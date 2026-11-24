import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

describe("Vaani chat UI", () => {
  it("keeps the root compatibility entrypoint byte-for-byte aligned with the deployed public frontend", () => {
    const root = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(root).toBe(deployed);
  });

  it("keeps New Chat state and in-flight responses isolated in both app entrypoints", () => {
    for (const path of ["../index.html", "../public/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html).toContain("function newChat(){");
      expect(html).toContain("const chat=cur;if(!chat)return;");
      expect(html).toContain("b.failed=message;");
      expect(html).toContain("if(cur===chat&&te.isConnected)");
      expect(html).toContain("b.failed=message;");
      expect(html).toContain("async function retryMessage(index)");
      expect(html).toContain("cur.m.map((m,i)=>row(m,i))");
      expect(html).toContain("function setComposerBusy(value)");
      expect(html).toContain("Please attach a smaller image.");
    }
  });

  it("uses one explicit sidebar controller for open, close and accessibility state", () => {
    for (const path of ["../index.html", "../public/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html).toContain('id="sideCloseBtn"');
      expect(html).toContain('onclick="closeSidebar(event)"');
      expect(html).toContain("function syncSidebarControls()");
      expect(html).toContain("function setSidebarOpen(open)");
      expect(html).toContain("function toggleSidebar(event)");
      expect(html).toContain("function closeSidebar(event)");
      expect(html).toContain("side.inert=hidden");
      expect(html).toContain("app.classList.toggle('sidebar-open',drawerOpen)");
      expect(html).toContain("side.classList.toggle('open',drawerOpen)");
      expect(html).toContain("#app.sidebar-open .sidebar-scrim");
      expect(html).toContain("pointer-events:auto!important");
    }
  });

  it("keeps history selection, New Chat and full-chat mode synchronized with sidebar state", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("profileClose();setSidebarOpen(false)");
    expect(html).toContain("app.classList.toggle('full-chat',full)");
    expect(html).toContain("setSidebarOpen(false);");
    expect(html).toContain("function newChat(){");
    expect(html).toContain("side.setAttribute('aria-hidden',String(hidden))");
  });

  it("keeps desktop sidebar persistent and uses a backdrop drawer on mobile", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("grid-template-columns:280px minmax(0,1fr)");
    expect(html).toContain("#app.sidebar-open .sidebar-scrim");
    expect(html).toContain("transform:translateX(-105%)!important");
    expect(html).toContain("function syncResponsiveLayout(){");
    expect(html).not.toContain("app.style.setProperty('grid-template-columns'");
  });

  it("only renders the profile admin shortcut for an active authorized admin profile", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("prof&&prof.is_admin===true&&!prof.is_banned");
    expect(html).toContain("id=\"profilePanel\"");
    expect(html).toContain("onclick=\"location.assign(\'/admin\')\"");
    expect(html).toContain("Admin dashboard");
  });

  it("styles the chat canvas black and AI replies yellow", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("--chat-black:#000");
    expect(html).toContain("--chat-yellow:#ffdf45");
    expect(html).toContain("#app .m.bot .t{color:var(--chat-yellow)");
    expect(html).toContain("#app .col{width:100%;max-width:none;margin:0}");
    expect(html).toContain("function formatReply(value)");
    expect(html).toContain("formatReply(m.x)");
  });

  it("adds site-wide mobile breakpoints for landing, chat, overlays and admin", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("Site-wide responsive finishing layer");
    expect(html).toContain("@media (max-width:820px)");
    expect(html).toContain("@media (max-width:420px)");
    expect(html).toContain("@media (orientation:landscape) and (max-height:600px)");
    expect(html).toContain("#land .hero{grid-template-columns:minmax(0,1fr)");
    expect(html).toContain("#mod .admin-form{grid-template-columns:minmax(0,1fr)}");
    expect(html).toContain("#app .m .t pre");
  });

  it("refreshes credits from the authenticated profile and uses verified checkout balance", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain('id="refreshCreditsBtn"');
    expect(html).toContain("async function refreshCredits(showToast=true)");
    expect(html).toContain("select('credits').eq('id',user.id).single()");
    expect(html).toContain('id="profileCredits"');
    expect(html).toContain("result.credits!==null&&result.credits!==undefined");
    expect(html).toContain("void refreshCredits(false)");
  });

  it("keeps legal content readable without horizontal overflow on phones", () => {
    const css = readFileSync(new URL("../public/legal.css", import.meta.url), "utf8");
    expect(css).toContain("Responsive legal pages");
    expect(css).toContain("@media(max-width:480px)");
    expect(css).toContain("overflow-wrap:anywhere");
  });


  it("builds profile and ordinary modals with valid independent classes", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("const isProfile=String(h).includes('<h2>Your profile</h2>')");
    expect(html).toContain("(isProfile?'profile-overlay':'')");
    expect(html).toContain("(isProfile?'profile-view':'')");
    expect(html).not.toContain("${'\u0024{isProfile?");
  });

  it("routes admin dashboard shortcuts to the standalone /admin route", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain('id="adminBtn" onclick="location.assign(\'/admin\')"');
    expect(html).toContain("location.assign('/admin')");
    expect(html).toContain("location.assign('/')");
    expect(html).not.toContain("adminUser('${u.id}','is_admin'");
  });

  it("prevents stale history fetches from replacing a newer conversation selection", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("if(cur!==selected)return;");
    expect(html).toContain("selected.m=(r.data||[]).map");
  });

  it("saves all admin settings in a single validated request", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
    expect(html).toContain("api('admin-settings-batch',{values})");
    expect(worker).toContain('if(action==="admin-settings-batch")');
    expect(worker).toContain('resolution=merge-duplicates,return=minimal');
    expect(worker).toContain("setting_not_allowed");
  });

  it("loads the global diagnostics runtime and reports site-wide errors with HTTP status and request IDs", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const diagnostics = readFileSync(new URL("../public/diagnostics.js", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
    expect(() => new Script(diagnostics)).not.toThrow();
    expect(html).toContain("window.__vaaniDiagnostics");
    expect(html).toContain("requestId:e?.request_id");
    expect(html).toContain("failure.code=j.code");
    expect(diagnostics).toContain("window.fetch = async");
    expect(diagnostics).toContain("REQUEST_TIMEOUT");
    expect(diagnostics).toContain("NETWORK_ERROR");
    expect(diagnostics).toContain("HTTP_ERROR");
    expect(diagnostics).toContain("Request ID:");
    expect(diagnostics).toContain("Copy details");
    expect(worker).toContain("function injectDiagnostics(html)");
    expect(worker).toContain('src="/diagnostics.js"');
    expect(worker).toContain('"x-request-id":requestId');
    expect(worker).toContain("diagnosticMessage");
  });

});