import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Vaani chat UI", () => {
  it("keeps the root compatibility entrypoint byte-for-byte aligned with the deployed public frontend", () => {
    const root = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const deployed = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(root).toBe(deployed);
  });

  it("keeps New Chat state and in-flight responses isolated in both app entrypoints", () => {
    for (const path of ["../index.html", "../public/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html).toContain("function newChat(){const app=$('app'),side=$('side')");
      expect(html).toContain("const chat=cur;const prompt=");
      expect(html).toContain("const answerIndex=chat.m.indexOf(b)");
      expect(html).toContain("if(cur===chat&&te.isConnected)");
    }
  });

  it("always opens the sidebar when leaving history full-chat mode, even with stale open state", () => {
    for (const path of ["../index.html", "../public/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      const start = html.indexOf("function toggleSidebar(event)");
      const end = html.indexOf("function syncResponsiveLayout()", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const toggle = html.slice(start, end);
      expect(toggle).toContain("const wasFullChat=app.classList.contains('full-chat')");
      expect(toggle).toContain("const opening=wasFullChat||!side.classList.contains('open')");
      expect(toggle.indexOf("app.classList.remove('full-chat')")).toBeLessThan(toggle.indexOf("const opening="));
      expect(toggle).toContain("app.classList.toggle('sidebar-open',opening)");
      expect(toggle).not.toContain("style.setProperty('transform'");
      expect(toggle).toContain("aria-expanded");
      expect(toggle).toContain("aria-pressed");
    }
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
    expect(html).toContain("onclick=\"adminOpen()\"");
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
});
