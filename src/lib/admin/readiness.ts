/**
 * Trả lời câu hỏi "product này bật lên storefront được chưa, và nếu chưa thì
 * thiếu gì" (spec §12.2, Task 6). THUẦN — không chạm DB, không import Prisma:
 * nhận vào phần cây đã build sẵn (từ `products.ts`, hoặc một builder trong
 * test) và trả danh sách vấn đề. `GET /products/:id` gọi hàm này sau khi đã
 * build xong cây; `PATCH { isEnabled: true }` gọi lại đúng hàm này để quyết
 * định 409 hay 200 — logic quyết định KHÔNG lặp lại ở hai nơi.
 *
 * Chỉ xét phần tử ACTIVE — một hàng `isActive: false` không bao giờ sinh ra
 * problem, dù nó thiếu giá hay trỏ tới attribute đã archived: nó không tham
 * gia bán, admin tắt nó đi chính là cách "sửa" mọi vấn đề của hàng đó.
 */

export type ReadinessCode =
  | "NO_HOST"
  | "NO_ACTIVE_STYLE"
  | "NO_ACTIVE_ANIMAL"
  | "NO_ACTIVE_STITCH"
  | "STYLE_WITHOUT_LEATHER"
  | "ANIMAL_WITHOUT_LEATHER"
  | "MISSING_PRICE"
  | "MISSING_VARIANT"
  | "VARIANT_MISSING"
  | "MISSING_SVG"
  | "ARCHIVED_ATTRIBUTE";

export interface ReadinessProblem {
  code: ReadinessCode;
  message: string;
  path: string[];
}

export interface ReadinessPriceCell {
  leatherId: string;
  isActive: boolean;
  archived: boolean;
  price: string | null;
  variant: { missing: boolean } | null;
}

export interface ReadinessStyleAnimalCell {
  animalId: string;
  isActive: boolean;
}

export interface ReadinessStyle {
  styleId: string;
  isActive: boolean;
  archived: boolean;
  leathers: ReadinessPriceCell[];
  animals: ReadinessStyleAnimalCell[];
}

export interface ReadinessAnimal {
  animalId: string;
  isActive: boolean;
  archived: boolean;
  leathers: ReadinessPriceCell[];
}

export interface ReadinessStitch {
  stitchId: string;
  isActive: boolean;
  archived: boolean;
}

/**
 * Hình tối thiểu `productReadiness` cần — `ProductTreeDto` thật ở
 * `products.ts` là một SUPERSET (có thêm `name`, `sortOrder`, `price`,
 * `svgUrl`, …), nên cây dựng ở đó truyền thẳng vào đây được, không cần map.
 */
export interface ProductReadinessTree {
  hosts: unknown[];
  styles: ReadinessStyle[];
  animals: ReadinessAnimal[];
  stitches: ReadinessStitch[];
}

function checkPriceCell(problems: ReadinessProblem[], cell: ReadinessPriceCell, basePath: string[]): void {
  const path = [...basePath, cell.leatherId];
  if (cell.archived) {
    problems.push({
      code: "ARCHIVED_ATTRIBUTE",
      message: `Leather ${cell.leatherId} đã bị archive nhưng ô giá vẫn đang bật`,
      path,
    });
  }
  if (cell.price == null) {
    problems.push({ code: "MISSING_PRICE", message: `Ô giá leather ${cell.leatherId} chưa nhập giá`, path });
  } else if (cell.variant == null) {
    problems.push({ code: "MISSING_VARIANT", message: `Ô giá leather ${cell.leatherId} chưa có variant Shopify`, path });
  } else if (cell.variant.missing) {
    problems.push({
      code: "VARIANT_MISSING",
      message: `Variant Shopify của ô giá leather ${cell.leatherId} không còn tồn tại`,
      path,
    });
  }
}

export function productReadiness(tree: ProductReadinessTree): { ready: boolean; problems: ReadinessProblem[] } {
  const problems: ReadinessProblem[] = [];

  if (tree.hosts.length === 0) {
    problems.push({ code: "NO_HOST", message: "Product chưa gắn trang Shopify nào", path: ["hosts"] });
  }

  const activeStyles = tree.styles.filter((s) => s.isActive);
  if (activeStyles.length === 0) {
    problems.push({ code: "NO_ACTIVE_STYLE", message: "Chưa có style nào đang bật", path: ["styles"] });
  }
  for (const style of activeStyles) {
    if (style.archived) {
      problems.push({
        code: "ARCHIVED_ATTRIBUTE",
        message: `Style ${style.styleId} đã bị archive nhưng vẫn đang bật`,
        path: ["styles", style.styleId],
      });
    }
    const activeLeathers = style.leathers.filter((l) => l.isActive);
    if (activeLeathers.length === 0) {
      problems.push({
        code: "STYLE_WITHOUT_LEATHER",
        message: `Style ${style.styleId} chưa có ô leather nào đang bật`,
        path: ["styles", style.styleId, "leathers"],
      });
    } else {
      for (const cell of activeLeathers) checkPriceCell(problems, cell, ["styles", style.styleId, "leathers"]);
    }
  }

  const activeAnimals = tree.animals.filter((a) => a.isActive);
  if (activeAnimals.length === 0) {
    problems.push({ code: "NO_ACTIVE_ANIMAL", message: "Chưa có animal nào đang bật", path: ["animals"] });
  }
  for (const animal of activeAnimals) {
    if (animal.archived) {
      problems.push({
        code: "ARCHIVED_ATTRIBUTE",
        message: `Animal ${animal.animalId} đã bị archive nhưng vẫn đang bật`,
        path: ["animals", animal.animalId],
      });
    }
    const activeLeathers = animal.leathers.filter((l) => l.isActive);
    if (activeLeathers.length === 0) {
      problems.push({
        code: "ANIMAL_WITHOUT_LEATHER",
        message: `Animal ${animal.animalId} chưa có ô leather nào đang bật`,
        path: ["animals", animal.animalId, "leathers"],
      });
    } else {
      for (const cell of activeLeathers) checkPriceCell(problems, cell, ["animals", animal.animalId, "leathers"]);
    }
  }

  const activeStitches = tree.stitches.filter((s) => s.isActive);
  if (activeStitches.length === 0) {
    problems.push({ code: "NO_ACTIVE_STITCH", message: "Chưa có stitch nào đang bật", path: ["stitches"] });
  }
  for (const stitch of activeStitches) {
    if (stitch.archived) {
      problems.push({
        code: "ARCHIVED_ATTRIBUTE",
        message: `Stitch ${stitch.stitchId} đã bị archive nhưng vẫn đang bật`,
        path: ["stitches", stitch.stitchId],
      });
    }
  }

  // Lưới SVG: mỗi cặp (style active × animal active) phải có một ô SVG active.
  for (const style of activeStyles) {
    for (const animal of activeAnimals) {
      const hasSvg = style.animals.some((cell) => cell.animalId === animal.animalId && cell.isActive);
      if (!hasSvg) {
        problems.push({
          code: "MISSING_SVG",
          message: `Cặp style ${style.styleId} × animal ${animal.animalId} chưa có SVG mockup`,
          path: ["styles", style.styleId, "animals", animal.animalId],
        });
      }
    }
  }

  return { ready: problems.length === 0, problems };
}
