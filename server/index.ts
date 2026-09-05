import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { seed } from "./seed";
import { syncAdminPassword } from "./admin-account";
import {
  clearAdminSessionCookie,
  createAdminToken,
  requireAdmin,
  revokeCurrentAdminSession,
  setAdminSessionCookie,
} from "./auth";
import {
  authenticatedCustomer,
  clearCustomerSessionCookie,
  createCustomerSession,
  requireCustomer,
  revokeCurrentCustomerSession,
  setCustomerSessionCookie,
  type CustomerIdentity,
} from "./customer-auth";
import { closeDatabase, sql } from "./db";
import { migrate } from "./migrate";
import { NikitaOtpError, sendNikitaOtp, verifyNikitaOtp } from "./nikita-otp";
import { resolveCorsOrigins } from "./cors-origins";
import {
  opaqueClientRateLimitKey,
  opaquePhoneRateLimitKey,
  opaqueRateLimitKey,
} from "./rate-limit-keys";
import {
  calculateOrderCoinReward,
  canTransitionCoinWithdrawal,
  canTransitionNftWithdrawal,
  isNftMilestone,
  isTransactionHashValid,
  isUuid,
  isWalletAddressValid,
  matchesCoinWithdrawalRequest,
  nftWithdrawalIdempotencyKey,
  normalizeRewardSettings,
  resolveNftTransferProviderConfig,
  shouldAccrueOrderRewards,
} from "./rewards";
import { resolveYandexMapLink, YandexMapLinkError } from "./yandex-map-link";

const app = express();
const port = Number(process.env.PORT || 4000);
const apiHost = process.env.API_HOST || "127.0.0.1";
const nftTransferProvider = resolveNftTransferProviderConfig(
  process.env.NFT_TRANSFER_WEBHOOK_URL,
  process.env.NFT_TRANSFER_WEBHOOK_TOKEN,
  process.env.NODE_ENV,
);
const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploadsDirectory = join(rootDirectory, "public", "uploads");
const corsOrigins = resolveCorsOrigins(process.env.CORS_ORIGIN, process.env.NODE_ENV);
await mkdir(uploadsDirectory, { recursive: true });

app.set("trust proxy", process.env.TRUST_PROXY === "loopback" ? "loopback" : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
if (corsOrigins.length > 0) app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDirectory, { maxAge: "7d", immutable: false }));

function configuredLimit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const clientRateKey = (request: Request, scope: string) => opaqueClientRateLimitKey(
  scope,
  request.socket.remoteAddress,
  request.headers["x-forwarded-for"],
);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const otpServiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: configuredLimit("OTP_SERVICE_LIMIT_PER_15_MINUTES", 120),
  standardHeaders: false,
  legacyHeaders: false,
  skip: (request) => {
    const phone = String(request.body?.phone || "").replace(/\D/g, "");
    if (!/^996\d{9}$/.test(phone) || verificationRequestsInFlight.has(phone)) return true;
    const challenge = verificationChallenges.get(phone);
    return Boolean(challenge && Date.now() - challenge.requestedAt < verificationResendDelayMs);
  },
  keyGenerator: () => opaqueRateLimitKey("otp-service", "all"),
  handler: (_request, response) => response.status(429).json({ error: "Отправка кодов временно перегружена. Попробуйте позже" }),
});
const otpClientLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: configuredLimit("OTP_CLIENT_LIMIT_PER_15_MINUTES", 15),
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (request) => clientRateKey(request, "otp-client"),
  handler: (_request, response) => response.status(429).json({ error: "Слишком много запросов кода. Попробуйте позже" }),
});
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (request) => !/^996\d{9}$/.test(String(request.body?.phone || "").replace(/\D/g, "")),
  keyGenerator: (request) => opaquePhoneRateLimitKey("otp-request", request.body?.phone),
  handler: (_request, response) => response.status(429).json({ error: "Слишком много запросов кода. Попробуйте позже" }),
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => opaquePhoneRateLimitKey("otp-verify", request.body?.phone),
  handler: (_request, response) => response.status(429).json({ error: "Слишком много попыток. Попробуйте позже" }),
});
const orderClientLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: configuredLimit("ORDER_CLIENT_LIMIT_PER_10_MINUTES", 30),
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (request) => clientRateKey(request, "order-client"),
  handler: (_request, response) => response.status(429).json({ error: "Слишком много заказов. Попробуйте позже" }),
});
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => opaquePhoneRateLimitKey("order", request.body?.customerPhone),
});
const rewardLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (_request, response) => opaqueRateLimitKey(
    "reward-customer",
    response.locals.customer?.id || "anonymous",
  ),
  handler: (_request, response) => response.status(429).json({ error: "Слишком много операций с наградами. Попробуйте позже" }),
});
const geocodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ error: "Слишком много запросов к поиску адреса. Подождите несколько минут" }),
});
const validStatuses = new Set(["new", "confirmed", "preparing", "ready", "completed", "cancelled"]);
type VerificationChallenge =
  | { mode: "nikita"; token: string; requestedAt: number; expiresAt: number; attempts: number }
  | { mode: "development"; code: string; requestedAt: number; expiresAt: number; attempts: number };
const verificationChallenges = new Map<string, VerificationChallenge>();
const verificationRequestsInFlight = new Set<string>();
const kyrgyzPhonePattern = /^996\d{9}$/;
const verificationLifetimeMs = 10 * 60 * 1000;
const verificationResendDelayMs = 60 * 1000;
const maxVerificationAttempts = 5;

function requireTrustedAdminOrigin(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.headers.origin?.trim();
  if (origin && !corsOrigins.includes(origin)) {
    response.status(403).json({ error: "Источник административного запроса не разрешён" });
    return;
  }
  next();
}

function pruneVerificationChallenges(now = Date.now()) {
  for (const [phone, challenge] of verificationChallenges) {
    if (challenge.expiresAt < now) verificationChallenges.delete(phone);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDirectory,
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback = true) {
  return value === undefined ? fallback : value === true || value === "true";
}

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function integerValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function normalizedCustomerPhone(value: unknown) {
  const phone = String(value || "").replace(/\D/g, "");
  return kyrgyzPhonePattern.test(phone) ? phone : "";
}

function requestedCustomerMatches(request: Request, response: Response) {
  const customer = authenticatedCustomer(response);
  if (request.query.phone === undefined) return true;
  const requestedPhone = normalizedCustomerPhone(request.query.phone);
  if (requestedPhone && requestedPhone === customer.phone) return true;
  response.status(403).json({ error: "Нельзя открыть данные другого профиля" });
  return false;
}

async function loadRewardSettings() {
  const [row] = await sql`SELECT value FROM site_settings WHERE key = 'rewards' LIMIT 1`;
  return normalizeRewardSettings(row?.value);
}

type DatabaseNft = Record<string, unknown> & {
  id: string;
  customer_id: number | string;
  reward_key: string;
  order_id: number | string | null;
  milestone_order_count: number;
  name: string;
  image: string;
  description: string;
  network: string;
  contract_address: string;
  metadata_uri: string;
  token_id: string | null;
  status: string;
  wallet_address: string | null;
  tx_hash: string | null;
  withdrawal_error: string | null;
  withdrawal_requested_at: Date | string | null;
  withdrawn_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DatabaseCoinWithdrawal = Record<string, unknown> & {
  id: string;
  customer_id: number | string;
  request_key: string;
  amount: number;
  wallet_address: string;
  network: string;
  status: string;
  tx_hash: string | null;
  error: string | null;
  processed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function publicNft(row: DatabaseNft) {
  return {
    id: String(row.id),
    customerId: Number(row.customer_id),
    rewardKey: row.reward_key,
    orderId: row.order_id === null ? null : String(row.order_id),
    milestoneOrderCount: Number(row.milestone_order_count),
    name: row.name,
    image: row.image,
    description: row.description,
    network: row.network,
    contractAddress: row.contract_address,
    metadataUri: row.metadata_uri,
    tokenId: row.token_id,
    status: row.status,
    walletAddress: row.wallet_address,
    txHash: row.tx_hash,
    withdrawalError: row.withdrawal_error,
    withdrawalRequestedAt: row.withdrawal_requested_at,
    withdrawnAt: row.withdrawn_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicCoinWithdrawal(row: DatabaseCoinWithdrawal) {
  return {
    id: String(row.id),
    customerId: Number(row.customer_id),
    requestId: String(row.request_key),
    amount: Number(row.amount),
    walletAddress: row.wallet_address,
    network: row.network,
    status: row.status,
    txHash: row.tx_hash,
    error: row.error,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function nftById(id: string) {
  const [row] = await sql<DatabaseNft[]>`SELECT * FROM account_nfts WHERE id = ${id}::uuid LIMIT 1`;
  return row;
}

async function dispatchNftWithdrawal(attempt: DatabaseNft) {
  if (!nftTransferProvider) return publicNft(attempt);

  // Claim the attempt in the database before any irreversible provider call.
  // Once submitted, neither the customer nor an administrator can refund/retry it.
  const [claimed] = await sql<DatabaseNft[]>`
    UPDATE account_nfts
    SET status = 'submitted',
        withdrawal_error = 'Отправка передана провайдеру; подтверждение ожидается.',
        updated_at = NOW()
    WHERE id = ${attempt.id}::uuid
      AND status = 'pending'
      AND withdrawal_requested_at = ${attempt.withdrawal_requested_at}
    RETURNING *
  `;
  if (!claimed) {
    const current = await nftById(attempt.id);
    if (!current) throw new ApiError(404, "NFT не найден");
    return publicNft(current);
  }

  const settle = async (values: {
    status: "submitted" | "withdrawn";
    txHash: string | null;
    tokenId: string | null;
    error: string | null;
  }) => {
    const [updated] = await sql<DatabaseNft[]>`
      UPDATE account_nfts
      SET status = ${values.status},
          tx_hash = ${values.txHash},
          token_id = ${values.tokenId},
          withdrawal_error = ${values.error},
          withdrawn_at = ${values.status === "withdrawn" ? new Date() : null},
          updated_at = NOW()
      WHERE id = ${claimed.id}::uuid
        AND status = 'submitted'
        AND withdrawal_requested_at = ${claimed.withdrawal_requested_at}
        AND tx_hash IS NULL
      RETURNING *
    `;
    const current = updated || await nftById(claimed.id);
    if (!current) throw new ApiError(404, "NFT не найден");
    return publicNft(current);
  };

  let providerSettlement: {
    status: "submitted" | "withdrawn";
    txHash: string;
    tokenId: string | null;
    error: null;
  };
  try {
    const idempotencyKey = nftWithdrawalIdempotencyKey(
      claimed.id,
      claimed.withdrawal_requested_at,
    );
    const upstream = await fetch(nftTransferProvider.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        ...(nftTransferProvider.token ? { authorization: `Bearer ${nftTransferProvider.token}` } : {}),
      },
      body: JSON.stringify({
        withdrawalId: claimed.id,
        idempotencyKey,
        walletAddress: claimed.wallet_address,
        network: claimed.network,
        contractAddress: claimed.contract_address || undefined,
        metadataUri: claimed.metadata_uri || undefined,
        name: claimed.name,
        description: claimed.description,
        image: claimed.image,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) throw new Error(`provider returned ${upstream.status}`);
    const result = await upstream.json() as {
      status?: "submitted" | "withdrawn";
      txHash?: string;
      tokenId?: string;
    };
    const txHash = result.txHash?.trim().slice(0, 200) || "";
    if (!txHash || !isTransactionHashValid(claimed.network, txHash)) {
      throw new Error("provider did not return a valid transaction hash");
    }
    providerSettlement = {
      status: result.status === "withdrawn" ? "withdrawn" : "submitted",
      txHash,
      tokenId: result.tokenId?.trim().slice(0, 160) || null,
      error: null,
    };
  } catch (error) {
    console.error("NFT withdrawal provider status is uncertain", {
      nftId: claimed.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return settle({
      status: "submitted",
      txHash: null,
      tokenId: null,
      error: "Статус отправки не подтверждён, требуется ручная проверка.",
    });
  }
  return settle(providerSettlement);
}

async function customerProfile(customer: { id: number; phone: string; name: string | null }) {
  const [accountRows, orders, coinTransactions, coinWithdrawals, nfts, adjustments, rewards] = await Promise.all([
    sql`SELECT nakta_coins AS "naktaCoins" FROM customers WHERE id = ${customer.id}`,
    sql`
      SELECT orders.id, orders.order_number AS "orderNumber", orders.total, orders.status,
        orders.created_at AS "createdAt", locations.name AS "locationName",
        locations.address AS "locationAddress",
        COALESCE((
          SELECT rewards.amount
          FROM nakta_coin_transactions rewards
          WHERE rewards.order_id = orders.id
        ), 0) AS "earnedNaktaCoins"
      FROM orders
      LEFT JOIN pickup_locations locations ON locations.id = orders.location_id
      WHERE orders.customer_id = ${customer.id}
      ORDER BY orders.created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT id, order_id AS "orderId", amount, description, created_at AS "createdAt"
      FROM nakta_coin_transactions
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql<DatabaseCoinWithdrawal[]>`
      SELECT * FROM nakta_coin_withdrawals
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    sql<DatabaseNft[]>`
      SELECT * FROM account_nfts
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    sql`
      SELECT id, delta, reason, created_at AS "createdAt"
      FROM customer_reward_adjustments
      WHERE customer_id = ${customer.id} AND asset = 'coin'
      ORDER BY created_at DESC
      LIMIT 100
    `,
    loadRewardSettings(),
  ]);

  const withdrawalHistory = coinWithdrawals.flatMap((withdrawal) => {
    const reason = withdrawal.error?.trim() || null;
    const request = {
      id: `withdrawal-${withdrawal.id}`,
      amount: -Number(withdrawal.amount),
      createdAt: withdrawal.created_at,
      description: withdrawal.status === "withdrawn"
        ? "Вывод NAKTA Coin завершён"
        : withdrawal.status === "cancelled"
          ? "Заявка на вывод NAKTA Coin отменена"
          : withdrawal.status === "failed"
            ? "Заявка на вывод NAKTA Coin отклонена"
            : "Заявка на вывод NAKTA Coin",
      withdrawalId: String(withdrawal.id),
      withdrawalStatus: withdrawal.status,
      withdrawalReason: reason,
    };
    return ["failed", "cancelled"].includes(withdrawal.status)
      ? [request, {
        id: `withdrawal-refund-${withdrawal.id}`,
        amount: Number(withdrawal.amount),
        createdAt: withdrawal.processed_at || withdrawal.created_at,
        description: `${withdrawal.status === "cancelled"
          ? "Возврат NAKTA Coin после отмены вывода"
          : "Возврат NAKTA Coin после отклонения вывода"}${reason ? `. Причина: ${reason}` : ""}`,
        withdrawalId: String(withdrawal.id),
        withdrawalStatus: withdrawal.status,
        withdrawalReason: reason,
      }]
      : [request];
  });
  const history = [
    ...coinTransactions.map((entry) => ({
      id: String(entry.id),
      orderId: String(entry.orderId),
      amount: Number(entry.amount),
      description: String(entry.description),
      createdAt: entry.createdAt,
    })),
    ...adjustments.map((entry) => ({
      id: `adjustment-${entry.id}`,
      amount: Number(entry.delta),
      description: String(entry.reason),
      createdAt: entry.createdAt,
    })),
    ...withdrawalHistory,
  ].sort((left, right) => new Date(right.createdAt as string).getTime() - new Date(left.createdAt as string).getTime());
  const serializedOrders = orders.map((order) => ({
    id: String(order.id),
    orderNumber: String(order.orderNumber),
    total: Number(order.total),
    status: String(order.status),
    deliveryType: "pickup" as const,
    address: String(order.locationAddress || ""),
    locationName: String(order.locationName || ""),
    locationAddress: String(order.locationAddress || ""),
    earnedNaktaCoins: Number(order.earnedNaktaCoins || 0),
    naktaCoins: Number(order.earnedNaktaCoins || 0),
    createdAt: order.createdAt,
  }));
  const currentStatuses = new Set(["new", "confirmed", "preparing", "ready"]);

  return {
    customer,
    naktaCoins: Number(accountRows[0]?.naktaCoins || 0),
    coinNetwork: rewards.coinNetwork,
    naktaCoinHistory: history,
    naktaCoinTransactions: history,
    nfts: nfts.map(publicNft),
    naktaCoinWithdrawals: coinWithdrawals.map(publicCoinWithdrawal),
    currentOrders: serializedOrders.filter((order) => currentStatuses.has(order.status)),
    orderHistory: serializedOrders.filter((order) => !currentStatuses.has(order.status)),
  };
}

async function adminCustomerDetail(phone: string) {
  const [summary] = await sql`
    SELECT customers.id::int AS id, customers.phone,
      COALESCE(customers.name, '') AS "customerName",
      COUNT(orders.id)::int AS "ordersCount",
      COUNT(orders.id) FILTER (WHERE orders.status = 'completed')::int AS "completedOrders",
      COALESCE(SUM(orders.total) FILTER (WHERE orders.status = 'completed'), 0)::bigint AS revenue,
      COALESCE(MAX(orders.created_at), customers.created_at) AS "lastOrderAt",
      customers.nakta_coins AS "naktaCoins"
    FROM customers
    LEFT JOIN orders ON orders.customer_id = customers.id
    WHERE customers.phone = ${phone}
    GROUP BY customers.id
  `;
  if (!summary) return null;

  const [orders, nfts, adjustments] = await Promise.all([
    sql`
      SELECT orders.id, orders.order_number AS "orderNumber", orders.total, orders.status,
        'pickup'::text AS "deliveryType", 'cash'::text AS "paymentMethod",
        locations.address, orders.created_at AS "createdAt"
      FROM orders
      LEFT JOIN pickup_locations locations ON locations.id = orders.location_id
      WHERE orders.customer_id = ${summary.id}
      ORDER BY orders.created_at DESC
      LIMIT 200
    `,
    sql<DatabaseNft[]>`
      SELECT * FROM account_nfts
      WHERE customer_id = ${summary.id}
      ORDER BY created_at DESC
      LIMIT 500
    `,
    sql`
      SELECT id, asset, delta, balance_after AS "balanceAfter", reason,
        created_at AS "createdAt"
      FROM customer_reward_adjustments
      WHERE customer_id = ${summary.id}
      ORDER BY created_at DESC
      LIMIT 100
    `,
  ]);
  const availableNftCount = nfts.filter((nft) => nft.status === "owned").length;
  const pendingNftCount = nfts.filter((nft) => ["pending", "submitted"].includes(nft.status)).length;

  return {
    phone: String(summary.phone),
    regionSlug: "default",
    customerName: String(summary.customerName || ""),
    ordersCount: Number(summary.ordersCount),
    completedOrders: Number(summary.completedOrders),
    revenue: Number(summary.revenue),
    lastOrderAt: summary.lastOrderAt,
    naktaCoins: Number(summary.naktaCoins),
    nftCount: nfts.length,
    availableNftCount,
    pendingNftCount,
    orders: orders.map((order) => ({
      ...order,
      id: String(order.id),
      total: Number(order.total),
    })),
    nfts: nfts.map((nft) => ({
      ...publicNft(nft),
      phone: String(summary.phone),
      regionSlug: "default",
    })),
    adjustments: adjustments.map((adjustment) => ({
      ...adjustment,
      id: String(adjustment.id),
      phone: String(summary.phone),
      regionSlug: "default",
      delta: Number(adjustment.delta),
      balanceAfter: Number(adjustment.balanceAfter),
    })),
  };
}

function locationCoordinates(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const values = body as Record<string, unknown>;
  const parseCoordinate = (value: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return Number.NaN;
  };
  const latitude = parseCoordinate(values.latitude);
  const longitude = parseCoordinate(values.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

const yandexGeocoderUrl = "https://geocode-maps.yandex.ru/v1/";
const yandexGeocoderTimeoutMs = 8_000;

type YandexGeocoderResponse = {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject?: {
          description?: string;
          name?: string;
          metaDataProperty?: {
            GeocoderMetaData?: {
              text?: string;
              Address?: { formatted?: string };
            };
          };
          Point?: { pos?: string };
        };
      }>;
    };
  };
};

class YandexGeocoderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function queryCoordinate(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value);
}

async function geocodeWithYandex(searchValue: string) {
  const apiKey = String(process.env.YANDEX_GEOCODER_API_KEY || "").trim();
  if (!apiKey) throw new YandexGeocoderError(503, "Геокодер Яндекса не настроен: добавьте YANDEX_GEOCODER_API_KEY");

  const url = new URL(yandexGeocoderUrl);
  url.search = new URLSearchParams({
    apikey: apiKey,
    geocode: searchValue,
    lang: "ru_RU",
    format: "json",
    results: "1",
  }).toString();

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", referer: "https://daanasushi.com/" },
      signal: AbortSignal.timeout(yandexGeocoderTimeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new YandexGeocoderError(504, "Яндекс Карты не ответили вовремя. Попробуйте ещё раз");
    }
    throw new YandexGeocoderError(502, "Не удалось связаться с геокодером Яндекса");
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      throw new YandexGeocoderError(502, "Яндекс отклонил ключ геокодера. Проверьте YANDEX_GEOCODER_API_KEY");
    }
    if (upstream.status === 429) {
      throw new YandexGeocoderError(429, "Превышен лимит запросов к геокодеру Яндекса. Попробуйте позже");
    }
    throw new YandexGeocoderError(502, "Геокодер Яндекса временно недоступен");
  }

  let payload: YandexGeocoderResponse;
  try {
    payload = await upstream.json() as YandexGeocoderResponse;
  } catch {
    throw new YandexGeocoderError(502, "Геокодер Яндекса вернул некорректный ответ");
  }

  const geoObject = payload.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const [longitude, latitude] = String(geoObject?.Point?.pos || "").trim().split(/\s+/).map(Number);
  const metadata = geoObject?.metaDataProperty?.GeocoderMetaData;
  const fallbackAddress = [geoObject?.description, geoObject?.name].filter(Boolean).join(", ");
  const address = String(metadata?.Address?.formatted || metadata?.text || fallbackAddress).trim();
  if (!address || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new YandexGeocoderError(404, "Адрес не найден. Уточните запрос или выберите другую точку на карте");
  }

  return { address, latitude, longitude };
}

app.get("/api/health", async (_request, response) => {
  const [result] = await sql`SELECT NOW() AS now`;
  response.json({ status: "ok", database: true, now: result.now });
});

app.get("/api/catalog", async (_request, response) => {
  const categoryRows = await sql`SELECT id, name, slug, sort_order AS "sortOrder", active FROM categories WHERE active = TRUE ORDER BY sort_order, id`;
  const productRows = await sql`SELECT id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder", nakta_coins AS "naktaCoins" FROM products WHERE active = TRUE ORDER BY category_id, sort_order, id`;
  response.json({ categories: categoryRows, products: productRows });
});

app.get("/api/locations", async (_request, response) => {
  const rows = await sql`SELECT id, name, address, phone, hours, opens_at AS "opensAt", latitude, longitude, active FROM pickup_locations WHERE active = TRUE ORDER BY id`;
  response.json(rows);
});

app.get("/api/promotions", async (_request, response) => {
  const rows = await sql`SELECT id, title, description, image, active, sort_order AS "sortOrder" FROM promotions WHERE active = TRUE ORDER BY sort_order, id`;
  response.json(rows);
});

app.get("/api/settings", async (_request, response) => {
  const rows = await sql`SELECT key, value FROM site_settings`;
  response.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
});

app.post("/api/auth/request-code", otpClientLimiter, otpRequestLimiter, otpServiceLimiter, async (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  if (!kyrgyzPhonePattern.test(phone)) return response.status(400).json({ error: "Укажите телефон в формате +996" });
  const now = Date.now();
  pruneVerificationChallenges(now);
  const existingChallenge = verificationChallenges.get(phone);
  if (existingChallenge && now - existingChallenge.requestedAt < verificationResendDelayMs) {
    return response.status(429).json({ error: "Код уже отправлен. Повторите через минуту" });
  }
  if (verificationRequestsInFlight.has(phone)) {
    return response.status(429).json({ error: "Код уже отправляется. Подождите несколько секунд" });
  }
  verificationRequestsInFlight.add(phone);
  const apiKey = String(process.env.NIKITA_OTP_API_KEY || "").trim();
  try {
    if (apiKey) {
      const transactionId = randomUUID().replaceAll("-", "");
      const token = await sendNikitaOtp(apiKey, phone, transactionId);
      verificationChallenges.set(phone, { mode: "nikita", token, requestedAt: now, expiresAt: now + verificationLifetimeMs, attempts: 0 });
      return response.json({ sent: true });
    }
    if (process.env.NODE_ENV === "production") return response.status(503).json({ error: "Отправка SMS ещё не настроена" });

    const code = "0000";
    verificationChallenges.set(phone, { mode: "development", code, requestedAt: now, expiresAt: now + verificationLifetimeMs, attempts: 0 });
    return response.json({ sent: true, devCode: code });
  } catch (error) {
    if (error instanceof NikitaOtpError) return response.status(error.httpStatus).json({ error: error.message });
    console.error("Nikita OTP send failed", error);
    return response.status(502).json({ error: "Не удалось отправить SMS-код" });
  } finally {
    verificationRequestsInFlight.delete(phone);
  }
});

app.post("/api/auth/verify-code", otpVerifyLimiter, async (request, response) => {
  const phone = String(request.body.phone || "").replace(/\D/g, "");
  const code = String(request.body.code || "").trim();
  if (!kyrgyzPhonePattern.test(phone) || code.length < 4 || code.length > 32) return response.status(400).json({ error: "Укажите корректные телефон и код" });
  const challenge = verificationChallenges.get(phone);
  if (!challenge || challenge.expiresAt < Date.now()) {
    verificationChallenges.delete(phone);
    return response.status(400).json({ error: "Код устарел. Запросите новый" });
  }
  if (challenge.attempts >= maxVerificationAttempts) {
    verificationChallenges.delete(phone);
    return response.status(429).json({ error: "Слишком много попыток. Запросите новый код" });
  }

  try {
    if (challenge.mode === "nikita") {
      const apiKey = String(process.env.NIKITA_OTP_API_KEY || "").trim();
      if (!apiKey) return response.status(503).json({ error: "Проверка SMS временно недоступна" });
      await verifyNikitaOtp(apiKey, challenge.token, code);
    } else if (challenge.code !== code) {
      challenge.attempts += 1;
      return response.status(400).json({ error: "Неверный код" });
    }

    verificationChallenges.delete(phone);
    const [customer] = await sql<CustomerIdentity[]>`INSERT INTO customers (phone) VALUES (${phone}) ON CONFLICT (phone) DO UPDATE SET updated_at = NOW() RETURNING id::int, phone, name`;
    const session = await createCustomerSession(customer);
    setCustomerSessionCookie(response, session.verificationToken);
    response.setHeader("Cache-Control", "no-store");
    return response.json({ customer, expiresInSeconds: session.expiresInSeconds });
  } catch (error) {
    if (error instanceof NikitaOtpError) {
      if (error.providerStatus === 12 || error.providerStatus === 13) verificationChallenges.delete(phone);
      else if (error.providerStatus === 14) challenge.attempts += 1;
      return response.status(error.httpStatus).json({ error: error.message });
    }
    console.error("Nikita OTP verification failed", error);
    return response.status(502).json({ error: "Не удалось проверить SMS-код" });
  }
});

app.post("/api/orders", orderClientLimiter, orderLimiter, async (request, response) => {
  const customerName = String(request.body.customerName || "").trim();
  const customerPhone = String(request.body.customerPhone || "").trim();
  const locationId = numberValue(request.body.locationId);
  const rawItems = Array.isArray(request.body.items) ? request.body.items : [];
  if (!customerName || !kyrgyzPhonePattern.test(customerPhone.replace(/\D/g, "")) || !locationId || rawItems.length === 0) return response.status(400).json({ error: "Заполните контактные данные и укажите телефон в формате +996" });
  const requested = new Map<number, number>();
  for (const item of rawItems) {
    const productId = integerValue(item.productId); const quantity = Math.min(99, Math.max(1, integerValue(item.quantity, 1)));
    if (productId) requested.set(productId, Math.min(99, (requested.get(productId) || 0) + quantity));
  }
  const ids = [...requested.keys()];
  if (!ids.length) return response.status(400).json({ error: "Корзина пуста" });
  const available = await sql`SELECT id, name, price, nakta_coins AS "naktaCoins" FROM products WHERE active = TRUE AND id IN ${sql(ids)}`;
  if (available.length !== ids.length) return response.status(409).json({ error: "Некоторые позиции больше недоступны" });
  const orderLines = available.map((product) => {
    const quantity = requested.get(product.id) || 1;
    return {
      id: Number(product.id),
      name: String(product.name),
      price: Number(product.price),
      quantity,
      lineTotal: Number(product.price) * quantity,
      naktaCoinsReward: Number(product.naktaCoins || 0) * quantity,
    };
  });
  if (orderLines.some((line) => (
    !Number.isSafeInteger(line.lineTotal)
    || line.lineTotal < 0
    || line.lineTotal > 2_147_483_647
    || !Number.isSafeInteger(line.naktaCoinsReward)
    || line.naktaCoinsReward < 0
    || line.naktaCoinsReward > 2_147_483_647
  ))) {
    throw new ApiError(400, "Сумма заказа или награды слишком велика");
  }
  const total = orderLines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
    throw new ApiError(400, "Сумма заказа слишком велика");
  }
  try {
    calculateOrderCoinReward(orderLines);
  } catch {
    throw new ApiError(400, "Сумма награды NAKTA Coin слишком велика");
  }
  const orderNumber = `ST-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const order = await sql.begin(async (tx) => {
    const normalizedPhone = customerPhone.replace(/\D/g, "");
    const [customer] = await tx`
      INSERT INTO customers (phone, name)
      VALUES (${normalizedPhone}, ${customerName})
      ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    const [created] = await tx`INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, location_id, comment, total) VALUES (${orderNumber}, ${customer.id}, ${customerName}, ${customerPhone}, ${locationId}, ${String(request.body.comment || "").slice(0, 1000)}, ${total}) RETURNING id, order_number AS "orderNumber", status, total, created_at AS "createdAt"`;
    for (const product of orderLines) {
      await tx`INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total, nakta_coins_reward) VALUES (${created.id}, ${product.id}, ${product.name}, ${product.price}, ${product.quantity}, ${product.lineTotal}, ${product.naktaCoinsReward})`;
    }
    return created;
  });
  response.status(201).json(order);
});

app.get("/api/auth/profile", requireCustomer, async (request, response) => {
  if (!requestedCustomerMatches(request, response)) return;
  response.setHeader("Cache-Control", "no-store");
  response.json(await customerProfile(authenticatedCustomer(response)));
});

app.post("/api/auth/logout", requireCustomer, async (request, response) => {
  const customer = authenticatedCustomer(response);
  await revokeCurrentCustomerSession(request, customer.id);
  clearCustomerSessionCookie(response);
  response.setHeader("Cache-Control", "no-store");
  response.json({ loggedOut: true });
});

app.post("/api/auth/coins/withdraw", requireCustomer, rewardLimiter, async (request, response) => {
  if (!requestedCustomerMatches(request, response)) return;
  const customer = authenticatedCustomer(response);
  const requestId = String(request.body.requestId || "").trim();
  const amount = integerValue(request.body.amount);
  const walletAddress = String(request.body.walletAddress || "").trim();
  if (!isUuid(requestId)) throw new ApiError(400, "Для вывода нужен корректный requestId UUID");
  const rewards = await loadRewardSettings();

  const withdrawal = await sql.begin(async (tx) => {
    const [account] = await tx`
      SELECT id, nakta_coins AS "naktaCoins"
      FROM customers
      WHERE id = ${customer.id}
      FOR UPDATE
    `;
    if (!account) throw new ApiError(404, "Аккаунт не найден");
    const [existing] = await tx<DatabaseCoinWithdrawal[]>`
      SELECT * FROM nakta_coin_withdrawals
      WHERE customer_id = ${customer.id} AND request_key = ${requestId}::uuid
      LIMIT 1
    `;
    if (existing) {
      if (!matchesCoinWithdrawalRequest(
        { amount: existing.amount, walletAddress: existing.wallet_address },
        { amount, walletAddress },
      )) {
        throw new ApiError(409, "Этот requestId уже использован для другой заявки");
      }
      return existing;
    }
    if (amount < 1) throw new ApiError(400, "Укажите целое количество NAKTA Coin для вывода");
    if (!isWalletAddressValid(rewards.coinNetwork, walletAddress)) {
      throw new ApiError(400, `Некорректный адрес кошелька для сети ${rewards.coinNetwork}`);
    }
    if (amount > Number(account.naktaCoins)) {
      throw new ApiError(400, "Недостаточно NAKTA Coin для вывода");
    }
    const [created] = await tx<DatabaseCoinWithdrawal[]>`
      INSERT INTO nakta_coin_withdrawals (customer_id, request_key, amount, wallet_address, network)
      VALUES (${customer.id}, ${requestId}::uuid, ${amount}, ${walletAddress}, ${rewards.coinNetwork})
      RETURNING *
    `;
    await tx`
      UPDATE customers
      SET nakta_coins = nakta_coins - ${amount}, updated_at = NOW()
      WHERE id = ${customer.id}
    `;
    return created;
  });
  response.json(publicCoinWithdrawal(withdrawal));
});

app.post("/api/auth/coins/withdrawals/:id/cancel", requireCustomer, rewardLimiter, async (request, response) => {
  if (!requestedCustomerMatches(request, response)) return;
  const id = String(request.params.id || "");
  if (!isUuid(id)) throw new ApiError(400, "Некорректный номер заявки");
  const customer = authenticatedCustomer(response);
  const withdrawal = await sql.begin(async (tx) => {
    const [current] = await tx<DatabaseCoinWithdrawal[]>`
      SELECT * FROM nakta_coin_withdrawals
      WHERE id = ${id}::uuid AND customer_id = ${customer.id}
      FOR UPDATE
    `;
    if (!current) throw new ApiError(404, "Заявка на вывод не найдена");
    if (current.status === "cancelled") return current;
    if (current.status !== "pending") {
      throw new ApiError(409, "Заявка уже обрабатывается и не может быть отменена");
    }
    const [account] = await tx`
      SELECT nakta_coins AS "naktaCoins"
      FROM customers
      WHERE id = ${customer.id}
      FOR UPDATE
    `;
    if (!account) throw new ApiError(404, "Аккаунт не найден");
    const nextBalance = Number(account.naktaCoins) + Number(current.amount);
    if (!Number.isSafeInteger(nextBalance) || nextBalance > 2_147_483_647) {
      throw new ApiError(409, "Баланс нельзя восстановить автоматически. Обратитесь в поддержку");
    }
    const [cancelled] = await tx<DatabaseCoinWithdrawal[]>`
      UPDATE nakta_coin_withdrawals
      SET status = 'cancelled', error = 'Отменено пользователем',
        processed_at = NOW(), updated_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING *
    `;
    if (!cancelled) throw new ApiError(409, "Заявка уже обрабатывается и не может быть отменена");
    await tx`
      UPDATE customers SET nakta_coins = ${nextBalance}, updated_at = NOW()
      WHERE id = ${customer.id}
    `;
    return cancelled;
  });
  response.json(publicCoinWithdrawal(withdrawal));
});

app.post("/api/auth/nfts/:id/withdraw", requireCustomer, rewardLimiter, async (request, response) => {
  if (!requestedCustomerMatches(request, response)) return;
  const id = String(request.params.id || "");
  if (!isUuid(id)) throw new ApiError(400, "Некорректный номер NFT");
  const customer = authenticatedCustomer(response);
  const walletAddress = String(request.body.walletAddress || "").trim();
  const withdrawalRequestedAt = new Date();
  const pending = await sql.begin(async (tx) => {
    const [current] = await tx<DatabaseNft[]>`
      SELECT * FROM account_nfts
      WHERE id = ${id}::uuid AND customer_id = ${customer.id}
      FOR UPDATE
    `;
    if (!current) throw new ApiError(404, "NFT не найден");
    if (["pending", "submitted"].includes(current.status)) {
      throw new ApiError(409, "Вывод этого NFT уже обрабатывается");
    }
    if (current.status === "withdrawn") throw new ApiError(409, "Этот NFT уже выведен");
    if (!isWalletAddressValid(current.network, walletAddress)) {
      throw new ApiError(400, `Некорректный адрес кошелька для сети ${current.network}`);
    }
    const [updated] = await tx<DatabaseNft[]>`
      UPDATE account_nfts
      SET status = 'pending', wallet_address = ${walletAddress}, tx_hash = NULL,
        token_id = NULL, withdrawal_error = NULL,
        withdrawal_requested_at = ${withdrawalRequestedAt},
        withdrawn_at = NULL, updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return updated;
  });
  response.json(await dispatchNftWithdrawal(pending));
});

app.post("/api/auth/nfts/:id/withdrawal/cancel", requireCustomer, rewardLimiter, async (request, response) => {
  if (!requestedCustomerMatches(request, response)) return;
  const id = String(request.params.id || "");
  if (!isUuid(id)) throw new ApiError(400, "Некорректный номер NFT");
  const customer = authenticatedCustomer(response);
  const nft = await sql.begin(async (tx) => {
    const [current] = await tx<DatabaseNft[]>`
      SELECT * FROM account_nfts
      WHERE id = ${id}::uuid AND customer_id = ${customer.id}
      FOR UPDATE
    `;
    if (!current) throw new ApiError(404, "NFT не найден");
    if (current.status === "owned" && current.withdrawal_error === "Заявка на вывод отменена пользователем") {
      return current;
    }
    if (current.status !== "pending") {
      throw new ApiError(409, "Заявка уже обрабатывается и не может быть отменена");
    }
    const [cancelled] = await tx<DatabaseNft[]>`
      UPDATE account_nfts
      SET status = 'owned', wallet_address = NULL, tx_hash = NULL, token_id = NULL,
        withdrawal_error = 'Заявка на вывод отменена пользователем',
        withdrawal_requested_at = NULL, withdrawn_at = NULL, updated_at = NOW()
      WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING *
    `;
    if (!cancelled) throw new ApiError(409, "Заявка уже обрабатывается и не может быть отменена");
    return cancelled;
  });
  response.json(publicNft(nft));
});

app.post("/api/admin/login", authLimiter, async (request, response) => {
  const [user] = await sql`SELECT id, password_hash, name FROM admin_users ORDER BY id LIMIT 1`;
  if (!user || !(await bcrypt.compare(String(request.body.password || ""), user.password_hash))) return response.status(401).json({ error: "Неверный пароль" });
  const publicUser = { id: Number(user.id), name: String(user.name) };
  setAdminSessionCookie(response, await createAdminToken(publicUser));
  response.setHeader("Cache-Control", "no-store");
  response.json({ authenticated: true, user: publicUser, expiresInSeconds: 2 * 60 * 60 });
});

app.post("/api/admin/logout", requireTrustedAdminOrigin, async (request, response) => {
  await revokeCurrentAdminSession(request);
  clearAdminSessionCookie(response);
  response.setHeader("Cache-Control", "no-store");
  response.json({ loggedOut: true });
});

app.use("/api/admin", requireAdmin, requireTrustedAdminOrigin);

app.get("/api/admin/session", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ authenticated: true, user: response.locals.admin });
});

app.get("/api/admin/geocode", geocodeLimiter, async (request, response) => {
  try {
    const rawQuery = request.query.query;
    if (rawQuery !== undefined) {
      if (typeof rawQuery !== "string") return response.status(400).json({ error: "Укажите один адрес для поиска" });
      const query = rawQuery.trim();
      if (query.length < 3 || query.length > 300) return response.status(400).json({ error: "Адрес должен содержать от 3 до 300 символов" });
      response.setHeader("Cache-Control", "no-store");
      return response.json(await geocodeWithYandex(query));
    }

    const latitude = queryCoordinate(request.query.latitude);
    const longitude = queryCoordinate(request.query.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return response.status(400).json({ error: "Укажите корректные широту и долготу" });
    }
    response.setHeader("Cache-Control", "no-store");
    return response.json(await geocodeWithYandex(`${longitude},${latitude}`));
  } catch (error) {
    if (error instanceof YandexGeocoderError) return response.status(error.status).json({ error: error.message });
    console.error("Yandex geocoding failed", error);
    return response.status(502).json({ error: "Не удалось выполнить поиск адреса" });
  }
});

app.post("/api/admin/yandex-map-link", geocodeLimiter, async (request, response) => {
  try {
    const rawUrl = request.body?.url;
    if (typeof rawUrl !== "string") return response.status(400).json({ error: "Вставьте ссылку из Яндекс Карт" });
    const coordinates = await resolveYandexMapLink(rawUrl);
    let address = "";
    if (String(process.env.YANDEX_GEOCODER_API_KEY || "").trim()) {
      try {
        address = (await geocodeWithYandex(`${coordinates.longitude},${coordinates.latitude}`)).address;
      } catch (error) {
        console.warn("Yandex link coordinates resolved without reverse geocoding", error instanceof Error ? error.message : error);
      }
    }
    response.setHeader("Cache-Control", "no-store");
    return response.json({ ...coordinates, address });
  } catch (error) {
    if (error instanceof YandexMapLinkError) return response.status(error.status).json({ error: error.message });
    console.error("Yandex map link resolution failed", error);
    return response.status(502).json({ error: "Не удалось обработать ссылку Яндекс Карт" });
  }
});

app.get("/api/admin/dashboard", async (_request, response) => {
  const [stats] = await sql`SELECT (SELECT COUNT(*)::int FROM orders WHERE created_at >= CURRENT_DATE) AS "ordersToday", (SELECT COALESCE(SUM(total),0)::int FROM orders WHERE created_at >= CURRENT_DATE AND status <> 'cancelled') AS "revenueToday", (SELECT COUNT(*)::int FROM products WHERE active = TRUE) AS products, (SELECT COUNT(*)::int FROM orders WHERE status IN ('new','confirmed','preparing')) AS "activeOrders"`;
  response.json(stats);
});

app.get("/api/admin/categories", async (_request, response) => response.json(await sql`SELECT id, name, slug, sort_order AS "sortOrder", active FROM categories ORDER BY sort_order, id`));
app.post("/api/admin/categories", async (request, response) => {
  const [created] = await sql`INSERT INTO categories (id, name, slug, sort_order, active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM categories), ${String(request.body.name || "Новая категория")}, ${String(request.body.slug || `category-${Date.now()}`)}, ${numberValue(request.body.sortOrder)}, ${booleanValue(request.body.active)}) RETURNING id, name, slug, sort_order AS "sortOrder", active`;
  response.status(201).json(created);
});
app.put("/api/admin/categories/:id", async (request, response) => {
  const [updated] = await sql`UPDATE categories SET name=${String(request.body.name)}, slug=${String(request.body.slug)}, sort_order=${numberValue(request.body.sortOrder)}, active=${booleanValue(request.body.active)}, updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id, name, slug, sort_order AS "sortOrder", active`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Категория не найдена" });
});
app.delete("/api/admin/categories/:id", async (request, response) => {
  try { await sql`DELETE FROM categories WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); } catch { response.status(409).json({ error: "Сначала перенесите или удалите товары категории" }); }
});

app.get("/api/admin/products", async (_request, response) => response.json(await sql`SELECT id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder", nakta_coins AS "naktaCoins" FROM products ORDER BY category_id, sort_order, id`));
app.post("/api/admin/products", async (request, response) => {
  const naktaCoins = integerValue(request.body.naktaCoins);
  if (naktaCoins < 0 || naktaCoins > 1_000_000) throw new ApiError(400, "Награда товара должна быть целым числом от 0 до 1 000 000");
  const [created] = await sql`INSERT INTO products (id, category_id, name, price, image, active, sort_order, nakta_coins) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM products), ${numberValue(request.body.categoryId)}, ${String(request.body.name || "Новый товар")}, ${numberValue(request.body.price)}, ${String(request.body.image || "")}, ${booleanValue(request.body.active)}, ${numberValue(request.body.sortOrder)}, ${naktaCoins}) RETURNING id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder", nakta_coins AS "naktaCoins"`;
  response.status(201).json(created);
});
app.put("/api/admin/products/:id", async (request, response) => {
  const naktaCoins = request.body.naktaCoins === undefined ? null : integerValue(request.body.naktaCoins, -1);
  if (naktaCoins !== null && (naktaCoins < 0 || naktaCoins > 1_000_000)) throw new ApiError(400, "Награда товара должна быть целым числом от 0 до 1 000 000");
  const [updated] = await sql`UPDATE products SET category_id=${numberValue(request.body.categoryId)}, name=${String(request.body.name)}, price=${numberValue(request.body.price)}, image=${String(request.body.image)}, active=${booleanValue(request.body.active)}, sort_order=${numberValue(request.body.sortOrder)}, nakta_coins=COALESCE(${naktaCoins}, nakta_coins), updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id, category_id AS "categoryId", name, price, image, active, sort_order AS "sortOrder", nakta_coins AS "naktaCoins"`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Товар не найден" });
});
app.delete("/api/admin/products/:id", async (request, response) => { await sql`DELETE FROM products WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); });

app.get("/api/admin/locations", async (_request, response) => response.json(await sql`SELECT id, name, address, phone, hours, opens_at AS "opensAt", latitude, longitude, active FROM pickup_locations ORDER BY id`));
app.post("/api/admin/locations", async (request, response) => {
  const coordinates = locationCoordinates(request.body);
  if (!coordinates) { response.status(400).json({ error: "Укажите корректные широту и долготу" }); return; }
  const [created] = await sql`INSERT INTO pickup_locations (id,name,address,phone,hours,opens_at,latitude,longitude,active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM pickup_locations),${String(request.body.name || "Новая точка")},${String(request.body.address || "")},${String(request.body.phone || "")},${String(request.body.hours || "10:00 - 21:00")},${String(request.body.opensAt || "10:00")},${coordinates.latitude},${coordinates.longitude},${booleanValue(request.body.active)}) RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  response.status(201).json(created);
});
app.put("/api/admin/locations/:id", async (request, response) => {
  const coordinates = locationCoordinates(request.body);
  if (!coordinates) { response.status(400).json({ error: "Укажите корректные широту и долготу" }); return; }
  const [updated] = await sql`UPDATE pickup_locations SET name=${String(request.body.name)},address=${String(request.body.address)},phone=${String(request.body.phone)},hours=${String(request.body.hours)},opens_at=${String(request.body.opensAt)},latitude=${coordinates.latitude},longitude=${coordinates.longitude},active=${booleanValue(request.body.active)},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,name,address,phone,hours,opens_at AS "opensAt",latitude,longitude,active`;
  if (updated) response.json(updated);
  else response.status(404).json({ error: "Точка не найдена" });
});
app.delete("/api/admin/locations/:id", async (request, response) => { try { await sql`DELETE FROM pickup_locations WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); } catch { response.status(409).json({ error: "Точка используется в заказах" }); } });

app.get("/api/admin/promotions", async (_request, response) => response.json(await sql`SELECT id,title,description,image,active,sort_order AS "sortOrder" FROM promotions ORDER BY sort_order,id`));
app.post("/api/admin/promotions", async (request, response) => {
  const [created] = await sql`INSERT INTO promotions (id,title,description,image,active,sort_order) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM promotions),${String(request.body.title || "Новая акция")},${String(request.body.description || "")},${String(request.body.image || "")},${booleanValue(request.body.active)},${numberValue(request.body.sortOrder)}) RETURNING id,title,description,image,active,sort_order AS "sortOrder"`;
  response.status(201).json(created);
});
app.put("/api/admin/promotions/:id", async (request, response) => {
  const [updated] = await sql`UPDATE promotions SET title=${String(request.body.title)},description=${String(request.body.description)},image=${String(request.body.image)},active=${booleanValue(request.body.active)},sort_order=${numberValue(request.body.sortOrder)},updated_at=NOW() WHERE id=${numberValue(request.params.id)} RETURNING id,title,description,image,active,sort_order AS "sortOrder"`;
  response.json(updated);
});
app.delete("/api/admin/promotions/:id", async (request, response) => { await sql`DELETE FROM promotions WHERE id=${numberValue(request.params.id)}`; response.status(204).end(); });

app.get("/api/admin/orders", async (_request, response) => {
  const orders = await sql`SELECT o.id,o.order_number AS "orderNumber",o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.status,o.comment,o.total,o.created_at AS "createdAt",l.name AS "locationName",l.address AS "locationAddress" FROM orders o JOIN pickup_locations l ON l.id=o.location_id ORDER BY o.created_at DESC LIMIT 500`;
  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length ? await sql`SELECT order_id AS "orderId",product_name AS "productName",unit_price AS "unitPrice",quantity,line_total AS "lineTotal",nakta_coins_reward AS "naktaCoinsReward" FROM order_items WHERE order_id IN ${sql(orderIds)} ORDER BY id` : [];
  response.json(orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) })));
});
app.patch("/api/admin/orders/:id/status", async (request, response) => {
  const status = String(request.body.status || "");
  if (!validStatuses.has(status)) return response.status(400).json({ error: "Неизвестный статус" });
  const orderId = integerValue(request.params.id);
  const updated = await sql.begin(async (tx) => {
    const [current] = await tx`
      SELECT id, order_number AS "orderNumber", customer_id AS "customerId",
        customer_phone AS "customerPhone", customer_name AS "customerName", status,
        rewards_processed_at AS "rewardsProcessedAt"
      FROM orders
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    if (!current) return null;
    if (current.status === status) {
      const [unchanged] = await tx`SELECT id, order_number AS "orderNumber", status, updated_at AS "updatedAt" FROM orders WHERE id = ${orderId}`;
      return unchanged;
    }

    const firstCompletion = shouldAccrueOrderRewards(
      String(current.status),
      status,
      current.rewardsProcessedAt,
    );
    let customerId = current.customerId as string | number | null;
    if (firstCompletion && !customerId) {
      const phone = normalizedCustomerPhone(current.customerPhone);
      if (phone) {
        const [customer] = await tx`
          INSERT INTO customers (phone, name)
          VALUES (${phone}, ${String(current.customerName || "") || null})
          ON CONFLICT (phone) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name), updated_at = NOW()
          RETURNING id
        `;
        customerId = customer.id;
        await tx`UPDATE orders SET customer_id = ${customerId} WHERE id = ${orderId}`;
      }
    }
    let lockedCustomer: Record<string, unknown> | undefined;
    if (firstCompletion && customerId) {
      [lockedCustomer] = await tx`
        SELECT id, nakta_coins AS "naktaCoins",
          reward_completed_orders AS "rewardCompletedOrders"
        FROM customers
        WHERE id = ${customerId}
        FOR UPDATE
      `;
    }

    const [saved] = await tx`
      UPDATE orders SET status = ${status},
        rewards_processed_at = CASE WHEN ${firstCompletion} THEN NOW() ELSE rewards_processed_at END,
        updated_at = NOW()
      WHERE id = ${orderId}
      RETURNING id, order_number AS "orderNumber", status, updated_at AS "updatedAt"
    `;
    if (!firstCompletion || !customerId || !lockedCustomer) return saved;

    const itemRows = await tx`
      SELECT nakta_coins_reward AS "naktaCoinsReward"
      FROM order_items
      WHERE order_id = ${orderId}
    `;
    let rewardAmount: number;
    try {
      rewardAmount = calculateOrderCoinReward(itemRows);
    } catch {
      throw new ApiError(409, "Сумма награды заказа превышает допустимый предел");
    }
    if (rewardAmount > 0) {
      const [inserted] = await tx`
        INSERT INTO nakta_coin_transactions (customer_id, order_id, amount, description)
        VALUES (${customerId}, ${orderId}, ${rewardAmount}, ${`Заказ №${current.orderNumber}`})
        ON CONFLICT (order_id) DO NOTHING
        RETURNING id
      `;
      if (inserted) {
        const nextBalance = Number(lockedCustomer.naktaCoins || 0) + rewardAmount;
        if (!Number.isSafeInteger(nextBalance) || nextBalance > 2_147_483_647) {
          throw new ApiError(409, "Начисление превышает допустимый баланс NAKTA Coin");
        }
        await tx`
          UPDATE customers SET nakta_coins = ${nextBalance}, updated_at = NOW()
          WHERE id = ${customerId}
        `;
      }
    }

    if (Number(lockedCustomer.rewardCompletedOrders || 0) >= 2_147_483_647) {
      throw new ApiError(409, "Достигнут предел счётчика заказов программы лояльности");
    }
    const [rewardCounter] = await tx`
      UPDATE customers
      SET reward_completed_orders = reward_completed_orders + 1, updated_at = NOW()
      WHERE id = ${customerId}
      RETURNING reward_completed_orders AS "completedOrders"
    `;
    const completedOrders = Number(rewardCounter.completedOrders);

    const [settingsRow] = await tx`SELECT value FROM site_settings WHERE key = 'rewards' LIMIT 1`;
    const rewards = normalizeRewardSettings(settingsRow?.value);
    if (isNftMilestone(completedOrders, rewards.nftRewardEveryOrders)) {
      await tx`
        INSERT INTO account_nfts (
          customer_id, reward_key, order_id, milestone_order_count, name, image,
          description, network, contract_address, metadata_uri
        ) VALUES (
          ${customerId}, ${`milestone:${orderId}`}, ${orderId}, ${completedOrders},
          ${rewards.nftRewardName}, ${rewards.nftRewardImage},
          ${rewards.nftRewardDescription}, ${rewards.nftRewardNetwork},
          ${rewards.nftContractAddress}, ${rewards.nftMetadataUri}
        )
        ON CONFLICT DO NOTHING
      `;
    }
    return saved;
  });
  if (!updated) return response.status(404).json({ error: "Заказ не найден" });
  response.json(updated);
});

app.get("/api/admin/loyalty/overview", async (_request, response) => {
  const rewards = await loadRewardSettings();
  const [productMetrics, coinMetrics, nftRows, accountMetrics, withdrawalMetrics] = await Promise.all([
    sql`
      SELECT COUNT(*) FILTER (WHERE nakta_coins > 0)::int AS "rewardedProducts",
        COALESCE(SUM(nakta_coins), 0)::bigint AS "coinsPerFullMenu"
      FROM products
      WHERE active = TRUE
    `,
    sql`
      SELECT COALESCE(SUM(amount), 0)::bigint AS "issuedCoins", COUNT(*)::int AS transactions
      FROM nakta_coin_transactions
    `,
    sql`SELECT status, COUNT(*)::int AS count FROM account_nfts GROUP BY status`,
    sql`SELECT COALESCE(SUM(nakta_coins), 0)::bigint AS "availableCoins" FROM customers`,
    sql`
      SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingCoinWithdrawals",
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS "submittedCoinWithdrawals"
      FROM nakta_coin_withdrawals
    `,
  ]);
  const nftStatuses: Record<string, number> = {
    owned: 0,
    pending: 0,
    submitted: 0,
    withdrawn: 0,
    failed: 0,
  };
  for (const row of nftRows) nftStatuses[String(row.status)] = Number(row.count);
  response.json({
    program: {
      enabled: rewards.nftRewardEveryOrders > 0,
      everyOrders: rewards.nftRewardEveryOrders,
      name: rewards.nftRewardName,
      image: rewards.nftRewardImage,
      description: rewards.nftRewardDescription,
      network: rewards.nftRewardNetwork,
      contractAddress: rewards.nftContractAddress,
      metadataUri: rewards.nftMetadataUri,
      coinNetwork: rewards.coinNetwork,
    },
    metrics: {
      rewardedProducts: Number(productMetrics[0]?.rewardedProducts || 0),
      coinsPerFullMenu: Number(productMetrics[0]?.coinsPerFullMenu || 0),
      issuedCoins: Number(coinMetrics[0]?.issuedCoins || 0),
      coinTransactions: Number(coinMetrics[0]?.transactions || 0),
      availableCoins: Number(accountMetrics[0]?.availableCoins || 0),
      pendingCoinWithdrawals: Number(withdrawalMetrics[0]?.pendingCoinWithdrawals || 0),
      submittedCoinWithdrawals: Number(withdrawalMetrics[0]?.submittedCoinWithdrawals || 0),
      nftsTotal: Object.values(nftStatuses).reduce((total, count) => total + count, 0),
      nftStatuses,
    },
    transferProviderConfigured: Boolean(nftTransferProvider),
  });
});

app.get("/api/admin/customers", async (request, response) => {
  const limit = Math.min(100, Math.max(1, integerValue(request.query.limit, 50)));
  const offset = Math.max(0, integerValue(request.query.offset));
  const search = String(request.query.search || "").trim().slice(0, 120);
  const pattern = `%${search}%`;
  const [rows, totals] = await Promise.all([
    sql`
      SELECT customers.phone, COALESCE(customers.name, '') AS "customerName",
        COUNT(orders.id)::int AS "ordersCount",
        COUNT(orders.id) FILTER (WHERE orders.status = 'completed')::int AS "completedOrders",
        COALESCE(SUM(orders.total) FILTER (WHERE orders.status = 'completed'), 0)::bigint AS revenue,
        COALESCE(MAX(orders.created_at), customers.created_at) AS "lastOrderAt",
        customers.nakta_coins AS "naktaCoins",
        (SELECT COUNT(*)::int FROM account_nfts WHERE customer_id = customers.id) AS "nftCount",
        (SELECT COUNT(*)::int FROM account_nfts WHERE customer_id = customers.id AND status IN ('pending', 'submitted')) AS "pendingNftCount"
      FROM customers
      LEFT JOIN orders ON orders.customer_id = customers.id
      WHERE ${search === ""} OR customers.phone ILIKE ${pattern} OR COALESCE(customers.name, '') ILIKE ${pattern}
      GROUP BY customers.id
      ORDER BY MAX(orders.created_at) DESC NULLS LAST, customers.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM customers
      WHERE ${search === ""} OR phone ILIKE ${pattern} OR COALESCE(name, '') ILIKE ${pattern}
    `,
  ]);
  response.json({
    items: rows.map((row) => ({
      ...row,
      ordersCount: Number(row.ordersCount),
      completedOrders: Number(row.completedOrders),
      revenue: Number(row.revenue),
      naktaCoins: Number(row.naktaCoins),
      nftCount: Number(row.nftCount),
      pendingNftCount: Number(row.pendingNftCount),
    })),
    total: Number(totals[0]?.total || 0),
    limit,
    offset,
  });
});

app.get("/api/admin/customers/:phone", async (request, response) => {
  const phone = normalizedCustomerPhone(request.params.phone);
  if (!phone) throw new ApiError(400, "Укажите телефон в формате +996");
  const detail = await adminCustomerDetail(phone);
  if (!detail) throw new ApiError(404, "Пользователь не найден");
  response.json(detail);
});

app.post("/api/admin/customers/:phone/rewards/adjust", async (request, response) => {
  const phone = normalizedCustomerPhone(request.params.phone);
  if (!phone) throw new ApiError(400, "Укажите телефон в формате +996");
  const asset = String(request.body.asset || "");
  const delta = integerValue(request.body.delta);
  const reason = String(request.body.reason || "").trim().slice(0, 240);
  if (!(["coin", "nft"] as const).includes(asset as "coin" | "nft")) {
    throw new ApiError(400, "Выберите NAKTA Coin или NFT");
  }
  if (delta === 0 || Math.abs(delta) > 1_000_000) {
    throw new ApiError(400, "Укажите целое количество больше или меньше нуля");
  }
  if (asset === "nft" && Math.abs(delta) > 100) {
    throw new ApiError(400, "За один раз можно изменить не более 100 NFT");
  }
  if (!reason) throw new ApiError(400, "Укажите причину корректировки");
  const rewards = await loadRewardSettings();

  await sql.begin(async (tx) => {
    const [customer] = await tx`
      SELECT id, nakta_coins AS "naktaCoins"
      FROM customers
      WHERE phone = ${phone}
      FOR UPDATE
    `;
    if (!customer) throw new ApiError(404, "Пользователь не найден");
    let balanceAfter: number;
    if (asset === "coin") {
      const nextBalance = Number(customer.naktaCoins) + delta;
      if (!Number.isSafeInteger(nextBalance) || nextBalance < 0 || nextBalance > 2_147_483_647) {
        throw new ApiError(400, "Недостаточно NAKTA Coin для списания или превышен допустимый баланс");
      }
      await tx`UPDATE customers SET nakta_coins = ${nextBalance}, updated_at = NOW() WHERE id = ${customer.id}`;
      balanceAfter = nextBalance;
    } else if (delta > 0) {
      for (let index = 0; index < delta; index += 1) {
        await tx`
          INSERT INTO account_nfts (
            customer_id, reward_key, milestone_order_count, name, image, description,
            network, contract_address, metadata_uri
          ) VALUES (
            ${customer.id}, ${`admin:${randomUUID()}`}, 0,
            ${rewards.nftRewardName || "NFT NAKTA"}, ${rewards.nftRewardImage},
            ${rewards.nftRewardDescription}, ${rewards.nftRewardNetwork},
            ${rewards.nftContractAddress}, ${rewards.nftMetadataUri}
          )
        `;
      }
      const [count] = await tx`SELECT COUNT(*)::int AS count FROM account_nfts WHERE customer_id = ${customer.id} AND status = 'owned'`;
      balanceAfter = Number(count.count);
    } else {
      const countToRemove = Math.abs(delta);
      const removable = await tx`
        SELECT id FROM account_nfts
        WHERE customer_id = ${customer.id} AND status = 'owned'
        ORDER BY created_at DESC
        LIMIT ${countToRemove}
        FOR UPDATE
      `;
      if (removable.length < countToRemove) {
        throw new ApiError(400, `Можно списать только доступные NFT: ${removable.length}`);
      }
      await tx`DELETE FROM account_nfts WHERE id IN ${tx(removable.map((nft) => nft.id))}`;
      const [count] = await tx`SELECT COUNT(*)::int AS count FROM account_nfts WHERE customer_id = ${customer.id} AND status = 'owned'`;
      balanceAfter = Number(count.count);
    }
    await tx`
      INSERT INTO customer_reward_adjustments (customer_id, asset, delta, balance_after, reason)
      VALUES (${customer.id}, ${asset}, ${delta}, ${balanceAfter}, ${reason})
    `;
  });

  const detail = await adminCustomerDetail(phone);
  if (!detail) throw new ApiError(404, "Пользователь не найден");
  response.json(detail);
});

app.get("/api/admin/coin-withdrawals", async (request, response) => {
  const status = request.query.status === undefined ? "" : String(request.query.status);
  const supported = new Set(["pending", "submitted", "withdrawn", "failed", "cancelled"]);
  if (status && !supported.has(status)) throw new ApiError(400, "Неизвестный статус заявки");
  const rows = await sql<(DatabaseCoinWithdrawal & { phone: string; customer_name: string | null })[]>`
    SELECT withdrawals.*, customers.phone, customers.name AS customer_name
    FROM nakta_coin_withdrawals withdrawals
    INNER JOIN customers ON customers.id = withdrawals.customer_id
    WHERE ${status === ""} OR withdrawals.status = ${status}
    ORDER BY CASE withdrawals.status
      WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 WHEN 'cancelled' THEN 2
      WHEN 'submitted' THEN 3 ELSE 4 END,
      CASE WHEN withdrawals.status IN ('pending', 'submitted') THEN withdrawals.created_at END ASC NULLS LAST,
      CASE WHEN withdrawals.status NOT IN ('pending', 'submitted') THEN withdrawals.created_at END DESC NULLS LAST
    LIMIT 200
  `;
  response.json(rows.map((row) => ({
    ...publicCoinWithdrawal(row),
    phone: row.phone,
    customerName: row.customer_name,
    regionSlug: "default",
  })));
});

app.patch("/api/admin/coin-withdrawals/:id", async (request, response) => {
  const id = String(request.params.id || "");
  if (!isUuid(id)) throw new ApiError(400, "Некорректный номер заявки");
  const status = String(request.body.status || "");
  if (!["submitted", "withdrawn", "failed"].includes(status)) throw new ApiError(400, "Неизвестный статус заявки");
  const suppliedTxHash = request.body.txHash === undefined ? undefined : String(request.body.txHash || "").trim().slice(0, 200);
  const suppliedError = request.body.error === undefined ? undefined : String(request.body.error || "").trim().slice(0, 2_000);
  const updated = await sql.begin(async (tx) => {
    const [current] = await tx<DatabaseCoinWithdrawal[]>`
      SELECT * FROM nakta_coin_withdrawals WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (!current) throw new ApiError(404, "Заявка на вывод не найдена");
    if (!canTransitionCoinWithdrawal(current.status, status)) {
      throw new ApiError(409, "Заявка уже завершена или переход статуса недоступен");
    }
    if (status !== "withdrawn" && suppliedTxHash) {
      throw new ApiError(400, "Хеш указывается только при завершении вывода");
    }
    if (current.tx_hash && suppliedTxHash && suppliedTxHash !== current.tx_hash) {
      throw new ApiError(409, "Записанный хеш транзакции нельзя заменить");
    }
    const txHash = suppliedTxHash === undefined ? current.tx_hash : suppliedTxHash || null;
    if (status === "withdrawn" && !txHash) {
      throw new ApiError(400, "Для завершения вывода NAKTA Coin нужен хеш транзакции");
    }
    if (status === "withdrawn" && !isTransactionHashValid(current.network, txHash || "")) {
      throw new ApiError(400, `Некорректный хеш транзакции для сети ${current.network}`);
    }
    if (status === "failed") {
      const [account] = await tx`
        SELECT nakta_coins AS "naktaCoins" FROM customers
        WHERE id = ${current.customer_id} FOR UPDATE
      `;
      if (!account) throw new ApiError(404, "Аккаунт не найден");
      const nextBalance = Number(account.naktaCoins) + Number(current.amount);
      if (!Number.isSafeInteger(nextBalance) || nextBalance > 2_147_483_647) {
        throw new ApiError(409, "Баланс нельзя восстановить автоматически");
      }
      await tx`UPDATE customers SET nakta_coins = ${nextBalance}, updated_at = NOW() WHERE id = ${current.customer_id}`;
    }
    const [saved] = await tx<DatabaseCoinWithdrawal[]>`
      UPDATE nakta_coin_withdrawals
      SET status = ${status}, tx_hash = ${txHash},
        error = ${status === "failed" ? suppliedError || "Заявка на вывод отклонена" : null},
        processed_at = ${["withdrawn", "failed"].includes(status) ? new Date() : null},
        updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return saved;
  });
  response.json(publicCoinWithdrawal(updated));
});

app.get("/api/admin/nft-withdrawals", async (request, response) => {
  const status = request.query.status === undefined ? "" : String(request.query.status);
  const supported = new Set(["owned", "pending", "submitted", "withdrawn", "failed"]);
  if (status && !supported.has(status)) throw new ApiError(400, "Неизвестный статус NFT");
  const rows = await sql<(DatabaseNft & { phone: string; customer_name: string | null })[]>`
    SELECT nfts.*, customers.phone, customers.name AS customer_name
    FROM account_nfts nfts
    INNER JOIN customers ON customers.id = nfts.customer_id
    WHERE ${status === ""} OR nfts.status = ${status}
    ORDER BY CASE nfts.status
      WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'owned' THEN 3 ELSE 4 END,
      CASE WHEN nfts.status IN ('pending', 'submitted')
        THEN COALESCE(nfts.withdrawal_requested_at, nfts.created_at) END ASC NULLS LAST,
      CASE WHEN nfts.status NOT IN ('pending', 'submitted') THEN nfts.created_at END DESC NULLS LAST
    LIMIT 200
  `;
  response.json(rows.map((row) => ({
    ...publicNft(row),
    phone: row.phone,
    customerName: row.customer_name,
    regionSlug: "default",
  })));
});

app.patch("/api/admin/nft-withdrawals/:id", async (request, response) => {
  const id = String(request.params.id || "");
  if (!isUuid(id)) throw new ApiError(400, "Некорректный номер NFT");
  const status = String(request.body.status || "");
  if (!["submitted", "withdrawn", "failed"].includes(status)) throw new ApiError(400, "Неизвестный статус NFT");
  const suppliedTxHash = request.body.txHash === undefined ? undefined : String(request.body.txHash || "").trim().slice(0, 200);
  const suppliedTokenId = request.body.tokenId === undefined ? undefined : String(request.body.tokenId || "").trim().slice(0, 160);
  const suppliedError = request.body.error === undefined ? undefined : String(request.body.error || "").trim().slice(0, 2_000);
  const updated = await sql.begin(async (tx) => {
    const [current] = await tx<DatabaseNft[]>`SELECT * FROM account_nfts WHERE id = ${id}::uuid FOR UPDATE`;
    if (!current) throw new ApiError(404, "NFT не найден");
    if (!canTransitionNftWithdrawal(current.status, status)) {
      throw new ApiError(409, current.status === "owned"
        ? "Клиент ещё не запрашивал вывод этого NFT"
        : "Вывод уже завершён или переход статуса недоступен");
    }
    if (status !== "withdrawn" && (suppliedTxHash || suppliedTokenId)) {
      throw new ApiError(400, "Хеш и Token ID указываются только при завершении вывода");
    }
    if (current.tx_hash && suppliedTxHash && suppliedTxHash !== current.tx_hash) {
      throw new ApiError(409, "Записанный хеш транзакции нельзя заменить");
    }
    if (current.token_id && suppliedTokenId && suppliedTokenId !== current.token_id) {
      throw new ApiError(409, "Записанный Token ID нельзя заменить");
    }
    const txHash = suppliedTxHash === undefined ? current.tx_hash : suppliedTxHash || null;
    if (status === "submitted" && !current.wallet_address) {
      throw new ApiError(400, "У заявки не указан кошелёк клиента");
    }
    if (status === "withdrawn" && (!current.wallet_address || !txHash)) {
      throw new ApiError(400, "Для завершения вывода NFT нужны кошелёк клиента и хеш транзакции");
    }
    if (status === "withdrawn" && !isTransactionHashValid(current.network, txHash || "")) {
      throw new ApiError(400, `Некорректный хеш транзакции для сети ${current.network}`);
    }
    const [saved] = await tx<DatabaseNft[]>`
      UPDATE account_nfts
      SET status = ${status}, tx_hash = ${txHash},
        token_id = ${suppliedTokenId === undefined ? current.token_id : suppliedTokenId || null},
        withdrawal_error = ${status === "failed" ? suppliedError || "Транзакция отклонена обработчиком" : null},
        withdrawn_at = ${status === "withdrawn" ? new Date() : null}, updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return saved;
  });
  response.json(publicNft(updated));
});

app.get("/api/admin/settings", async (_request, response) => {
  const rows = await sql`SELECT key,value,updated_at AS "updatedAt" FROM site_settings ORDER BY key`;
  response.json(rows);
});
app.put("/api/admin/settings/:key", async (request, response) => {
  const key = String(request.params.key);
  const value = key === "rewards" ? normalizeRewardSettings(request.body.value) : request.body.value ?? {};
  const [updated] = await sql`INSERT INTO site_settings (key,value) VALUES (${key},${sql.json(value)}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW() RETURNING key,value,updated_at AS "updatedAt"`;
  response.json(updated);
});
app.post("/api/admin/upload", upload.single("file"), (request: Request, response: Response) => {
  if (!request.file) return response.status(400).json({ error: "Поддерживаются PNG, JPG и WebP до 5 МБ" });
  response.status(201).json({ url: `/uploads/${request.file.filename}` });
});

app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
  void _next;
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  const databaseError = error as { code?: string };
  if (databaseError?.code === "23505") {
    response.status(409).json({ error: "Такая запись уже существует" });
    return;
  }
  if (["23503", "23514", "22P02"].includes(databaseError?.code || "")) {
    response.status(400).json({ error: "Проверьте введённые данные" });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Внутренняя ошибка сервера" });
});

await migrate();
const [databaseState] = await sql`SELECT EXISTS (SELECT 1 FROM products) AS "hasProducts"`;
if (!databaseState.hasProducts) await seed();
else await syncAdminPassword();
const server = app.listen(port, apiHost, () => console.log(`DAANA SUSHI API: http://${apiHost}:${port}/api`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(async () => { await closeDatabase(); process.exit(0); }));
}
