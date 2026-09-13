import assert from "node:assert/strict";
import test from "node:test";
import { waitForDatabaseConnection } from "../server/database-readiness";

test("retries temporary DNS failures until the database is reachable", async () => {
  let attempts = 0;
  let warnings = 0;
  await waitForDatabaseConnection(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("DNS not ready"), { code: "ENOTFOUND" });
  }, 100, 1, () => { warnings += 1; });
  assert.equal(attempts, 3);
  assert.equal(warnings, 1);
});

test("does not hide a permanent database error", async () => {
  const error = Object.assign(new Error("bad credentials"), { code: "28P01" });
  await assert.rejects(waitForDatabaseConnection(async () => { throw error; }, 100, 1), error);
});

test("stops retrying when the startup deadline expires", async () => {
  const error = Object.assign(new Error("DNS not ready"), { code: "ENOTFOUND" });
  await assert.rejects(waitForDatabaseConnection(async () => { throw error; }, 5, 1), error);
});
