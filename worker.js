
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // اختبار الموقع
    if (url.pathname === "/api/health") {
      return Response.json({
        success: true,
        store: "TANGERSTYLO",
        message: "Store is running"
      });
    }

    // اختبار الاتصال بقاعدة البيانات
    if (url.pathname === "/api/db-check") {
      if (!env.DB) {
        return Response.json({
          success: false,
          message: "Database binding DB not found"
        }, { status: 500 });
      }

      try {
        const result = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        return Response.json({
          success: true,
          database: "Connected",
          result: result
        });

      } catch (error) {
        return Response.json({
          success: false,
          message: error.message
        }, { status: 500 });
      }
    }

    // عرض ملفات المتجر
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("TANGERSTYLO Store", {
      headers: {
        "content-type": "text/plain"
      }
    });
  }
};


