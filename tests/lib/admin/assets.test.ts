import { describe, expect, it } from "vitest";
import { sanitizeOriginalFilename } from "@/lib/admin/assets";

describe("sanitizeOriginalFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\x\\a.svg", "a.svg"],
    ["a\u202Egpj.svg", "agpj.svg"], // bidi-override char stripped, không đảo hướng
    ["\u0000", "upload"],
    ["   ", "upload"],
    ["mockup.svg", "mockup.svg"],
    ["Ảnh mockup.svg", "Ảnh mockup.svg"], // giữ Unicode hợp lệ (không phải path/control/bidi)
  ])("%j → %j", (input, expected) => {
    expect(sanitizeOriginalFilename(input)).toBe(expected);
  });

  it("cắt còn 255 ký tự", () => {
    const long = "a".repeat(1000) + ".svg";
    const result = sanitizeOriginalFilename(long);
    expect(result.length).toBe(255);
  });

  it("không chứa ký tự điều khiển sau khi lọc", () => {
    const withControls = "a\u0001\u0002b\u009Fc.svg";
    expect(sanitizeOriginalFilename(withControls)).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });

  it("không chứa ký tự đảo hướng bidi sau khi lọc", () => {
    const withBidi = "a\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069b.svg";
    expect(sanitizeOriginalFilename(withBidi)).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });
});
