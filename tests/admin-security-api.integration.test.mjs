import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";

const base=process.env.ADMIN_API_INTEGRATION_URL;
test("admin v2 enforces roles, next-request revocation, last owner and concurrent order state",{skip:base!=="http://127.0.0.1:4100/api"||!process.env.ADMIN_PASSWORD,timeout:45000},async()=>{
  const client=()=>{let cookie="";return async(path,{expected=200,...options}={})=>{
    const response=await fetch(`${base}${path}`,{...options,headers:{...(cookie?{cookie}:{}),...(options.body?{"content-type":"application/json"}:{}),...options.headers}});
    const updated=response.headers.get("set-cookie");if(updated)cookie=updated.split(";",1)[0];
    const body=await response.json().catch(()=>({}));assert.equal(response.status,expected,`${options.method||"GET"} ${path}: ${JSON.stringify(body)}`);return body;
  };};
  const owner=client();const manager=client();const admin=client();
  const login=await owner("/admin/login",{method:"POST",body:JSON.stringify({password:process.env.ADMIN_PASSWORD})});
  assert.equal(login.user.role,"OWNER");
  await owner(`/admin/staff/${login.user.id}/access`,{method:"PUT",expected:409,body:JSON.stringify({role:"ADMIN",permissions:{}})});
  await owner(`/admin/staff/${login.user.id}`,{method:"PATCH",expected:409,body:JSON.stringify({active:false})});
  await owner(`/admin/staff/${login.user.id}`,{method:"PATCH",expected:400,body:JSON.stringify({role:"MANAGER"})});
  const suffix=Date.now();const password=`Integration-${suffix}-safe`;
  const managerUser=await owner("/admin/staff",{method:"POST",expected:201,body:JSON.stringify({name:"Тест менеджера",email:`manager-${suffix}@example.test`,password,role:"MANAGER"})});
  const adminUser=await owner("/admin/staff",{method:"POST",expected:201,body:JSON.stringify({name:"Тест администратора",email:`admin-${suffix}@example.test`,password,role:"ADMIN"})});
  await manager("/admin/login",{method:"POST",body:JSON.stringify({email:managerUser.email,password})});
  await admin("/admin/login",{method:"POST",body:JSON.stringify({email:adminUser.email,password})});
  for(const path of ["/admin/dashboard","/admin/products","/admin/analytics","/admin/settings","/admin/staff"]){await manager(path,{expected:403});}
  await manager("/admin/orders?paginate=1&limit=1");await manager("/admin/customers?limit=1");
  await admin(`/admin/staff/${adminUser.id}/access`,{method:"PUT",expected:403,body:JSON.stringify({role:"OWNER",permissions:{}})});
  await admin(`/admin/staff/${login.user.id}`,{method:"PATCH",expected:403,body:JSON.stringify({password:"Attempted-owner-reset-password"})});
  await owner(`/admin/staff/${managerUser.id}/access`,{method:"PUT",body:JSON.stringify({role:"MANAGER",permissions:{"orders.view":false,"analytics.view":true}})});
  await manager("/admin/orders?paginate=1",{expected:403});
  const session=await manager("/admin/session");assert.ok(!session.user.permissions.includes("orders.view"));assert.ok(session.user.permissions.includes("analytics.view"));
  await owner(`/admin/staff/${managerUser.id}/access`,{method:"PUT",body:JSON.stringify({role:"MANAGER",permissions:{}})});
  const catalog=await owner("/catalog");const locations=await owner("/locations");
  const product=catalog.products[0];assert.ok(product&&locations[0]);
  const order=await owner("/orders",{method:"POST",expected:201,body:JSON.stringify({customerName:"Проверка прав",customerPhone:"996555000017",locationId:locations[0].id,items:[{productId:product.id,quantity:1}]})});
  const saved=await manager(`/admin/orders/${order.id}`);assert.equal(saved.items[0].productName,product.name);
  await manager(`/admin/orders/${order.id}/status`,{method:"PATCH",body:JSON.stringify({status:"confirmed",expectedStatus:"new"})});
  await manager(`/admin/orders/${order.id}/status`,{method:"PATCH",expected:409,body:JSON.stringify({status:"preparing",expectedStatus:"new"})});
  await manager(`/admin/orders/${order.id}/status`,{method:"PATCH",body:JSON.stringify({status:"confirmed",expectedStatus:"new"})});
  const detail=await owner(`/admin/orders/${order.id}`);assert.equal(detail.status,"confirmed");assert.equal(detail.history.at(-1).actorName,managerUser.name);
  await owner(`/admin/staff/${managerUser.id}`,{method:"PATCH",body:JSON.stringify({active:false})});
  await manager("/admin/session",{expected:401});
  await owner(`/admin/staff/${adminUser.id}`,{method:"PATCH",body:JSON.stringify({active:false})});
  const audit=await owner("/admin/audit?limit=100");assert.ok(audit.items.some(event=>event.action==="staff.access"));assert.ok(audit.items.some(event=>event.action==="orders.status"));
});
