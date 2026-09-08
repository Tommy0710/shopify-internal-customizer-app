import { describe, expect, it } from "vitest";
import { normalizeHex } from "@/svg-engine/colors";

describe("normalizeHex", () => {
  it("expands three-digit hex and uppercases it", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("#ABC")).toBe("#AABBCC");
  });

  it("uppercases six-digit hex and adds the missing hash", () => {
    expect(normalizeHex("#e7c337")).toBe("#E7C337");
    expect(normalizeHex("e7c337")).toBe("#E7C337");
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeHex("  #e7c337  ")).toBe("#E7C337");
  });

  it("rejects anything that is not a complete hex colour", () => {
    for (const value of ["", "#", "#ab", "#abcd", "#abcde", "#abcdefa", "rebeccapurple", "#gggggg", "rgb(1,2,3)"]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });

  it("rejects non-string input rather than coercing it", () => {
    for (const value of [null, undefined, 123456, {}, [], true]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});
