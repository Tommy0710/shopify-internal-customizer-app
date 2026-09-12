/**
 * Luật cấm DÙNG CHUNG cho hai hàng rào thuần: `src/svg-engine/` và `src/shared/`.
 *
 * Trước final review P1b, mỗi hàng rào tự giữ danh sách riêng và chúng lệch nhau:
 * `src/shared` cấm `node:*` còn svg-engine thì không; cả hai đều để lọt
 * `from "crypto"` (builtin không prefix), import bắc cầu `@/lib/…`, và
 * `process["env"]`. Đó đúng là dạng lỗi lặp lại của dự án này — một luật chỉ
 * tồn tại ở một phía. Nên luật sống ở đây, một chỗ, và cả hai hàng rào đọc nó.
 *
 * Vẫn là regex trên văn bản, không AST: một import dựng chuỗi động vẫn lọt.
 * Chấp nhận — đó là cố ý qua mặt, không phải lỡ tay.
 */

/** Module không bao giờ được vào code chạy ở trình duyệt / engine thuần. */
const FORBIDDEN_MODULES = [
  "next",
  "react",
  "react-dom",
  "@prisma",
  "linkedom",
  "@supabase/supabase-js",
  // Import bắc cầu: `@/lib/*` là code server (storage, ids dùng node:crypto,
  // auth, db). Đi qua nó là kéo cả cây server vào bundle.
  "@/lib/",
  "@/app/",
] as const;

/** Builtin Node — cả dạng `node:x` lẫn dạng trần `x` mà Node vẫn chấp nhận. */
const NODE_BUILTINS = [
  "crypto", "fs", "path", "os", "buffer", "stream", "http", "https", "url", "util",
  "child_process", "zlib", "events", "net", "tls", "worker_threads", "vm", "assert",
] as const;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Mọi cách nạp một module: `from "x"`, `require("x")`, `import("x")`, `import "x"`. */
export function importPatterns(moduleName: string): RegExp[] {
  const name = escape(moduleName);
  return [
    new RegExp(`from\\s*["']${name}`),
    new RegExp(`require\\s*\\(\\s*["']${name}`),
    new RegExp(`import\\s*\\(\\s*["']${name}`),
    new RegExp(`import\\s*["']${name}`),
  ];
}

/** Builtin khớp ĐÚNG tên (hoặc subpath như `fs/promises`), để `"url"` không bắt nhầm `"url-parse"`. */
function builtinPatterns(builtin: string): RegExp[] {
  const specifier = `["'](?:node:)?${escape(builtin)}(?:\\/[^"']*)?["']`;
  return [
    new RegExp(`from\\s*${specifier}`),
    new RegExp(`require\\s*\\(\\s*${specifier}`),
    new RegExp(`import\\s*\\(\\s*${specifier}`),
    new RegExp(`import\\s*${specifier}`),
  ];
}

export interface FenceRule {
  label: string;
  pattern: RegExp;
}

export const PURITY_RULES: readonly FenceRule[] = [
  ...FORBIDDEN_MODULES.flatMap((moduleName) =>
    importPatterns(moduleName).map((pattern) => ({ label: `import ${moduleName}`, pattern })),
  ),
  ...NODE_BUILTINS.flatMap((builtin) =>
    builtinPatterns(builtin).map((pattern) => ({ label: `node builtin ${builtin}`, pattern })),
  ),
  // Mọi module `node:*`, kể cả builtin không có trong danh sách trên.
  ...importPatterns("node:").map((pattern) => ({ label: "node:*", pattern })),
  // process.env, process["env"], process['env'], process[`env`], process [ … ]
  { label: "process.env / process[…]", pattern: /\bprocess\s*(?:\.\s*env\b|\[)/ },
];

/** Trả danh sách vi phạm dạng "file: luật" — rỗng nghĩa là sạch. */
export function purityViolations(sources: Array<[string, string]>): string[] {
  const violations: string[] = [];
  for (const [file, body] of sources) {
    for (const rule of PURITY_RULES) {
      if (rule.pattern.test(body)) violations.push(`${file}: ${rule.label}`);
    }
  }
  return violations;
}
