import assert from "node:assert/strict";
import test from "node:test";
import "dotenv/config";

const baseUrl = process.env.REWARDS_API_INTEGRATION_URL;

async function responseBody(response) {
  return response.json().catch(() => ({}));
}

test("real API keeps reward accrual and withdrawals atomic and idempotent", {
  skip: !baseUrl || !process.env.ADMIN_PASSWORD,
  timeout: 30_000,
}, async (context) => {
  const phone = process.env.REWARDS_TEST_PHONE || `996555${String(Date.now()).slice(-6)}`;
  const wallet = `0x${"a".repeat(40)}`;
  const transactionHash = `0x${"b".repeat(64)}`;
  let customerCookie = "";
  let adminCookie = "";
  let lastSetCookie = "";

  const call = async (path, { cookie, expected = 200, ...options } = {}) => {
    const headers = new Headers(options.headers || {});
    if (cookie) headers.set("cookie", cookie);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      lastSetCookie = setCookie;
      const cookiePair = setCookie.split(";", 1)[0];
      if (cookiePair.startsWith("daana_admin_session=")) adminCookie = cookiePair;
      if (cookiePair.startsWith("daana_customer_session=")) customerCookie = cookiePair;
    }
    const body = await responseBody(response);
    assert.equal(response.status, expected, `${options.method || "GET"} ${path}: ${JSON.stringify(body)}`);
    return body;
  };

  const login = await call("/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.authenticated, true);
  assert.equal("token" in login, false, "raw admin token must not be returned to browser code");
  assert.match(adminCookie, /^daana_admin_session=/);
  assert.match(lastSetCookie, /; HttpOnly;/i);

  const products = await call("/admin/products", { cookie: adminCookie });
  const product = products.find((entry) => entry.active) || products[0];
  assert.ok(product, "seeded product is required");
  await call(`/admin/products/${product.id}`, {
    cookie: adminCookie,
    method: "PUT",
    body: JSON.stringify({ ...product, naktaCoins: 7 }),
  });
  await call("/admin/settings/rewards", {
    cookie: adminCookie,
    method: "PUT",
    body: JSON.stringify({
      value: {
        coinNetwork: "polygon",
        nftRewardEveryOrders: 1,
        nftRewardName: "DAANA Test NFT",
        nftRewardImage: "",
        nftRewardDescription: "Интеграционная награда",
        nftRewardNetwork: "polygon",
        nftContractAddress: "",
        nftMetadataUri: "",
      },
    }),
  });

  const locations = await call("/locations");
  assert.ok(locations[0]?.id, "seeded pickup location is required");
  const order = await call("/orders", {
    expected: 201,
    method: "POST",
    body: JSON.stringify({
      customerName: "Интеграционный клиент",
      customerPhone: phone,
      locationId: locations[0].id,
      items: [{ productId: product.id, quantity: 2 }],
    }),
  });
  await call(`/admin/orders/${order.id}/status`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
  await call(`/admin/orders/${order.id}/status`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });

  await call("/auth/request-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  const verified = await call("/auth/verify-code", {
    method: "POST",
    body: JSON.stringify({ phone, code: "0000" }),
  });
  assert.equal(verified.customer.phone, phone);
  assert.equal("verificationToken" in verified, false, "raw session token must not be returned to browser code");
  assert.match(customerCookie, /^daana_customer_session=[a-f0-9]{64}$/);
  assert.match(lastSetCookie, /; HttpOnly;/i);
  assert.match(lastSetCookie, /; SameSite=Strict/i);
  assert.match(lastSetCookie, /; Path=\/api\/auth;/i);

  let profile = await call("/auth/profile", { cookie: customerCookie });
  assert.equal(profile.naktaCoins, 14);
  assert.equal(profile.nfts.length, 1);
  assert.equal(profile.naktaCoinHistory.filter((entry) => entry.orderId === String(order.id)).length, 1);

  await call(`/admin/customers/${phone}/rewards/adjust`, {
    cookie: adminCookie,
    method: "POST",
    body: JSON.stringify({ asset: "coin", delta: 5, reason: "Интеграционная проверка Coin" }),
  });
  await call(`/admin/customers/${phone}/rewards/adjust`, {
    cookie: adminCookie,
    method: "POST",
    body: JSON.stringify({ asset: "nft", delta: 1, reason: "Интеграционная проверка NFT" }),
  });
  profile = await call("/auth/profile", { cookie: customerCookie });
  assert.equal(profile.naktaCoins, 19);
  assert.equal(profile.nfts.length, 2);

  const requestId = crypto.randomUUID();
  const withdrawalOptions = {
    cookie: customerCookie,
    method: "POST",
    body: JSON.stringify({ requestId, amount: 5, walletAddress: wallet }),
  };
  const [firstWithdrawal, retriedWithdrawal] = await Promise.all([
    call("/auth/coins/withdraw", withdrawalOptions),
    call("/auth/coins/withdraw", withdrawalOptions),
  ]);
  assert.equal(firstWithdrawal.id, retriedWithdrawal.id);
  profile = await call("/auth/profile", { cookie: customerCookie });
  assert.equal(profile.naktaCoins, 14, "concurrent retry must debit exactly once");
  await call("/auth/coins/withdraw", {
    ...withdrawalOptions,
    expected: 409,
    body: JSON.stringify({ requestId, amount: 4, walletAddress: wallet }),
  });
  await Promise.all([
    call(`/auth/coins/withdrawals/${firstWithdrawal.id}/cancel`, { cookie: customerCookie, method: "POST" }),
    call(`/auth/coins/withdrawals/${firstWithdrawal.id}/cancel`, { cookie: customerCookie, method: "POST" }),
  ]);
  profile = await call("/auth/profile", { cookie: customerCookie });
  assert.equal(profile.naktaCoins, 19, "concurrent cancellation must refund exactly once");

  const claimedCoin = await call("/auth/coins/withdraw", {
    cookie: customerCookie,
    method: "POST",
    body: JSON.stringify({ requestId: crypto.randomUUID(), amount: 4, walletAddress: wallet }),
  });
  await call(`/admin/coin-withdrawals/${claimedCoin.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "submitted" }),
  });
  await call(`/auth/coins/withdrawals/${claimedCoin.id}/cancel`, {
    cookie: customerCookie,
    method: "POST",
    expected: 409,
  });
  await call(`/admin/coin-withdrawals/${claimedCoin.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    expected: 409,
    body: JSON.stringify({ status: "failed", error: "Нельзя возвращать после отправки" }),
  });
  await call(`/admin/coin-withdrawals/${claimedCoin.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    expected: 400,
    body: JSON.stringify({ status: "withdrawn", txHash: "invalid" }),
  });
  await call(`/admin/coin-withdrawals/${claimedCoin.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "withdrawn", txHash: transactionHash }),
  });

  profile = await call("/auth/profile", { cookie: customerCookie });
  const ownedNft = profile.nfts.find((entry) => entry.status === "owned");
  assert.ok(ownedNft);
  const pendingNft = await call(`/auth/nfts/${ownedNft.id}/withdraw`, {
    cookie: customerCookie,
    method: "POST",
    body: JSON.stringify({ walletAddress: wallet }),
  });
  assert.equal(pendingNft.status, "pending");
  await call(`/auth/nfts/${ownedNft.id}/withdrawal/cancel`, { cookie: customerCookie, method: "POST" });
  await call(`/auth/nfts/${ownedNft.id}/withdrawal/cancel`, { cookie: customerCookie, method: "POST" });

  await call(`/auth/nfts/${ownedNft.id}/withdraw`, {
    cookie: customerCookie,
    method: "POST",
    body: JSON.stringify({ walletAddress: wallet }),
  });
  await call(`/admin/nft-withdrawals/${ownedNft.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "submitted" }),
  });
  await call(`/auth/nfts/${ownedNft.id}/withdrawal/cancel`, {
    cookie: customerCookie,
    method: "POST",
    expected: 409,
  });
  await call(`/admin/nft-withdrawals/${ownedNft.id}`, {
    cookie: adminCookie,
    method: "PATCH",
    body: JSON.stringify({ status: "withdrawn", txHash: transactionHash, tokenId: "integration-1" }),
  });

  const oldCookie = customerCookie;
  await call("/auth/logout", { cookie: customerCookie, method: "POST" });
  await call("/auth/profile", { cookie: oldCookie, expected: 401 });
  await call("/admin/settings/rewards", {
    cookie: adminCookie,
    expected: 403,
    method: "PUT",
    headers: { origin: "https://attacker.invalid" },
    body: JSON.stringify({ value: {} }),
  });
  const oldAdminCookie = adminCookie;
  await call("/admin/logout", { cookie: adminCookie, method: "POST" });
  await call("/admin/session", { cookie: oldAdminCookie, expected: 401 });
  await call("/admin/customers", { expected: 401 });
  context.diagnostic(`validated customer ${phone.slice(0, 6)}•••${phone.slice(-3)}`);
});
