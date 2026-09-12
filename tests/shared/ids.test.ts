import { describe, expect, it } from "vitest";
import {
  designIdSchema,
  shareTokenSchema,
  DESIGN_ID_PREFIX,
  DESIGN_ID_BODY_LENGTH,
  SHARE_TOKEN_LENGTH,
} from "@/shared/ids";

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

  it.each([["21 ký tự", "A".repeat(21)], ["23 ký tự", "A".repeat(23)]])(
    "từ chối %s",
    (_label, value) => {
      expect(shareTokenSchema.safeParse(value).success).toBe(false);
    },
  );

  it("chấp nhận token trông giống có prefix designId — an toàn vì độ dài không trùng", () => {
    // shareToken không có khái niệm "prefix cấm" (interface: "22 ký tự, không
    // prefix" nghĩa là bản thân nó không mang prefix, không phải nó cấm chuỗi
    // khác trông giống có prefix). Một token bắt đầu bằng "cd_" vẫn hợp lệ
    // miễn đúng 22 ký tự — designId thật luôn dài
    // DESIGN_ID_PREFIX.length + DESIGN_ID_BODY_LENGTH = 24 ký tự, không bao
    // giờ trùng SHARE_TOKEN_LENGTH = 22. Hai namespace tách biệt bằng ĐỘ DÀI,
    // không phải bằng prefix, nên chấp nhận chuỗi này là an toàn — xem test
    // "namespace tách biệt bằng độ dài" ngay dưới cho bất biến đó.
    const looksLikeDesignId = `${DESIGN_ID_PREFIX}${"A".repeat(19)}`; // 3 + 19 = 22 ký tự
    expect(looksLikeDesignId.length).toBe(SHARE_TOKEN_LENGTH);
    expect(shareTokenSchema.safeParse(looksLikeDesignId).success).toBe(true);
  });

  it("designId và shareToken không thể cùng khớp một chuỗi — namespace tách biệt bằng độ dài", () => {
    // Đây là bất biến mà test "chấp nhận token trông giống có prefix" ở trên
    // dựa vào. Nếu ai đó sau này đổi DESIGN_ID_BODY_LENGTH hoặc
    // SHARE_TOKEN_LENGTH khiến tổng độ dài hai loại trùng nhau, test này báo
    // động ngay — lúc đó việc shareToken chấp nhận chuỗi "trông giống designId"
    // không còn an toàn nữa.
    expect(DESIGN_ID_PREFIX.length + DESIGN_ID_BODY_LENGTH).not.toBe(SHARE_TOKEN_LENGTH);

    const validDesignId = "cd_7hK9mQwErTyUiOpAsDfXY";
    expect(designIdSchema.safeParse(validDesignId).success).toBe(true);
    expect(shareTokenSchema.safeParse(validDesignId).success).toBe(false);

    const validShareToken = "A".repeat(SHARE_TOKEN_LENGTH);
    expect(shareTokenSchema.safeParse(validShareToken).success).toBe(true);
    expect(designIdSchema.safeParse(validShareToken).success).toBe(false);
  });
});
