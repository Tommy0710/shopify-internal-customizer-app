import { describe, expect, it } from "vitest";
import {
  WK_PROP,
  WK_LABEL,
  WK_PROPERTY_VERSION,
  buildMainLineProperties,
  buildAddonLineProperties,
  parseLineProperties,
} from "@/shared/lineItemProperties";

// Body phải dài đúng DESIGN_ID_BODY_LENGTH = 21 ký tự (khớp src/shared/ids.ts).
const DESIGN_ID = "cd_7hK9mQwErTyUiOpAsDfXY";
const PREVIEW = "https://cdn.example/design/abc.svg";

const MAIN_INPUT = {
  designId: DESIGN_ID,
  previewUrl: PREVIEW,
  animalName: "Alligator",
  animalLeatherName: "Togo Brown",
  stitchName: "Gold",
};

describe("buildMainLineProperties", () => {
  it("sinh đúng bảy property của spec §4.4", () => {
    expect(buildMainLineProperties(MAIN_INPUT)).toEqual({
      [WK_PROP.designId]: DESIGN_ID,
      [WK_PROP.role]: "main",
      [WK_PROP.preview]: PREVIEW,
      [WK_PROP.version]: String(WK_PROPERTY_VERSION),
      [WK_LABEL.animal]: "Alligator",
      [WK_LABEL.animalLeather]: "Togo Brown",
      [WK_LABEL.stitch]: "Gold",
    });
  });

  it("KHÔNG lặp lại Style và Body Leather — variant title đã mang chúng", () => {
    const keys = Object.keys(buildMainLineProperties(MAIN_INPUT));
    expect(keys).not.toContain("Style");
    expect(keys).not.toContain("Body Leather");
  });

  it("KHÔNG bao giờ chứa giá hay mã màu hex", () => {
    const serialized = JSON.stringify(buildMainLineProperties(MAIN_INPUT));
    expect(serialized).not.toMatch(/price|\$\d|#[0-9a-fA-F]{6}/);
  });

  it("chỉ _wk_preview được mang đường dẫn file — không rò tên file SVG master", () => {
    // Spec §4.4 cấm đưa "tên file SVG" vào properties. `_wk_preview` là ngoại lệ
    // có chủ ý: nó là URL công khai của baked design SVG, chính là thứ cart dùng
    // để hiện ảnh. Test này chốt rằng KHÔNG property nào KHÁC mang đuôi .svg.
    const built = buildMainLineProperties(MAIN_INPUT);
    const others = Object.entries(built).filter(([key]) => key !== WK_PROP.preview);
    for (const [key, value] of others) {
      expect(value, `${key} không được mang tên file`).not.toMatch(/\.svg\b/);
    }
  });

  it("mọi khoá kỹ thuật đều bắt đầu bằng dấu gạch dưới (ẩn khỏi cart khách)", () => {
    for (const key of Object.values(WK_PROP)) expect(key).toMatch(/^_wk_/);
  });
});

describe("buildAddonLineProperties", () => {
  it("chỉ mang ba property, không có preview và không có nhãn hiện", () => {
    expect(buildAddonLineProperties(DESIGN_ID)).toEqual({
      [WK_PROP.designId]: DESIGN_ID,
      [WK_PROP.role]: "addon",
      [WK_PROP.version]: String(WK_PROPERTY_VERSION),
    });
  });

  it("dùng cùng designId với dòng chính — đó là thứ nối hai dòng", () => {
    expect(buildAddonLineProperties(DESIGN_ID)[WK_PROP.designId]).toBe(
      buildMainLineProperties(MAIN_INPUT)[WK_PROP.designId],
    );
  });
});

describe("parseLineProperties", () => {
  it("đọc lại được thứ chính nó ghi ra", () => {
    expect(parseLineProperties(buildMainLineProperties(MAIN_INPUT))).toMatchObject({
      designId: DESIGN_ID,
      role: "main",
      version: WK_PROPERTY_VERSION,
    });
    expect(parseLineProperties(buildAddonLineProperties(DESIGN_ID))).toMatchObject({
      designId: DESIGN_ID,
      role: "addon",
    });
  });

  it("đọc được mảng {name,value} — dạng Shopify gửi trong webhook", () => {
    const asShopifySends = Object.entries(buildMainLineProperties(MAIN_INPUT)).map(
      ([name, value]) => ({ name, value }),
    );
    expect(parseLineProperties(asShopifySends)).toMatchObject({ designId: DESIGN_ID, role: "main" });
  });

  it.each([
    ["thiếu hoàn toàn", {}],
    ["dòng thường của khách", { Engraving: "Happy birthday" }],
    ["designId sai định dạng", { [WK_PROP.designId]: "'; DROP TABLE", [WK_PROP.role]: "main", [WK_PROP.version]: "1" }],
    ["role lạ", { [WK_PROP.designId]: DESIGN_ID, [WK_PROP.role]: "admin", [WK_PROP.version]: "1" }],
    ["version không phải số", { [WK_PROP.designId]: DESIGN_ID, [WK_PROP.role]: "main", [WK_PROP.version]: "v1" }],
    [
      // "9".repeat(400) qua Number() thành Infinity — nếu lọt qua, một check
      // tương lai kiểu `parsed.version > WK_PROPERTY_VERSION` sẽ coi design
      // này là "từ tương lai" mãi mãi. version phải bị chặn ở tầng chuỗi.
      "version dài bất thường (400 chữ số)",
      { ...buildMainLineProperties(MAIN_INPUT), [WK_PROP.version]: "9".repeat(400) },
    ],
    ["null", null],
    ["chuỗi", "_wk_design_id=cd_x"],
  ])("trả null cho %s", (_label, input) => {
    expect(parseLineProperties(input)).toBeNull();
  });

  it("bỏ qua property lạ do khách tự thêm qua Cart AJAX API", () => {
    const parsed = parseLineProperties({
      ...buildMainLineProperties(MAIN_INPUT),
      _wk_admin: "true",
      "<script>": "x",
    });
    expect(parsed).toMatchObject({ designId: DESIGN_ID, role: "main" });
    expect(parsed).not.toHaveProperty("_wk_admin");
  });
});
