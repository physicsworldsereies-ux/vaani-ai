import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { calculateCredits, constantEqual, hmac, readBody } from "../src/index.js";
const env={ALLOWED_ORIGIN:"https://vaani-ai.radhadevi05051980.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_KEY:"test",RAZORPAY_WEBHOOK_SECRET:"webhook-test",ASSETS:{fetch:async()=>new Response("site")}};
afterEach(()=>vi.unstubAllGlobals());
describe("Vaani Worker",()=>{
 it("serves health",async()=>{const r=await worker.fetch(new Request("https://site/health"),env,{});expect(r.status).toBe(200);expect((await r.json()).ok).toBe(true)});
 it("rejects unknown API paths",async()=>{const r=await worker.fetch(new Request("https://site/api/nope",{method:"POST"}),env,{});expect(r.status).toBe(404)});
 it("serves the static site",async()=>{const r=await worker.fetch(new Request("https://site/"),env,{});expect(r.status).toBe(200);expect(await r.text()).toBe("site")});
 it("serves the app shell at the direct admin route with an auth bootstrap",async()=>{const routedEnv={...env,ASSETS:{fetch:async()=>new Response("<!doctype html><html><body>app</body></html>",{headers:{"content-type":"text/html; charset=utf-8","content-length":"42"}})}};const r=await worker.fetch(new Request("https://site/admin"),routedEnv,{});const html=await r.text();expect(r.status).toBe(200);expect(html).toContain("await adminOpen()");expect(html).toContain('$("app").classList.add("hide")');expect(html).toContain('$("land").classList.add("hide")');expect(html).toContain("Admin access required.");expect(r.headers.get("content-length")).toBeNull()});
 it("rejects missing auth on chat",async()=>{const r=await worker.fetch(new Request("https://site/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hi"})}),env,{});expect(r.status).toBe(401)});
 it("rejects invalid user tokens using mocked Supabase fetch",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:401})));const r=await worker.fetch(new Request("https://site/api/chat",{method:"POST",headers:{authorization:"Bearer invalid","content-type":"application/json"},body:JSON.stringify({message:"hi"})}),env,{});expect(r.status).toBe(401)});
 it("calculates token credit cost with ceiling and minimum",()=>{expect(calculateCredits(1001,1001,1,4)).toBe(6);expect(calculateCredits(0,0,1,4)).toBe(1)});
 it("compares signatures without accepting different values",()=>{expect(constantEqual("abcd","abcd")).toBe(true);expect(constantEqual("abcd","abce")).toBe(false);expect(constantEqual("abc","abcd")).toBe(false)});
 it("verifies HMAC SHA-256 helper",async()=>{const sig=await hmac("secret","payload");expect(sig).toMatch(/^[0-9a-f]{64}$/);expect(constantEqual(sig,await hmac("secret","payload"))).toBe(true)});
 it("rejects invalid Razorpay webhook signature",async()=>{const r=await worker.fetch(new Request("https://site/api/razorpay-webhook",{method:"POST",headers:{"content-type":"application/json","x-razorpay-signature":"bad"},body:JSON.stringify({event:"payment.captured"})}),env,{});expect(r.status).toBe(401)});
 it("rejects invalid CORS origins",async()=>{const r=await worker.fetch(new Request("https://site/health",{headers:{origin:"https://evil.example"}}),env,{});expect(r.headers.get("access-control-allow-origin")).toBeNull()});
 it("rejects oversized request bodies",async()=>{const req=new Request("https://site/api/chat",{method:"POST",headers:{"content-type":"application/json","content-length":"20000"},body:"x"});await expect(readBody(req,16384)).rejects.toMatchObject({status:413})});
 it("requires authentication for admin actions",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:401})));const r=await worker.fetch(new Request("https://site/api",{method:"POST",headers:{authorization:"Bearer invalid","content-type":"application/json"},body:JSON.stringify({action:"admin-credit",user_id:"not-a-uuid",amount:-1})}),env,{});expect(r.status).toBe(401)});


  it("saves admin settings in one validated upsert batch", async () => {
    const userId="123e4567-e89b-42d3-a456-426614174000";
    const calls=[];
    vi.stubGlobal("fetch",vi.fn(async (input,init={})=>{
      const url=String(input);calls.push({url,method:init.method||"GET",body:init.body});
      if(url.endsWith("/auth/v1/user"))return new Response(JSON.stringify({id:userId,email:"admin@example.com"}),{status:200});
      if(url.includes("/rest/v1/profiles?"))return new Response(JSON.stringify([{id:userId,is_admin:true,is_banned:false,credits:10}]),{status:200});
      if(url.includes("/rest/v1/app_settings?on_conflict=key"))return new Response(null,{status:204});
      return new Response("unexpected request",{status:500});
    }));
    const body={action:"admin-settings-batch",values:[{key:"model",value:"gemini-2.5-flash"},{key:"maintenance_mode",value:false}]};
    const r=await worker.fetch(new Request("https://site/api",{method:"POST",headers:{authorization:"Bearer good","content-type":"application/json"},body:JSON.stringify(body)}),env,{});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({saved:true,count:2});
    const upsert=calls.find(x=>x.url.includes("/rest/v1/app_settings?on_conflict=key"));
    expect(upsert.method).toBe("POST");
    expect(JSON.parse(upsert.body)).toHaveLength(2);
    expect(upsert.body).toContain("gemini-2.5-flash");
  });

  it("rejects duplicate or unsupported keys before writing admin settings", async () => {
    const userId="123e4567-e89b-42d3-a456-426614174000";
    const calls=[];
    vi.stubGlobal("fetch",vi.fn(async input=>{
      const url=String(input);calls.push(url);
      if(url.endsWith("/auth/v1/user"))return new Response(JSON.stringify({id:userId}),{status:200});
      if(url.includes("/rest/v1/profiles?"))return new Response(JSON.stringify([{id:userId,is_admin:true,is_banned:false}]),{status:200});
      return new Response("unexpected request",{status:500});
    }));
    const body={action:"admin-settings-batch",values:[{key:"model",value:"gemini-2.5-flash"},{key:"model",value:"other"}]};
    const r=await worker.fetch(new Request("https://site/api",{method:"POST",headers:{authorization:"Bearer good","content-type":"application/json"},body:JSON.stringify(body)}),env,{});
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("setting_not_allowed");
    expect(calls.some(url=>url.includes("/rest/v1/app_settings"))).toBe(false);
  });

});
