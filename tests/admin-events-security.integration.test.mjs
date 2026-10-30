import test from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";

const base=process.env.ADMIN_API_INTEGRATION_URL;
test("order events expose committed records and honor rights revoked on an open stream",{skip:base!=="http://127.0.0.1:4100/api"||!process.env.ADMIN_PASSWORD,timeout:30000},async()=>{
  const call=async(path,cookie="",options={})=>{
    const response=await fetch(`${base}${path}`,{...options,headers:{...(cookie?{cookie}:{}),...(options.body?{"content-type":"application/json"}:{}),...options.headers}});
    const body=await response.json().catch(()=>({}));assert.equal(response.ok,true,`${path}: ${response.status} ${JSON.stringify(body)}`);return {body,cookie:response.headers.get("set-cookie")?.split(";",1)[0]||cookie};
  };
  const owner=await call("/admin/login","",{method:"POST",body:JSON.stringify({password:process.env.ADMIN_PASSWORD})});
  const password=`Event-test-${Date.now()}-safe`;
  const {body:employee}=await call("/admin/staff",owner.cookie,{method:"POST",body:JSON.stringify({name:"Тест подписки",email:`events-${Date.now()}@example.test`,password,role:"MANAGER"})});
  const manager=await call("/admin/login","",{method:"POST",body:JSON.stringify({email:employee.email,password})});
  const controllers=[];const readers=[];const events=[];
  const start=async(cookie)=>{
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(`${base}/admin/events`,{headers:{cookie},signal:controller.signal});assert.equal(response.status,200);
    const received=[];events.push(received);const reader=response.body.getReader();let buffer="";
    readers.push((async()=>{try{while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=new TextDecoder().decode(chunk.value);let boundary;while((boundary=buffer.indexOf("\n\n"))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const type=block.match(/^event: (.*)$/m)?.[1];const data=block.match(/^data: (.*)$/m)?.[1];if(type&&data)received.push({type,data:JSON.parse(data)});}}}catch(error){if(!controller.signal.aborted)throw error;}})());return received;
  };
  const until=async(predicate)=>{const end=Date.now()+7000;while(!predicate()){if(Date.now()>end)assert.fail("Expected server event did not arrive");await new Promise(resolve=>setTimeout(resolve,30));}};
  try{
    const ownerEvents=await start(owner.cookie);const managerEvents=await start(manager.cookie);
    const {body:catalog}=await call("/catalog");const {body:locations}=await call("/locations");
    const createOrder=async()=>{const {body}=await call("/orders","",{method:"POST",body:JSON.stringify({customerName:"Проверка событий",customerPhone:"996555000018",locationId:locations[0].id,items:[{productId:catalog.products[0].id,quantity:1}]})});return body;};
    const first=await createOrder();
    await until(()=>managerEvents.some(event=>event.type==="order-created"&&String(event.data.orderId)===String(first.id)));
    const event=managerEvents.find(event=>event.type==="order-created"&&String(event.data.orderId)===String(first.id));assert.equal(event.data.eventId,`order:${first.id}`);assert.equal("customerPhone" in event.data,false);
    const committed=await call(`/admin/orders/${first.id}`,owner.cookie);assert.equal(committed.body.items.length,1);
    await call(`/admin/staff/${employee.id}/access`,owner.cookie,{method:"PUT",body:JSON.stringify({role:"MANAGER",permissions:{"orders.view":false}})});
    const second=await createOrder();await until(()=>ownerEvents.some(event=>event.type==="order-created"&&String(event.data.orderId)===String(second.id)));
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(managerEvents.some(event=>event.type==="order-created"&&String(event.data.orderId)===String(second.id)),false);
    assert.ok(managerEvents.some(event=>event.type==="access-changed"));
  }finally{
    controllers.forEach(controller=>controller.abort());await Promise.allSettled(readers);
    await call(`/admin/staff/${employee.id}`,owner.cookie,{method:"PATCH",body:JSON.stringify({active:false})});
  }
});
