import { describe, expect, it } from "vitest";
import { newDesignId, newShareToken } from "@/lib/ids";
import { ID_ALPHABET, designIdSchema, shareTokenSchema } from "@/shared/ids";

describe("newDesignId", () => {
  it("luôn qua được designIdSchema (1000 lần)", () => {
    for (let i = 0; i < 1000; i++) {
      expect(designIdSchema.safeParse(newDesignId()).success).toBe(true);
    }
  });

  it("mọi ký tự sau prefix đều nằm trong ID_ALPHABET", () => {
    const id = newDesignId();
    const body = id.slice("cd_".length);
    for (const char of body) expect(ID_ALPHABET).toContain(char);
  });

  it("1000 id liên tiếp không trùng nhau", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newDesignId());
    expect(ids.size).toBe(1000);
  });
});

describe("newShareToken", () => {
  it("luôn qua được shareTokenSchema (1000 lần)", () => {
    for (let i = 0; i < 1000; i++) {
      expect(shareTokenSchema.safeParse(newShareToken()).success).toBe(true);
    }
  });

  it("mọi ký tự đều nằm trong ID_ALPHABET", () => {
    const token = newShareToken();
    for (const char of token) expect(ID_ALPHABET).toContain(char);
  });

  it("1000 token liên tiếp không trùng nhau", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(newShareToken());
    expect(tokens.size).toBe(1000);
  });
});
