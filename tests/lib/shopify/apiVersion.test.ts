import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiVersion } from "@shopify/shopify-api";
import { SHOPIFY_API_VERSION, adminGraphqlUrl } from "@/lib/shopify/apiVersion";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string, acc: Array<[string, string]> = []): Array<[string, string]> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      sourceFiles(`${full}/`, acc);
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
    acc.push([full.slice(REPO.length), readFileSync(full, "utf8")]);
  }
  return acc;
}

describe("Shopify API version", () => {
  it("có định dạng YYYY-MM", () => {
    expect(SHOPIFY_API_VERSION).toMatch(/^\d{4}-(01|04|07|10)$/);
  });

  it("là một giá trị thư viện đang cài thật sự biết", () => {
    expect(Object.values(ApiVersion)).toContain(SHOPIFY_API_VERSION);
  });

  it("khớp với api_version trong shopify.app.toml", () => {
    const toml = readFileSync(`${REPO}shopify.app.toml`, "utf8");
    const match = toml.match(/^\s*api_version\s*=\s*"([^"]+)"/m);
    expect(match?.[1]).toBe(SHOPIFY_API_VERSION);
  });

  it("dựng URL Admin GraphQL từ chính hằng số đó", () => {
    expect(adminGraphqlUrl("demo.myshopify.com")).toBe(
      `https://demo.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    );
  });

  // Đây là test đáng giá nhất của task: nó chống việc version lệch lại lần nữa.
  it("không có file nguồn nào hardcode version ngoài apiVersion.ts", () => {
    const offenders = sourceFiles(`${REPO}src/`)
      .filter(([path]) => path !== "src/lib/shopify/apiVersion.ts")
      .filter(([, body]) => /\/admin\/api\/\d{4}-\d{2}/.test(body) || /ApiVersion\.[A-Za-z]+\d\d/.test(body))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
