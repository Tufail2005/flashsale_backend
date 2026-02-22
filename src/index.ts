// src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "./db/schema";
import { sign } from "hono/jwt";
import { hashPassword } from "./utils/auth";

// Type definitions for Cloudflare bindings
type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// Basic Route to check health
app.get("/", (c) => c.text("Flash Sale API is running!"));

const userRouter = new Hono<{ Bindings: Bindings }>();

userRouter.post("/signup", async (c) => {
  const body = await c.req.json();

  // Debug: Check if the string is actually arriving
  console.log("Connecting to:", c.env.DATABASE_URL);

  if (!c.env.DATABASE_URL) {
    return c.json({ error: "DATABASE_URL is missing" }, 500);
  }
  // Initialize DB connection using Neon serverless
  const sql = neon(c.env.DATABASE_URL);
  const db = drizzle(sql);

  try {
    const hashpassword = await hashPassword(body.password);
    // Insert user using Drizzle
    const [newUser] = await db
      .insert(users)
      .values({
        userName: body.userName,
        password: hashpassword,
        name: body.name,
      })
      .returning();

    //  Sign JWT
    const jwt_token = await sign({ id: newUser.id }, c.env.JWT_SECRET);

    return c.json({
      token: jwt_token,
      name: newUser.userName,
    });
  } catch (error) {
    console.error("DB Error:", error);
    c.status(500);
    return c.json({ msg: "Error creating user" });
  }
});

app.route("/api/v1/user", userRouter);

export default app;
