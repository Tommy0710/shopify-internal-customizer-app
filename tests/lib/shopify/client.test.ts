import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Bản cũ dựng client ngay lúc import với `SHOPIFY_API_SECRET || "local_dev_secret"`.
 * Final review P1b xác minh bằng thực thi: thiếu biến thì `decodeSessionToken`
 * CHẤP NHẬN một token tự ký bằng "local_dev_secret" với `dest` của shop lạ.
 * Cùng loại lỗi với khoá HMAC rỗng ở P0. Giờ: dựng lười, trim-và-ném.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function setEnv(overrides: Record<string, string> = {}) {
  const base = {
    SHOPIFY_API_KEY: "21102b2e2138173c5ab87e5ad38ef1e4",
    SHOPIFY_API_SECRET: "a_real_looking_secret_value",
    SHOPIFY_APP_URL: "https://wild-king-customizer.vercel.app",
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) vi.stubEnv(key, value);
}

describe("getShopify", () => {
  it("import module KHÔNG ném khi thiếu env — next build nạp route module lúc build", async () => {
    vi.stubEnv("SHOPIFY_API_SECRET", "");
    await expect(import("@/lib/shopify/client")).resolves.toBeDefined();
  });

  it.each([
    ["SHOPIFY_API_SECRET", ""],
    ["SHOPIFY_API_SECRET", "  \n"],
    ["SHOPIFY_API_KEY", ""],
    ["SHOPIFY_APP_URL", " "],
  ])("ném khi %s = %j, không bao giờ rơi về giá trị mặc định", async (name, value) => {
    setEnv({ [name]: value });
    const { getShopify } = await import("@/lib/shopify/client");
    expect(() => getShopify()).toThrow(name);
  });

  it("dựng được với cấu hình hợp lệ, và trả cùng một instance", async () => {
    setEnv();
    const { getShopify } = await import("@/lib/shopify/client");
    const first = getShopify();
    expect(first.config.apiSecretKey).toBe("a_real_looking_secret_value");
    expect(getShopify()).toBe(first);
  });

  it("không còn chuỗi secret mặc định nào trong mã nguồn", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/shopify/client.ts", "utf8");
    expect(source).not.toMatch(/local_dev_secret|local_dev_key/);
  });
});
