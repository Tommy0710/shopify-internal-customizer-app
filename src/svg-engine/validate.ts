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

  report.checks.push({ id: SVG_ROOT_ID, status: "ok", element: "svg" });
  report.viewBox = root.getAttribute("viewBox");

  for (const required of REQUIRED_ELEMENTS) {
    if (required.id === SVG_ROOT_ID) {
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
