import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ProductAttributes } from "../utils/type";

export const users = pgTable("user", {
  id: serial("id").primaryKey(),
  userName: varchar("user_name", { length: 255 }).unique().notNull(),
  password: text("password").notNull(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // A discriminator (e.g., 'sneaker', 'ticket')
  isFlashSale: boolean("is_flash_sale").default(false).notNull(),
  allocatedStock: integer("allocated_stock").notNull().default(0),
  availableStock: integer("available_stock").notNull().default(0),
  attributes: jsonb("attributes").$type<ProductAttributes>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  productId: integer("product_id")
    .references(() => products.id)
    .notNull(),
  status: varchar("status", { enum: ["PENDING", "CONFIRMED", "FAILED"] })
    .default("PENDING")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
