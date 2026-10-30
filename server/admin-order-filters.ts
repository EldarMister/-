import { sql } from "./db";
export function orderFilter(query:Record<string,unknown>){
  const search=String(query.search||"").trim().slice(0,120);const status=String(query.status||"");const locationId=Number(query.locationId||0);
  const from=String(query.from||"");const to=String(query.to||"");
  const validDate=(value:string)=>!value || /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
  if(!validDate(from)||!validDate(to)||from&&to&&from>to||!Number.isSafeInteger(locationId)||locationId<0||status&&!["new","confirmed","preparing","ready","completed","cancelled"].includes(status))throw Object.assign(new Error("Проверьте период, точку и статус"),{status:400});
  return sql`(${search===""} OR o.order_number ILIKE ${`%${search}%`} OR o.customer_name ILIKE ${`%${search}%`} OR o.customer_phone ILIKE ${`%${search}%`}) AND (${status===""} OR o.status=${status}) AND (${locationId===0} OR o.location_id=${locationId}) AND (${from===""} OR o.created_at >= (NULLIF(${from},'')::date::timestamp AT TIME ZONE 'Asia/Bishkek')) AND (${to===""} OR o.created_at < ((NULLIF(${to},'')::date+1)::timestamp AT TIME ZONE 'Asia/Bishkek'))`;
}
export function csvCell(value:unknown){const text=String(value??"");return `"${(/^[=+\-@\t\r]/.test(text)?"'":"")+text.replaceAll('"','""')}"`;}
