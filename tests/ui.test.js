import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Vaani chat UI", () => {
  it("keeps the deployed public app and root copy in sync", () => {
    const root = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const publicHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(root).toBe(publicHtml);
  });

  it("only renders the profile admin shortcut for an active authorized admin profile", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain("prof&&prof.is_admin===true&&!prof.is_banned");
    expect(html).toContain("onclick=\"closeM();adminOpen()\"");
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
