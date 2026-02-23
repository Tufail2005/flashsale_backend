// src/routes/user.ts
import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sign } from "hono/jwt";
import { users } from "../db/schema";
import { hashPassword } from "../utils/auth";
import type { Bindings } from "../utils/type";

// Create the router
export const userRouter = new Hono<{ Bindings: Bindings }>();

userRouter.post("/signup", async (c) => {
  const body = await c.req.json();

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

    // Sign JWT
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
