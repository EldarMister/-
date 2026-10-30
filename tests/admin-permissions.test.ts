import test from "node:test";
import assert from "node:assert/strict";
import { effectivePermissions, requiredPermission, roleDefaults } from "../server/admin-permissions";

test("manager has only orders and customer operations, no destructive or export grants",()=>{
  assert.deepEqual(effectivePermissions("MANAGER"),["orders.view","orders.status","users.view","users.edit"]);
  assert.ok(roleDefaults.ADMIN.includes("products.delete"));
  assert.ok(!roleDefaults.ADMIN.includes("staff.access"));
});
test("overrides deny, grant, inherit, and cannot remove owner authority",()=>{
  assert.ok(!effectivePermissions("ADMIN",{"products.view":false}).includes("products.view"));
  assert.ok(!effectivePermissions("ADMIN",{"orders.view":false}).includes("orders.status"));
  assert.ok(effectivePermissions("MANAGER",{"analytics.view":true}).includes("analytics.view"));
  assert.ok(effectivePermissions("MANAGER",{"orders.view":null}).includes("orders.view"));
  assert.ok(effectivePermissions("OWNER",{"staff.access":false}).includes("staff.access"));
  assert.ok(!effectivePermissions("ADMIN",{"staff.access":true,"staff.create":true}).includes("staff.access"));
  assert.ok(!effectivePermissions("MANAGER",{"staff.create":true}).includes("staff.create"));
  assert.ok(!effectivePermissions("ADMIN",{"users.view":false}).includes("loyalty.adjust"));
});
test("direct endpoints require action specific grants and default deny unknown routes",()=>{
  assert.equal(requiredPermission("PUT","/staff/2/access"),"staff.access");
  assert.equal(requiredPermission("PATCH","/orders/2/status"),"orders.status");
  assert.equal(requiredPermission("POST","/customers/996555000001/rewards/adjust"),"loyalty.adjust");
  assert.equal(requiredPermission("GET","/analytics/export"),"analytics.export");
  assert.equal(requiredPermission("DELETE","/products/1"),"products.delete");
  assert.equal(requiredPermission("PATCH","/customers/996555000001"),"users.edit");
  assert.equal(requiredPermission("GET","/customers/996555000001/orders"),"orders.view");
  assert.equal(requiredPermission("GET","/secret"),"__denied__");
});
