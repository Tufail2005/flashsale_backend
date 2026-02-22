import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { verify } from "hono/jwt";
import { createMiddleware } from "hono/factory";

// Promisify scrypt so it doesn't block the event loop
const scryptAsync = promisify(scrypt);

const JWT_SECRET = process.env.JWT_SECRET;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;

  // Store both the salt and the hash together
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(
  passwordAttempt: string,
  storedHash: string
): Promise<boolean> {
  // Extract the salt and the original hash
  const [salt, key] = storedHash.split(":");
  const keyBuffer = Buffer.from(key, "hex");

  // Hash the attempt using the exact same salt
  const derivedKey = (await scryptAsync(passwordAttempt, salt, 64)) as Buffer;

  return timingSafeEqual(keyBuffer, derivedKey);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.split(" ")[1];
  try {
    const decodedPayload = await verify(token, c.env.JWT_SECRET, "HS256");
    c.set("userId", decodedPayload.id);
    await next();
  } catch (error) {
    console.error("JWT Verification Error:", error);
    return c.json({ message: "Invalid or expired token" }, 401);
  }
});
