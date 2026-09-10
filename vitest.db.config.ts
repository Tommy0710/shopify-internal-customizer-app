import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Suite chạm Postgres thật. Chạy qua `npm run test:db` — script đó đặt
 * DATABASE_URL trỏ vào container cục bộ. Chạy file tuần tự: mọi file dùng
 * chung một DB và mỗi test bắt đầu bằng `resetDb()`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests-db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
