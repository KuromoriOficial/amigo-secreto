import handler from "vinext/server/fetch-handler";

export default {
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    if (!env.PAGES_URL) return handler.fetch(request, env, context);

    const pages = new URL(env.PAGES_URL);
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith("/api/")) {
      const destination = pathname.replace(/\/$/, "") === "/organizar"
        ? new URL("organizar/", pages)
        : pages;
      return Response.redirect(destination, 302);
    }

    const origin = request.headers.get("Origin");
    const headers = new Headers({ Vary: "Origin", "Cache-Control": "no-store" });
    if (origin && origin !== pages.origin) {
      return new Response(null, { status: 403, headers });
    }
    if (origin) headers.set("Access-Control-Allow-Origin", origin);

    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      if (!origin || (method !== "GET" && method !== "POST")) {
        return new Response(null, { status: 405, headers });
      }
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }

    const response = await handler.fetch(request, env, context);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.append("Vary", "Origin");
    responseHeaders.set("Cache-Control", "no-store");
    if (origin) responseHeaders.set("Access-Control-Allow-Origin", origin);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};
