import { createHash } from "node:crypto";

export const REWARD_NETWORKS = ["polygon", "ethereum", "bsc", "solana", "ton"] as const;

export type RewardNetwork = typeof REWARD_NETWORKS[number];

export type RewardSettings = {
  nftRewardEveryOrders: number;
  nftRewardName: string;
  nftRewardImage: string;
  nftRewardDescription: string;
  nftRewardNetwork: RewardNetwork;
  nftContractAddress: string;
  nftMetadataUri: string;
  coinNetwork: RewardNetwork;
};

export const DEFAULT_REWARD_SETTINGS: RewardSettings = {
  nftRewardEveryOrders: 10,
  nftRewardName: "NFT NAKTA",
  nftRewardImage: "",
  nftRewardDescription: "",
  nftRewardNetwork: "polygon",
  nftContractAddress: "",
  nftMetadataUri: "",
  coinNetwork: "polygon",
};

export type NftTransferProviderConfig = {
  url: string;
  token: string | null;
};

const POSTGRES_INTEGER_MAX = 2_147_483_647;

function boundedString(value: unknown, fallback: string, maximumLength: number) {
  return (typeof value === "string" ? value : fallback).trim().slice(0, maximumLength);
}

function rewardNetwork(value: unknown, fallback: RewardNetwork): RewardNetwork {
  return REWARD_NETWORKS.includes(value as RewardNetwork) ? value as RewardNetwork : fallback;
}

export function resolveNftTransferProviderConfig(
  configuredUrl: string | undefined,
  configuredToken: string | undefined,
  environment: string | undefined,
): NftTransferProviderConfig | null {
  const rawUrl = configuredUrl?.trim() || "";
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("NFT_TRANSFER_WEBHOOK_URL must be a valid absolute URL");
  }
  if (url.username || url.password) {
    throw new Error("NFT_TRANSFER_WEBHOOK_URL must not contain credentials");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(environment !== "production" && url.protocol === "http:" && loopback)) {
    throw new Error("NFT_TRANSFER_WEBHOOK_URL must use HTTPS outside local development");
  }
  const token = configuredToken?.trim() || "";
  if ((environment === "production" || !loopback) && token.length < 32) {
    throw new Error("NFT_TRANSFER_WEBHOOK_TOKEN must contain at least 32 private characters");
  }
  return { url: url.toString(), token: token || null };
}

export function nftWithdrawalIdempotencyKey(nftId: string, requestedAt: unknown) {
  const date = requestedAt instanceof Date ? requestedAt : new Date(String(requestedAt || ""));
  if (!isUuid(nftId) || Number.isNaN(date.getTime())) {
    throw new TypeError("A valid NFT withdrawal attempt is required");
  }
  return createHash("sha256").update(`${nftId}:${date.toISOString()}`).digest("hex");
}

export function normalizeRewardSettings(value: unknown): RewardSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rawMilestone = Number(source.nftRewardEveryOrders);
  const nftRewardEveryOrders = Number.isInteger(rawMilestone)
    ? Math.min(10_000, Math.max(0, rawMilestone))
    : DEFAULT_REWARD_SETTINGS.nftRewardEveryOrders;
  const nftRewardName = boundedString(
    source.nftRewardName,
    DEFAULT_REWARD_SETTINGS.nftRewardName,
    160,
  ) || DEFAULT_REWARD_SETTINGS.nftRewardName;

  return {
    nftRewardEveryOrders,
    nftRewardName,
    nftRewardImage: boundedString(source.nftRewardImage, "", 2_000_000),
    nftRewardDescription: boundedString(source.nftRewardDescription, "", 2_000),
    nftRewardNetwork: rewardNetwork(
      source.nftRewardNetwork,
      DEFAULT_REWARD_SETTINGS.nftRewardNetwork,
    ),
    nftContractAddress: boundedString(source.nftContractAddress, "", 200),
    nftMetadataUri: boundedString(source.nftMetadataUri, "", 2_000),
    coinNetwork: rewardNetwork(source.coinNetwork, DEFAULT_REWARD_SETTINGS.coinNetwork),
  };
}

export function calculateOrderCoinReward(
  items: Array<{ naktaCoinsReward?: unknown }>,
) {
  const amount = items.reduce((total, item) => {
    const reward = Number(item.naktaCoinsReward ?? 0);
    return total + (Number.isInteger(reward) && reward > 0 ? reward : 0);
  }, 0);
  if (!Number.isSafeInteger(amount) || amount > POSTGRES_INTEGER_MAX) {
    throw new RangeError("Сумма награды NAKTA Coin слишком велика");
  }
  return amount;
}

export function isNftMilestone(completedOrders: number, everyOrders: number) {
  return Number.isInteger(completedOrders)
    && completedOrders > 0
    && Number.isInteger(everyOrders)
    && everyOrders > 0
    && completedOrders % everyOrders === 0;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const UINT64_MASK = BigInt("0xffffffffffffffff");
const KECCAK_ROUND_CONSTANTS = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a",
  "0x8000000080008000", "0x000000000000808b", "0x0000000080000001",
  "0x8000000080008081", "0x8000000000008009", "0x000000000000008a",
  "0x0000000000000088", "0x0000000080008009", "0x000000008000000a",
  "0x000000008000808b", "0x800000000000008b", "0x8000000000008089",
  "0x8000000000008003", "0x8000000000008002", "0x8000000000000080",
  "0x000000000000800a", "0x800000008000000a", "0x8000000080008081",
  "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map((value) => BigInt(value));
const KECCAK_ROTATIONS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotateLeft64(value: bigint, shift: number) {
  if (shift === 0) return value & UINT64_MASK;
  const distance = BigInt(shift);
  return ((value << distance) | (value >> (BigInt(64) - distance))) & UINT64_MASK;
}

function keccakPermutation(state: bigint[]) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columns = Array.from({ length: 5 }, (_, x) => (
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    ));
    const theta = columns.map((_, x) => columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1));
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) state[x + 5 * y] = (state[x + 5 * y] ^ theta[x]) & UINT64_MASK;
    }

    const rotated = Array<bigint>(25).fill(BigInt(0));
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        rotated[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft64(
          state[x + 5 * y],
          KECCAK_ROTATIONS[x + 5 * y],
        );
      }
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] = (
          rotated[x + 5 * y]
          ^ ((~rotated[(x + 1) % 5 + 5 * y]) & rotated[(x + 2) % 5 + 5 * y])
        ) & UINT64_MASK;
      }
    }
    state[0] = (state[0] ^ roundConstant) & UINT64_MASK;
  }
}

export function keccak256Hex(value: string) {
  const rateBytes = 136;
  const input = new TextEncoder().encode(value);
  const paddingLength = rateBytes - (input.length % rateBytes);
  const padded = new Uint8Array(input.length + paddingLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const state = Array<bigint>(25).fill(BigInt(0));
  for (let offset = 0; offset < padded.length; offset += rateBytes) {
    for (let byteIndex = 0; byteIndex < rateBytes; byteIndex += 1) {
      const lane = Math.floor(byteIndex / 8);
      const shift = BigInt((byteIndex % 8) * 8);
      state[lane] ^= BigInt(padded[offset + byteIndex]) << shift;
    }
    keccakPermutation(state);
  }
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & BigInt(0xff));
  }
  return Buffer.from(output).toString("hex");
}

function isEvmAddressValid(candidate: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(candidate)) return false;
  const address = candidate.slice(2);
  if (address === address.toLowerCase() || address === address.toUpperCase()) return true;
  const checksum = keccak256Hex(address.toLowerCase());
  return [...address].every((character, index) => {
    if (!/[a-f]/i.test(character)) return true;
    const uppercase = Number.parseInt(checksum[index], 16) >= 8;
    return uppercase ? character === character.toUpperCase() : character === character.toLowerCase();
  });
}

function decodedBase58Length(value: string) {
  let decoded = BigInt(0);
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return -1;
    decoded = decoded * BigInt(58) + BigInt(digit);
  }
  let byteLength = 0;
  while (decoded > 0) {
    byteLength += 1;
    decoded >>= BigInt(8);
  }
  let leadingZeroes = 0;
  while (value[leadingZeroes] === "1") leadingZeroes += 1;
  return leadingZeroes + byteLength;
}

function crc16Xmodem(value: Uint8Array) {
  let crc = 0;
  for (const byte of value) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

function isTonFriendlyAddressValid(candidate: string) {
  if (!/^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/.test(candidate)) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(candidate, "base64url");
  } catch {
    return false;
  }
  if (decoded.length !== 36 || ![0x11, 0x51].includes(decoded[0]) || ![0x00, 0xff].includes(decoded[1])) return false;
  const checksum = crc16Xmodem(decoded.subarray(0, 34));
  return decoded[34] === (checksum >> 8) && decoded[35] === (checksum & 0xff);
}

export function shouldAccrueOrderRewards(
  currentStatus: string,
  nextStatus: string,
  rewardsProcessedAt: unknown,
) {
  return currentStatus !== "completed"
    && nextStatus === "completed"
    && (rewardsProcessedAt === null || rewardsProcessedAt === undefined);
}

export function matchesCoinWithdrawalRequest(
  existing: { amount: unknown; walletAddress: string },
  requested: { amount: number; walletAddress: string },
) {
  return Number(existing.amount) === requested.amount
    && existing.walletAddress === requested.walletAddress;
}

export function isWalletAddressValid(network: string, address: string) {
  const candidate = address.trim();
  if (["polygon", "ethereum", "bsc"].includes(network)) {
    return isEvmAddressValid(candidate);
  }
  if (network === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate)
      && decodedBase58Length(candidate) === 32;
  }
  if (network === "ton") {
    return /^(?:-1|0):[a-fA-F0-9]{64}$/.test(candidate)
      || isTonFriendlyAddressValid(candidate);
  }
  return false;
}

function isThirtyTwoByteBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

export function isTransactionHashValid(network: string, transactionHash: string) {
  const candidate = transactionHash.trim();
  if (["polygon", "ethereum", "bsc"].includes(network)) {
    return /^0x[a-fA-F0-9]{64}$/.test(candidate);
  }
  if (network === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(candidate)
      && decodedBase58Length(candidate) === 64;
  }
  if (network === "ton") {
    return /^[a-fA-F0-9]{64}$/.test(candidate) || isThirtyTwoByteBase64(candidate);
  }
  return false;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function canTransitionCoinWithdrawal(current: string, next: string) {
  if (current === "pending") return ["submitted", "failed"].includes(next);
  if (current === "submitted") return next === "withdrawn";
  return false;
}

export function canTransitionNftWithdrawal(current: string, next: string) {
  if (current === "pending") return ["submitted", "failed"].includes(next);
  if (current === "submitted") return next === "withdrawn";
  return false;
}
