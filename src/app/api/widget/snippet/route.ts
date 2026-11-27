import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Devuelve un snippet JS/HTML para incrustar el widget en cualquier sitio web. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const inboxId = url.searchParams.get("inboxId") || "inbox-widget";
  const origin = url.origin;
  const target = `${origin}/widget/${encodeURIComponent(inboxId)}`;
  const snippet = `<script>
(function () {
  var btn = document.createElement('button');
  btn.textContent = '💬 Chat';
  btn.setAttribute('aria-label', 'Abrir chat');
  btn.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;border:0;border-radius:999px;padding:12px 18px;background:#5b5bd6;color:#fff;font:600 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer';
  btn.onclick = function () {
    var w = window.open('${target}', 'conversa-chat', 'width=420,height=620');
    if (w) w.focus();
  };
  document.body.appendChild(btn);
})();
</script>`;
  return new NextResponse(snippet, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
