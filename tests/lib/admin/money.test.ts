import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { priceSchema, formatPrice } from "@/lib/admin/money";

/**
 * `priceSchema` là cửa duy nhất tiền đi qua trên đường ghi: chuẩn hoá thành
 * chuỗi "80.00", KHÔNG BAO GIỜ làm tròn — một giá trị không phải tiền hợp lệ
 * (quá 2 chữ số thập phân, âm, vượt Decimal(10,2)...) phải bị từ chối thẳng.
 *
 * `0.1 + 0.2` là ca then chốt: giá trị float 0.30000000000000004 KHÔNG phải
 * một số tiền có đúng 2 chữ số thập phân. Một cài đặt dùng dung sai nổi
 * (`value * 100` gần số nguyên trong ±1e-6) sẽ ÂM THẦM CHẤP NHẬN nó thành
 * "0.30" — vì sai số làm tròn của phép cộng float còn nhỏ hơn cả sai số biểu
 * diễn của 19.99 (một số hợp lệ phải được chấp nhận). Test này khoá đúng
 * hành vi: từ chối 0.1+0.2, vẫn chấp nhận 19.99.
 */

describe("priceSchema — chấp nhận", () => {
  it.each([
    ["80", "80.00"],
    ["80.5", "80.50"],
    ["80.50", "80.50"],
    [80, "80.00"],
    [80.5, "80.50"],
    [0, "0.00"],
    [19.99, "19.99"],
    [99999999.99, "99999999.99"],
  ])("%p → %p", (input, expected) => {
    expect(priceSchema.parse(input)).toBe(expected);
  });
});

describe("priceSchema — từ chối", () => {
  it.each([
    ["-1"],
    [-1],
    ["80.555"],
    [80.555],
    ["1e3"],
    ["abc"],
    [""],
    [NaN],
    [Infinity],
    ["100000000.00"], // vượt Decimal(10,2)
    [null],
    [0.1 + 0.2], // float lệch — không phải tiền có đúng 2 chữ số thập phân
    [1.005], // 3 chữ số thập phân
  ])("%p bị từ chối", (input) => {
    expect(priceSchema.safeParse(input).success).toBe(false);
  });
});

describe("formatPrice", () => {
  it("Decimal → chuỗi 2 chữ số thập phân", () => {
    expect(formatPrice(new Prisma.Decimal("80"))).toBe("80.00");
  });

  it("null → null", () => {
    expect(formatPrice(null)).toBeNull();
  });
});
