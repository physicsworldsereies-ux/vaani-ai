import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Vaani chat UI", () => {
  it("keeps New Chat state and in-flight responses isolated in both app entrypoints", () => {
    for (const path of ["../index.html", "../public/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html).toContain("function newChat(){const app=$('app'),side=$('side')");
      expect(html).toContain("const chat=cur;const prompt=");
      expect(html).toContain("chat.m.pop();chat.m.pop();draw()");
      expect(html).toContain("if(cur===chat)$('msgs').scrollTop=1e9");
    }
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
