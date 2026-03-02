import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Redis } from "@upstash/redis/cloudflare";
import { sql } from "drizzle-orm";
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

  // ==========================================
  // AXIOM LOGGING HELPER
  // ==========================================
  // We create this tiny function to fire off logs without cluttering the main logic.
  const sendAxiomLog = (status: "success" | "out_of_stock" | "error") => {
    const logData = [
      {
        _time: new Date().toISOString(),
        event: "checkout_attempt",
        userId: userId,
        productId: productId,
        status: status,
      },
    ];

    c.executionCtx.waitUntil(
      fetch("https://api.axiom.co/v1/datasets/flashsale/ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.env.AXIOM_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(logData),
      }).catch((err) => console.error("Axiom log failed:", err))
    );
  };

  let isFlashSale;

  // ==========================================
  // DISASTER RECOVERY: CIRCUIT BREAKER
  // ==========================================

  try {
    isFlashSale = await redis.get(`product:${productId}:is_flash`);
  } catch (redisError) {
    console.error("🔴 CIRCUIT BREAKER OPEN: Redis is down!", redisError);
    sendAxiomLog("error"); //  Log the crash
    c.status(503);
    return c.json({
      msg: "Service Temporarily Unavailable. We are experiencing unprecedented traffic.",
    });
  }

  try {
    // ==========================================
    //  THE FLASH SALE CHECKOUT (Redis Lua)
    // ==========================================
    if (isFlashSale === true) {
      const inventoryKey = `inventory:${productId}:stock`;
      let result;

      try {
        result = await redis.eval(
          CLAIM_INVENTORY_SCRIPT,
          [inventoryKey],
          ["1"]
        );
      } catch (scriptError) {
        console.error(
          "CIRCUIT BREAKER OPEN: Redis script failed!",
          scriptError
        );
        sendAxiomLog("error"); // Log the crash
        c.status(503);
        return c.json({ msg: "Checkout currently unavailable. Please hold." });
      }

      if (result === 1) {
        // Push to the Main Queue (flash-orders)
        await c.env.FLASH_ORDERS.send({
          userId: userId,
          productId: productId,
          timestamp: Date.now(),
        });

        sendAxiomLog("success"); //  Log the WINNER!

        c.status(202);
        return c.json({
          msg: "Order received and is processing. You are in the queue!",
          status: "PENDING",
        });
      } else if (result === 0) {
        sendAxiomLog("out_of_stock"); //  Log the LOSER
        c.status(400);
        return c.json({ msg: "OUT_OF_STOCK" });
      } else {
        sendAxiomLog("error");
        c.status(500);
        return c.json({ msg: "Flash sale unavailable." });
      }
    }

    // ==========================================
    //  NORMAL PRODUCT CHECKOUT (Atomic DB Transact)
    // ==========================================

    // We use raw SQL to write a "WITH" clause (CTE)
    const query = sql`
      WITH updated_product AS (
        UPDATE products
        SET available_stock = available_stock - 1
        WHERE id = ${productId} AND available_stock > 0
        RETURNING id
      )
      INSERT INTO orders (user_id, product_id, status)
      SELECT ${userId}, id, 'CONFIRMED'
      FROM updated_product
      RETURNING id;
    `;

    // Execute the single, atomic command over standard HTTP
    const result = await db.execute(query);

    // If no rows were affected, it means the WHERE stock > 0 failed
    if (result.rowCount === 0) {
      sendAxiomLog("out_of_stock"); //  Normal item out of stock
      return c.json({ msg: "Product out of stock or not found" }, 400);
    }

    sendAxiomLog("success"); //  Normal item purchase success
    return c.json(
      { msg: "Checkout successful", orderId: result.rows[0].id }, // Drizzle returns raw execution results in the 'rows' array
      200
    );
  } catch (error) {
    console.error("Checkout failed:", error);
    sendAxiomLog("error"); //  Log any total failures
    return c.json({ msg: "Internal Server Error" }, 500);
  }
});
