import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { products, orders } from "../db/schema";
import { eq, sql, and } from "drizzle-orm";
import { Redis } from "@upstash/redis/cloudflare";
import { Bindings, CreateProductSchema } from "../utils/type";

export const adminRouter = new Hono<{ Bindings: Bindings }>();

// ==========================================
// Product insertion into db (seed-catalog)
// ==========================================
adminRouter.post("/seed-catalog", async (c) => {
  try {
    // Get and validate the request body
    const body = await c.req.json();

    // Zod throws an error if the data doesn't match the schema
    const parsedData = CreateProductSchema.safeParse(body);

    if (!parsedData.success) {
      return c.json(
        {
          msg: "Type validation problem",
        },
        500
      );
    }

    // Initialize Database
    const sql = neon(c.env.DATABASE_URL);
    const db = drizzle(sql);

    // Insert into PostgreSQL
    const [newProduct] = await db
      .insert(products)
      .values({
        name: parsedData.data.name,
        type: parsedData.data.type,
        isFlashSale: parsedData.data.isFlashSale,
        allocatedStock: parsedData.data.allocatedStock,
        availableStock: parsedData.data.allocatedStock,
        attributes: parsedData.data.attributes,
      })
      .returning();

    return c.json(
      {
        msg: "Product added to catalog successfully",
        product: newProduct,
      },
      201
    );
  } catch (error: any) {
    console.error("Catalog Insertion Error:", error);

    // Handle Zod Validation Errors
    if (error.name === "ZodError") {
      return c.json({ msg: "Invalid product data", errors: error.errors }, 400);
    }

    return c.json({ msg: "Internal Server Error" }, 500);
  }
});

// ==========================================
// DISASTER RECOVERY: REDIS REHYDRATION
// ==========================================

adminRouter.post("/rehydrate", async (c) => {
  const dbSql = neon(c.env.DATABASE_URL);
  const db = drizzle(dbSql);
  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  try {
    console.log("staring Redis Rehydration Protocl...");
    const flashProducts = await db
      .select()
      .from(products)
      .where(eq(products.isFlashSale, true));
    const rehydratedStats = [];

    // for each product, calculate true remaining stock
    for (const product of flashProducts) {
      // Query Postgres for all CONFIRMED orders for this specific product
      const [orderData] = await db
        .select({ count: sql<number>`cast(count(${orders.id}) as int)` })
        .from(orders)
        .where(
          and(eq(orders.productId, product.id), eq(orders.status, "CONFIRMED"))
        );

      const confirmedOrdersCount = orderData.count || 0;

      // True Stock = Total Allocated Stock - Confirmed Orders
      const trueRemainingStock = product.allocatedStock - confirmedOrdersCount;

      // Ensure we don't accidentally set negative stock if oversold
      const safeStock = Math.max(0, trueRemainingStock);

      // Rebuild the Redis Keys using a pipeline for performance
      const pipeline = redis.pipeline();

      // Restore the inventory count
      pipeline.set(`inventory:${product.id}:stock`, safeStock);
      // Restore the O(1) routing cache
      pipeline.set(`product:${product.id}:is_flash`, "true");

      await pipeline.exec();

      await db
        .update(products)
        .set({ availableStock: safeStock })
        .where(eq(products.id, product.id));

      rehydratedStats.push({
        productId: product.id,
        productName: product.name,
        originalStock: product.allocatedStock,
        confirmedOrders: confirmedOrdersCount,
        restoredRedisStock: safeStock,
      });
    }
    return c.json({
      msg: "✅ Redis successfully rehydrated from PostgreSQL Source of Truth.",
      stats: rehydratedStats,
    });
  } catch (error) {
    console.error(" Rehydration Failed:", error);
    c.status(500);
    return c.json({ msg: "Critical Failure during rehydration." });
  }
});
