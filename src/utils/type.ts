export type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  FLASH_ORDERS: Queue<OrderMessage>;
  PAYMENT_TIMEOUT: Queue<OrderMessage>;
};
// Variables type so TypeScript knows 'userId' exists in this file too
export type Variables = {
  userId: number;
};

// Define the payload structure moving through your queues
export type OrderMessage = {
  userId: number;
  productId: number;
  timestamp: number;
};
