import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, slugify } from "@/lib/admin/slug";

describe("slugify", () => {
  it.each([
    ["Suede Brown", "suede-brown"],
    ["  Togo  Brown!! ", "togo-brown"],
    ["Da Bò Việt", "da-bo-viet"],
    ["Đà Nẵng", "da-nang"],
    ["!!!@@@###", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("mọi slug không rỗng sinh ra đều khớp SLUG_PATTERN", () => {
    for (const input of ["Suede Brown", "  Togo  Brown!! ", "Da Bò Việt", "Đà Nẵng"]) {
      expect(slugify(input)).toMatch(SLUG_PATTERN);
    }
  });
});
