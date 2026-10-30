"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Monitor, Smartphone, Tablet } from "lucide-react";
import type { CmsBrand } from "@/lib/cms/types";
import { BRAND_NAMES } from "@/lib/editorial/helpers";
import { Segmented } from "./ui";

/**
 * Headless preview matrix: the same draft rendered at desktop, tablet, mobile
 * and email widths in sandboxed iframes. Content travels by postMessage so the
 * frames update as the editor types without reloading. The templates are
 * stand-ins for the public site and newsletter templates.
 */

export type PreviewPayload = { title: string; byline: string; excerpt: string; section: string; html: string; brand: CmsBrand; brandName: string };

const DEVICES = [
  { id: "desktop", label: "Desktop", width: 1200, icon: Monitor },
  { id: "tablet", label: "Tablet", width: 768, icon: Tablet },
  { id: "mobile", label: "Mobile", width: 390, icon: Smartphone },
  { id: "email", label: "Email", width: 600, icon: Mail },
] as const;
type Device = (typeof DEVICES)[number];
type DeviceId = Device["id"];

const BRAND_INK: Record<CmsBrand, string> = { ws: "#6f1d2b", wa: "#3d5a80", ca: "#b45309", mw: "#1b4332" };

/** The page template: receives {type:"preview", payload} and fills the slots. Styles only; no external requests. */
function siteTemplate(brand: CmsBrand): string {
  const ink = BRAND_INK[brand];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; base-uri 'none'; form-action 'none'">
<style>
body{margin:0;font:17px/1.7 Georgia,'Times New Roman',serif;color:#1b1b1b;background:#fff}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:3px solid ${ink};font:700 15px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${ink}}
header nav{display:flex;gap:16px;font:500 12px/1 system-ui,sans-serif;color:#555;text-transform:none;letter-spacing:0}
main{max-width:720px;margin:0 auto;padding:28px 20px 60px}
.kicker{font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${ink}}
h1{font:600 clamp(28px,5vw,42px)/1.08 system-ui,sans-serif;letter-spacing:-.02em;margin:10px 0 12px}
.dek{font:18px/1.5 system-ui,sans-serif;color:#555;margin:0 0 16px}
.byline{font:13px/1.5 system-ui,sans-serif;color:#666;padding-bottom:16px;margin:0 0 24px;border-bottom:1px solid #e5e5e5}
h2{font:600 24px/1.25 system-ui,sans-serif;margin:34px 0 10px}h3{font:600 19px/1.3 system-ui,sans-serif;margin:26px 0 8px}
a{color:${ink}}img{max-width:100%;height:auto;border-radius:4px}figure{margin:28px 0}figcaption{font:13px/1.5 system-ui,sans-serif;color:#666;margin-top:8px}
blockquote{border-left:3px solid ${ink};padding-left:18px;margin:26px 0;color:#444;font-style:italic}
table{border-collapse:collapse;width:100%;font-size:15px}td,th{border:1px solid #e5e5e5;padding:8px}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto;font-size:14px}
mark{background:#fff3a3}
figure[data-embed] a{display:block;padding:40px 16px;text-align:center;background:#f4f4f5;border-radius:6px;font:14px system-ui,sans-serif}
@media (max-width:480px){header nav{display:none}main{padding:20px 16px 40px}body{font-size:16px}}
</style></head><body>
<header><span id="brand"></span><nav><span>News</span><span>Ratings</span><span>Features</span><span>Subscribe</span></nav></header>
<main><p class="kicker" id="kicker"></p><h1 id="title"></h1><p class="dek" id="dek"></p><p class="byline" id="byline"></p><div id="body"></div></main>
<script>
window.addEventListener("message", function (event) {
  var data = event.data; if (!data || data.type !== "preview") return; var p = data.payload;
  var set = function (id, text) { var el = document.getElementById(id); el.textContent = text || ""; el.style.display = text ? "" : "none"; };
  set("brand", p.brandName); set("kicker", p.section); set("title", p.title || "Untitled"); set("dek", p.excerpt); set("byline", p.byline ? "By " + p.byline : "");
  document.getElementById("body").innerHTML = p.html;
  document.querySelectorAll("figure[data-embed] a").forEach(function (a) { a.textContent = "▶ " + a.textContent; });
});
parent.postMessage({ type: "preview-ready" }, "*");
</script></body></html>`;
}

/** The newsletter template: single column, table-based, inline styles, the way email clients expect. */
function emailTemplate(brand: CmsBrand): string {
  const ink = BRAND_INK[brand];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>body{margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif}.wrap{width:100%;max-width:600px;margin:0 auto;background:#fff}.bar{background:${ink};color:#fff;padding:18px 24px;font:700 14px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}.inner{padding:24px}
.kicker{font:700 11px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${ink}}h1{font:700 26px/1.2 Arial,sans-serif;margin:8px 0 10px;color:#111}.dek{font:16px/1.5 Georgia,serif;color:#444;margin:0 0 12px}.byline{font:12px/1.5 Arial,sans-serif;color:#777;margin:0 0 20px}
.body{font:16px/1.65 Georgia,serif;color:#222}.body h2{font:700 20px/1.3 Arial,sans-serif;margin:24px 0 8px}.body img{max-width:100%;height:auto}.body figure{margin:20px 0}.body figcaption{font:12px/1.5 Arial,sans-serif;color:#777}
.body figure[data-embed] a{display:block;padding:36px 16px;text-align:center;background:#f4f4f5;color:${ink};font:14px Arial,sans-serif;text-decoration:none}
.cta{display:block;margin:28px 0 0;padding:14px;text-align:center;background:${ink};color:#fff;font:700 14px Arial,sans-serif;text-decoration:none}
.foot{padding:18px 24px;font:11px/1.6 Arial,sans-serif;color:#888;border-top:1px solid #eee}</style></head><body>
<table role="presentation" class="wrap" cellpadding="0" cellspacing="0"><tr><td class="bar" id="brand"></td></tr>
<tr><td class="inner"><p class="kicker" id="kicker"></p><h1 id="title"></h1><p class="dek" id="dek"></p><p class="byline" id="byline"></p><div class="body" id="body"></div><a class="cta" href="#">Read the full story</a></td></tr>
<tr><td class="foot">You are receiving this because you subscribe to <span id="brand2"></span>. Unsubscribe · Preferences · M. Shanken Communications</td></tr></table>
<script>
window.addEventListener("message", function (event) {
  var data = event.data; if (!data || data.type !== "preview") return; var p = data.payload;
  var set = function (id, text) { var el = document.getElementById(id); el.textContent = text || ""; el.style.display = text ? "" : "none"; };
  set("brand", p.brandName + " · Daily Alert"); set("brand2", p.brandName); set("kicker", p.section); set("title", p.title || "Untitled"); set("dek", p.excerpt); set("byline", p.byline ? "By " + p.byline : "");
  var body = p.html.split("<h2").slice(0, 2).join("<h2");
  document.getElementById("body").innerHTML = body + (body.length < p.html.length ? "<p><em>Continue reading on the site…</em></p>" : "");
});
parent.postMessage({ type: "preview-ready" }, "*");
</script></body></html>`;
}

function Frame({ device, payload, scale }: { device: Device; payload: PreviewPayload; scale: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const srcDoc = useMemo(() => device.id === "email" ? emailTemplate(payload.brand) : siteTemplate(payload.brand), [device.id, payload.brand]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => { if (event.source === ref.current?.contentWindow && event.data?.type === "preview-ready") setReady(true); };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => { if (ready) ref.current?.contentWindow?.postMessage({ type: "preview", payload }, "*"); }, [ready, payload]);
  const height = device.id === "mobile" ? 760 : device.id === "email" ? 820 : 720;
  return <div className="ed-preview-device" style={{ width: device.width * scale }}>
    <div className="ed-preview-device-head"><device.icon size={13} aria-hidden />{device.label} · {device.width}px</div>
    <div className="ed-preview-device-screen" style={{ height: height * scale }}>
      <iframe ref={ref} title={`${device.label} preview`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ width: device.width, height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, background: "#fff" }} />
    </div>
  </div>;
}

export function PreviewMatrix({ payload }: { payload: PreviewPayload }) {
  const [mode, setMode] = useState<"matrix" | DeviceId>("matrix");
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(1200);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setAvailable(entries[0]?.contentRect.width ?? 1200));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown: readonly Device[] = mode === "matrix" ? DEVICES : DEVICES.filter(device => device.id === mode);
  const total = shown.map(device => device.width).reduce((sum, width) => sum + width, 0) + (shown.length - 1) * 16;
  const scale = Math.min(1, available / total);
  return <div className="ed-preview-matrix" ref={containerRef}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
      <Segmented label="Preview layout" size="sm" value={mode} onChange={setMode} options={[{ id: "matrix", label: "All sizes" }, ...DEVICES.map(device => ({ id: device.id, label: device.label }))]} />
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{BRAND_NAMES[payload.brand]} templates · shown at {Math.round(scale * 100)}%{scale < 1 ? ", scaled to fit" : ""}</span>
    </div>
    <div className="ed-preview-devices" style={{ gap: 16 * scale }}>{shown.map(device => <Frame key={device.id} device={device} payload={payload} scale={scale} />)}</div>
  </div>;
}
