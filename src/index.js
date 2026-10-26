const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_MS = 60_000;
const RATE_MAX = 12;
const rateBuckets = new Map();

const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...headers }
});
const enc = new TextEncoder();
const sb = (env, path, init={}) => fetch(env.SUPABASE_URL + path, {
  ...init,
  headers: {
    apikey: env.SUPABASE_SERVICE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
    "content-type": "application/json",
    ...(init.headers || {})
  }
});
async function sbJson(env,path,init={}) {
  const res=await sb(env,path,init);
  const text=await res.text();
  let data=null; try { data=text ? JSON.parse(text) : null; } catch {}
  if(!res.ok) throw new Error("supabase_"+res.status);
  return {data,res};
}
function constantEqual(a,b){
  if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
  let n=0; for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i); return n===0;
}
async function hmac(secret,value){
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(value)))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function readBody(req,limit=16_384){
  const declared=Number(req.headers.get("content-length")||0);
  if(declared>limit) throw Object.assign(new Error("body_too_large"),{status:413});
  const text=await req.text();
  if(new TextEncoder().encode(text).byteLength>limit) throw Object.assign(new Error("body_too_large"),{status:413});
  return text;
}
function corsFor(req,env){
  const allowed=(env.ALLOWED_ORIGIN||"").split(",").map(s=>s.trim()).filter(Boolean);
  const origin=req.headers.get("origin")||"";
  const valid=allowed.includes(origin);
  return {
    ...(valid?{"access-control-allow-origin":origin}:{}),
    "access-control-allow-methods":"GET,POST,PUT,OPTIONS",
    "access-control-allow-headers":"authorization,content-type",
    "access-control-max-age":"86400",
    "vary":"Origin"
  };
}
function limited(key){
  const now=Date.now(); const old=rateBuckets.get(key);
  if(!old||now-old.start>=WINDOW_MS){rateBuckets.set(key,{start:now,count:1});return false}
  old.count++; return old.count>RATE_MAX;
}
async function authUser(req,env){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) throw Object.assign(new Error("unauthorized"),{status:401});
  const res=await fetch(env.SUPABASE_URL+"/auth/v1/user",{
    headers:{apikey:env.SUPABASE_SERVICE_KEY,authorization:"Bearer "+token}
  });
  if(!res.ok) throw Object.assign(new Error("unauthorized"),{status:401});
  return {user:await res.json(),token};
}
async function profile(env,id){
  const {data}=await sbJson(env,"/rest/v1/profiles?id=eq."+encodeURIComponent(id)+"&select=id,email,full_name,avatar_url,credits,is_admin,is_banned&limit=1");
  return Array.isArray(data)?data[0]:null;
}
async function requireAdmin(env,user){
  const p=await profile(env,user.id);
  if(!p||p.is_banned||p.is_admin!==true) throw Object.assign(new Error("admin_required"),{status:403});
  return p;
}
async function settings(env){
  const {data}=await sbJson(env,"/rest/v1/app_settings?select=key,value");
  const out={}; for(const row of Array.isArray(data)?data:[])out[row.key]=row.value;
  return out;
}
async function insertOrder(env,row){
  const {data}=await sbJson(env,"/rest/v1/orders",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify(row)});
  return Array.isArray(data)?data[0]:null;
}
async function fulfill(env,orderId,paymentId){
  const {data}=await sbJson(env,"/rest/v1/rpc/fulfill_order",{method:"POST",body:JSON.stringify({p_rzp_order:orderId,p_payment:paymentId})});
  return data;
}
async function makeOrder(env,user,packId){
  const keyId=env.RAZORPAY_KEY_ID,keySecret=env.RAZORPAY_KEY_SECRET;
  if(!keyId||!keySecret)throw Object.assign(new Error("razorpay_not_configured"),{status:503});
  const id=Number(packId);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error("invalid_pack"),{status:400});
  const {data}=await sbJson(env,"/rest/v1/credit_packs?id=eq."+id+"&active=eq.true&select=id,name,credits,price_paise&limit=1");
  const pack=Array.isArray(data)?data[0]:null;
  if(!pack)throw Object.assign(new Error("pack_unavailable"),{status:400});
  const basic=btoa(keyId+":"+keySecret);
  const rr=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{authorization:"Basic "+basic,"content-type":"application/json"},body:JSON.stringify({
    amount:pack.price_paise,currency:"INR",receipt:"vaani_"+crypto.randomUUID().replaceAll("-","").slice(0,20),
    notes:{user_id:user.id,pack_id:String(pack.id)}
  })});
  const order=await rr.json().catch(()=>({}));
  if(!rr.ok||!order.id)throw Object.assign(new Error("razorpay_order_failed"),{status:502});
  const saved=await insertOrder(env,{user_id:user.id,pack_id:pack.id,razorpay_order_id:order.id,amount_paise:pack.price_paise,credits:pack.credits,status:"created"});
  if(!saved)throw Object.assign(new Error("order_save_failed"),{status:500});
  return {key_id:keyId,order_id:order.id,amount:pack.price_paise,currency:"INR",name:"Vaani",description:pack.credits+" credits",prefill:{email:user.email||""}};
}
async function verifyPayment(env,user,body){
  const secret=env.RAZORPAY_KEY_SECRET;
  if(!secret)throw Object.assign(new Error("razorpay_not_configured"),{status:503});
  const orderId=String(body.razorpay_order_id||""), paymentId=String(body.razorpay_payment_id||""), signature=String(body.razorpay_signature||"");
  if(!orderId||!paymentId||!signature)throw Object.assign(new Error("payment_details_missing"),{status:400});
  const {data}=await sbJson(env,"/rest/v1/orders?razorpay_order_id=eq."+encodeURIComponent(orderId)+"&user_id=eq."+encodeURIComponent(user.id)+"&select=id,status&limit=1");
  if(!Array.isArray(data)||!data[0])throw Object.assign(new Error("order_not_found"),{status:404});
  if(!constantEqual(await hmac(secret,orderId+"|"+paymentId),signature))throw Object.assign(new Error("payment_signature_invalid"),{status:400});
  const fulfilled=await fulfill(env,orderId,paymentId);
  const p=await profile(env,user.id);
  return {verified:true,already_fulfilled:fulfilled===false,credits:p?.credits??null};
}
async function handleWebhook(req,env){
  const secret=env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret)return json({error:"webhook_not_configured"},503);
  const raw=await readBody(req,1_000_000);
  const signature=req.headers.get("x-razorpay-signature")||"";
  if(!signature||!constantEqual(await hmac(secret,raw),signature))return json({error:"invalid_signature"},401);
  let event;try{event=JSON.parse(raw)}catch{return json({error:"invalid_json"},400)}
  if(event.event==="payment.captured"||event.event==="order.paid"){
    const payment=event.payload?.payment?.entity,order=event.payload?.order?.entity;
    const orderId=payment?.order_id||order?.id,paymentId=payment?.id;
    if(orderId&&paymentId){
      try{await fulfill(env,orderId,paymentId)}catch{return json({error:"fulfilment_failed"},500)}
    }
  }
  return json({received:true});
}
async function chat(req,env,ctx,cors,user,token){
  if(limited("chat:"+user.id))return json({error:"rate_limited"},429,cors);
  let body;try{body=JSON.parse(await readBody(req))}catch(e){return json({error:e.status===413?"body_too_large":"bad_request"},e.status||400,cors)}
  const text=String(body.message||"").trim();
  if(!text||text.length>8000)return json({error:"bad_message"},400,cors);
  const p=await profile(env,user.id);
  if(!p)return json({error:"no_profile"},403,cors);
  if(p.is_banned)return json({error:"banned"},403,cors);
  if(p.credits<1)return json({error:"no_credits"},402,cors);
  const S=await settings(env);
  if(S.maintenance_mode===true)return json({error:"maintenance"},503,cors);
  const model=String(S.model??"").trim();
  if(!model||!/^[a-zA-Z0-9._-]{1,100}$/.test(model))return json({error:"model_setting_missing"},503,cors);
  if(!env.GEMINI_API_KEY)return json({error:"ai_not_configured"},503,cors);
  let chatId=body.chat_id||null,history=[];
  if(chatId){
    if(!UUID.test(chatId))return json({error:"chat_not_found"},404,cors);
    const {data:c}=await sbJson(env,"/rest/v1/chats?id=eq."+chatId+"&user_id=eq."+user.id+"&select=id&limit=1");
    if(!Array.isArray(c)||!c[0])return json({error:"chat_not_found"},404,cors);
    const {data:h}=await sbJson(env,"/rest/v1/messages?chat_id=eq."+chatId+"&user_id=eq."+user.id+"&select=role,content&order=created_at.desc&limit=20");
    history=(Array.isArray(h)?h:[]).reverse();
  }
  const contents=[...history.map(m=>({role:m.role==="user"?"user":"model",parts:[{text:m.content}]})),{role:"user",parts:[{text}]}];
  const rin=Math.max(0,Number(S.credits_per_1k_input??1)),rout=Math.max(0,Number(S.credits_per_1k_output??4));
  const maxOut=Math.max(64,Math.min(2048,Math.floor((p.credits/Math.max(rout,1))*1000)));
  const gr=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":streamGenerateContent?alt=sse",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:String(S.system_prompt??"")} ]},contents,generationConfig:{maxOutputTokens:maxOut}})});
  if(!gr.ok||!gr.body)return json({error:"ai_error"},502,cors);
  if(!chatId){
    const {data:c}=await sbJson(env,"/rest/v1/chats",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({user_id:user.id,title:text.slice(0,36)})});
    if(!Array.isArray(c)||!c[0])return json({error:"chat_save_failed"},500,cors);chatId=c[0].id;
  }
  const {readable,writable}=new TransformStream(),writer=writable.getWriter();
  const sendEvent=o=>writer.write(enc.encode("data: "+JSON.stringify(o)+"\n\n"));
  ctx.waitUntil((async()=>{
    let full="",usage=null;
    try{
      await sendEvent({type:"meta",chat_id:chatId});
      const reader=gr.body.getReader(),decoder=new TextDecoder();let buffer="";
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});let idx;
        while((idx=buffer.indexOf("\n"))>=0){
          const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);
          if(!line.startsWith("data:"))continue;
          let chunk;try{chunk=JSON.parse(line.slice(5).trim())}catch{continue}
          const delta=(chunk.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("");
          if(delta){full+=delta;await sendEvent({type:"delta",text:delta})}
          if(chunk.usageMetadata)usage=chunk.usageMetadata;
        }
      }
      if(!full)throw new Error("empty_reply");
      const tin=Number(usage?.promptTokenCount||Math.ceil((text.length+history.reduce((n,m)=>n+m.content.length,0))/4));
      const tout=Number(usage?.candidatesTokenCount||Math.ceil(full.length/4));
      const cost=Math.max(1,Math.ceil(tin/1000*rin+tout/1000*rout));
      const latest=await profile(env,user.id);
      if(!latest||latest.is_banned||latest.credits<cost){
        await sendEvent({type:"error",error:latest?.is_banned?"banned":"no_credits"});return;
      }
      const saved=await sbJson(env,"/rest/v1/messages",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify([
        {chat_id:chatId,user_id:user.id,role:"user",content:text,tokens_in:tin,tokens_out:0,credits_used:0},
        {chat_id:chatId,user_id:user.id,role:"assistant",content:full,tokens_in:0,tokens_out:tout,credits_used:cost}
      ])});
      const deducted=await sbJson(env,"/rest/v1/rpc/deduct_credits",{method:"POST",body:JSON.stringify({p_user:user.id,p_amount:cost,p_ref:chatId})});
      await sb(env,"/rest/v1/chats?id=eq."+chatId+"&user_id=eq."+user.id,{method:"PATCH",body:JSON.stringify({updated_at:new Date().toISOString()})});
      await sendEvent({type:"done",credits_left:deducted.data,credits_used:cost});
    }catch(e){try{await sendEvent({type:"error",error:"ai_error"})}catch{}}
    finally{try{await writer.close()}catch{}}
  })());
  return new Response(readable,{headers:{...cors,"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache, no-transform","x-content-type-options":"nosniff"}});
}
async function adminAction(env,user,body){
  await requireAdmin(env,user);
  const action=String(body.action||"");
  if(action==="admin-data"){
    const [stats,users,orders,packs,settingsRows,ledger,messages]=await Promise.all([
      fetch(env.SUPABASE_URL+"/rest/v1/rpc/admin_stats",{method:"POST",headers:{apikey:"sb_publishable__GL22Bcvbk0VC-uhhrsQ1Q_9edvV9OD",authorization:"Bearer "+token,"content-type":"application/json"},body:"{}"}).then(async r=>{if(!r.ok)throw new Error("admin_stats_failed");return {data:await r.json(),res:r}}),
      sbJson(env,"/rest/v1/profiles?select=id,email,full_name,credits,is_admin,is_banned,created_at&order=created_at.desc&limit=200"),
      sbJson(env,"/rest/v1/orders?select=id,user_id,pack_id,razorpay_order_id,razorpay_payment_id,amount_paise,credits,status,created_at&order=created_at.desc&limit=200"),
      sbJson(env,"/rest/v1/credit_packs?select=id,name,credits,price_paise,is_popular,active,sort&order=sort"),
      sbJson(env,"/rest/v1/app_settings?select=key,value,updated_at&order=key"),
      sbJson(env,"/rest/v1/credit_ledger?select=id,user_id,delta,reason,ref,created_at&order=created_at.desc&limit=1000"),
      sbJson(env,"/rest/v1/messages?select=created_at,credits_used&order=created_at.desc&limit=1000")
    ]);
    
    const allOrders=orders.data||[],allLedger=ledger.data||[],allMessages=messages.data||[];\n    const daily={};\n    for(let i=29;i>=0;i--){const day=new Date(Date.now()-i*86400000).toISOString().slice(0,10);daily[day]={date:day,messages:0,credits_used:0,revenue_inr:0};}\n    for(const m of allMessages){const day=String(m.created_at||"").slice(0,10);if(daily[day]){daily[day].messages++;daily[day].credits_used+=Number(m.credits_used||0);}}\n    for(const o of allOrders){const day=String(o.created_at||"").slice(0,10);if(daily[day]&&o.status==="paid")daily[day].revenue_inr+=Number(o.amount_paise||0)/100;}
    return {stats:stats.data||{},users:users.data||[],orders:allOrders,packs:packs.data||[],settings:settingsRows.data||[],ledger:allLedger,daily_usage:Object.values(daily)};
  }
  if(action==="admin-user"){
    const id=String(body.user_id||"");if(!UUID.test(id))throw Object.assign(new Error("invalid_user"),{status:400});
    const update={};if(typeof body.is_banned==="boolean")update.is_banned=body.is_banned;if(typeof body.is_admin==="boolean")update.is_admin=body.is_admin;
    if(!Object.keys(update).length)throw Object.assign(new Error("invalid_update"),{status:400});
    await sbJson(env,"/rest/v1/profiles?id=eq."+id,{method:"PATCH",body:JSON.stringify(update)});return {saved:true};
  }
  if(action==="admin-credit"){
    const id=String(body.user_id||""),amount=Math.floor(Number(body.amount));
    if(!UUID.test(id)||!Number.isInteger(amount)||amount===0||Math.abs(amount)>100000)throw Object.assign(new Error("invalid_credit_amount"),{status:400});
    const {data}=await sbJson(env,"/rest/v1/rpc/admin_adjust_credits",{method:"POST",body:JSON.stringify({p_user:id,p_delta:amount,p_reason:String(body.reason||"admin_adjust").slice(0,120)})});return {saved:true,credits:data};
  }
  if(action==="admin-setting"){
    const key=String(body.key||""),allowed=new Set(["system_prompt","model","free_credits","credits_per_1k_input","credits_per_1k_output","maintenance_mode"]);
    if(!allowed.has(key))throw Object.assign(new Error("setting_not_allowed"),{status:400});
    let value=body.value;
    if(key==="maintenance_mode")value=Boolean(value);
    else if(key==="system_prompt")value=String(value||"").slice(0,12000);
    else if(key==="model"){value=String(value||"").trim();if(!/^[a-zA-Z0-9._-]{1,100}$/.test(value))throw Object.assign(new Error("invalid_model"),{status:400})}
    else {value=Math.floor(Number(value));if(!Number.isFinite(value)||value<0||value>100000)throw Object.assign(new Error("invalid_setting"),{status:400})}
    await sbJson(env,"/rest/v1/app_settings?on_conflict=key",{method:"POST",headers:{prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({key,value,updated_at:new Date().toISOString()})});return {saved:true};
  }
  if(action==="admin-pack"){
    const id=Number(body.id),update={};
    if(typeof body.name==="string")update.name=body.name.trim().slice(0,60);
    if(Number.isInteger(body.credits)&&body.credits>0)update.credits=body.credits;
    if(Number.isInteger(body.price_paise)&&body.price_paise>0)update.price_paise=body.price_paise;
    if(typeof body.active==="boolean")update.active=body.active;
    if(typeof body.is_popular==="boolean")update.is_popular=body.is_popular;
    if(!body.id){
      if(!update.name||!Number.isInteger(update.credits)||!Number.isInteger(update.price_paise))throw Object.assign(new Error("invalid_pack"),{status:400});
      if(typeof update.active!=="boolean")update.active=true;
      if(typeof update.is_popular!=="boolean")update.is_popular=false;
      const result=await sbJson(env,"/rest/v1/credit_packs",{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify(update)});
      return {saved:true,pack:Array.isArray(result.data)?result.data[0]:null};
    }
    if(!Number.isInteger(id)||id<1||!Object.keys(update).length)throw Object.assign(new Error("invalid_pack"),{status:400});
    await sbJson(env,"/rest/v1/credit_packs?id=eq."+id,{method:"PATCH",body:JSON.stringify(update)});return {saved:true};
  }
  throw Object.assign(new Error("unknown_admin_action"),{status:400});
}
async function apiAction(req,env,user,body,token){
  const action=String(body.action||"");
  if(action.startsWith("admin-"))return adminAction(env,user,body,token);
  if(action==="create-order")return makeOrder(env,user,body.pack_id);
  if(action==="verify-payment")return verifyPayment(env,user,body);
  if(action==="chat")throw Object.assign(new Error("use_chat_endpoint"),{status:400});
  throw Object.assign(new Error("unknown_action"),{status:400});
}
export default {
 async fetch(req,env,ctx){
  const cors=corsFor(req,env),url=new URL(req.url),path=url.pathname;
  if(path==="/health")return json({ok:true,service:"vaani-ai",time:new Date().toISOString()},200,cors);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(path==="/api/razorpay-webhook"&&req.method==="POST")return handleWebhook(req,env);
  if(path==="/api/chat"&&req.method==="POST"){
   try{const {user,token}=await authUser(req,env);return await chat(req,env,ctx,cors,user,token)}
   catch(e){return json({error:e.status===401?"unauthorized":e.status===413?"body_too_large":"server_error"},e.status||500,cors)}
  }
  if(path==="/api/order"&&req.method==="POST"||path==="/api/verify"&&req.method==="POST"||path==="/api"&&req.method==="POST"||path.startsWith("/api/admin/")){
   try{
    const {user}=await authUser(req,env);
    if(path.startsWith("/api/admin/")){
      const p=await requireAdmin(env,user);
      if(path==="/api/admin/me"&&req.method==="GET")return json({is_admin:true,user_id:user.id},200,cors);
      if(path==="/api/admin/stats"&&req.method==="GET"){
        const token=(req.headers.get("authorization")||"").split(" ").slice(1).join(" ");const result=await adminAction(env,user,{action:"admin-data"},token);return json({stats:result.stats,daily_usage:result.daily_usage},200,cors);
      }
      if(path==="/api/admin/users"&&req.method==="GET"){
        const q=(url.searchParams.get("q")||"").replace(/[,%()]/g,"").slice(0,80),page=Math.max(1,Number(url.searchParams.get("page")||1));
        const {data}=await sbJson(env,"/rest/v1/profiles?select=id,email,full_name,credits,is_admin,is_banned,created_at&or=(email.ilike.*"+encodeURIComponent(q)+"*,full_name.ilike.*"+encodeURIComponent(q)+"*)&order=created_at.desc&limit=50&offset="+((page-1)*50));
        return json({users:data||[]},200,cors);
      }
      if(path==="/api/admin/users"&&req.method==="POST"){
        const b=JSON.parse(await readBody(req));const id=String(b.user_id||"");
        if(b.action==="ban"||typeof b.banned==="boolean"){if(!UUID.test(id))throw Object.assign(new Error("invalid_user"),{status:400});await sbJson(env,"/rest/v1/profiles?id=eq."+id,{method:"PATCH",body:JSON.stringify({is_banned:Boolean(b.banned)})});return json({saved:true},200,cors)}
        if(b.action==="credits"){const amount=Math.floor(Number(b.delta));if(!UUID.test(id)||!Number.isInteger(amount)||amount===0||Math.abs(amount)>100000)throw Object.assign(new Error("invalid_credit_delta"),{status:400});const {data}=await sbJson(env,"/rest/v1/rpc/admin_adjust_credits",{method:"POST",body:JSON.stringify({p_user:id,p_delta:amount,p_reason:String(b.reason||"admin_adjust").slice(0,120)})});return json({saved:true,credits:data},200,cors)}
      }
      if(path==="/api/admin/settings"&&req.method==="GET"){const s=await settings(env);return json({settings:s},200,cors)}
      if(path==="/api/admin/settings"&&req.method==="PUT"){const b=JSON.parse(await readBody(req));return json(await adminAction(env,user,{action:"admin-setting",...b}),200,cors)}
      if(path==="/api/admin/packs"&&(req.method==="GET"||req.method==="POST"||req.method==="PUT")){
        if(req.method==="GET"){const {data}=await sbJson(env,"/rest/v1/credit_packs?select=id,name,credits,price_paise,is_popular,active,sort&order=sort");return json({packs:data||[]},200,cors)}
        const b=JSON.parse(await readBody(req));return json(await adminAction(env,user,{action:"admin-pack",...b}),200,cors)
      }
      if(path==="/api/admin/orders"&&req.method==="GET"){const {data}=await sbJson(env,"/rest/v1/orders?select=id,user_id,pack_id,razorpay_order_id,razorpay_payment_id,amount_paise,credits,status,created_at&order=created_at.desc&limit=200");return json({orders:data||[]},200,cors)}
      return json({error:"not_found"},404,cors);
    }
    if(path==="/api/order"){const b=JSON.parse(await readBody(req));return json(await makeOrder(env,user,b.pack_id),200,cors)}
    if(path==="/api/verify"){const b=JSON.parse(await readBody(req));return json(await verifyPayment(env,user,b),200,cors)}
    const b=JSON.parse(await readBody(req));return json(await apiAction(req,env,user,b,(req.headers.get("authorization")||"").split(" ").slice(1).join(" ")),200,cors);
   }catch(e){return json({error:e.status===401?"unauthorized":e.message||"server_error"},e.status||500,cors)}
  }
  if(path.startsWith("/api/"))return json({error:"not_found"},404,cors);
  if(req.method!=="GET"&&req.method!=="HEAD")return json({error:"method_not_allowed"},405,cors);
  if(!env.ASSETS)return json({error:"assets_not_configured"},503,cors);
  return env.ASSETS.fetch(req);
 }
};
