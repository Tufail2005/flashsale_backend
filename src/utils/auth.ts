import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Promisify scrypt so it doesn't block the event loop
const scryptAsync = promisify(scrypt);

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
