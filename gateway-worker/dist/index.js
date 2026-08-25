// src/index.ts
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "nexor-gateway" });
    }
    return Response.json(
      { error: { type: "not_found", message: `No route for ${url.pathname}` } },
      { status: 404 }
    );
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
