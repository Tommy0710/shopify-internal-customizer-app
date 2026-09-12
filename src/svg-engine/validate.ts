import {
  ARTWORK_CLIP_BINDINGS,
  CONTRACT_VERSION,
  LEGACY_ID_PREFIX,
  REQUIRED_ELEMENTS,
  STITCH_CSS_VAR,
  SVG_NAMESPACE,
  SVG_ROOT_ID,
} from "./contract";
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_ELEMENTS,
  HREF_ATTRIBUTES,
  extractUrlReferences,
  foreignUseTarget,
  fragmentIdOf,
  isAllowedUrlValue,
  unsafeNodeName,
} from "./policy";

export type CheckStatus =
  | "ok"
  | "missing"
  | "duplicate"
  | "wrong-element"
  | "warning"
  /** artwork không được cắt bởi clipPath tương ứng (guide §8, §13) */
  | "unlinked"
  /** clipPath tồn tại nhưng rỗng — cắt sạch mọi thứ */
  | "empty"
  /** href="#..." hoặc url(#...) trỏ tới ID không tồn tại */
  | "dangling-ref"
  /** script, event handler inline, hoặc tài nguyên ngoài không tin cậy */
  | "unsafe";

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

/** ID của các check không gắn với một phần tử hợp đồng cụ thể. */
export const REFERENCE_CHECK_ID = "references";
export const SAFETY_CHECK_ID = "safety";

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

/** Mọi phần tử của tài liệu, root trước. */
function everyElement(root: Element): Element[] {
  return [root, ...(Array.from(root.querySelectorAll("*")) as Element[])];
}

/**
 * Phần tử duy nhất mang ID này, hoặc `null` khi vắng mặt / trùng lặp.
 * Selector luôn dựng từ hằng số compile-time, không bao giờ từ input (guide §8).
 */
function uniqueById(root: Element, id: string): Element | null {
  const matches = root.getAttribute("id") === id ? [root] : [];
  matches.push(...(Array.from(root.querySelectorAll(`[id="${id}"]`)) as Element[]));
  return matches.length === 1 ? matches[0] : null;
}

/** Mọi giá trị thuộc tính có thể mang URL, kèm ngữ cảnh để báo lỗi. */
function urlValuesOf(element: Element): Array<{ attribute: string; value: string }> {
  const values: Array<{ attribute: string; value: string }> = [];
  for (const attribute of element.getAttributeNames()) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    if (HREF_ATTRIBUTES.includes(attribute)) {
      values.push({ attribute, value });
      continue;
    }
    // Không có cổng `value.includes("url(")` đứng trước: nó phân biệt hoa
    // thường trong khi tên hàm CSS thì không, nên `URL(#khong-ton-tai)` từng
    // qua được cả check này lẫn `checkSafety`. `extractUrlReferences` là định
    // nghĩa duy nhất, dùng chung với `sanitizeSvgRoot`.
    for (const reference of extractUrlReferences(value)) {
      values.push({ attribute, value: reference });
    }
  }
  return values;
}

/**
 * Guide §8: "tất cả `href="#..."` và `url(#...)` trỏ tới ID tồn tại".
 *
 * Vì sao là lỗi chứ không phải cảnh báo: `clip-path="url(#khong-ton-tai)"`
 * khiến phần tử KHÔNG render — artwork biến mất mà không có dấu hiệu nào.
 */
function checkReferences(root: Element, elements: Element[]): ContractCheck {
  const ids = new Set<string>();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id) ids.add(id);
  }

  const dangling: string[] = [];
  for (const element of elements) {
    for (const { attribute, value } of urlValuesOf(element)) {
      const fragment = fragmentIdOf(value);
      if (fragment !== null && !ids.has(fragment)) {
        dangling.push(`<${element.localName} ${attribute}="#${fragment}">`);
      }
    }
  }

  if (dangling.length === 0) {
    return { id: REFERENCE_CHECK_ID, status: "ok" };
  }

  return {
    id: REFERENCE_CHECK_ID,
    status: "dangling-ref",
    hint: `${dangling.length} reference(s) point at ids that do not exist: ${dangling
      .slice(0, 5)
      .join(", ")}. An element with a dangling clip-path or href does not render at all.`,
  };
}

/**
 * Guide §8: "không có script, event handler inline hoặc external resource
 * không được tin cậy".
 *
 * Đây là CỔNG THỨ HAI, độc lập với sanitize: nếu sanitize có lỗ thì tài liệu
 * vẫn phải bị chặn ở đây trước khi hiển thị hoặc bake. Cả hai dùng chung
 * allowlist trong `./policy`, nên đúng một định nghĩa "an toàn" tồn tại — và
 * check này tương đương câu "sanitize sẽ không gỡ gì khỏi tài liệu này".
 *
 * Sự tương đương đó là một khẳng định phải KIỂM CHỨNG ĐƯỢC, không phải một
 * khẩu hiệu, và nó đã hỏng hai lần theo cùng một kiểu: một luật chỉ tồn tại
 * bên phía sanitize. Lần một là node không phải phần tử (comment, PI, CDATA);
 * lần hai là `<use>` trỏ ra ngoài tài liệu. Mỗi luật giờ nằm trong `./policy`
 * và được ĐỌC từ đó ở cả hai bên, và
 * `tests/svg-engine/validate.test.ts` có bảng khẳng định
 * `safety === "unsafe"` KHI VÀ CHỈ KHI sanitize gỡ thứ gì đó. Thêm luật mới
 * vào một bên mà không thêm vào bảng đó là cách con bug này quay lại.
 *
 * URL `https:` ngoài KHÔNG bị coi là không tin cậy ở tầng này: texture da hợp
 * lệ là URL ngoài, và bản đã bake luôn chứa hai cái. Việc lọc theo host là
 * allowlist của caller, dựa trên `SanitizeReport.externalRefs`.
 */
function checkSafety(elements: Element[]): ContractCheck {
  const offenders: string[] = [];

  for (const element of elements) {
    if (!ALLOWED_ELEMENTS.has(element.localName.toLowerCase())) {
      offenders.push(`<${element.localName}>`);
      continue;
    }
    // `<use>` trỏ ra ngoài tài liệu. `isAllowedUrlValue("https://…")` trả true
    // một cách chính đáng — texture da hợp lệ LÀ một URL ngoài — nên vòng URL
    // bên dưới không bao giờ bắt được nó, và trước bản vá này một
    // `<use href="https://evil.example/x.svg#a">` đi qua với `safety: ok`
    // trong khi sanitize gỡ nó. Cùng một quy tắc, đọc từ cùng một chỗ.
    const foreignUse = foreignUseTarget(element);
    if (foreignUse !== null) {
      offenders.push(`<use href="${foreignUse.slice(0, 40)}">`);
      continue;
    }
    // Node không phải phần tử. `elements` chỉ chứa phần tử, nhưng mọi node khác
    // trong cây là con trực tiếp của một phần tử nào đó trong danh sách, nên
    // vòng này phủ hết. Thiếu nó, khẳng định ở đầu hàm — "an toàn nghĩa là
    // sanitize sẽ không gỡ gì" — sai với đúng loại node nguy hiểm nhất: một
    // comment chứa `--!>` mở ra `<script>` khi markup được inline vào HTML.
    for (const child of Array.from(element.childNodes)) {
      const nodeName = unsafeNodeName(child);
      if (nodeName !== null) {
        offenders.push(`${nodeName} in <${element.localName}>`);
      }
    }
    for (const attribute of element.getAttributeNames()) {
      if (!ALLOWED_ATTRIBUTES.has(attribute)) {
        offenders.push(`<${element.localName} ${attribute}>`);
      }
    }
    for (const { attribute, value } of urlValuesOf(element)) {
      if (!isAllowedUrlValue(value)) {
        offenders.push(`<${element.localName} ${attribute}="${value.slice(0, 40)}">`);
      }
    }
  }

  if (offenders.length === 0) {
    return { id: SAFETY_CHECK_ID, status: "ok" };
  }

  return {
    id: SAFETY_CHECK_ID,
    status: "unsafe",
    hint: `${offenders.length} element(s), node(s), attribute(s) or URL(s) are outside the safe allowlist: ${offenders
      .slice(0, 5)
      .join(", ")}. Sanitize the file before using it.`,
  };
}

/** Guide §8 + §13: artwork phải được cắt bởi đúng clipPath, và clipPath phải có nội dung. */
function checkArtworkClipping(root: Element): ContractCheck[] {
  const checks: ContractCheck[] = [];

  for (const binding of ARTWORK_CLIP_BINDINGS) {
    const clip = uniqueById(root, binding.clipId);
    const artwork = uniqueById(root, binding.artworkId);

    if (artwork) {
      // Chấp nhận cả hai cách viết hợp lệ: thuộc tính trình bày `clip-path` và
      // khai báo tương đương trong `style`.
      const references = [
        artwork.getAttribute("clip-path") ?? "",
        artwork.getAttribute("style") ?? "",
      ]
        .flatMap((value) => extractUrlReferences(value))
        .map((value) => fragmentIdOf(value))
        .filter((fragment): fragment is string => fragment !== null);

      checks.push(
        references.includes(binding.clipId)
          ? { id: `${binding.artworkId}/clip-path`, status: "ok" }
          : {
              id: `${binding.artworkId}/clip-path`,
              status: "unlinked",
              hint: `#${binding.artworkId} must carry clip-path="url(#${binding.clipId})"; without it the artwork renders as a rectangle covering the whole canvas.`,
            },
      );
    }

    if (clip) {
      checks.push(
        clip.children.length > 0
          ? { id: `${binding.clipId}/contents`, status: "ok" }
          : {
              id: `${binding.clipId}/contents`,
              status: "empty",
              hint: `<clipPath id="${binding.clipId}"> has no child shape; an empty clipPath clips everything away, so #${binding.artworkId} renders as nothing.`,
            },
      );
    }
  }

  return checks;
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
  // clipPath và <use> sẽ không hoạt động. Namespace được lấy từ chính DOM;
  // engine KHÔNG bao giờ tự đọc thuộc tính `xmlns` để bù, đó là việc của tầng
  // parse (`src/lib/svg/parseSvgNode.ts` cho Node).
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

  const elements = everyElement(root);

  for (const required of REQUIRED_ELEMENTS) {
    // Root mang ID gốc; querySelectorAll không bao giờ trả về chính root, nên
    // một phần tử lồng bên trong dùng lại ID đó phải được cộng vào thủ công —
    // nếu không, `<g id="wallet-preview">` lọt qua như thể không trùng.
    const descendants = Array.from(root.querySelectorAll(`[id="${required.id}"]`)) as Element[];
    const matches = required.id === SVG_ROOT_ID ? [root, ...descendants] : descendants;

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

    const element = matches[0];

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

  report.checks.push(...checkArtworkClipping(root));
  report.checks.push(checkReferences(root, elements));
  report.checks.push(checkSafety(elements));

  report.valid = report.checks.every(
    (check) => check.status === "ok" || check.status === "warning",
  );

  return report;
}
