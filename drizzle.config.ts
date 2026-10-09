import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infra/db/schema/index.ts",
  out: "./drizzle",
});
