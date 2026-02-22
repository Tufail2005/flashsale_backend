import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./utils/type";

// Import your modular routers
import userRouter from "./routes/user";

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// Basic Route to check health
app.get("/", (c) => c.text("Flash Sale API is running!"));

app.route("/api/v1/user", userRouter);

export default app;
