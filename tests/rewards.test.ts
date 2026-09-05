import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveAdminPassword } from "../server/admin-account";
import { resolveAdminJwtSecret } from "../server/auth";
import { customerSessionTokenHash } from "../server/customer-auth";
import {
  calculateOrderCoinReward,
  canTransitionCoinWithdrawal,
  canTransitionNftWithdrawal,
  isNftMilestone,
  isTransactionHashValid,
  isWalletAddressValid,
  keccak256Hex,
  matchesCoinWithdrawalRequest,
  nftWithdrawalIdempotencyKey,
  normalizeRewardSettings,
  resolveNftTransferProviderConfig,
  shouldAccrueOrderRewards,
} from "../server/rewards";

test("order rewards are attempted only on the first completed transition", () => {
  assert.equal(shouldAccrueOrderRewards("ready", "completed", null), true);
  assert.equal(shouldAccrueOrderRewards("completed", "completed", null), false);
  assert.equal(shouldAccrueOrderRewards("cancelled", "completed", new Date()), false);
  assert.equal(shouldAccrueOrderRewards("ready", "cancelled", null), false);
});

test("coin reward snapshot totals stay integer and bounded", () => {
  assert.equal(calculateOrderCoinReward([
    { naktaCoinsReward: 4 },
    { naktaCoinsReward: 12 },
    { naktaCoinsReward: -5 },
  ]), 16);
  assert.throws(
    () => calculateOrderCoinReward([{ naktaCoinsReward: 2_147_483_648 }]),
    /слишком велика/i,
  );
});

test("NFT milestones and reward settings are normalized", () => {
  assert.equal(isNftMilestone(10, 10), true);
  assert.equal(isNftMilestone(11, 10), false);
  assert.equal(isNftMilestone(10, 0), false);
  assert.equal(normalizeRewardSettings({ nftRewardName: "" }).nftRewardName, "NFT NAKTA");
  assert.deepEqual(normalizeRewardSettings({
    nftRewardEveryOrders: -2,
    nftRewardName: "  ",
    nftRewardNetwork: "unknown",
    coinNetwork: "solana",
  }), {
    nftRewardEveryOrders: 0,
    nftRewardName: "NFT NAKTA",
    nftRewardImage: "",
    nftRewardDescription: "",
    nftRewardNetwork: "polygon",
    nftContractAddress: "",
    nftMetadataUri: "",
    coinNetwork: "solana",
  });
});

test("wallet validation uses chain-native decoding and checksums", () => {
  assert.equal(
    keccak256Hex(""),
    "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  );
  assert.equal(
    keccak256Hex("abc"),
    "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
  );
  assert.equal(isWalletAddressValid("polygon", `0x${"a".repeat(40)}`), true);
  assert.equal(
    isWalletAddressValid("ethereum", "0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE"),
    true,
  );
  assert.equal(
    isWalletAddressValid("ethereum", "0x5aEDA56215b167893e80B4fE645BA6d5Bab767DE"),
    false,
  );
  assert.equal(isWalletAddressValid("polygon", "0x123"), false);
  assert.equal(isWalletAddressValid("solana", "11111111111111111111111111111111"), true);
  assert.equal(isWalletAddressValid("solana", "z".repeat(32)), false);
  assert.equal(
    isWalletAddressValid("ton", "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c"),
    true,
  );
  assert.equal(
    isWalletAddressValid("ton", "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9d"),
    false,
  );
  assert.equal(isWalletAddressValid("ton", `0:${"0".repeat(64)}`), true);
});

test("withdrawal terminal states are guarded", () => {
  assert.equal(canTransitionCoinWithdrawal("pending", "failed"), true);
  assert.equal(canTransitionCoinWithdrawal("pending", "submitted"), true);
  assert.equal(canTransitionCoinWithdrawal("pending", "withdrawn"), false);
  assert.equal(canTransitionCoinWithdrawal("submitted", "submitted"), false);
  assert.equal(canTransitionCoinWithdrawal("submitted", "withdrawn"), true);
  assert.equal(canTransitionCoinWithdrawal("submitted", "failed"), false);
  assert.equal(canTransitionCoinWithdrawal("failed", "failed"), false);
  assert.equal(canTransitionCoinWithdrawal("cancelled", "submitted"), false);
  assert.equal(canTransitionNftWithdrawal("submitted", "failed"), false);
  assert.equal(canTransitionNftWithdrawal("submitted", "submitted"), false);
  assert.equal(canTransitionNftWithdrawal("pending", "withdrawn"), false);
});

test("transaction hashes have the expected byte shape for each network", () => {
  assert.equal(isTransactionHashValid("ethereum", `0x${"ab".repeat(32)}`), true);
  assert.equal(isTransactionHashValid("polygon", "ab".repeat(32)), false);
  assert.equal(isTransactionHashValid("bsc", `0x${"g".repeat(64)}`), false);

  assert.equal(isTransactionHashValid("solana", "1".repeat(64)), true);
  assert.equal(isTransactionHashValid("solana", "z".repeat(64)), false);

  assert.equal(isTransactionHashValid("ton", "ab".repeat(32)), true);
  assert.equal(isTransactionHashValid("ton", Buffer.alloc(32, 1).toString("base64")), true);
  assert.equal(isTransactionHashValid("ton", Buffer.alloc(32, 1).toString("base64url")), true);
  assert.equal(isTransactionHashValid("ton", Buffer.alloc(31, 1).toString("base64")), false);
  assert.equal(isTransactionHashValid("unknown", "ab".repeat(32)), false);
});

test("NFT provider configuration is authenticated and HTTPS in production", () => {
  assert.equal(resolveNftTransferProviderConfig(undefined, undefined, "production"), null);
  assert.throws(
    () => resolveNftTransferProviderConfig("http://provider.example/transfer", "x".repeat(32), "production"),
    /HTTPS/,
  );
  assert.throws(
    () => resolveNftTransferProviderConfig("https://provider.example/transfer", "short", "production"),
    /at least 32/,
  );
  assert.deepEqual(
    resolveNftTransferProviderConfig("http://127.0.0.1:9090/transfer", undefined, "development"),
    { url: "http://127.0.0.1:9090/transfer", token: null },
  );
  assert.deepEqual(
    resolveNftTransferProviderConfig("https://provider.example/transfer", "x".repeat(32), "production"),
    { url: "https://provider.example/transfer", token: "x".repeat(32) },
  );
});

test("NFT provider idempotency key is stable for one withdrawal attempt", () => {
  const nftId = "123e4567-e89b-42d3-a456-426614174000";
  const first = nftWithdrawalIdempotencyKey(nftId, "2026-09-05T12:00:00.000Z");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, nftWithdrawalIdempotencyKey(nftId, new Date("2026-09-05T12:00:00.000Z")));
  assert.notEqual(first, nftWithdrawalIdempotencyKey(nftId, "2026-09-05T12:00:01.000Z"));
});

test("coin withdrawal retry must keep the same amount and address", () => {
  const existing = { amount: "25", walletAddress: `0x${"b".repeat(40)}` };
  assert.equal(matchesCoinWithdrawalRequest(existing, {
    amount: 25,
    walletAddress: existing.walletAddress,
  }), true);
  assert.equal(matchesCoinWithdrawalRequest(existing, {
    amount: 26,
    walletAddress: existing.walletAddress,
  }), false);
  assert.equal(matchesCoinWithdrawalRequest(existing, {
    amount: 25,
    walletAddress: `0x${"c".repeat(40)}`,
  }), false);
});

test("production admin JWT secret has no known or short fallback", () => {
  assert.throws(() => resolveAdminJwtSecret(undefined, "production"), /at least 32/);
  assert.throws(() => resolveAdminJwtSecret("too-short", "production"), /at least 32/);
  assert.throws(
    () => resolveAdminJwtSecret("development-only-change-this-secret", "production"),
    /at least 32/,
  );
  assert.equal(resolveAdminJwtSecret("x".repeat(32), "production"), "x".repeat(32));
  assert.ok(resolveAdminJwtSecret(undefined, "development").length >= 32);
});

test("production admin password has no known or short fallback", () => {
  assert.throws(() => resolveAdminPassword(undefined, "production"), /at least 12/);
  assert.throws(() => resolveAdminPassword("short-pass", "production"), /at least 12/);
  assert.throws(() => resolveAdminPassword("ChangeMe123!", "production"), /at least 12/);
  assert.equal(resolveAdminPassword("unique-admin-password", "production"), "unique-admin-password");
  assert.equal(resolveAdminPassword(undefined, "development"), "ChangeMe123!");
});

test("customer session tokens are stored as deterministic one-way hashes", () => {
  const token = "a".repeat(64);
  const hash = customerSessionTokenHash(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hash, customerSessionTokenHash(token));
});

test("schema enforces one coin accrual and one milestone reward per order", async () => {
  const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /order_id BIGINT NOT NULL UNIQUE REFERENCES orders\(id\)/);
  assert.match(schema, /reward_key VARCHAR\(180\) NOT NULL UNIQUE/);
  assert.match(schema, /rewards_processed_at TIMESTAMPTZ/);
  assert.match(schema, /reward_completed_orders INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_sessions/);
  assert.match(schema, /request_key UUID NOT NULL/);
  assert.match(schema, /uq_coin_withdrawals_customer_request/);
  assert.match(schema, /uq_account_nfts_customer_milestone/);
});

test("NFT provider call happens only after an atomic submitted claim", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function dispatchNftWithdrawal");
  const end = source.indexOf("async function customerProfile", start);
  const dispatch = source.slice(start, end);
  const claim = dispatch.indexOf("SET status = 'submitted'");
  const providerCall = dispatch.indexOf("await fetch(");
  assert.ok(claim >= 0);
  assert.ok(providerCall > claim);
  assert.match(dispatch, /AND status = 'pending'[\s\S]*AND withdrawal_requested_at/);
  assert.match(dispatch, /AND status = 'submitted'[\s\S]*AND withdrawal_requested_at/);
});
