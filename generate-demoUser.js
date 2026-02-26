// generate-army.js
import jwt from "jsonwebtoken";
import fs from "fs";

// ⚠️ IMPORTANT: This MUST match the JWT_SECRET in your wrangler.toml
const JWT_SECRET = "jwt_myKey";
const TOTAL_USERS = 10;

const users = [];

console.log(`Forging ${TOTAL_USERS} battle-ready JWTs...`);

for (let i = 1; i <= TOTAL_USERS; i++) {
  // We match the exact payload your Hono authMiddleware expects!
  // It looks for decodedPayload.id
  const payload = { id: i, username: `user${i}` };

  const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });

  users.push({ id: i, token: token });
}

fs.writeFileSync("users.json", JSON.stringify(users));
console.log("✅ Army generated and saved to users.json!");
