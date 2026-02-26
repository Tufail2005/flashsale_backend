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

app.use("/api/*", cors());

// Basic Route to check health

app.route("/api/v1/user", userRouter);
app.route("api/v1/admin", adminRouter);
app.route("/api/v1/product", productRouter);
app.route("/api/v1/admin/dashboard", dashboardRouter);

// Export both the Hono HTTP handler AND the Cloudflare Queue handler
export default {
  fetch: app.fetch, //  Tell Cloudflare to send HTTP requests to Hono
  queue: queueHandler, //  Tell Cloudflare to send Queue messages to your custom handler
};
