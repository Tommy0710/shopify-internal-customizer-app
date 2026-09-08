import { readFileSync, writeFileSync } from "node:fs";

const LEGACY = "fish-";
const MODERN = "animal-";

/**
 * Đổi bộ ID legacy `fish-*` sang hợp đồng `animal-*` (guide §2).
 *
 * Chỉ chạm ba ngữ cảnh: id="fish-…", href="#fish-…", url(#fish-…).
 * Comment, class và data-* giữ nguyên — chúng không thuộc hợp đồng, và đổi
 * bừa là sửa thứ không ai yêu cầu.
 *
 * Idempotent: chạy lại trên output đã migrate không đổi gì.
 */
export function migrateSvgIds(source) {
  const renamed = new Set();

  const svg = source
    .replace(/\bid="fish-([A-Za-z0-9_-]+)"/g, (_match, rest) => {
      renamed.add(LEGACY + rest);
      return `id="${MODERN}${rest}"`;
    })
    .replace(/\b(href|xlink:href)="#fish-([A-Za-z0-9_-]+)"/g, (_match, attr, rest) => {
      return `${attr}="#${MODERN}${rest}"`;
    })
    .replace(/url\(#fish-([A-Za-z0-9_-]+)\)/g, (_match, rest) => {
      return `url(#${MODERN}${rest})`;
    });

  return { svg, renamed: [...renamed] };
}

// CLI: node scripts/migrate-svg-ids.mjs <input.svg> <output.svg>
if (process.argv[1] && process.argv[1].endsWith("migrate-svg-ids.mjs")) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: node scripts/migrate-svg-ids.mjs <input.svg> <output.svg>");
    process.exit(1);
  }
  const result = migrateSvgIds(readFileSync(input, "utf8"));
  writeFileSync(output, result.svg);
  console.log(`${input} -> ${output}`);
  console.log(
    result.renamed.length
      ? `Renamed ${result.renamed.length} id(s): ${result.renamed.join(", ")}`
      : "No legacy ids found; file already on the animal-* contract.",
  );
}
