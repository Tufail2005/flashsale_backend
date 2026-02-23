import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { products } from "../db/schema";
import { Bindings, CreateProductSchema } from "../utils/type";

export const adminRouter = new Hono<{ Bindings: Bindings }>();

adminRouter.post("/seed-catalog", async (c) => {
  try {
    // Get and validate the request body
    const body = await c.req.json();

    // Zod throws an error if the data doesn't match the schema
    const parsedData = CreateProductSchema.safeParse(body);

    if (!parsedData.success) {
      return c.json(
        {
          msg: "Type validation problem",
        },
        500
      );
    }

    // Initialize Database
    const sql = neon(c.env.DATABASE_URL);
    const db = drizzle(sql);

    // Insert into PostgreSQL
    const [newProduct] = await db
      .insert(products)
      .values({
        name: parsedData.data.name,
        type: parsedData.data.type,
        isFlashSale: parsedData.data.isFlashSale,
        stock: parsedData.data.stock,
        attributes: parsedData.data.attributes,
      })
      .returning();

    return c.json(
      {
        msg: "Product added to catalog successfully",
        product: newProduct,
      },
      201
    );
  } catch (error: any) {
    console.error("Catalog Insertion Error:", error);

    // Handle Zod Validation Errors
    if (error.name === "ZodError") {
      return c.json({ msg: "Invalid product data", errors: error.errors }, 400);
    }

    return c.json({ msg: "Internal Server Error" }, 500);
  }
});
