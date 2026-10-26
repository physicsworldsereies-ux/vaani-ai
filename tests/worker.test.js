import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
const env={ALLOWED_ORIGIN:"https://vaani-ai.radhadevi05051980.workers.dev",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_KEY:"test",ASSETS:{fetch:async()=>new Response("site")}};
describe("Vaani Worker routing",()=>{
 it("serves health",async()=>{const r=await worker.fetch(new Request("https://site/health"),env,{});expect(r.status).toBe(200);expect((await r.json()).ok).toBe(true)});
 it("rejects unknown API paths",async()=>{const r=await worker.fetch(new Request("https://site/api/nope",{method:"POST"}),env,{});expect(r.status).toBe(404)});
 it("serves the static site",async()=>{const r=await worker.fetch(new Request("https://site/"),env,{});expect(r.status).toBe(200);expect(await r.text()).toBe("site")});
 it("rejects missing auth on chat",async()=>{const r=await worker.fetch(new Request("https://site/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hi"})}),env,{});expect(r.status).toBe(401)});
});
