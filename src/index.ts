import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./utils/type";

// Import your modular routers
import { userRouter } from "./routes/user";
import { productRouter } from "./routes/product";
import { adminRouter } from "./routes/admin";
import { dashboardRouter } from "./routes/dashboard";

import { queueHandler } from "./workers/queueHandler"; // <-- Import queue consumer

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: [
      "https://flashsale.eradev.xyz",
      "https://eradev.xyz",
      "https://www.eradev.xyz",
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

// Basic Route to check health
app.get("/api/health", (c) =>
  c.json({ status: "ok", message: "API is running" })
);

app.route("/api/v1/user", userRouter);
app.route("api/v1/admin", adminRouter);
app.route("/api/v1/product", productRouter);
app.route("/api/v1/admin/dashboard", dashboardRouter);

// Export both the Hono HTTP handler AND the Cloudflare Queue handler
export default {
  fetch: app.fetch, //  Tell Cloudflare to send HTTP requests to Hono
  queue: queueHandler, //  Tell Cloudflare to send Queue messages to your custom handler
};
