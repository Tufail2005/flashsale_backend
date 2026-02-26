import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Redis } from "@upstash/redis/cloudflare";
import { products, orders } from "../db/schema";
import { sql } from "drizzle-orm";
import { Bindings } from "../utils/type";

export const dashboardRouter = new Hono<{ Bindings: Bindings }>();

dashboardRouter.get("/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.text("Expected Upgrade: websocket", 426);
  }

  const webSocketPair = new WebSocketPair();
  const client = webSocketPair[0];
  const server = webSocketPair[1];

  server.accept();

  const dbSql = neon(c.env.DATABASE_URL);
  const db = drizzle(dbSql);
  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  server.addEventListener("message", async (event) => {
    try {
      const msg = JSON.parse(event.data as string);

      if (msg.action === "refresh") {
        const allProducts = await db.select().from(products);

        const orderStats = await db
          .select({
            status: orders.status,
            count: sql<number>`cast(count(${orders.id}) as int)`,
          })
          .from(orders)
          .groupBy(orders.status);

        const dashboardData = {
          timestamp: new Date().toISOString(),
          orderMetrics: orderStats,
          dlqRescues: 0,
          flashSales: [] as any[],
          normalProducts: [] as any[],
        };

        const pipeline = redis.pipeline();
        pipeline.get("telemetry:dlq_rescues");

        for (const p of allProducts) {
          if (p.isFlashSale) {
            pipeline.get(`inventory:${p.id}:stock`);
          } else {
            dashboardData.normalProducts.push({
              id: p.id,
              name: p.name,
              availableStock: p.availableStock,
            });
          }
        }

        const pipelineResults = await pipeline.exec();
        dashboardData.dlqRescues = parseInt(pipelineResults[0] as string) || 0;

        let pipelineIndex = 1;
        for (const p of allProducts) {
          if (p.isFlashSale) {
            const liveStock =
              pipelineResults[pipelineIndex] ?? p.availableStock;
            dashboardData.flashSales.push({
              id: p.id,
              name: p.name,
              liveStock: liveStock,
            });
            pipelineIndex++;
          }
        }

        server.send(JSON.stringify(dashboardData));
      }
    } catch (error) {
      console.error("Dashboard Polling Error:", error);
      server.send(JSON.stringify({ error: "Telemetry offline" }));
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});
