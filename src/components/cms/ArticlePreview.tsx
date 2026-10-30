"use client";

function escape(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

export function ArticlePreview({ title, byline, html }: { title: string; byline: string; html: string }) {
  const content = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"><style>body{font:17px/1.75 Georgia,serif;color:#242821;background:#fff;margin:0;padding:42px;overflow-wrap:anywhere}h1{font-size:38px;line-height:1.15;font-weight:400;margin:0 0 20px}h2{font-size:27px;line-height:1.3;margin-top:36px}a{color:#8b5a2d}img{max-width:100%;height:auto}blockquote{border-left:3px solid #bf9e62;padding-left:22px;margin:30px 0;color:#5e625a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px}.byline{font:12px/1.5 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#777;margin-bottom:32px}</style></head><body><h1>${escape(title)}</h1>${byline ? `<p class="byline">${escape(byline)}</p>` : ""}${html}</body></html>`;
  return <iframe title="Article preview" className="cms-preview" sandbox="" referrerPolicy="no-referrer" srcDoc={content} />;
}
