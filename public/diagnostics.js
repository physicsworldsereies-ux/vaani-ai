(() => {
  if (window.__vaaniDiagnostics) return;

  const recent = [];
  const clean = value => String(value ?? "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token redacted]")
    .replace(/(api[_-]?key|apikey|secret|password)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, 700);

  const endpoint = value => {
    try {
      const u = new URL(value, location.href);
      return u.origin === location.origin ? u.pathname : u.hostname + u.pathname;
    } catch { return "unknown endpoint"; }
  };

  const classify = path => {
    if (/\/auth\/v1\//.test(path)) return "Supabase Authentication";
    if (/\/rest\/v1\//.test(path)) return "Supabase Database";
    if (/\/api\/chat/.test(path)) return "AI Chat API";
    if (/\/api\/admin/.test(path)) return "Admin API";
    if (/\/api/.test(path)) return "Vaani Backend API";
    return "Website resource";
  };

  function report(info = {}) {
    const path = endpoint(info.endpoint || location.pathname);
    const item = {
      time: new Date().toLocaleString(),
      area: clean(info.area || classify(path)),
      stage: clean(info.stage || "Request"),
      status: clean(info.status ?? "Unknown"),
      code: clean(info.code || "CLIENT_ERROR"),
      message: clean(info.message || "The operation failed without an error message."),
      requestId: clean(info.requestId || "Not supplied by server"),
      endpoint: clean(path),
      hint: clean(info.hint || "")
    };
    recent.unshift(item);
    recent.splice(8);
    let panel = document.getElementById("vaani-global-diagnostics");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "vaani-global-diagnostics";
      panel.setAttribute("role", "alert");
      panel.setAttribute("aria-live", "assertive");
      Object.assign(panel.style, {
        position: "fixed", left: "max(12px, env(safe-area-inset-left))",
        right: "max(12px, env(safe-area-inset-right))",
        bottom: "max(12px, env(safe-area-inset-bottom))", zIndex: "2147483647",
        maxHeight: "48dvh", overflow: "auto", padding: "14px",
        border: "1px solid #d66", borderRadius: "12px",
        background: "#171717", color: "#f5f5f5",
        boxShadow: "0 12px 40px #000b",
        font: "13px/1.45 system-ui, sans-serif"
      });
      document.body.append(panel);
    }
    panel.replaceChildren();
    const header = document.createElement("div");
    Object.assign(header.style, {display:"flex",justifyContent:"space-between",gap:"10px",alignItems:"center",flexWrap:"wrap"});
    const title = document.createElement("strong");
    title.textContent = "Vaani — Real Error Diagnosis";
    title.style.color = "#ffb4a9";
    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    const button = (label, action) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      Object.assign(b.style,{background:"#303030",color:"#fff",border:"1px solid #666",borderRadius:"7px",padding:"6px 9px",font:"inherit"});
      b.addEventListener("click", action);
      return b;
    };
    controls.append(
      button("Copy details", () => {
        const value = recent.map(x => [
          x.time, x.area, "Stage: "+x.stage, "HTTP: "+x.status,
          "Code: "+x.code, "Message: "+x.message, "Request ID: "+x.requestId,
          "Endpoint: "+x.endpoint, x.hint
        ].filter(Boolean).join(" | ")).join("\n");
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(() => {}).catch(() => {});
      }),
      button("Dismiss", () => { panel.hidden = true; })
    );
    header.append(title, controls);
    panel.append(header);
    for (const x of recent) {
      const row = document.createElement("div");
      Object.assign(row.style,{marginTop:"9px",paddingTop:"8px",borderTop:"1px solid #444",overflowWrap:"anywhere"});
      const line = document.createElement("div");
      line.textContent = x.time+" · "+x.area+" · "+x.stage;
      line.style.color = "#bbb";
      const details = document.createElement("div");
      details.textContent = "HTTP "+x.status+" · "+x.code+" — "+x.message;
      details.style.color = "#ffe08a";
      const meta = document.createElement("div");
      meta.textContent = "Request ID: "+x.requestId+" · Endpoint: "+x.endpoint;
      meta.style.color = "#ccc";
      row.append(line, details, meta);
      if (x.hint !== "Unknown error" && x.hint) {
        const hint = document.createElement("div");
        hint.textContent = "Hint: "+x.hint;
        hint.style.color = "#c9c9c9";
        row.append(hint);
      }
      panel.append(row);
    }
    panel.hidden = false;
    console.error("[Vaani diagnostic]", item);
  }

  window.__vaaniDiagnostics = { report };

  // The app shell already routes JavaScript exceptions through reportDiagnostic.
  // Reuse that handler when present to avoid duplicate error panels.
  // Capture failed scripts, stylesheets, images and other page resources too.
  window.addEventListener("error", event => {
    if (event.target && event.target !== window) {
      const target = event.target;
      report({area:"Resource loading",stage:"Browser resource",status:"Unavailable",
        code:"RESOURCE_LOAD_FAILED",message:"A page resource could not be loaded.",
        endpoint:target.src || target.href || location.pathname});
    }
  }, true);

  if (typeof window.reportDiagnostic !== "function") {
    window.addEventListener("error", event => {
      if (event.target && event.target !== window) {
        const target = event.target;
        report({area:"Resource loading",stage:"Browser resource",code:"RESOURCE_LOAD_FAILED",
          message:"A page resource could not be loaded.",endpoint:target.src || target.href || location.pathname});
      } else {
        report({area:"Browser JavaScript",stage:"Runtime",code:"JAVASCRIPT_ERROR",
          message:event.message || "Script error",endpoint:event.filename || location.pathname,
          hint:event.lineno ? "Line "+event.lineno : ""});
      }
    }, true);
    window.addEventListener("unhandledrejection", event => {
      report({area:"Unhandled async operation",stage:"Promise",code:"UNHANDLED_REJECTION",
        message:event.reason?.message || event.reason || "Promise rejected",endpoint:location.pathname});
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    const path = endpoint(rawUrl);
    const method = String(init.method || input?.method || "GET").toUpperCase();
    const started = Date.now();
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished && (/\/api(?:\/|$)|\/auth\/v1\/|\/rest\/v1\//.test(path))) {
        report({area:classify(path),stage:"Network timeout",status:"Timeout",code:"REQUEST_TIMEOUT",
          message:"The server did not return response headers within 20 seconds.",
          endpoint:path,hint:"Check the matching Supabase or Cloudflare logs using the request time."});
      }
    }, 20000);
    try {
      const response = await nativeFetch(input, init);
      finished = true;
      clearTimeout(timer);
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => ({}));
        report({
          area:payload.stage || classify(path),
          stage:payload.stage || "HTTP response",
          status:response.status,
          code:payload.code || payload.error || "HTTP_ERROR",
          message:[payload.message,payload.diagnostic_detail,payload.details,payload.hint].filter(Boolean).join(" | ") || response.statusText || "Request failed",
          requestId:payload.request_id || response.headers.get("x-request-id") || response.headers.get("sb-request-id") || response.headers.get("x-kong-request-id"),
          endpoint:path,
          hint:payload.upstream_status ? "Upstream service HTTP "+payload.upstream_status : ""
        });
      }
      return response;
    } catch (error) {
      finished = true;
      clearTimeout(timer);
      report({area:classify(path),stage:"Network request",status:"Unavailable",
        code:"NETWORK_ERROR",message:error?.message || error || "Network request failed",
        endpoint:path,hint:"Check internet connectivity, CORS and the service status."});
      throw error;
    }
  };
})();