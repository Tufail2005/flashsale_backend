// src/workers/queueHandler.ts
import { MessageBatch } from "@cloudflare/workers-types";
import { Bindings, OrderMessage } from "../utils/type";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { orders, products } from "../db/schema";
import { Redis } from "@upstash/redis/cloudflare";
import { eq, sql } from "drizzle-orm";

export async function queueHandler(
  batch: MessageBatch<OrderMessage>,
  env: Bindings
): Promise<void> {
  const neonClient = neon(env.DATABASE_URL);
  const db = drizzle(neonClient);
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Route logic based on which queue the batch came from
  switch (batch.queue) {
    case "flash-orders":
      for (const message of batch.messages) {
        try {
          // for testing flash-dlq is working or not
          // throw new Error("SIMULATED DATABASE CRASH!");

          // Mock Payment Simulator (80% success probability)
          const paymentSuccess = Math.random() < 0.8;

          if (paymentSuccess) {
            // Write CONFIRMED order to PostgreSQL
            await db.insert(orders).values({
              userId: message.body.userId,
              productId: message.body.productId,
              status: "CONFIRMED",
            });
            // DECREMENT AVAILABLE STOCK IN DB
            await db
              .update(products)
              .set({ availableStock: sql`${products.availableStock} - 1` })
              .where(eq(products.id, message.body.productId));

            // Send to payment-timeout queue with a 5-minute delay to "verify"
            await env.PAYMENT_TIMEOUT.send(message.body, { delaySeconds: 300 });

            message.ack(); // Mark as successful
          } else {
            // Write FAILED order to DB
            await db.insert(orders).values({
              userId: message.body.userId,
              productId: message.body.productId,
              status: "FAILED",
            });

            // Return item to Redis pool for another user
            await redis.incr(`inventory:${message.body.productId}:stock`);

            message.ack(); // Acknowledge so it doesn't retry
          }
        } catch (error) {
          console.error("Database Write Failed. Retrying...", error);
          message.retry(); // This will increment retry count. At 4, it hits the DLQ.
        }
      }
      break;

    case "payment-timeout":
      // Handle delayed verification logic here
      for (const message of batch.messages) {
        console.log(
          "Verifying payment after 5 minutes for user:",
          message.body.userId
        );
        message.ack();
      }
      break;

    case "flash-dlq":
      // DLQ Restock (Database Crash/Permanent Failure)
      for (const message of batch.messages) {
        console.error(
          "Permanent Failure in DB write. Restocking Redis...",
          message.body
        );

        // Prevent the "ghost order" where inventory is locked in a void
        await redis.incr(`inventory:${message.body.productId}:stock`);

        message.ack();
      }
      break;
  }
}
