import { describe, expect, it } from "vitest";
import { designIdSchema, shareTokenSchema, DESIGN_ID_PREFIX } from "@/shared/ids";

describe("designIdSchema", () => {
  it("chấp nhận id đúng định dạng", () => {
    // Body phải dài đúng DESIGN_ID_BODY_LENGTH = 21 ký tự (khớp Step 6).
    expect(designIdSchema.safeParse("cd_7hK9mQwErTyUiOpAsDfXY").success).toBe(true);
    expect(designIdSchema.safeParse("cd_A-b_C0123456789xyzABC").success).toBe(true);
  });

  it.each([
    ["thiếu prefix", "7hK9mQwErTyUiOpAsDf12"],
    ["prefix sai", "de_7hK9mQwErTyUiOpAsDf"],
    ["quá ngắn", "cd_short"],
    ["quá dài", "cd_7hK9mQwErTyUiOpAsDfEXTRA"],
    ["ký tự ngoài alphabet", "cd_7hK9mQwErTyUiOpAs.f"],
    ["có khoảng trắng", "cd_7hK9mQwErTyUiOpAs f"],
    ["rỗng", ""],
  ])("từ chối %s", (_label, value) => {
    expect(designIdSchema.safeParse(value).success).toBe(false);
  });

  it("prefix được export để nơi khác không hardcode lại", () => {
    expect(DESIGN_ID_PREFIX).toBe("cd_");
  });
});

describe("shareTokenSchema", () => {
  it("chấp nhận token 22 ký tự, không prefix", () => {
    expect(shareTokenSchema.safeParse("A".repeat(22)).success).toBe(true);
  });

  it.each([["21 ký tự", "A".repeat(21)], ["23 ký tự", "A".repeat(23)], ["có prefix", `cd_${"A".repeat(22)}`]])(
    "từ chối %s",
    (_label, value) => {
      expect(shareTokenSchema.safeParse(value).success).toBe(false);
    },
  );
});
