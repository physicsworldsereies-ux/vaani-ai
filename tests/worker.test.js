import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { calculateCredits, constantEqual, hmac, readBody } from "../src/index.js";
const env={ALLOWED_ORIGIN:"https://vaani-ai.radhadevi05051980.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_KEY:"test",RAZORPAY_WEBHOOK_SECRET:"webhook-test",ASSETS:{fetch:async()=>new Response("site")}};
afterEach(()=>vi.unstubAllGlobals());
describe("Vaani Worker",()=>{
 it("serves health",async()=>{const r=await worker.fetch(new Request("https://site/health"),env,{});expect(r.status).toBe(200);expect((await r.json()).ok).toBe(true)});
 it("rejects unknown API paths",async()=>{const r=await worker.fetch(new Request("https://site/api/nope",{method:"POST"}),env,{});expect(r.status).toBe(404)});
 it("serves the static site",async()=>{const r=await worker.fetch(new Request("https://site/"),env,{});expect(r.status).toBe(200);expect(await r.text()).toBe("site")});
 it("rejects missing auth on chat",async()=>{const r=await worker.fetch(new Request("https://site/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hi"})}),env,{});expect(r.status).toBe(401)});
 it("rejects invalid user tokens using mocked Supabase fetch",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:401})));const r=await worker.fetch(new Request("https://site/api/chat",{method:"POST",headers:{authorization:"Bearer invalid","content-type":"application/json"},body:JSON.stringify({message:"hi"})}),env,{});expect(r.status).toBe(401)});
 it("calculates token credit cost with ceiling and minimum",()=>{expect(calculateCredits(1001,1001,1,4)).toBe(6);expect(calculateCredits(0,0,1,4)).toBe(1)});
 it("compares signatures without accepting different values",()=>{expect(constantEqual("abcd","abcd")).toBe(true);expect(constantEqual("abcd","abce")).toBe(false);expect(constantEqual("abc","abcd")).toBe(false)});
 it("verifies HMAC SHA-256 helper",async()=>{const sig=await hmac("secret","payload");expect(sig).toMatch(/^[0-9a-f]{64}$/);expect(constantEqual(sig,await hmac("secret","payload"))).toBe(true)});
 it("rejects invalid Razorpay webhook signature",async()=>{const r=await worker.fetch(new Request("https://site/api/razorpay-webhook",{method:"POST",headers:{"content-type":"application/json","x-razorpay-signature":"bad"},body:JSON.stringify({event:"payment.captured"})}),env,{});expect(r.status).toBe(401)});
 it("rejects invalid CORS origins",async()=>{const r=await worker.fetch(new Request("https://site/health",{headers:{origin:"https://evil.example"}}),env,{});expect(r.headers.get("access-control-allow-origin")).toBeNull()});
 it("rejects oversized request bodies",async()=>{const req=new Request("https://site/api/chat",{method:"POST",headers:{"content-type":"application/json","content-length":"20000"},body:"x"});await expect(readBody(req,16384)).rejects.toMatchObject({status:413})});
 it("requires authentication for admin actions",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:401})));const r=await worker.fetch(new Request("https://site/api",{method:"POST",headers:{authorization:"Bearer invalid","content-type":"application/json"},body:JSON.stringify({action:"admin-credit",user_id:"not-a-uuid",amount:-1})}),env,{});expect(r.status).toBe(401)});

});
