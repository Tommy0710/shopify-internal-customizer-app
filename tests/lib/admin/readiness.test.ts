import { describe, expect, it } from "vitest";
import { productReadiness, type ProductReadinessTree, type ReadinessPriceCell } from "@/lib/admin/readiness";

/**
 * `productReadiness` là hàm THUẦN (brief Task 6, R1) — test này không chạm
 * DB, tự dựng cây bằng builder bên dưới. Mỗi `ReadinessCode` có ít nhất một
 * test sinh đúng nó với đúng `path`; một cây đầy đủ trả `ready: true,
 * problems: []`; phần tử `isActive: false` không bao giờ sinh problem.
 */

function fullPriceCell(overrides: Partial<ReadinessPriceCell> = {}): ReadinessPriceCell {
  return {
    leatherId: "lth_1",
    isActive: true,
    archived: false,
    price: "80.00",
    variant: { missing: false },
    ...overrides,
  };
}

/** Cây "sẵn sàng": 1 host, 1 style active (1 ô leather đủ + 1 ô svg khớp animal), 1 animal active (1 ô leather đủ), 1 stitch active. */
function fullTree(overrides: Partial<ProductReadinessTree> = {}): ProductReadinessTree {
  return {
    hosts: [{}],
    styles: [
      {
        styleId: "sty_1",
        isActive: true,
        archived: false,
        leathers: [fullPriceCell({ leatherId: "lth_style" })],
        animals: [{ animalId: "ani_1", isActive: true, svgAssetArchived: false, defaultStitchArchived: false }],
      },
    ],
    animals: [
      {
        animalId: "ani_1",
        isActive: true,
        archived: false,
        leathers: [fullPriceCell({ leatherId: "lth_animal" })],
      },
    ],
    stitches: [{ stitchId: "st_1", isActive: true, archived: false }],
    ...overrides,
  };
}

describe("productReadiness — thuần, không chạm DB", () => {
  it("cây đầy đủ → ready: true, problems: []", () => {
    expect(productReadiness(fullTree())).toEqual({ ready: true, problems: [] });
  });

  it("NO_HOST: không có host nào", () => {
    const result = productReadiness(fullTree({ hosts: [] }));
    expect(result.ready).toBe(false);
    expect(result.problems).toContainEqual({
      code: "NO_HOST",
      message: expect.any(String),
      path: ["hosts"],
    });
  });

  it("NO_ACTIVE_STYLE: không có style active nào", () => {
    const result = productReadiness(fullTree({ styles: [] }));
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "NO_ACTIVE_STYLE", path: ["styles"] }),
    );
  });

  it("NO_ACTIVE_ANIMAL: không có animal active nào", () => {
    const result = productReadiness(fullTree({ animals: [] }));
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "NO_ACTIVE_ANIMAL", path: ["animals"] }),
    );
  });

  it("NO_ACTIVE_STITCH: không có stitch active nào", () => {
    const result = productReadiness(fullTree({ stitches: [] }));
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "NO_ACTIVE_STITCH", path: ["stitches"] }),
    );
  });

  it("STYLE_WITHOUT_LEATHER: style active nhưng không có ô leather active nào", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "STYLE_WITHOUT_LEATHER", path: ["styles", "sty_1", "leathers"] }),
    );
  });

  it("ANIMAL_WITHOUT_LEATHER: animal active nhưng không có ô leather active nào", () => {
    const tree = fullTree();
    tree.animals[0].leathers = [];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ANIMAL_WITHOUT_LEATHER", path: ["animals", "ani_1", "leathers"] }),
    );
  });

  it("MISSING_PRICE: ô giá active chưa nhập giá", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [fullPriceCell({ leatherId: "lth_style", price: null, variant: null })];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "MISSING_PRICE", path: ["styles", "sty_1", "leathers", "lth_style"] }),
    );
  });

  it("MISSING_VARIANT: có giá nhưng chưa có variant Shopify", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [fullPriceCell({ leatherId: "lth_style", price: "80.00", variant: null })];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "MISSING_VARIANT", path: ["styles", "sty_1", "leathers", "lth_style"] }),
    );
  });

  it("VARIANT_MISSING: có variant nhưng variant.missing = true", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [
      fullPriceCell({ leatherId: "lth_style", price: "80.00", variant: { missing: true } }),
    ];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "VARIANT_MISSING", path: ["styles", "sty_1", "leathers", "lth_style"] }),
    );
  });

  it("MISSING_SVG: cặp style active × animal active không có ô SVG active khớp", () => {
    const tree = fullTree();
    tree.styles[0].animals = [];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "MISSING_SVG", path: ["styles", "sty_1", "animals", "ani_1"] }),
    );
  });

  it("MISSING_SVG: ô SVG tồn tại nhưng isActive: false vẫn tính là thiếu", () => {
    const tree = fullTree();
    tree.styles[0].animals = [{ animalId: "ani_1", isActive: false, svgAssetArchived: false, defaultStitchArchived: false }];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "MISSING_SVG", path: ["styles", "sty_1", "animals", "ani_1"] }),
    );
  });

  it("ARCHIVED_ATTRIBUTE: style active trỏ tới Style đã archived", () => {
    const tree = fullTree();
    tree.styles[0].archived = true;
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["styles", "sty_1"] }),
    );
  });

  it("ARCHIVED_ATTRIBUTE: animal active trỏ tới Animal đã archived", () => {
    const tree = fullTree();
    tree.animals[0].archived = true;
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["animals", "ani_1"] }),
    );
  });

  it("ARCHIVED_ATTRIBUTE: stitch active trỏ tới Stitch đã archived", () => {
    const tree = fullTree();
    tree.stitches[0].archived = true;
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["stitches", "st_1"] }),
    );
  });

  it("ARCHIVED_ATTRIBUTE: ô giá active trỏ tới Leather đã archived", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [fullPriceCell({ leatherId: "lth_style", archived: true })];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["styles", "sty_1", "leathers", "lth_style"] }),
    );
  });

  // Review Task 6 phát hiện: một mockup SVG hay stitch mặc định bị archive SAU
  // khi đã wire vào ô active không tự sinh MISSING_SVG (ô "vẫn có mặt"), nên
  // hai ca dưới đây từng lọt qua readiness với ready:true.
  it("ARCHIVED_ATTRIBUTE: ô SVG active trỏ tới asset SVG_MOCKUP đã archived", () => {
    const tree = fullTree();
    tree.styles[0].animals = [
      { animalId: "ani_1", isActive: true, svgAssetArchived: true, defaultStitchArchived: false },
    ];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["styles", "sty_1", "animals", "ani_1"] }),
    );
  });

  it("ARCHIVED_ATTRIBUTE: ô SVG active trỏ tới defaultStitchId đã archived", () => {
    const tree = fullTree();
    tree.styles[0].animals = [
      { animalId: "ani_1", isActive: true, svgAssetArchived: false, defaultStitchArchived: true },
    ];
    const result = productReadiness(tree);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "ARCHIVED_ATTRIBUTE", path: ["styles", "sty_1", "animals", "ani_1"] }),
    );
  });

  it("ô SVG active, không archive gì — không sinh ARCHIVED_ATTRIBUTE cho ô đó (không false positive)", () => {
    const tree = fullTree();
    const result = productReadiness(tree);
    const svgProblems = result.problems.filter(
      (p) => p.path[0] === "styles" && p.path[2] === "animals",
    );
    expect(svgProblems).toEqual([]);
  });

  it("isActive: false không bao giờ sinh problem — style tắt, thiếu mọi thứ, vẫn ready", () => {
    const tree = fullTree();
    tree.styles.push({
      styleId: "sty_broken",
      isActive: false,
      archived: true,
      leathers: [fullPriceCell({ leatherId: "lth_broken", price: null, variant: null, archived: true })],
      animals: [],
    });
    expect(productReadiness(tree)).toEqual({ ready: true, problems: [] });
  });

  it("isActive: false không bao giờ sinh problem — ô giá tắt trong style active vẫn thiếu giá/variant nhưng không báo", () => {
    const tree = fullTree();
    tree.styles[0].leathers = [
      fullPriceCell({ leatherId: "lth_style" }),
      fullPriceCell({ leatherId: "lth_off", isActive: false, price: null, variant: null, archived: true }),
    ];
    expect(productReadiness(tree)).toEqual({ ready: true, problems: [] });
  });

  it("isActive: false không bao giờ sinh problem — animal tắt, thiếu mọi thứ, vẫn ready", () => {
    const tree = fullTree();
    tree.animals.push({
      animalId: "ani_broken",
      isActive: false,
      archived: true,
      leathers: [],
    });
    expect(productReadiness(tree)).toEqual({ ready: true, problems: [] });
  });

  it("isActive: false không bao giờ sinh problem — stitch tắt và archived vẫn ready", () => {
    const tree = fullTree();
    tree.stitches.push({ stitchId: "st_broken", isActive: false, archived: true });
    expect(productReadiness(tree)).toEqual({ ready: true, problems: [] });
  });

  it("nhiều vấn đề cùng lúc: tất cả problems được thu thập, không dừng ở cái đầu tiên", () => {
    const result = productReadiness(fullTree({ hosts: [], stitches: [] }));
    const codes = result.problems.map((p) => p.code).sort();
    expect(codes).toEqual(["NO_ACTIVE_STITCH", "NO_HOST"]);
  });
});
