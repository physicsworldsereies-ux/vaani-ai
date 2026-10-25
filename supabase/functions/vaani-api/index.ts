import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let n = 0; for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const adminDb = createClient(url, serviceKey, { auth: { persistSession: false } });
const userClient = (token: string) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST required" });
  const pathname = new URL(req.url).pathname;
  const raw = await req.text();

  if (pathname.endsWith("/webhook")) {
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    const signature = req.headers.get("x-razorpay-signature") ?? "";
    if (!secret || !signature || !safeEqual(await hmac(secret, raw), signature)) return reply(401, { error: "Invalid webhook signature" });
    let event: any; try { event = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload?.payment?.entity;
      const order = event.payload?.order?.entity;
      const orderId = payment?.order_id ?? order?.id;
      const paymentId = payment?.id;
      if (orderId && paymentId) {
        const { error } = await adminDb.rpc("fulfill_order", { p_rzp_order: orderId, p_payment: paymentId });
        if (error) return reply(500, { error: "Order fulfilment failed" });
      }
    }
    return reply(200, { received: true });
  }

  let body: any; try { body = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sign in required" });
  const { data: authData, error: authError } = await userClient(token).auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return reply(401, { error: "Invalid session" });
  const { data: profile, error: profileError } = await adminDb.from("profiles").select("id,credits,is_admin,is_banned,email,full_name").eq("id", user.id).single();
  if (profileError || !profile || profile.is_banned) return reply(403, { error: "Account unavailable" });
  const isAdmin = profile.is_admin === true;
  const action = String(body.action ?? "");
  const requireAdmin = () => isAdmin ? null : reply(403, { error: "Admin access required" });

  try {
    if (action === "chat") {
      const message = String(body.message ?? "").trim();
      if (!message || message.length > 12000) return reply(400, { error: "Message must be 1–12000 characters" });
      if (profile.credits < 1) return reply(402, { error: "No credits left. Please top up." });
      let chatId = body.chat_id ? String(body.chat_id) : "";
      if (chatId) {
        const { data: chat } = await adminDb.from("chats").select("id,user_id").eq("id", chatId).eq("user_id", user.id).maybeSingle();
        if (!chat) return reply(404, { error: "Chat not found" });
      } else {
        const { data: chat, error } = await adminDb.from("chats").insert({ user_id: user.id, title: message.slice(0, 36) }).select("id").single();
        if (error || !chat) return reply(500, { error: "Could not create chat" });
        chatId = chat.id;
      }
      const { data: settings } = await adminDb.from("app_settings").select("key,value").in("key", ["maintenance_mode", "model", "system_prompt", "credits_per_1k_input", "credits_per_1k_output"]);
      const cfg: Record<string, any> = {}; for (const x of settings ?? []) cfg[x.key] = x.value;
      if (cfg.maintenance_mode === true) return reply(503, { error: "Vaani is temporarily under maintenance." });
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) return reply(503, { error: "AI backend is not configured yet. Add GEMINI_API_KEY to Supabase Edge Function secrets." });
      const { data: history } = await adminDb.from("messages").select("role,content").eq("chat_id", chatId).eq("user_id", user.id).order("created_at", { ascending: true }).limit(30);
      const contents = [...(history ?? []).map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), { role: "user", parts: [{ text: message }] }];
      const model = String(cfg.model ?? "gemini-2.5-flash").replace(/[^a-zA-Z0-9.-]/g, "");
      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: String(cfg.system_prompt ?? "You are Vaani, a helpful assistant. Reply in the language used by the user.") }] }, contents, generationConfig: { maxOutputTokens: 2048 } }),
      });
      const ai = await aiRes.json();
      if (!aiRes.ok) return reply(502, { error: ai.error?.message ?? "Gemini request failed" });
      const answer = String(ai.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "").trim();
      if (!answer) return reply(502, { error: "Gemini returned an empty answer" });
      const inTokens = Number(ai.usageMetadata?.promptTokenCount ?? Math.ceil((message.length + (history ?? []).reduce((n: number, m: any) => n + m.content.length, 0)) / 4));
      const outTokens = Number(ai.usageMetadata?.candidatesTokenCount ?? Math.ceil(answer.length / 4));
      const credits = Math.max(1, Math.ceil(inTokens / 1000) * Number(cfg.credits_per_1k_input ?? 1) + Math.ceil(outTokens / 1000) * Number(cfg.credits_per_1k_output ?? 4));
      const { data: savedMessages, error: saveError } = await adminDb.from("messages").insert([
        { chat_id: chatId, user_id: user.id, role: "user", content: message, tokens_in: inTokens, tokens_out: 0, credits_used: 0 },
        { chat_id: chatId, user_id: user.id, role: "assistant", content: answer, tokens_in: 0, tokens_out: outTokens, credits_used: credits },
      ]).select("id");
      if (saveError || !savedMessages) return reply(500, { error: "Reply generated but chat history could not be saved. No credits were charged." });
      const { data: remaining, error: chargeError } = await adminDb.rpc("deduct_credits", { p_user: user.id, p_amount: credits, p_ref: chatId });
      if (chargeError) {
        await adminDb.from("messages").delete().in("id", savedMessages.map((m: any) => m.id)).eq("user_id", user.id);
        return reply(402, { error: "Not enough credits for this response. Please top up." });
      }
      await adminDb.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId).eq("user_id", user.id);
      return reply(200, { chat_id: chatId, answer, credits_used: credits, credits_remaining: remaining });
    }

    if (action === "create-order") {
      const keyId = Deno.env.get("RAZORPAY_KEY_ID"), keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
      if (!keyId || !keySecret) return reply(503, { error: "Razorpay is not configured. Add server-side Razorpay secrets first." });
      const packId = Number(body.pack_id);
      const { data: pack } = await adminDb.from("credit_packs").select("id,credits,price_paise,name").eq("id", packId).eq("active", true).single();
      if (!pack) return reply(400, { error: "Credit pack is unavailable" });
      const basic = btoa(`${keyId}:${keySecret}`);
      const rr = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount: pack.price_paise, currency: "INR", receipt: `vaani_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, notes: { user_id: user.id, pack_id: String(pack.id) } }) });
      const order = await rr.json();
      if (!rr.ok) return reply(502, { error: "Razorpay order creation failed", details: order.error?.description ?? "Check Razorpay settings" });
      const { error } = await adminDb.from("orders").insert({ user_id: user.id, pack_id: pack.id, razorpay_order_id: order.id, amount_paise: pack.price_paise, credits: pack.credits, status: "created" });
      if (error) return reply(500, { error: "Could not save payment order" });
      return reply(200, { key_id: keyId, order_id: order.id, amount: pack.price_paise, currency: "INR", name: "Vaani", description: `${pack.credits} credits`, prefill: { email: user.email ?? "" } });
    }

    if (action === "verify-payment") {
      const secret = Deno.env.get("RAZORPAY_KEY_SECRET");
      if (!secret) return reply(503, { error: "Razorpay secret is not configured" });
      const orderId = String(body.razorpay_order_id ?? ""), paymentId = String(body.razorpay_payment_id ?? ""), signature = String(body.razorpay_signature ?? "");
      const { data: order } = await adminDb.from("orders").select("id,user_id,razorpay_order_id,status").eq("razorpay_order_id", orderId).eq("user_id", user.id).single();
      if (!order) return reply(404, { error: "Order not found" });
      if (!safeEqual(await hmac(secret, `${orderId}|${paymentId}`), signature)) return reply(400, { error: "Payment signature verification failed" });
      const { data: ok, error } = await adminDb.rpc("fulfill_order", { p_rzp_order: orderId, p_payment: paymentId });
      if (error) return reply(500, { error: "Payment verified but fulfilment failed. Contact support with your payment ID." });
      const { data: updated } = await adminDb.from("profiles").select("credits").eq("id", user.id).single();
      return reply(200, { verified: true, already_fulfilled: ok === false, credits: updated?.credits ?? null });
    }

    if (action.startsWith("admin-")) {
      const denied = requireAdmin(); if (denied) return denied;
      if (action === "admin-data") {
        const [statsResult, users, orders, packs, settings, ledger] = await Promise.all([
          adminDb.rpc("admin_stats"),
          adminDb.from("profiles").select("id,email,full_name,credits,is_admin,is_banned,created_at").order("created_at", { ascending: false }).limit(200),
          adminDb.from("orders").select("id,user_id,pack_id,razorpay_order_id,razorpay_payment_id,amount_paise,credits,status,created_at").order("created_at", { ascending: false }).limit(200),
          adminDb.from("credit_packs").select("id,name,credits,price_paise,is_popular,active,sort").order("sort"),
          adminDb.from("app_settings").select("key,value,updated_at").order("key"),
          adminDb.from("credit_ledger").select("id,user_id,delta,reason,ref,created_at").order("created_at", { ascending: false }).limit(100),
        ]);
        if (statsResult.error) return reply(500, { error: "Could not load dashboard statistics" });
        return reply(200, { stats: statsResult.data, users: users.data ?? [], orders: orders.data ?? [], packs: packs.data ?? [], settings: settings.data ?? [], ledger: ledger.data ?? [] });
      }
      if (action === "admin-user") {
        const id = String(body.user_id ?? ""); if (!id || id === user.id && body.is_admin === false) return reply(400, { error: "Invalid target user" });
        const update: Record<string, unknown> = {};
        if (typeof body.is_banned === "boolean") update.is_banned = body.is_banned;
        if (typeof body.is_admin === "boolean") update.is_admin = body.is_admin;
        if (!Object.keys(update).length) return reply(400, { error: "No valid fields" });
        const { error } = await adminDb.from("profiles").update(update).eq("id", id);
        if (error) return reply(500, { error: "Could not update user" });
        return reply(200, { saved: true });
      }
      if (action === "admin-setting") {
        const allowed = new Set(["system_prompt", "model", "maintenance_mode", "free_credits", "credits_per_1k_input", "credits_per_1k_output"]);
        const key = String(body.key ?? ""); if (!allowed.has(key)) return reply(400, { error: "Setting not allowed" });
        const value = key === "maintenance_mode" ? Boolean(body.value) : key === "system_prompt" || key === "model" ? String(body.value).slice(0, 8000) : Math.max(0, Math.min(100000, Math.floor(Number(body.value))));
        const { error } = await adminDb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return error ? reply(500, { error: "Could not save setting" }) : reply(200, { saved: true });
      }
      if (action === "admin-pack") {
        const id = Number(body.id); const update: Record<string, unknown> = {};
        if (typeof body.name === "string") update.name = body.name.slice(0, 60);
        if (Number.isInteger(body.credits) && body.credits > 0) update.credits = body.credits;
        if (Number.isInteger(body.price_paise) && body.price_paise > 0) update.price_paise = body.price_paise;
        if (typeof body.active === "boolean") update.active = body.active;
        if (typeof body.is_popular === "boolean") update.is_popular = body.is_popular;
        if (!id || !Object.keys(update).length) return reply(400, { error: "Invalid pack update" });
        const { error } = await adminDb.from("credit_packs").update(update).eq("id", id);
        return error ? reply(500, { error: "Could not update pack" }) : reply(200, { saved: true });
      }
      if (action === "admin-credit") {
        const target = String(body.user_id ?? ""), amount = Math.floor(Number(body.amount));
        if (!target || !Number.isInteger(amount) || amount < 1 || amount > 100000) return reply(400, { error: "Credit amount must be 1–100000" });
        const { error } = await adminDb.rpc("admin_adjust_credits", { p_user: target, p_amount: amount, p_reason: "admin_adjustment" });
        return error ? reply(500, { error: "Could not adjust credits" }) : reply(200, { saved: true });
      }
      return reply(400, { error: "Unknown admin action" });
    }
    return reply(400, { error: "Unknown action" });
  } catch (e) {
    console.error("vaani-api error", e);
    return reply(500, { error: "Unexpected server error" });
  }
});
