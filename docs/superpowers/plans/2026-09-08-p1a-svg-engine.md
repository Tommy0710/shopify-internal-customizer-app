# P1a — SVG Engine & Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một implementation duy nhất của hợp đồng SVG, dùng chung cho storefront (browser), admin preview (browser) và validator lúc upload (Node) — không có bản sao thứ hai để lệch nhau.

**Architecture:** `src/svg-engine/` gồm các hàm **thuần, không tự parse**. Mọi hàm nhận một `Element`/`Document` đã parse sẵn qua tham số, nên chạy y hệt trên DOM trình duyệt và trên `linkedom` ở Node. Không import React, không import Next.js, không đọc `process.env`. Toàn bộ CSS custom property được ghi qua **thuộc tính `style`** chứ không qua `element.style.setProperty`, để một implementation chạy được cả hai môi trường.

**Tech Stack:** TypeScript · Vitest (đã có từ P0) · `linkedom` (DOM cho Node)

**Spec:** `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` §6

**Nguồn sự thật cho hợp đồng:** `docs/SVG_CUSTOMIZER_ACTION_GUIDE.md` §2, §5, §6, §8. Khi plan này và guide bất đồng, **guide thắng** — báo cáo lại thay vì tự quyết.

## Global Constraints

- Hợp đồng ID là **`animal-*`**. File dùng `fish-*` bị **từ chối** kèm hint. Guide §2 cấm duy trì song song hai bộ ID.
- 8 ID bắt buộc, mỗi ID xuất hiện **đúng một lần**: `wallet-preview` (`<svg>`), `wallet-body-shape`, `animal-shape`, `wallet-body-clip` (`<clipPath>`), `animal-clip` (`<clipPath>`), `body-artwork` (`<image>`), `animal-artwork` (`<image>`), `stitches` (`<g>`).
- CSS custom property đổi màu chỉ: **`--wallet-stitches`**.
- Màu chuẩn hoá thành hex 6 ký tự **viết hoa** (`#AABBCC`). Giá trị không hợp lệ **không bao giờ** được ghi vào SVG.
- `src/svg-engine/**` **không** được import `react`, `next`, `@prisma/client`, hay đọc `process.env`. Nó là thư viện thuần.
- Không hàm nào trong engine tự gọi `DOMParser` — caller parse rồi truyền vào.
- Không bao giờ nối chuỗi từ input vào CSS selector. Danh sách ID là hằng số compile-time (guide §8).
- Branch: `feat/customizer-redesign`. Mọi commit kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Test đặt tại `tests/`, mirror `src/`.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `src/svg-engine/contract.ts` | Tạo | Hằng số hợp đồng: ID bắt buộc, tên CSS var, prefix legacy. Không logic. |
| `src/svg-engine/css.ts` | Tạo | Đọc/ghi CSS custom property qua **thuộc tính `style`** — lớp tương thích browser ↔ linkedom |
| `src/svg-engine/colors.ts` | Tạo | `normalizeHex` — port từ reference implementation |
| `src/svg-engine/validate.ts` | Tạo | `validateSvgContract` → báo cáo từng ID, dùng bởi cả admin upload lẫn storefront swap |
| `src/svg-engine/apply.ts` | Tạo | `applyTexture`, `applyStitchColor` — thao tác runtime trên SVG đang hiển thị |
| `src/svg-engine/loader.ts` | Tạo | `createMockupLoader` — race guard, chỉ lần chọn mới nhất được commit |
| `src/svg-engine/sanitize.ts` | Tạo | `sanitizeSvgRoot` — gỡ script/handler/ref ngoài allowlist. Chạy server-side lúc upload. |
| `src/svg-engine/bake.ts` | Tạo | `bakeDesign` — ghi cứng texture + màu chỉ vào SVG để lưu bản bất biến |
| `src/svg-engine/index.ts` | Tạo | Re-export public API |
| `tests/helpers/svgDom.ts` | Tạo | `parseSvg(text)` bằng linkedom, dùng chung mọi test của engine |
| `tests/fixtures/svg/angler-fish.svg` | Tạo | Master đã migrate sang `animal-*`, hợp lệ |
| `tests/fixtures/svg/crocodile.svg` | Tạo | Như trên |
| `scripts/migrate-svg-ids.mjs` | Tạo | Script một lần đổi `fish-*` → `animal-*`, chạy lại được |
| `tests/svg-engine/*.test.ts` | Tạo | Một file test mỗi module |
| `package.json` | Sửa | Thêm `linkedom` |

**Vì sao tách `css.ts` riêng:** `element.style.setProperty` tồn tại trên browser nhưng linkedom không đảm bảo. Ghi qua thuộc tính `style` dạng chuỗi chạy giống nhau ở cả hai nơi — đây là lý do engine test được ở Node mà vẫn đúng trên storefront. Gói riêng để chỗ duy nhất biết về khác biệt môi trường nằm trong một file 30 dòng.

---

## Task 1: Hằng số hợp đồng + chuẩn hoá màu

**Files:**
- Create: `src/svg-engine/contract.ts`
- Create: `src/svg-engine/colors.ts`
- Create: `tests/svg-engine/colors.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: không có (task đầu)
- Produces:
  - `CONTRACT_VERSION: "animal-v1"`
  - `SVG_ROOT_ID: "wallet-preview"`
  - `STITCH_CSS_VAR: "--wallet-stitches"`
  - `LEGACY_ID_PREFIX: "fish-"`
  - `REQUIRED_ELEMENTS: ReadonlyArray<{ id: string; element: string | null }>`
  - `ARTWORK_TARGET_IDS: { readonly body: "body-artwork"; readonly animal: "animal-artwork" }`
  - `type ArtworkTarget = "body" | "animal"`
  - `normalizeHex(value: unknown): string | null`

- [ ] **Step 1: Cài linkedom**

```bash
npm install linkedom@^0.18.5
```

`linkedom` là dependency **runtime** (không phải devDependency): `sanitize.ts` và `bake.ts` chạy trên server lúc admin upload và lúc tạo design.

- [ ] **Step 2: Viết hằng số hợp đồng**

Tạo `src/svg-engine/contract.ts`:

```ts
/**
 * Hợp đồng SVG — nguồn sự thật là docs/SVG_CUSTOMIZER_ACTION_GUIDE.md §2.
 *
 * Danh sách ID ở đây là hằng số compile-time và PHẢI giữ nguyên như vậy.
 * Guide §8: không bao giờ nối chuỗi không tin cậy vào CSS selector.
 */

export const CONTRACT_VERSION = "animal-v1";

export const SVG_ROOT_ID = "wallet-preview";

export const STITCH_CSS_VAR = "--wallet-stitches";

/** SVG mẫu cũ dùng bộ ID này. Guide §2 cấm hỗ trợ song song — chỉ dùng để sinh hint. */
export const LEGACY_ID_PREFIX = "fish-";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * `element: null` nghĩa là hợp đồng không ràng buộc loại phần tử — chỉ cần
 * ID tồn tại đúng một lần. `wallet-body-shape` và `animal-shape` có thể là
 * <path> hoặc bất kỳ shape tương đương nào (guide §2).
 */
export const REQUIRED_ELEMENTS: ReadonlyArray<{
  readonly id: string;
  readonly element: string | null;
}> = [
  { id: "wallet-preview", element: "svg" },
  { id: "wallet-body-shape", element: null },
  { id: "animal-shape", element: null },
  { id: "wallet-body-clip", element: "clipPath" },
  { id: "animal-clip", element: "clipPath" },
  { id: "body-artwork", element: "image" },
  { id: "animal-artwork", element: "image" },
  { id: "stitches", element: "g" },
] as const;

export const ARTWORK_TARGET_IDS = {
  body: "body-artwork",
  animal: "animal-artwork",
} as const;

export type ArtworkTarget = keyof typeof ARTWORK_TARGET_IDS;
```

- [ ] **Step 3: Viết test thất bại cho normalizeHex**

Tạo `tests/svg-engine/colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeHex } from "@/svg-engine/colors";

describe("normalizeHex", () => {
  it("expands three-digit hex and uppercases it", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("#ABC")).toBe("#AABBCC");
  });

  it("uppercases six-digit hex and adds the missing hash", () => {
    expect(normalizeHex("#e7c337")).toBe("#E7C337");
    expect(normalizeHex("e7c337")).toBe("#E7C337");
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeHex("  #e7c337  ")).toBe("#E7C337");
  });

  it("rejects anything that is not a complete hex colour", () => {
    for (const value of ["", "#", "#ab", "#abcd", "#abcde", "#abcdefa", "rebeccapurple", "#gggggg", "rgb(1,2,3)"]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });

  it("rejects non-string input rather than coercing it", () => {
    for (const value of [null, undefined, 123456, {}, [], true]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});
```

- [ ] **Step 4: Chạy test để xác nhận nó fail**

Run: `npm test -- colors`
Expected: FAIL — `Failed to resolve import "@/svg-engine/colors"`

- [ ] **Step 5: Viết implementation**

Tạo `src/svg-engine/colors.ts`:

```ts
/**
 * Chuẩn hoá đầu vào màu thành hex sáu ký tự viết hoa.
 *
 * Port từ implementation nguyên mẫu tại
 * `test svg/src/stitches-color.js`. Trả `null` cho mọi giá trị không hợp lệ —
 * caller có trách nhiệm KHÔNG ghi `null` vào SVG (guide §6).
 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const draft = value.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(draft)) {
    return `#${[...draft].map((character) => character.repeat(2)).join("").toUpperCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(draft)) {
    return `#${draft.toUpperCase()}`;
  }

  return null;
}
```

Lưu ý sai lệch có chủ ý so với reference: bản gốc dùng `String(value)` nên `123456` biến thành `"123456"` rồi được chấp nhận thành `#123456`. Ở đây kiểu `unknown` bị từ chối thẳng — server nhận input từ HTTP nên ép kiểu ngầm là rủi ro, không phải tiện lợi.

- [ ] **Step 6: Chạy test để xác nhận pass**

Run: `npm test -- colors`
Expected: PASS — 5 test

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/svg-engine/contract.ts src/svg-engine/colors.ts tests/svg-engine/colors.test.ts
git commit -m "feat(svg-engine): hằng số hợp đồng và chuẩn hoá màu chỉ

Danh sách 8 ID bắt buộc là hằng số compile-time, không bao giờ nối chuỗi
từ input vào selector (guide §8).

normalizeHex từ chối input không phải string thay vì ép kiểu như bản
nguyên mẫu — engine này nhận dữ liệu từ HTTP.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Lớp tương thích CSS custom property

**Files:**
- Create: `src/svg-engine/css.ts`
- Create: `tests/helpers/svgDom.ts`
- Create: `tests/svg-engine/css.test.ts`

**Interfaces:**
- Consumes: không có
- Produces:
  - `readCssVar(element: Element, name: string): string | null`
  - `writeCssVar(element: Element, name: string, value: string): void`
  - Test helper: `parseSvg(text: string): SVGElement` (throws nếu parse lỗi hoặc root không phải `<svg>`)

**Bối cảnh:** `element.style.setProperty` có trên browser nhưng linkedom không đảm bảo. Ghi qua **thuộc tính `style`** dạng chuỗi chạy giống hệt nhau ở cả hai môi trường, và trình duyệt vẫn honour custom property đặt trong inline style. Đây là lý do toàn bộ engine test được ở Node.

- [ ] **Step 1: Viết test helper**

Tạo `tests/helpers/svgDom.ts`:

```ts
import { DOMParser } from "linkedom";

/**
 * Parse SVG text thành một Element dùng được cho svg-engine.
 * Chỉ dùng trong test — code production tự parse ở tầng của nó
 * (DOMParser trình duyệt ở storefront, linkedom ở server).
 */
export function parseSvg(text: string): Element {
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg") {
    throw new Error("Fixture is not an <svg> document");
  }
  return root as unknown as Element;
}
```

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/svg-engine/css.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readCssVar, writeCssVar } from "@/svg-engine/css";
import { parseSvg } from "../helpers/svgDom";

const bare = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`;
const withVar = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="--wallet-stitches: #E7C337"></svg>`;
const withOthers = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="opacity: 0.5; --wallet-stitches:#E7C337; display:block"></svg>`;

describe("readCssVar", () => {
  it("returns null when the element has no style attribute", () => {
    expect(readCssVar(parseSvg(bare), "--wallet-stitches")).toBeNull();
  });

  it("reads a custom property, ignoring surrounding whitespace", () => {
    expect(readCssVar(parseSvg(withVar), "--wallet-stitches")).toBe("#E7C337");
  });

  it("reads a custom property that sits among other declarations", () => {
    expect(readCssVar(parseSvg(withOthers), "--wallet-stitches")).toBe("#E7C337");
  });

  it("returns null for a property that is absent", () => {
    expect(readCssVar(parseSvg(withVar), "--nope")).toBeNull();
  });

  it("does not match a property whose name merely ends with the query", () => {
    const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" style="--outer-wallet-stitches: #FFFFFF"></svg>`);
    expect(readCssVar(svg, "--wallet-stitches")).toBeNull();
  });
});

describe("writeCssVar", () => {
  it("adds the property to an element with no style attribute", () => {
    const svg = parseSvg(bare);
    writeCssVar(svg, "--wallet-stitches", "#AABBCC");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#AABBCC");
  });

  it("replaces an existing value without duplicating the declaration", () => {
    const svg = parseSvg(withVar);
    writeCssVar(svg, "--wallet-stitches", "#123456");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#123456");
    expect(svg.getAttribute("style")!.match(/--wallet-stitches/g)).toHaveLength(1);
  });

  it("preserves unrelated declarations", () => {
    const svg = parseSvg(withOthers);
    writeCssVar(svg, "--wallet-stitches", "#123456");
    const style = svg.getAttribute("style")!;
    expect(style).toContain("opacity: 0.5");
    expect(style).toContain("display:block");
    expect(readCssVar(svg, "--wallet-stitches")).toBe("#123456");
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận nó fail**

Run: `npm test -- css`
Expected: FAIL — `Failed to resolve import "@/svg-engine/css"`

- [ ] **Step 4: Viết implementation**

Tạo `src/svg-engine/css.ts`:

```ts
/**
 * Đọc/ghi CSS custom property qua THUỘC TÍNH `style` chứ không qua
 * `element.style.setProperty`.
 *
 * Lý do: `element.style` có trên DOM trình duyệt nhưng linkedom không đảm bảo.
 * Thao tác trên chuỗi thuộc tính chạy giống hệt ở cả hai môi trường, và trình
 * duyệt vẫn honour custom property đặt trong inline style. Đây là chỗ DUY NHẤT
 * trong engine biết tới khác biệt môi trường.
 */

function declarations(element: Element): string[] {
  const style = element.getAttribute("style");
  if (!style) return [];
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function nameOf(declaration: string): string {
  return declaration.slice(0, declaration.indexOf(":")).trim();
}

export function readCssVar(element: Element, name: string): string | null {
  for (const declaration of declarations(element)) {
    if (nameOf(declaration) === name) {
      return declaration.slice(declaration.indexOf(":") + 1).trim();
    }
  }
  return null;
}

export function writeCssVar(element: Element, name: string, value: string): void {
  const kept = declarations(element).filter((declaration) => nameOf(declaration) !== name);
  kept.push(`${name}: ${value}`);
  element.setAttribute("style", kept.join("; "));
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm test -- css`
Expected: PASS — 8 test

- [ ] **Step 6: Commit**

```bash
git add src/svg-engine/css.ts tests/helpers/svgDom.ts tests/svg-engine/css.test.ts
git commit -m "feat(svg-engine): đọc/ghi CSS custom property qua thuộc tính style

element.style.setProperty có trên browser nhưng linkedom không đảm bảo.
Thao tác trên chuỗi thuộc tính chạy giống nhau ở cả hai, nên toàn bộ
engine test được ở Node mà vẫn đúng trên storefront.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Validator hợp đồng

**Files:**
- Create: `src/svg-engine/validate.ts`
- Create: `tests/svg-engine/validate.test.ts`

**Interfaces:**
- Consumes: `REQUIRED_ELEMENTS`, `SVG_ROOT_ID`, `STITCH_CSS_VAR`, `LEGACY_ID_PREFIX`, `SVG_NAMESPACE`, `CONTRACT_VERSION` từ `@/svg-engine/contract`
- Produces:
  - `type CheckStatus = "ok" | "missing" | "duplicate" | "wrong-element" | "warning"`
  - `interface ContractCheck { id: string; status: CheckStatus; element?: string; hint?: string }`
  - `interface ValidationReport { valid: boolean; contractVersion: string; viewBox: string | null; checks: ContractCheck[] }`
  - `validateSvgContract(root: Element | null | undefined): ValidationReport`

`valid` là `true` chỉ khi **mọi** check có status `"ok"`. Status `"warning"` KHÔNG làm hỏng `valid` — nó dành cho thứ đúng cấu trúc nhưng đáng ngờ về ngữ nghĩa (ví dụ `#stitches` không dùng `var(--wallet-stitches)`).

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

function build(options: {
  rootId?: string;
  omit?: string[];
  duplicate?: string;
  bodyArtworkAs?: string;
  stitchesFill?: string;
  viewBox?: string;
} = {}): string {
  const omit = new Set(options.omit ?? []);
  const bodyArtworkTag = options.bodyArtworkAs ?? "image";
  const parts: string[] = [];

  if (!omit.has("wallet-body-shape")) parts.push(`<path id="wallet-body-shape" d="M0 0h10v10H0z"/>`);
  if (!omit.has("animal-shape")) parts.push(`<path id="animal-shape" d="M2 2h4v4H2z"/>`);
  if (!omit.has("wallet-body-clip")) parts.push(`<clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>`);
  if (!omit.has("animal-clip")) parts.push(`<clipPath id="animal-clip"><use href="#animal-shape"/></clipPath>`);
  if (!omit.has("body-artwork")) parts.push(`<${bodyArtworkTag} id="body-artwork" clip-path="url(#wallet-body-clip)"/>`);
  if (!omit.has("animal-artwork")) parts.push(`<image id="animal-artwork" clip-path="url(#animal-clip)"/>`);
  if (!omit.has("stitches")) parts.push(`<g id="stitches" fill="${options.stitchesFill ?? "var(--wallet-stitches)"}"></g>`);
  if (options.duplicate) parts.push(`<g id="${options.duplicate}"></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" id="${options.rootId ?? "wallet-preview"}" viewBox="${options.viewBox ?? "0 0 1427 1102"}">${parts.join("")}</svg>`;
}

function statusOf(report: ReturnType<typeof validateSvgContract>, id: string) {
  return report.checks.find((check) => check.id === id)?.status;
}

describe("validateSvgContract", () => {
  it("accepts a document that satisfies every required element", () => {
    const report = validateSvgContract(parseSvg(build()));
    expect(report.valid).toBe(true);
    expect(report.contractVersion).toBe("animal-v1");
    expect(report.viewBox).toBe("0 0 1427 1102");
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("rejects a null root without throwing", () => {
    const report = validateSvgContract(null);
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("rejects a root whose id is not wallet-preview", () => {
    const report = validateSvgContract(parseSvg(build({ rootId: "something-else" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("missing");
  });

  it("reports each missing required id separately", () => {
    const report = validateSvgContract(parseSvg(build({ omit: ["animal-artwork", "stitches"] })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-artwork")).toBe("missing");
    expect(statusOf(report, "stitches")).toBe("missing");
    expect(statusOf(report, "body-artwork")).toBe("ok");
  });

  it("rejects a duplicated id", () => {
    const report = validateSvgContract(parseSvg(build({ duplicate: "animal-shape" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "animal-shape")).toBe("duplicate");
  });

  it("rejects an artwork target that is not an <image>", () => {
    const report = validateSvgContract(parseSvg(build({ bodyArtworkAs: "rect" })));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "body-artwork")).toBe("wrong-element");
    expect(report.checks.find((check) => check.id === "body-artwork")?.element).toBe("rect");
  });

  it("warns but stays valid when #stitches does not use the colour variable", () => {
    const report = validateSvgContract(parseSvg(build({ stitchesFill: "#E7C337" })));
    expect(statusOf(report, "stitches")).toBe("warning");
    expect(report.valid).toBe(true);
  });

  it("hints at the animal-* migration when it finds legacy fish-* ids", () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
      <image id="body-artwork"/>
      <image id="fish-artwork"/>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`;
    const report = validateSvgContract(parseSvg(legacy));
    expect(report.valid).toBe(false);
    for (const id of ["animal-shape", "animal-clip", "animal-artwork"]) {
      const check = report.checks.find((entry) => entry.id === id);
      expect(check?.status).toBe("missing");
      expect(check?.hint).toMatch(/fish-/);
    }
  });

  it("rejects a root that is not in the SVG namespace", () => {
    const html = `<svg id="wallet-preview" xmlns="http://www.w3.org/1999/xhtml"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    const report = validateSvgContract(parseSvg(html));
    expect(report.valid).toBe(false);
    expect(statusOf(report, "wallet-preview")).toBe("wrong-element");
  });

  it("returns a null viewBox rather than throwing when the attribute is absent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><g id="stitches" fill="var(--wallet-stitches)"></g></svg>`;
    expect(validateSvgContract(parseSvg(svg)).viewBox).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- validate`
Expected: FAIL — `Failed to resolve import "@/svg-engine/validate"`

- [ ] **Step 3: Viết implementation**

Tạo `src/svg-engine/validate.ts`:

```ts
import {
  CONTRACT_VERSION,
  LEGACY_ID_PREFIX,
  REQUIRED_ELEMENTS,
  STITCH_CSS_VAR,
  SVG_NAMESPACE,
  SVG_ROOT_ID,
} from "./contract";

export type CheckStatus = "ok" | "missing" | "duplicate" | "wrong-element" | "warning";

export interface ContractCheck {
  id: string;
  status: CheckStatus;
  /** localName thực tế tìm thấy, khi status là "wrong-element" */
  element?: string;
  /** Gợi ý sửa cho admin, ví dụ khi phát hiện ID legacy */
  hint?: string;
}

export interface ValidationReport {
  valid: boolean;
  contractVersion: string;
  viewBox: string | null;
  checks: ContractCheck[];
}

/**
 * Gợi ý migration khi ID bắt buộc vắng mặt nhưng bản legacy tương ứng có mặt.
 * `animal-shape` -> `fish-shape`. Guide §2 cấm hỗ trợ song song hai bộ ID, nên
 * đây chỉ là thông điệp cho người sửa file, không phải fallback.
 */
function legacyHint(root: Element, requiredId: string): string | undefined {
  if (!requiredId.startsWith("animal-")) return undefined;
  const legacyId = LEGACY_ID_PREFIX + requiredId.slice("animal-".length);
  const found = root.querySelectorAll(`[id="${legacyId}"]`).length > 0;
  return found
    ? `Found '${legacyId}'. This file has not been migrated to the ${CONTRACT_VERSION} contract.`
    : undefined;
}

function usesStitchVariable(element: Element): boolean {
  const fill = element.getAttribute("fill") ?? "";
  const style = element.getAttribute("style") ?? "";
  return fill.includes(`var(${STITCH_CSS_VAR})`) || style.includes(`var(${STITCH_CSS_VAR})`);
}

export function validateSvgContract(root: Element | null | undefined): ValidationReport {
  const report: ValidationReport = {
    valid: false,
    contractVersion: CONTRACT_VERSION,
    viewBox: null,
    checks: [],
  };

  if (!root || root.localName !== "svg" || root.getAttribute("id") !== SVG_ROOT_ID) {
    report.checks.push({
      id: SVG_ROOT_ID,
      status: "missing",
      hint: `Root must be an <svg> element with id="${SVG_ROOT_ID}".`,
    });
    return report;
  }

  // Guide §8: root phải nằm trong namespace SVG. Một tài liệu HTML có thẻ tên
  // "svg" sẽ qua được kiểm tra localName ở trên nhưng không phải SVG thật —
  // clipPath và <use> sẽ không hoạt động.
  if (root.namespaceURI !== SVG_NAMESPACE) {
    report.checks.push({
      id: SVG_ROOT_ID,
      status: "wrong-element",
      element: root.namespaceURI ?? "(no namespace)",
      hint: `Root must be in the ${SVG_NAMESPACE} namespace.`,
    });
    return report;
  }

  report.viewBox = root.getAttribute("viewBox");

  for (const required of REQUIRED_ELEMENTS) {
    if (required.id === SVG_ROOT_ID) {
      report.checks.push({ id: required.id, status: "ok", element: "svg" });
      continue;
    }

    // Selector dựng từ hằng số compile-time, không bao giờ từ input (guide §8).
    const matches = root.querySelectorAll(`[id="${required.id}"]`);

    if (matches.length === 0) {
      report.checks.push({
        id: required.id,
        status: "missing",
        hint: legacyHint(root, required.id),
      });
      continue;
    }

    if (matches.length > 1) {
      report.checks.push({
        id: required.id,
        status: "duplicate",
        hint: `Found ${matches.length} elements with this id; the contract requires exactly one.`,
      });
      continue;
    }

    const element = matches[0] as Element;

    if (required.element && element.localName !== required.element) {
      report.checks.push({
        id: required.id,
        status: "wrong-element",
        element: element.localName,
        hint: `Expected <${required.element}>, found <${element.localName}>.`,
      });
      continue;
    }

    if (required.id === "stitches" && !usesStitchVariable(element)) {
      report.checks.push({
        id: required.id,
        status: "warning",
        element: element.localName,
        hint: `Group exists but its fill does not use var(${STITCH_CSS_VAR}); the stitch colour control will do nothing.`,
      });
      continue;
    }

    report.checks.push({ id: required.id, status: "ok", element: element.localName });
  }

  report.valid = report.checks.every(
    (check) => check.status === "ok" || check.status === "warning",
  );

  return report;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- validate`
Expected: PASS — 10 test

- [ ] **Step 5: Commit**

```bash
git add src/svg-engine/validate.ts tests/svg-engine/validate.test.ts
git commit -m "feat(svg-engine): validator hợp đồng với báo cáo từng ID

Trả về status riêng cho mỗi ID bắt buộc (ok/missing/duplicate/
wrong-element/warning) để admin biết chính xác phải sửa gì trong file.

Phát hiện ID legacy fish-* và sinh hint migration, nhưng KHÔNG chấp nhận
chúng — guide §2 cấm duy trì song song hai bộ ID.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Áp texture và màu chỉ

**Files:**
- Create: `src/svg-engine/apply.ts`
- Create: `tests/svg-engine/apply.test.ts`

**Interfaces:**
- Consumes: `ARTWORK_TARGET_IDS`, `ArtworkTarget`, `STITCH_CSS_VAR` từ `./contract`; `writeCssVar` từ `./css`; `normalizeHex` từ `./colors`
- Produces:
  - `applyTexture(root: Element, target: ArtworkTarget, url: string | null): void` — throws `MissingTargetError` nếu không tìm thấy `<image>`
  - `applyStitchColor(root: Element, value: unknown): string | null` — trả hex đã chuẩn hoá nếu ghi thành công, `null` nếu input không hợp lệ (và **không ghi gì**)
  - `class MissingTargetError extends Error`

**Hành vi bắt buộc theo guide §5:** gán URL thì đặt `href`, **gỡ** `hidden`, đặt `visibility="visible"`. Gỡ URL thì làm ngược lại. Các ngăn ví tự cập nhật theo vì chúng dùng `<use href="#body-artwork">` — engine không cần biết tới chúng.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/apply.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MissingTargetError, applyStitchColor, applyTexture } from "@/svg-engine/apply";
import { readCssVar } from "@/svg-engine/css";
import { parseSvg } from "../helpers/svgDom";

const doc = () =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview" style="--wallet-stitches: #E7C337">
    <image id="body-artwork" hidden="hidden"/>
    <image id="animal-artwork" hidden="hidden"/>
    <g id="stitches" fill="var(--wallet-stitches)"></g>
  </svg>`);

const target = (root: Element, id: string) => root.querySelector(`[id="${id}"]`)!;

describe("applyTexture", () => {
  it("sets href and reveals the image", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    const image = target(root, "body-artwork");
    expect(image.getAttribute("href")).toBe("https://cdn.example/leather.webp");
    expect(image.hasAttribute("hidden")).toBe(false);
    expect(image.getAttribute("visibility")).toBe("visible");
  });

  it("touches only the requested target", () => {
    const root = doc();
    applyTexture(root, "animal", "https://cdn.example/togo.webp");
    expect(target(root, "animal-artwork").getAttribute("href")).toBe("https://cdn.example/togo.webp");
    expect(target(root, "body-artwork").hasAttribute("href")).toBe(false);
    expect(target(root, "body-artwork").hasAttribute("hidden")).toBe(true);
  });

  it("clears href and hides the image again when given null", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    applyTexture(root, "body", null);
    const image = target(root, "body-artwork");
    expect(image.hasAttribute("href")).toBe(false);
    expect(image.getAttribute("hidden")).toBe("");
    expect(image.getAttribute("visibility")).toBe("hidden");
  });

  it("throws a typed error when the target is absent", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`);
    expect(() => applyTexture(root, "body", "https://cdn.example/x.webp")).toThrow(MissingTargetError);
  });
});

describe("applyStitchColor", () => {
  it("writes a normalised colour and returns it", () => {
    const root = doc();
    expect(applyStitchColor(root, "#abc")).toBe("#AABBCC");
    expect(readCssVar(root, "--wallet-stitches")).toBe("#AABBCC");
  });

  it("leaves the existing colour untouched when the input is invalid", () => {
    const root = doc();
    expect(applyStitchColor(root, "rebeccapurple")).toBeNull();
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("does not write anything for a non-string input", () => {
    const root = doc();
    expect(applyStitchColor(root, 123456)).toBeNull();
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("does not disturb the artwork targets", () => {
    const root = doc();
    applyTexture(root, "body", "https://cdn.example/leather.webp");
    applyStitchColor(root, "#123456");
    expect(target(root, "body-artwork").getAttribute("href")).toBe("https://cdn.example/leather.webp");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- apply`
Expected: FAIL — `Failed to resolve import "@/svg-engine/apply"`

- [ ] **Step 3: Viết implementation**

Tạo `src/svg-engine/apply.ts`:

```ts
import { ARTWORK_TARGET_IDS, STITCH_CSS_VAR, type ArtworkTarget } from "./contract";
import { normalizeHex } from "./colors";
import { writeCssVar } from "./css";

export class MissingTargetError extends Error {
  constructor(readonly targetId: string) {
    super(`Missing SVG target: ${targetId}`);
    this.name = "MissingTargetError";
  }
}

/**
 * Gán hoặc gỡ ảnh texture cho một trong hai artwork target.
 *
 * Guide §5: gán thì đặt href, GỠ `hidden`, đặt visibility="visible".
 * Gỡ thì làm ngược lại. Các ngăn ví dùng `<use href="#body-artwork">` nên tự
 * cập nhật theo — engine không cần biết tới chúng.
 */
export function applyTexture(root: Element, target: ArtworkTarget, url: string | null): void {
  const id = ARTWORK_TARGET_IDS[target];
  const image = root.querySelector(`[id="${id}"]`);

  if (!image) throw new MissingTargetError(id);

  if (url) {
    image.setAttribute("href", url);
    image.removeAttribute("hidden");
    image.setAttribute("visibility", "visible");
    return;
  }

  image.removeAttribute("href");
  image.setAttribute("hidden", "");
  image.setAttribute("visibility", "hidden");
}

/**
 * Ghi màu chỉ vào CSS custom property ở root.
 *
 * Trả hex đã chuẩn hoá khi ghi thành công, `null` khi input không hợp lệ —
 * và khi `null` thì KHÔNG ghi gì cả, màu hiện tại giữ nguyên (guide §6).
 */
export function applyStitchColor(root: Element, value: unknown): string | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  writeCssVar(root, STITCH_CSS_VAR, hex);
  return hex;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- apply`
Expected: PASS — 8 test

- [ ] **Step 5: Commit**

```bash
git add src/svg-engine/apply.ts tests/svg-engine/apply.test.ts
git commit -m "feat(svg-engine): áp texture và màu chỉ lên SVG

applyTexture theo đúng guide §5: đặt href, gỡ hidden, đặt visibility.
Các ngăn ví tự cập nhật vì chúng dùng <use href=\"#body-artwork\">.

applyStitchColor không ghi gì khi input không hợp lệ — màu hiện tại
giữ nguyên thay vì bị xoá (guide §6).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Loader có race guard

**Files:**
- Create: `src/svg-engine/loader.ts`
- Create: `tests/svg-engine/loader.test.ts`

**Interfaces:**
- Consumes: không có
- Produces:
  - `type LoadOutcome<T> = { status: "ready"; value: T } | { status: "stale" } | { status: "error"; error: unknown }`
  - `createMockupLoader<K, V>(read: (key: K) => Promise<V>): (key: K) => Promise<LoadOutcome<V>>`

**Vấn đề nó giải:** khách đổi animal hai lần liên tiếp. Request thứ nhất chậm hơn request thứ hai và trả về **sau**. Không có guard, kết quả cũ ghi đè lựa chọn mới và preview hiển thị sai con vật. Guide §7 mục 7 nêu đích danh. Port từ `test svg/src/mockups.js`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/loader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockupLoader } from "@/svg-engine/loader";

/** Promise mở, để test tự quyết định thứ tự resolve. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createMockupLoader", () => {
  it("returns the value for a single request", async () => {
    const load = createMockupLoader(async (key: string) => `svg:${key}`);
    await expect(load("fish")).resolves.toEqual({ status: "ready", value: "svg:fish" });
  });

  it("marks an earlier request stale when a later one is issued", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const load = createMockupLoader(async () => queue.shift()!.promise);

    const slow = load("fish");
    const fast = load("crocodile");

    // Lần chọn MỚI resolve trước, rồi lần cũ mới về — đúng kịch bản nguy hiểm.
    second.resolve("svg:crocodile");
    await expect(fast).resolves.toEqual({ status: "ready", value: "svg:crocodile" });

    first.resolve("svg:fish");
    await expect(slow).resolves.toEqual({ status: "stale" });
  });

  it("reports an error for the latest request", async () => {
    const boom = new Error("HTTP 500");
    const load = createMockupLoader(async () => {
      throw boom;
    });
    await expect(load("fish")).resolves.toEqual({ status: "error", error: boom });
  });

  it("marks a failed earlier request stale rather than surfacing its error", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const load = createMockupLoader(async () => queue.shift()!.promise);

    const slow = load("fish");
    const fast = load("crocodile");

    second.resolve("svg:crocodile");
    await fast;

    first.reject(new Error("HTTP 500"));
    await expect(slow).resolves.toEqual({ status: "stale" });
  });

  it("allows a retry after a failure to become the latest request", async () => {
    let attempt = 0;
    const load = createMockupLoader(async (key: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error("HTTP 500");
      return `svg:${key}`;
    });

    await expect(load("fish")).resolves.toMatchObject({ status: "error" });
    await expect(load("fish")).resolves.toEqual({ status: "ready", value: "svg:fish" });
  });

  it("keeps separate loaders independent", async () => {
    const a = createMockupLoader(async (key: string) => `a:${key}`);
    const b = createMockupLoader(async (key: string) => `b:${key}`);
    await expect(a("x")).resolves.toEqual({ status: "ready", value: "a:x" });
    await expect(b("y")).resolves.toEqual({ status: "ready", value: "b:y" });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- loader`
Expected: FAIL — `Failed to resolve import "@/svg-engine/loader"`

- [ ] **Step 3: Viết implementation**

Tạo `src/svg-engine/loader.ts`:

```ts
export type LoadOutcome<T> =
  | { status: "ready"; value: T }
  | { status: "stale" }
  | { status: "error"; error: unknown };

/**
 * Bọc một hàm đọc bất đồng bộ sao cho CHỈ kết quả của lần gọi mới nhất được
 * phép commit.
 *
 * Vấn đề nó giải: khách đổi animal hai lần liên tiếp; request đầu chậm hơn và
 * trả về SAU request thứ hai. Không có guard, kết quả cũ ghi đè lựa chọn mới
 * và preview hiển thị sai con vật (guide §7).
 *
 * Lần gọi cũ nhận `{status:"stale"}` — kể cả khi nó thất bại — nên caller
 * không bao giờ hiện lỗi của một lựa chọn khách đã bỏ.
 *
 * Port từ `test svg/src/mockups.js`.
 */
export function createMockupLoader<K, V>(
  read: (key: K) => Promise<V>,
): (key: K) => Promise<LoadOutcome<V>> {
  let sequence = 0;

  return async (key: K): Promise<LoadOutcome<V>> => {
    const request = ++sequence;
    try {
      const value = await read(key);
      return request === sequence ? { status: "ready", value } : { status: "stale" };
    } catch (error) {
      return request === sequence ? { status: "error", error } : { status: "stale" };
    }
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- loader`
Expected: PASS — 6 test

- [ ] **Step 5: Commit**

```bash
git add src/svg-engine/loader.ts tests/svg-engine/loader.test.ts
git commit -m "feat(svg-engine): loader chỉ commit kết quả của lần chọn mới nhất

Chặn kịch bản request cũ về trễ ghi đè lựa chọn mới, khiến preview hiện
sai con vật. Lần gọi cũ nhận status stale kể cả khi nó lỗi, nên caller
không hiện lỗi của lựa chọn khách đã bỏ.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Migrate SVG mẫu sang hợp đồng animal-*

**Files:**
- Create: `scripts/migrate-svg-ids.mjs`
- Create: `tests/svg-engine/migrate-svg-ids.test.ts`
- Create: `tests/fixtures/svg/angler-fish.svg` (sinh ra, commit)
- Create: `tests/fixtures/svg/crocodile.svg` (sinh ra, commit)
- Create: `tests/svg-engine/fixtures.test.ts`

**Interfaces:**
- Consumes: `validateSvgContract` từ `@/svg-engine/validate`; `parseSvg` từ `tests/helpers/svgDom`
- Produces: `migrateSvgIds(source: string): { svg: string; renamed: string[] }` export từ `scripts/migrate-svg-ids.mjs`

**Bối cảnh:** hai file mockup nguyên mẫu vẫn dùng bộ ID `fish-*`. Guide §2 bắt buộc đổi sang `animal-*` và **cấm** duy trì song song. Đây là migration một lần, nhưng script được commit vì sẽ còn file cũ khác cần chạy qua.

Đo được trước khi bắt đầu — `fish.svg` có 12 ID `fish-*`, `crocodile.svg` có 7; tham chiếu gồm `href="#fish-shape"` (3 lần mỗi file), `url(#fish-clip)` (1 lần mỗi file), và riêng crocodile thêm `url(#fish-eyes-clip)`.

⚠️ **Chỉ đổi bên trong ba ngữ cảnh**: `id="fish-…"`, `href="#fish-…"`, `url(#fish-…)`. Đừng thay chuỗi `fish-` ở nơi khác — comment, class, hay `data-*` không thuộc hợp đồng và đổi bừa là sửa thứ không ai yêu cầu.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/migrate-svg-ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { migrateSvgIds } from "../../scripts/migrate-svg-ids.mjs";

describe("migrateSvgIds", () => {
  it("renames ids, href targets and url() references together", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
      <image id="fish-artwork" clip-path="url(#fish-clip)"/>
      <g id="fish-outline"><use href="#fish-shape"/></g>
    </svg>`;

    const { svg, renamed } = migrateSvgIds(source);

    expect(svg).toContain(`id="animal-shape"`);
    expect(svg).toContain(`id="animal-clip"`);
    expect(svg).toContain(`id="animal-artwork"`);
    expect(svg).toContain(`href="#animal-shape"`);
    expect(svg).toContain(`url(#animal-clip)`);
    expect(svg).not.toContain("fish-");
    expect(renamed.sort()).toEqual(["fish-artwork", "fish-clip", "fish-outline", "fish-shape"]);
  });

  it("leaves ids that are not fish-prefixed alone", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="wallet-body-shape" d="M0 0h1v1H0z"/>
      <clipPath id="wallet-body-clip"><use href="#wallet-body-shape"/></clipPath>
      <g id="stitches" fill="var(--wallet-stitches)"></g>
    </svg>`;
    const { svg, renamed } = migrateSvgIds(source);
    expect(svg).toBe(source);
    expect(renamed).toEqual([]);
  });

  it("does not touch the word fish outside id, href and url contexts", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <!-- the fish-shaped applique sits above the body -->
      <g class="fish-layer" data-note="fish-thing"><path id="fish-shape" d="M0 0h1v1H0z"/></g>
    </svg>`;
    const { svg } = migrateSvgIds(source);
    expect(svg).toContain("the fish-shaped applique");
    expect(svg).toContain(`class="fish-layer"`);
    expect(svg).toContain(`data-note="fish-thing"`);
    expect(svg).toContain(`id="animal-shape"`);
  });

  it("is idempotent — running it on migrated output changes nothing", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview">
      <path id="fish-shape" d="M0 0h1v1H0z"/>
      <clipPath id="fish-clip"><use href="#fish-shape"/></clipPath>
    </svg>`;
    const once = migrateSvgIds(source);
    const twice = migrateSvgIds(once.svg);
    expect(twice.svg).toBe(once.svg);
    expect(twice.renamed).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- migrate-svg-ids`
Expected: FAIL — không resolve được `scripts/migrate-svg-ids.mjs`

- [ ] **Step 3: Viết script migration**

Tạo `scripts/migrate-svg-ids.mjs`:

```js
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- migrate-svg-ids`
Expected: PASS — 4 test

- [ ] **Step 4b: Xác nhận typecheck vẫn sạch dù test import một file .mjs**

Run: `npx tsc --noEmit`
Expected: không lỗi. `tsconfig.json` đã bật `allowJs: true` nên TypeScript suy kiểu được từ file `.mjs`, và repo đã có tiền lệ script `.mjs` (`scripts/bundle-extension.mjs`, `prisma/seed.mjs`).

Nếu tsc báo không tìm được khai báo kiểu cho import này, **báo lại vấn đề** — đừng dập bằng `@ts-ignore` hay `any`. Có đường sửa sạch (chuyển logic sang `src/svg-engine/migrateIds.ts` rồi để `.mjs` chỉ còn là CLI mỏng), nhưng nó đổi cấu trúc file nên cần controller quyết.

- [ ] **Step 5: Sinh hai fixture từ master nguyên mẫu**

```bash
mkdir -p tests/fixtures/svg
node scripts/migrate-svg-ids.mjs \
  "/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/assets/mockups/fish.svg" \
  tests/fixtures/svg/angler-fish.svg
node scripts/migrate-svg-ids.mjs \
  "/Users/nguyenvanthien/Desktop/wildandking custom stupid animal/test svg/assets/mockups/crocodile.svg" \
  tests/fixtures/svg/crocodile.svg
```

Expected: dòng đầu báo đổi **12** id, dòng sau báo đổi **7** id.

Nếu đường dẫn nguồn không tồn tại, **dừng và báo BLOCKED** — đừng tự dựng SVG thay thế. Hai file này là master đã qua kiểm tra trực quan; một bản tự chế sẽ làm mọi test hợp đồng phía sau thành vô nghĩa.

- [ ] **Step 6: Viết test khẳng định fixture thật sự hợp lệ**

Tạo `tests/svg-engine/fixtures.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

const FIXTURES = ["angler-fish", "crocodile"] as const;

function load(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
}

describe.each(FIXTURES)("fixture %s", (name) => {
  const source = load(name);

  it("satisfies the animal-* contract", () => {
    const report = validateSvgContract(parseSvg(source));
    const failed = report.checks.filter((check) => check.status !== "ok" && check.status !== "warning");
    expect(failed).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("retains no legacy fish-* identifiers or references", () => {
    expect(source).not.toMatch(/\bid="fish-/);
    expect(source).not.toMatch(/href="#fish-/);
    expect(source).not.toMatch(/url\(#fish-/);
  });

  it("declares a viewBox", () => {
    expect(validateSvgContract(parseSvg(source)).viewBox).toMatch(/^[\d.\s-]+$/);
  });

  it("keeps the stitch group wired to the colour variable", () => {
    const stitches = parseSvg(source).querySelector(`[id="stitches"]`)!;
    expect(stitches.getAttribute("fill")).toContain("var(--wallet-stitches)");
  });
});
```

- [ ] **Step 7: Chạy test để xác nhận pass**

Run: `npm test -- fixtures`
Expected: PASS — 8 test (4 assertion × 2 fixture)

Nếu một fixture **fail** validator, đó là tín hiệu có giá trị chứ không phải phiền toái: nó nghĩa là master nguyên mẫu chưa thoả hợp đồng ngay cả sau khi đổi ID. Ghi lại ID nào fail và **báo DONE_WITH_CONCERNS** kèm báo cáo validator — đừng nới lỏng validator để file đi qua.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-svg-ids.mjs tests/svg-engine/migrate-svg-ids.test.ts \
        tests/fixtures/svg/angler-fish.svg tests/fixtures/svg/crocodile.svg \
        tests/svg-engine/fixtures.test.ts
git commit -m "feat(svg-engine): migrate mockup mẫu sang hợp đồng animal-*

Guide §2 bắt buộc đổi fish-* sang animal-* và cấm duy trì song song hai bộ
ID. Script chỉ chạm id=, href=\"#\" và url(#) — comment, class, data-* giữ
nguyên vì chúng không thuộc hợp đồng.

Hai master đã migrate được commit làm fixture, kèm test khẳng định chúng
thật sự qua validator — nếu không, mọi test hợp đồng phía sau là vô nghĩa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Sanitizer server-side

**Files:**
- Create: `src/svg-engine/sanitize.ts`
- Create: `tests/svg-engine/sanitize.test.ts`

**Interfaces:**
- Consumes: không có (thao tác DOM thuần)
- Produces:
  - `interface SanitizeReport { removedElements: string[]; removedAttributes: string[]; externalRefs: string[] }`
  - `sanitizeSvgRoot(root: Element): SanitizeReport` — **mutate** root tại chỗ, trả về những gì đã gỡ

**Rủi ro nó đóng (spec §13.2 S1):** admin inline SVG chưa lọc vào trang admin. Một `<script>` hay `onload=` trong file upload sẽ chạy trong ngữ cảnh Shopify Admin — nơi có session token. Sanitize **lúc upload** và lưu bản đã lọc, để storefront và admin không bao giờ chạm bản gốc.

**Quy tắc:**
- Gỡ hẳn: `<script>`, `<foreignObject>`, **tất cả SMIL** (`<animate>`, `<set>`, `<animateTransform>`, `<animateMotion>` — loại bỏ vô điều kiện, không chỉ khi có `attributeName="href"`), `<use>` trỏ ra ngoài tài liệu.
- Gỡ thuộc tính: mọi `on*`, `xlink:href`/`href` mang scheme `javascript:` hoặc `data:text/html` **sau khi chuẩn hoá** (gỡ `\t`, `\n`, `\r` theo WHATWG parser).
- Ghi nhận (không gỡ) URL ngoài trong `href`/`url()` để caller quyết định — texture hợp lệ chính là URL ngoài. Loại bỏ SMIL vô điều kiện vì product chỉ render mockup tĩnh, hai fixture thật không dùng nó; nếu có file mới animate, admin sẽ thấy nó trong report `removedElements`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/sanitize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeSvgRoot } from "@/svg-engine/sanitize";
import { parseSvg } from "../helpers/svgDom";

describe("sanitizeSvgRoot", () => {
  it("removes script elements", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g id="stitches"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("script")).toBeNull();
    expect(report.removedElements).toContain("script");
  });

  it("removes foreignObject elements", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector("foreignObject")).toBeNull();
    expect(report.removedElements).toContain("foreignObject");
  });

  it("strips every inline event handler regardless of case", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g id="a" onload="steal()" ONCLICK="x()" onMouseOver="y()"/></svg>`);
    const report = sanitizeSvgRoot(root);
    const g = root.querySelector(`[id="a"]`)!;
    expect(g.getAttributeNames().filter((name) => name.toLowerCase().startsWith("on"))).toEqual([]);
    expect(report.removedAttributes).toHaveLength(3);
  });

  it("strips javascript: and data:text/html hrefs but keeps ordinary ones", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <a id="evil" href="javascript:alert(1)"/>
      <a id="alsoEvil" href="data:text/html;base64,PHNjcmlwdD4="/>
      <image id="fine" href="https://cdn.example/leather.webp"/>
      <use id="internal" href="#animal-shape"/>
    </svg>`);
    sanitizeSvgRoot(root);
    expect(root.querySelector(`[id="evil"]`)!.hasAttribute("href")).toBe(false);
    expect(root.querySelector(`[id="alsoEvil"]`)!.hasAttribute("href")).toBe(false);
    expect(root.querySelector(`[id="fine"]`)!.getAttribute("href")).toBe("https://cdn.example/leather.webp");
    expect(root.querySelector(`[id="internal"]`)!.getAttribute("href")).toBe("#animal-shape");
  });

  it("records external references without removing them", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image id="fine" href="https://cdn.example/leather.webp"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(report.externalRefs).toEqual(["https://cdn.example/leather.webp"]);
    expect(root.querySelector(`[id="fine"]`)!.hasAttribute("href")).toBe(true);
  });

  it("leaves a clean document byte-identical in structure", () => {
    const clean = `<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"><path id="animal-shape" d="M0 0h1v1H0z"/><g id="stitches" fill="var(--wallet-stitches)"/></svg>`;
    const root = parseSvg(clean);
    const report = sanitizeSvgRoot(root);
    expect(report).toEqual({ removedElements: [], removedAttributes: [], externalRefs: [] });
    expect(root.querySelector(`[id="animal-shape"]`)).not.toBeNull();
    expect(root.querySelector(`[id="stitches"]`)).not.toBeNull();
  });

  it("removes a use element that points at another document", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><use id="external" href="https://evil.example/x.svg#a"/><use id="local" href="#animal-shape"/></svg>`);
    const report = sanitizeSvgRoot(root);
    expect(root.querySelector(`[id="external"]`)).toBeNull();
    expect(root.querySelector(`[id="local"]`)).not.toBeNull();
    expect(report.removedElements).toContain("use");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- sanitize`
Expected: FAIL — `Failed to resolve import "@/svg-engine/sanitize"`

- [ ] **Step 3: Viết implementation**

Tạo `src/svg-engine/sanitize.ts`:

```ts
export interface SanitizeReport {
  /** localName của các phần tử đã bị gỡ */
  removedElements: string[];
  /** "localName@attributeName" của các thuộc tính đã bị gỡ */
  removedAttributes: string[];
  /** URL tuyệt đối còn lại — hợp lệ (texture), ghi nhận để caller quyết định */
  externalRefs: string[];
}

const FORBIDDEN_ELEMENTS = new Set(["script", "foreignobject", "animate", "set", "animatetransform", "animatemotion"]);
const HREF_ATTRIBUTES = ["href", "xlink:href"];
const DANGEROUS_SCHEME = /^(javascript:|data:text\/html)/i;

function normalizeForSchemeCheck(value: string): string {
  // Remove ASCII whitespace chars (tab, line-feed, carriage-return) that WHATWG URL parser strips.
  // This prevents bypass attacks like "java\tscript:" which the browser normalizes to "javascript:".
  return value.replace(/[\t\n\r]/g, "");
}

function isEventHandler(name: string): boolean {
  return name.toLowerCase().startsWith("on");
}

function isExternal(value: string): boolean {
  // Only http(s) and protocol-relative URLs are recorded as external refs for caller allowlisting.
  // This is intentionally narrower than the <use> check which blocks all non-fragments,
  // since <use> can load external SVG with code, while http(s) refs are texture URLs.
  return /^(https?:)?\/\//i.test(value.trim());
}

function extractUrlReferences(value: string): string[] {
  const urls: string[] = [];

  // Match url() in three forms:
  // 1. url("...") - double quoted (unambiguous)
  let pattern = /url\s*\(\s*"([^"]*)"\s*\)/gi;
  let m;
  while ((m = pattern.exec(value)) !== null) {
    urls.push(m[1]);
  }

  // 2. url('...') - single quoted (unambiguous)
  pattern = /url\s*\(\s*'([^']*)'\s*\)/gi;
  while ((m = pattern.exec(value)) !== null) {
    urls.push(m[1]);
  }

  // 3. url(...) - unquoted (matches everything until first closing paren)
  // Note: unquoted URLs can have function calls like javascript:alert(1)
  pattern = /url\s*\(\s*([^)]*)\s*\)/gi;
  while ((m = pattern.exec(value)) !== null) {
    urls.push(m[1]);
  }

  return urls;
}

/**
 * Lọc một SVG đã parse tại chỗ, trước khi nó được lưu hoặc inline vào DOM.
 *
 * Rủi ro nó đóng (spec §13.2 S1): admin upload một file có <script> hoặc
 * onload=, file đó được inline vào trang admin, và script chạy trong ngữ cảnh
 * Shopify Admin nơi có session token. Sanitize LÚC UPLOAD và chỉ lưu bản đã
 * lọc, để không tầng nào phía sau chạm bản gốc.
 *
 * URL ngoài KHÔNG bị gỡ — texture hợp lệ chính là URL ngoài. Chúng được ghi
 * nhận để caller tự quyết định theo allowlist của mình.
 *
 * SMIL loại bỏ vô điều kiện vì product chỉ render mockup tĩnh. Nếu file mới
 * animate, admin sẽ thấy nó trong removedElements.
 */
export function sanitizeSvgRoot(root: Element): SanitizeReport {
  const report: SanitizeReport = {
    removedElements: [],
    removedAttributes: [],
    externalRefs: [],
  };

  // Duyệt một bản chụp: cây bị sửa trong lúc duyệt.
  const elements = [root, ...Array.from(root.querySelectorAll("*"))] as Element[];

  for (const element of elements) {
    const name = element.localName.toLowerCase();

    if (FORBIDDEN_ELEMENTS.has(name)) {
      report.removedElements.push(element.localName);
      element.parentNode?.removeChild(element);
      continue;
    }

    // <use> trỏ sang tài liệu khác kéo nội dung ngoài vào cây — luôn gỡ.
    if (name === "use") {
      const target = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
      if (target && !target.startsWith("#")) {
        report.removedElements.push(element.localName);
        element.parentNode?.removeChild(element);
        continue;
      }
    }

    // Process all attributes
    const attrNames = [...element.getAttributeNames()];
    for (const attribute of attrNames) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;

      // Check for event handlers
      if (isEventHandler(attribute)) {
        report.removedAttributes.push(`${element.localName}@${attribute}`);
        element.removeAttribute(attribute);
        continue;
      }

      // Check href attributes for dangerous schemes
      if (HREF_ATTRIBUTES.includes(attribute)) {
        const normalized = normalizeForSchemeCheck(value);
        if (DANGEROUS_SCHEME.test(normalized)) {
          report.removedAttributes.push(`${element.localName}@${attribute}`);
          element.removeAttribute(attribute);
          continue;
        }

        if (isExternal(value)) {
          report.externalRefs.push(value);
        }
        continue;
      }

      // Check for url(...) references in any attribute
      if (value.includes("url(")) {
        const urlRefs = extractUrlReferences(value);
        let hasDangerous = false;
        for (const urlRef of urlRefs) {
          const normalized = normalizeForSchemeCheck(urlRef);
          if (DANGEROUS_SCHEME.test(normalized)) {
            hasDangerous = true;
            break;
          } else if (isExternal(urlRef)) {
            report.externalRefs.push(urlRef);
          }
        }
        if (hasDangerous) {
          report.removedAttributes.push(`${element.localName}@${attribute}`);
          element.removeAttribute(attribute);
        }
      }
    }
  }

  return report;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- sanitize`
Expected: PASS — 7 test

- [ ] **Step 5: Xác nhận sanitizer không phá hai fixture thật**

Run: `npm test -- fixtures`
Expected: PASS — vẫn 8 test như Task 6. Nếu fail, sanitizer đang gỡ nhầm thứ hợp lệ.

Thêm vào `tests/svg-engine/sanitize.test.ts` một khối cuối:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSvgContract } from "@/svg-engine/validate";

describe("sanitizeSvgRoot on real mockups", () => {
  it.each(["angler-fish", "crocodile"])("leaves %s contract-valid and removes nothing", (name) => {
    const source = readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
    const root = parseSvg(source);
    const report = sanitizeSvgRoot(root);
    expect(report.removedElements).toEqual([]);
    expect(report.removedAttributes).toEqual([]);
    expect(validateSvgContract(root).valid).toBe(true);
  });
});
```

Run: `npm test -- sanitize`
Expected: PASS — 9 test

- [ ] **Step 6: Commit**

```bash
git add src/svg-engine/sanitize.ts tests/svg-engine/sanitize.test.ts
git commit -m "feat(svg-engine): sanitize SVG upload trước khi lưu

Đóng spec §13.2 S1: SVG upload chưa lọc được inline vào trang admin sẽ
chạy script trong ngữ cảnh có session token. Gỡ script, foreignObject,
mọi on*, scheme javascript:/data:text/html, và <use> trỏ sang tài liệu khác.

URL ngoài KHÔNG bị gỡ — texture hợp lệ chính là URL ngoài — mà được ghi
nhận để caller áp allowlist riêng.

Kèm test khẳng định sanitizer không đụng gì trên hai mockup thật.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Baked design SVG + public API

**Files:**
- Create: `src/svg-engine/bake.ts`
- Create: `src/svg-engine/index.ts`
- Create: `tests/svg-engine/bake.test.ts`
- Create: `tests/svg-engine/index.test.ts`

**Interfaces:**
- Consumes: `applyTexture`, `applyStitchColor` từ `./apply`; `validateSvgContract` từ `./validate`
- Produces:
  - `interface BakeInput { bodyTextureUrl: string; animalTextureUrl: string; stitchHex: string }`
  - `class BakeError extends Error`
  - `bakeDesign(root: Element, input: BakeInput): void` — mutate; throws `BakeError` nếu contract không hợp lệ hoặc hex không hợp lệ
  - `src/svg-engine/index.ts` re-export toàn bộ public API

**Vì sao bake (spec §6.6):** lưu một SVG hoàn chỉnh với texture và màu chỉ ghi cứng, để đơn hàng cũ vẫn mở đúng hình đã bán kể cả khi admin thay master sau này. Dedupe theo sha256 nên storage tăng theo **số tổ hợp**, không theo **số đơn**.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/svg-engine/bake.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BakeError, bakeDesign } from "@/svg-engine/bake";
import { readCssVar } from "@/svg-engine/css";
import { validateSvgContract } from "@/svg-engine/validate";
import { parseSvg } from "../helpers/svgDom";

const input = {
  bodyTextureUrl: "https://cdn.example/texture/suede-brown.webp",
  animalTextureUrl: "https://cdn.example/texture/togo-brown.webp",
  stitchHex: "#e7c337",
};

function realMockup(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/svg/${name}.svg`, import.meta.url)), "utf8");
}

describe("bakeDesign", () => {
  it("writes both textures and the stitch colour into a real mockup", () => {
    const root = parseSvg(realMockup("angler-fish"));
    bakeDesign(root, input);

    expect(root.querySelector(`[id="body-artwork"]`)!.getAttribute("href")).toBe(input.bodyTextureUrl);
    expect(root.querySelector(`[id="animal-artwork"]`)!.getAttribute("href")).toBe(input.animalTextureUrl);
    expect(readCssVar(root, "--wallet-stitches")).toBe("#E7C337");
  });

  it("reveals both artwork layers so the baked file renders standalone", () => {
    const root = parseSvg(realMockup("crocodile"));
    bakeDesign(root, input);
    for (const id of ["body-artwork", "animal-artwork"]) {
      const image = root.querySelector(`[id="${id}"]`)!;
      expect(image.hasAttribute("hidden")).toBe(false);
      expect(image.getAttribute("visibility")).toBe("visible");
    }
  });

  it("keeps the result contract-valid", () => {
    const root = parseSvg(realMockup("angler-fish"));
    bakeDesign(root, input);
    expect(validateSvgContract(root).valid).toBe(true);
  });

  it("is deterministic — same input yields identical output", () => {
    const a = parseSvg(realMockup("angler-fish"));
    const b = parseSvg(realMockup("angler-fish"));
    bakeDesign(a, input);
    bakeDesign(b, input);
    expect(a.outerHTML).toBe(b.outerHTML);
  });

  it("refuses a mockup that does not satisfy the contract", () => {
    const root = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="wallet-preview"></svg>`);
    expect(() => bakeDesign(root, input)).toThrow(BakeError);
  });

  it("refuses an invalid stitch colour rather than writing a broken value", () => {
    const root = parseSvg(realMockup("angler-fish"));
    expect(() => bakeDesign(root, { ...input, stitchHex: "rebeccapurple" })).toThrow(BakeError);
    expect(readCssVar(root, "--wallet-stitches")).not.toBe("rebeccapurple");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- bake`
Expected: FAIL — `Failed to resolve import "@/svg-engine/bake"`

- [ ] **Step 3: Viết implementation**

Tạo `src/svg-engine/bake.ts`:

```ts
import { applyStitchColor, applyTexture } from "./apply";
import { validateSvgContract } from "./validate";

export interface BakeInput {
  bodyTextureUrl: string;
  animalTextureUrl: string;
  stitchHex: string;
}

export class BakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BakeError";
  }
}

/**
 * Ghi cứng texture và màu chỉ vào một mockup, tạo bản SVG độc lập của một design.
 *
 * Vì sao cần (spec §6.6): đơn hàng cũ vẫn phải mở ra đúng hình đã bán kể cả khi
 * admin thay master SVG của tổ hợp đó về sau. Kết quả deterministic nên hai đơn
 * cùng tổ hợp cho ra cùng một chuỗi byte, và ràng buộc unique theo sha256 tự
 * dedupe — storage tăng theo số TỔ HỢP, không theo số ĐƠN.
 *
 * Mutate `root` tại chỗ; caller serialize.
 */
export function bakeDesign(root: Element, input: BakeInput): void {
  const report = validateSvgContract(root);
  if (!report.valid) {
    const broken = report.checks
      .filter((check) => check.status !== "ok" && check.status !== "warning")
      .map((check) => `${check.id}:${check.status}`)
      .join(", ");
    throw new BakeError(`Mockup does not satisfy the contract (${broken})`);
  }

  applyTexture(root, "body", input.bodyTextureUrl);
  applyTexture(root, "animal", input.animalTextureUrl);

  if (applyStitchColor(root, input.stitchHex) === null) {
    throw new BakeError(`Invalid stitch colour: ${String(input.stitchHex)}`);
  }
}
```

- [ ] **Step 4: Viết public API và test của nó**

Tạo `src/svg-engine/index.ts`:

```ts
export {
  ARTWORK_TARGET_IDS,
  CONTRACT_VERSION,
  LEGACY_ID_PREFIX,
  REQUIRED_ELEMENTS,
  STITCH_CSS_VAR,
  SVG_NAMESPACE,
  SVG_ROOT_ID,
  type ArtworkTarget,
} from "./contract";

export { normalizeHex } from "./colors";
export { readCssVar, writeCssVar } from "./css";
export {
  validateSvgContract,
  type CheckStatus,
  type ContractCheck,
  type ValidationReport,
} from "./validate";
export { MissingTargetError, applyStitchColor, applyTexture } from "./apply";
export { createMockupLoader, type LoadOutcome } from "./loader";
export { sanitizeSvgRoot, type SanitizeReport } from "./sanitize";
export { BakeError, bakeDesign, type BakeInput } from "./bake";
```

Tạo `tests/svg-engine/index.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as engine from "@/svg-engine";

const SRC_DIR = fileURLToPath(new URL("../../src/svg-engine/", import.meta.url));

describe("svg-engine public API", () => {
  it("exports every documented entry point", () => {
    for (const name of [
      "CONTRACT_VERSION",
      "SVG_ROOT_ID",
      "STITCH_CSS_VAR",
      "ARTWORK_TARGET_IDS",
      "REQUIRED_ELEMENTS",
      "normalizeHex",
      "readCssVar",
      "writeCssVar",
      "validateSvgContract",
      "applyTexture",
      "applyStitchColor",
      "MissingTargetError",
      "createMockupLoader",
      "sanitizeSvgRoot",
      "bakeDesign",
      "BakeError",
    ]) {
      expect(engine).toHaveProperty(name);
    }
  });

  it("stays free of framework and environment coupling", () => {
    const forbidden = [/from ["']react/, /from ["']next/, /from ["']@prisma/, /process\.env/];
    for (const file of readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(SRC_DIR + file, "utf8");
      for (const pattern of forbidden) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("never parses SVG itself — callers supply the document", () => {
    for (const file of readdirSync(SRC_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(SRC_DIR + file, "utf8");
      expect(source, `${file} must not construct a DOMParser`).not.toMatch(/new DOMParser/);
    }
  });
});
```

Test thứ hai và thứ ba là **hàng rào kiến trúc**: chúng làm ràng buộc "engine là thư viện thuần, không tự parse" thành thứ CI bắt được, thay vì một dòng ghi chú người ta quên.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS — 43 test của P0 cộng toàn bộ test của P1a, không có warning lạ.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: không có lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/svg-engine/bake.ts src/svg-engine/index.ts \
        tests/svg-engine/bake.test.ts tests/svg-engine/index.test.ts
git commit -m "feat(svg-engine): baked design SVG và public API

bakeDesign ghi cứng texture + màu chỉ vào mockup để đơn hàng cũ vẫn mở
đúng hình đã bán khi admin thay master về sau. Deterministic nên hai đơn
cùng tổ hợp cho cùng chuỗi byte và tự dedupe theo sha256.

index.test.ts là hàng rào kiến trúc: nó biến ràng buộc \"engine là thư
viện thuần, không tự parse\" thành thứ CI bắt được thay vì một ghi chú
người ta quên.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Gate nghiệm thu P1a

- [ ] `npm test` — toàn bộ xanh, output sạch, không warning lạ
- [ ] `npx tsc --noEmit` — không lỗi
- [ ] `npm run build` — thành công
- [ ] `grep -rn "from \"react\"\|from \"next\|process\.env" src/svg-engine/` — không kết quả
- [ ] `grep -rn "new DOMParser" src/svg-engine/` — không kết quả
- [ ] `grep -rn "fish-" tests/fixtures/svg/` — không kết quả
- [ ] Hai fixture qua `validateSvgContract` với `valid === true`
- [ ] `sanitizeSvgRoot` chạy trên hai fixture thật gỡ **không** thứ gì

## Ngoài phạm vi P1a

Những thứ này thuộc plan khác, đừng làm ở đây:
- Prisma schema, `src/shared/` zod, Supabase Storage, hằng số Shopify API version → **P1b**
- Admin UI, bộ sinh variant → **P2**
- App Block, Shadow DOM, React wrapper quanh engine → **P3**
- Upload SVG thật lên Storage → P2 (P1a chỉ có fixture trong repo)
