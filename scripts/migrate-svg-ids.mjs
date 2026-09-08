import { readFileSync, writeFileSync } from "node:fs";

const LEGACY = "fish-";
const MODERN = "animal-";

// A real `id="…"` (or `href="…"` / `xlink:href="…"`) attribute is never
// preceded by a letter, digit, underscore, hyphen or colon — those only show
// up when the match would actually be inside a longer name like `data-id=`
// or `xml:id=`. The negative lookbehind rejects exactly those cases so the
// rename never bleeds into decorator attributes (`data-id`, `data-figma-id`,
// `xml:id`, …) that design-tool exports routinely carry.
const ATTR_BOUNDARY = "(?<![A-Za-z0-9_:-])";

/**
 * Đổi bộ ID legacy `fish-*` sang hợp đồng `animal-*` (guide §2).
 *
 * Chỉ chạm ba ngữ cảnh: id="fish-…", href="#fish-…" / xlink:href="#fish-…",
 * url(#fish-…). Comment, class và data-* (kể cả data-id, xml:id) giữ
 * nguyên — chúng không thuộc hợp đồng, và đổi bừa là sửa thứ không ai yêu
 * cầu.
 *
 * Idempotent: chạy lại trên output đã migrate không đổi gì.
 *
 * Ids chứa ký tự ngoài [A-Za-z0-9_-] (vd. "fish-eye.left") bị bỏ qua có chủ
 * ý và không báo hiệu — hợp đồng animal-* chỉ dùng kebab-case (guide §2),
 * nên một id lệch chuẩn như vậy đã sai trước khi tới bước migrate này.
 *
 * `collisions` liệt kê các legacy id mà target `animal-…` đã tồn tại sẵn
 * trong tài liệu gốc (vd. file vừa có `id="fish-shape"` vừa có
 * `id="animal-shape"` từ trước) — rename vẫn diễn ra bình thường (hàm này
 * không throw, luôn trả về `svg` đã migrate để caller tự quyết), nhưng kết
 * quả là tài liệu có id trùng lặp và caller phải coi đây là lỗi.
 */
export function migrateSvgIds(source) {
  const idScanPattern = new RegExp(`${ATTR_BOUNDARY}id="([A-Za-z0-9_-]+)"`, "g");
  const existingIds = new Set();
  for (const match of source.matchAll(idScanPattern)) {
    existingIds.add(match[1]);
  }

  const renamed = new Set();
  const collisions = new Set();

  const idPattern = new RegExp(`${ATTR_BOUNDARY}id="fish-([A-Za-z0-9_-]+)"`, "g");
  const hrefPattern = new RegExp(`${ATTR_BOUNDARY}(href|xlink:href)="#fish-([A-Za-z0-9_-]+)"`, "g");
  const urlPattern = /url\(#fish-([A-Za-z0-9_-]+)\)/g;

  const svg = source
    .replace(idPattern, (_match, rest) => {
      const legacyId = LEGACY + rest;
      const targetId = MODERN + rest;
      renamed.add(legacyId);
      if (existingIds.has(targetId)) {
        collisions.add(legacyId);
      }
      return `id="${targetId}"`;
    })
    .replace(hrefPattern, (_match, attr, rest) => {
      return `${attr}="#${MODERN}${rest}"`;
    })
    .replace(urlPattern, (_match, rest) => {
      return `url(#${MODERN}${rest})`;
    });

  return { svg, renamed: [...renamed], collisions: [...collisions] };
}

// CLI: node scripts/migrate-svg-ids.mjs <input.svg> <output.svg>
if (process.argv[1] && process.argv[1].endsWith("migrate-svg-ids.mjs")) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: node scripts/migrate-svg-ids.mjs <input.svg> <output.svg>");
    process.exit(1);
  }
  const result = migrateSvgIds(readFileSync(input, "utf8"));
  if (result.collisions.length) {
    console.error(
      `Refusing to write ${output}: migrating would create duplicate id(s): ${result.collisions.join(", ")}`,
    );
    console.error(
      "Each listed legacy id's animal-* target already exists elsewhere in the source. " +
        "Resolve the clash (rename the pre-existing target id, or the legacy id) and re-run.",
    );
    process.exit(1);
  }
  writeFileSync(output, result.svg);
  console.log(`${input} -> ${output}`);
  console.log(
    result.renamed.length
      ? `Renamed ${result.renamed.length} id(s): ${result.renamed.join(", ")}`
      : "No legacy ids found; file already on the animal-* contract.",
  );
}
