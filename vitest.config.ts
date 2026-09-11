import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig.json khai `jsx: "preserve"` (Next.js tự biên dịch JSX bằng SWC lúc
  // build) — nhưng vitest chạy tsx trực tiếp qua esbuild của Vite, không qua
  // SWC của Next, nên esbuild cần được bảo rõ dùng automatic runtime, nếu
  // không mọi JSX trong test/component sẽ cần `import React` thủ công.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jsdomPolyfills.ts"],
  },
});
