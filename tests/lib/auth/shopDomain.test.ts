import { describe, expect, it } from "vitest";
import { isValidShopDomain } from "@/lib/auth/shopDomain";

describe("isValidShopDomain", () => {
  it("accepts a real Shopify shop domain", () => {
    expect(isValidShopDomain("wildandking-demo.myshopify.com")).toBe(true);
    expect(isValidShopDomain("shop123.myshopify.com")).toBe(true);
  });

  it("rejects a host that is not myshopify.com", () => {
    expect(isValidShopDomain("evil.example.com")).toBe(false);
    expect(isValidShopDomain("myshopify.com.evil.example.com")).toBe(false);
    expect(isValidShopDomain("evil.com#.myshopify.com")).toBe(false);
    expect(isValidShopDomain("sub.shop.myshopify.com")).toBe(false);
  });

  it("rejects a value carrying a path, port, scheme or credentials", () => {
    expect(isValidShopDomain("shop.myshopify.com/../evil")).toBe(false);
    expect(isValidShopDomain("shop.myshopify.com:8080")).toBe(false);
    expect(isValidShopDomain("https://shop.myshopify.com")).toBe(false);
    expect(isValidShopDomain("shop.myshopify.com@evil.example.com")).toBe(false);
  });

  it("rejects an empty string and non-strings", () => {
    expect(isValidShopDomain("")).toBe(false);
    expect(isValidShopDomain(".myshopify.com")).toBe(false);
    expect(isValidShopDomain(null)).toBe(false);
    expect(isValidShopDomain(undefined)).toBe(false);
  });
});
