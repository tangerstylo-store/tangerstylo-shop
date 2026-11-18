
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        store: "TANGERSTYLO",
        message: "Store is running"
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("TANGERSTYLO Store", {
      headers: { "content-type": "text/plain" }
    });
  }
};
