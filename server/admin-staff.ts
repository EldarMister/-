import { Router } from "express";
import bcrypt from "bcryptjs";
import { sql } from "./db";
import { effectivePermissions, permissionDefinitions, roleDefaults, validRole } from "./admin-permissions";

const router=Router();
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
function publicStaff(row:Record<string,unknown>){
  const role=validRole(row.role)?row.role:"MANAGER";
  const permissionOverrides=(row.permission_overrides||{}) as Record<string,boolean|null>;
  return {id:Number(row.id),name:row.name,email:row.email,role,active:row.active,createdAt:row.created_at,permissionOverrides,effectivePermissions:effectivePermissions(role,permissionOverrides)};
}
router.get("/",async(_req,res)=>{
  const rows=await sql`SELECT id,name,email,role,active,permission_overrides,created_at FROM admin_users ORDER BY id`;
  res.json({items:rows.map(publicStaff),permissionDefinitions,roleDefaults});
});
router.post("/",async(req,res)=>{
  if(res.locals.admin.role!=="OWNER")fail(403,"Создавать учётные записи и назначать роли может только владелец");
  const name=String(req.body.name||"").trim();const email=String(req.body.email||"").trim().toLowerCase();const password=String(req.body.password||"");
  if(!name||name.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||password.length<12||password.length>256||!validRole(req.body.role))fail(400,"Укажите имя, email, роль и пароль от 12 символов");
  const hash=await bcrypt.hash(password,12);
  const row=await sql.begin(async tx=>{
    const [created]=await tx`INSERT INTO admin_users(name,email,password_hash,role) VALUES (${name},${email},${hash},${req.body.role}) RETURNING *`;
    await tx`INSERT INTO admin_audit_log(admin_user_id,actor_name,action,target,details) VALUES (${res.locals.admin.id},${res.locals.admin.name},'staff.create',${String(created.id)},${tx.json({name,role:req.body.role})})`;
    return created;
  });res.status(201).json(publicStaff(row));
});
router.patch("/:id",async(req,res)=>{
  if("role" in req.body||"permissions" in req.body||"permissionOverrides" in req.body||"permission_overrides" in req.body)fail(400,"Роли и права изменяются только владельцем в разделе доступа");
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)fail(400,"Сотрудник не найден");
  const owner=res.locals.admin.role==="OWNER";
  if(!owner && ("active" in req.body||"password" in req.body))fail(403,"Изменять доступ к учётной записи может только владелец");
  const name=req.body.name===undefined?null:String(req.body.name).trim();
  const email=req.body.email===undefined?null:String(req.body.email).trim().toLowerCase();
  const active=req.body.active===undefined?null:req.body.active;
  const password=req.body.password===undefined?"":String(req.body.password);
  if(name!==null&&(!name||name.length>120)||email!==null&&(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)||active!==null&&typeof active!=="boolean"||password&&(password.length<12||password.length>256))fail(400,"Проверьте имя, email и длину пароля (от 12 символов)");
  const hash=password?await bcrypt.hash(password,12):null;
  const updated=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(76121025)`;
    const [current]=await tx`SELECT * FROM admin_users WHERE id=${id} FOR UPDATE`;
    if(!current)fail(404,"Сотрудник не найден");
    if(!owner && (current.role==="OWNER" || id!==res.locals.admin.id))fail(403,"Редактировать других сотрудников может только владелец");
    if(current.role==="OWNER"&&current.active&&active===false){
      const [count]=await tx`SELECT COUNT(*)::int AS count FROM admin_users WHERE role='OWNER' AND active=TRUE`;
      if(count.count<=1)fail(409,"Нельзя заблокировать последнего активного владельца");
    }
    const [row]=await tx`UPDATE admin_users SET name=COALESCE(${name},name),email=COALESCE(${email},email),active=COALESCE(${active},active),password_hash=COALESCE(${hash},password_hash) WHERE id=${id} RETURNING *`;
    if(active===false || hash)await tx`DELETE FROM admin_sessions WHERE admin_user_id=${id}`;
    if(active===false)await tx`DELETE FROM admin_push_subscriptions WHERE admin_user_id=${id}`;
    await tx`INSERT INTO admin_audit_log(admin_user_id,actor_name,action,target,details) VALUES (${res.locals.admin.id},${res.locals.admin.name},'staff.edit',${String(id)},${tx.json({name:row.name,active:row.active,passwordChanged:Boolean(hash)})})`;
    return row;
  });res.json(publicStaff(updated));
});
router.put("/:id/access",async(req,res)=>{
  if(res.locals.admin.role!=="OWNER")fail(403,"Изменять роли и права может только владелец");
  if(!validRole(req.body.role))fail(400,"Выберите роль сотрудника");
  const overrides=req.body.permissions;
  const keys=new Set(permissionDefinitions.map(p=>p.key));
  if(!overrides || typeof overrides!=="object"||Array.isArray(overrides)||Object.entries(overrides).some(([key,value])=>!keys.has(key)||![true,false,null].includes(value as boolean|null)))fail(400,"Проверьте персональные права");
  const clean=Object.fromEntries(Object.entries(overrides).filter(([,value])=>value!==null)) as Record<string,boolean>;
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)fail(400,"Сотрудник не найден");
  const row=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(76121025)`;
    const [current]=await tx`SELECT * FROM admin_users WHERE id=${id} FOR UPDATE`;
    if(!current)fail(404,"Сотрудник не найден");
    if(current.role==="OWNER"&&current.active&&req.body.role!=="OWNER"){
      const [count]=await tx`SELECT COUNT(*)::int AS count FROM admin_users WHERE role='OWNER' AND active=TRUE`;
      if(count.count<=1)fail(409,"Нельзя понизить последнего активного владельца");
    }
    const [saved]=await tx`UPDATE admin_users SET role=${req.body.role},permission_overrides=${tx.json(clean as never)} WHERE id=${id} RETURNING *`;
    const permissions=effectivePermissions(saved.role,saved.permission_overrides);
    if(!permissions.includes("orders.view"))await tx`DELETE FROM admin_push_subscriptions WHERE admin_user_id=${id}`;
    await tx`INSERT INTO admin_audit_log(admin_user_id,actor_name,action,target,details) VALUES (${res.locals.admin.id},${res.locals.admin.name},'staff.access',${String(id)},${tx.json({role:saved.role,permissions:clean})})`;
    return saved;
  });res.json(publicStaff(row));
});
export default router;
