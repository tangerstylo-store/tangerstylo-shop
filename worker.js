
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const json = (data, status = 200) =>
      Response.json(data, { status });

    async function ensureSchema() {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          price REAL NOT NULL DEFAULT 0,
          image_url TEXT DEFAULT '',
          category TEXT DEFAULT '',
          stock INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_name TEXT NOT NULL,
          phone TEXT NOT NULL,
          address TEXT DEFAULT '',
          items_json TEXT NOT NULL,
          total REAL NOT NULL DEFAULT 0,
          status TEXT DEFAULT 'new',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    }

    function isAdmin() {
      const token = request.headers.get("Authorization");
      return !!env.ADMIN_PASSWORD &&
        token === `Bearer ${env.ADMIN_PASSWORD}`;
    }

    try {
      if (path === "/api/health") {
        return json({
          success: true,
          store: "TANGERSTYLO",
          message: "Store is running"
        });
      }

      if (path.startsWith("/api/")) {
        if (!env.DB) {
          return json({
            success: false,
            message: "Database binding DB not found"
          }, 500);
        }

        await ensureSchema();

        // التحقق من اتصال قاعدة البيانات
        if (path === "/api/db-check" && method === "GET") {
          const result = await env.DB
            .prepare("SELECT 1 AS ok")
            .first();

          return json({
            success: true,
            database: "Connected",
            result
          });
        }

        // عرض المنتجات للزبائن
        if (path === "/api/products" && method === "GET") {
          const result = await env.DB.prepare(`
            SELECT * FROM products
            WHERE active = 1
            ORDER BY id DESC
          `).all();

          return json({
            success: true,
            products: result.results
          });
        }

        // تسجيل طلب جديد
        if (path === "/api/orders" && method === "POST") {
          const data = await request.json();

          const customerName =
            String(data.customer_name || "").trim();
          const phone = String(data.phone || "").trim();
          const address = String(data.address || "").trim();
          const requestedItems = data.items;

          if (
            !customerName || customerName.length > 100 ||
            !phone || phone.length > 30 ||
            !address || address.length > 300 ||
            !Array.isArray(requestedItems) ||
            requestedItems.length === 0 ||
            requestedItems.length > 50
          ) {
            return json({
              success: false,
              message: "معلومات الزبون أو المنتجات غير صحيحة"
            }, 400);
          }

          const quantities = new Map();

          for (const item of requestedItems) {
            const id = Number(item.id);
            const quantity = Number(item.quantity);

            if (
              !Number.isInteger(id) || id <= 0 ||
              !Number.isInteger(quantity) || quantity <= 0
            ) {
              return json({
                success: false,
                message: "كمية أو رقم منتج غير صحيح"
              }, 400);
            }

            quantities.set(
              id,
              (quantities.get(id) || 0) + quantity
            );
          }

          const items = [];
          let total = 0;

          for (const [id, quantity] of quantities) {
            const product = await env.DB.prepare(`
              SELECT id, name, price, stock
              FROM products
              WHERE id = ? AND active = 1
            `).bind(id).first();

            if (!product) {
              return json({
                success: false,
                message: "أحد المنتجات لم يعد متوفراً"
              }, 400);
            }

            if (quantity > product.stock) {
              return json({
                success: false,
                message: "الكمية المطلوبة غير متوفرة للمنتج: " +
                  product.name
              }, 400);
            }

            const subtotal = Number(product.price) * quantity;
            total += subtotal;

            items.push({
              id: product.id,
              name: product.name,
              price: Number(product.price),
              quantity,
              subtotal
            });
          }

          const result = await env.DB.prepare(`
            INSERT INTO orders
            (customer_name, phone, address, items_json, total, status)
            VALUES (?, ?, ?, ?, ?, 'new')
          `).bind(
            customerName,
            phone,
            address,
            JSON.stringify(items),
            total
          ).run();

          return json({
            success: true,
            message: "تم تسجيل الطلب بنجاح",
            order_id: result.meta.last_row_id,
            total,
            items
          }, 201);
        }

        // حماية جميع مسارات الإدارة
        if (path.startsWith("/api/admin/")) {
          if (!isAdmin()) {
            return json({
              success: false,
              message: "Unauthorized"
            }, 401);
          }
        }

        // عرض المنتجات للإدارة
        if (path === "/api/admin/products" && method === "GET") {
          const result = await env.DB.prepare(`
            SELECT * FROM products ORDER BY id DESC
          `).all();

          return json({
            success: true,
            products: result.results
          });
        }

        // إضافة منتج
        if (path === "/api/admin/products" && method === "POST") {
          const data = await request.json();

          const name = String(data.name || "").trim();
          const price = Number(data.price);
          const stock = Number(data.stock || 0);

          if (
            !name ||
            !Number.isFinite(price) || price < 0 ||
            !Number.isInteger(stock) || stock < 0
          ) {
            return json({
              success: false,
              message: "Invalid product information"
            }, 400);
          }

          const result = await env.DB.prepare(`
            INSERT INTO products
            (name, description, price, image_url, category, stock, active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            name,
            String(data.description || ""),
            price,
            String(data.image_url || ""),
            String(data.category || ""),
            stock,
            data.active === false ? 0 : 1
          ).run();

          return json({
            success: true,
            message: "Product added",
            id: result.meta.last_row_id
          });
        }

        // تعديل أو حذف منتج
        const match = path.match(
          /^\/api\/admin\/products\/(\d+)$/
        );

        if (match) {
          const id = Number(match[1]);

          if (method === "PUT") {
            const data = await request.json();

            const name = String(data.name || "").trim();
            const price = Number(data.price);
            const stock = Number(data.stock || 0);

            if (
              !name ||
              !Number.isFinite(price) || price < 0 ||
              !Number.isInteger(stock) || stock < 0
            ) {
              return json({
                success: false,
                message: "Invalid product information"
              }, 400);
            }

            const result = await env.DB.prepare(`
              UPDATE products SET
                name = ?, description = ?, price = ?,
                image_url = ?, category = ?, stock = ?, active = ?
              WHERE id = ?
            `).bind(
              name,
              String(data.description || ""),
              price,
              String(data.image_url || ""),
              String(data.category || ""),
              stock,
              data.active === false ? 0 : 1,
              id
            ).run();

            return json({
              success: true,
              updated: result.meta.changes > 0
            });
          }

          if (method === "DELETE") {
            const result = await env.DB.prepare(
              "DELETE FROM products WHERE id = ?"
            ).bind(id).run();

            return json({
              success: true,
              deleted: result.meta.changes > 0
            });
          }
        }

        // عرض الطلبات للإدارة
        if (path === "/api/admin/orders" && method === "GET") {
          const result = await env.DB.prepare(`
            SELECT * FROM orders ORDER BY id DESC
          `).all();

          return json({
            success: true,
            orders: result.results
          });
        }

        return json({
          success: false,
          message: "API route not found"
        }, 404);
      }

      // عرض ملفات المتجر
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("TANGERSTYLO Store");

    } catch (error) {
      return json({
        success: false,
        message: error.message
      }, 500);
    }
  }
};
