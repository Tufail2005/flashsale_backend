import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Redis } from "@upstash/redis/cloudflare";
import { products, orders } from "../db/schema";
import { eq, sql, and, gt } from "drizzle-orm";
import { Bindings } from "../utils/type";
import { authMiddleware } from "../utils/auth";
import { Variables } from "../utils/type";

export const productRouter = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

const CLAIM_INVENTORY_SCRIPT = `
local stock = tonumber(redis.call('GET', KEYS[1]))
  if stock == nil then return -1 end
  if stock >= tonumber(ARGV[1]) then
      redis.call('DECRBY', KEYS[1], ARGV[1])
      return 1
  else
      return 0
  end
`;

productRouter.post("/checkout/:id", authMiddleware, async (c) => {
  const productId = parseInt(c.req.param("id"));
  const userId = c.get("userId");
  console.log("Processing checkout for User:", userId);
  // Initialize DB and Redis
  const client = neon(c.env.DATABASE_URL);
  const db = drizzle(client);
  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  try {
    const isFlashSale = await redis.get(`product:${productId}:is_flash`);

    // ==========================================
    //  THE FLASH SALE CHECKOUT (Redis Lua)
    // ==========================================
    if (isFlashSale === "true") {
      const inventoryKey = `inventory:${productId}:stock`;
      const result = await redis.eval(
        CLAIM_INVENTORY_SCRIPT,
        [inventoryKey],
        ["1"]
      );

      if (result === 1) {
        // Push to the Main Queue (flash-orders)
        await c.env.FLASH_ORDERS.send({
          userId: userId,
          productId: productId,
          timestamp: Date.now(),
        });

        c.status(202);
        return c.json({
          msg: "Order received and is processing. You are in the queue!",
          status: "PENDING",
        });
      } else if (result === 0) {
        c.status(400);
        return c.json({ msg: "OUT_OF_STOCK" });
      } else {
        c.status(500);
        return c.json({ msg: "Flash sale unavailable." });
      }
    }

    // ==========================================
    //  NORMAL PRODUCT CHECKOUT (Atomic DB Transact)
    // ==========================================

    // wrap everything in a transaction to ensure atomicity
    const result = await db.transaction(async (tx) => {
      // Atomic Stock Deduction
      const updatedRows = await tx
        .update(products)
        .set({
          stock: sql`${products.stock} - 1`,
        })
        .where(
          and(
            eq(products.id, productId),
            gt(products.stock, 0) // Ensures we never go below zero
          )
        )
        .returning();

      if (updatedRows.length === 0) {
        tx.rollback(); // Stop the transaction here
        return null;
      }

      // Create the Order
      const [newOrder] = await tx
        .insert(orders)
        .values({
          userId: userId,
          productId: productId,
          status: "CONFIRMED",
        })
        .returning();

      return newOrder;
    });

    if (!result) {
      return c.json({ msg: "Product out of stock or not found" }, 400);
    }

    return c.json(
      {
        msg: "Checkout successful",
        orderId: result.id,
      },
      200
    );
  } catch (error) {
    console.error("Checkout Error:", error);
    return c.json({ msg: "Internal Server Error" }, 500);
  }
});
