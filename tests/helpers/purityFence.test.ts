import { describe, expect, it } from "vitest";
import { purityViolations } from "./purityFence";

/** Kiểm soát cho chính luật hàng rào: một hàng rào hỏng thì hai bộ quét dùng nó xanh vô nghĩa. */
describe("luật hàng rào thuần dùng chung", () => {
  it.each([
    ["builtin trần (final review P1b)", `import { randomBytes } from "crypto";`],
    ["builtin có subpath", `import "fs/promises";`],
    ["node: prefix", `import "node:crypto";`],
    ["node: builtin ngoài danh sách", `import { x } from "node:perf_hooks";`],
    ["import bắc cầu @/lib (final review P1b)", `import { newDesignId } from "@/lib/ids";`],
    ["import @/app", `import x from "@/app/page";`],
    ["process[\"env\"] (final review P1b)", `const e = process["env"].X;`],
    ["process.env", `const k = process.env.SECRET;`],
    ["supabase", `import { createClient } from "@supabase/supabase-js";`],
    ["react-dom/client", `import { createRoot } from "react-dom/client";`],
    ["require", `const fs = require("fs");`],
    ["dynamic import", `await import("linkedom");`],
  ])("bắt: %s", (_label, source) => {
    expect(purityViolations([["probe.ts", source]])).not.toEqual([]);
  });

  it.each([
    ["zod", `import { z } from "zod";`],
    ["import tương đối", `import { parseLineProperties } from "./lineItemProperties";`],
    ["package tên bắt đầu bằng builtin", `import parse from "url-parse";`],
    ["chuỗi URL thường", `const u = "https://cdn.example.com/x.svg";`],
    ["chữ process trong comment", `// process mockup rồi trả về`],
  ])("không bắt nhầm: %s", (_label, source) => {
    expect(purityViolations([["probe.ts", source]])).toEqual([]);
  });
});
