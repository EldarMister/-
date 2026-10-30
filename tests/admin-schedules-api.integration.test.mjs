import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";

const base=process.env.ADMIN_API_INTEGRATION_URL;
test("weekly schedules reject closed orders, validate updates, enforce rights and preserve legacy hours",{skip:base!=="http://127.0.0.1:4100/api"||!process.env.ADMIN_PASSWORD,timeout:30000},async()=>{
  const call=async(path,cookie="",{expected=200,...options}={})=>{
    const response=await fetch(`${base}${path}`,{...options,headers:{...(cookie?{cookie}:{}),...(options.body?{"content-type":"application/json"}:{}),...options.headers}});
    const body=await response.json().catch(()=>({}));assert.equal(response.status,expected,`${path}: ${response.status} ${JSON.stringify(body)}`);return {body,cookie:response.headers.get("set-cookie")?.split(";",1)[0]||cookie};
  };
  const owner=await call("/admin/login","",{method:"POST",body:JSON.stringify({password:process.env.ADMIN_PASSWORD})});
  const suffix=Date.now();const name=`Тест расписания ${suffix}`;
  const {body:location}=await call("/admin/locations",owner.cookie,{method:"POST",expected:201,body:JSON.stringify({name,address:"Тестовый адрес",phone:"996555000019",hours:"10:00 - 21:00",opensAt:"10:00",latitude:40.6,longitude:72.9,active:true})});
  let employee;
  try{
    const {body:catalog}=await call("/catalog");const closed=Array.from({length:7},(_,day)=>({day,intervals:[]}));
    const {body:list}=await call(`/admin/schedules?search=${encodeURIComponent(name)}`,owner.cookie);const initial=list.items.find(row=>Number(row.locationId)===location.id);assert.equal(initial.version,0);assert.equal(initial.enabled,false);
    const {body:saved}=await call(`/admin/schedules/${location.id}`,owner.cookie,{method:"PUT",body:JSON.stringify({enabled:true,weekly:closed,version:0})});assert.equal(saved.version,1);
    const orderBody=JSON.stringify({customerName:"Проверка расписания",customerPhone:"996555000019",locationId:location.id,items:[{productId:catalog.products[0].id,quantity:1}]});
    await call("/orders","",{method:"POST",expected:409,body:orderBody});
    await call(`/admin/schedules/${location.id}`,owner.cookie,{method:"PUT",expected:409,body:JSON.stringify({enabled:false,weekly:closed,version:0})});
    await call(`/admin/schedules/${location.id}`,owner.cookie,{method:"PUT",expected:400,body:JSON.stringify({enabled:true,weekly:[{day:0,intervals:[{start:"25:00",end:"10:00"}]}],version:1})});
    const password=`Schedule-test-${suffix}-safe`;const created=await call("/admin/staff",owner.cookie,{method:"POST",expected:201,body:JSON.stringify({name:"Тест расписания менеджер",email:`schedules-${suffix}@example.test`,password,role:"MANAGER"})});employee=created.body;
    const manager=await call("/admin/login","",{method:"POST",body:JSON.stringify({email:employee.email,password})});
    await call("/admin/schedules",manager.cookie,{expected:403});await call(`/admin/schedules/${location.id}`,manager.cookie,{method:"PUT",expected:403,body:JSON.stringify({enabled:false,weekly:closed,version:1})});
    await call(`/admin/schedules/${location.id}`,owner.cookie,{method:"PUT",body:JSON.stringify({enabled:false,weekly:closed,version:1})});
    await call("/orders","",{method:"POST",expected:201,body:orderBody});
    const {body:publicLocations}=await call("/locations");assert.equal(publicLocations.find(row=>row.id===location.id).hours,"10:00 - 21:00");
  }finally{
    await call(`/admin/locations/${location.id}`,owner.cookie,{method:"DELETE",expected:204});
    if(employee)await call(`/admin/staff/${employee.id}`,owner.cookie,{method:"PATCH",body:JSON.stringify({active:false})});
  }
});
