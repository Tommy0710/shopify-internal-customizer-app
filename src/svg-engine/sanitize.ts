import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_ELEMENTS,
  HREF_ATTRIBUTES,
  extractUrlReferences,
  isAllowedUrlValue,
  isExternalUrlValue,
  normalizeUrlForSchemeCheck,
} from "./policy";

export interface SanitizeReport {
  /** localName của các phần tử đã bị gỡ */
  removedElements: string[];
  /** "localName@attributeName" của các thuộc tính đã bị gỡ */
  removedAttributes: string[];
  /** URL tuyệt đối còn lại — hợp lệ (texture), ghi nhận để caller quyết định */
  externalRefs: string[];
}

/**
 * Lọc một SVG đã parse tại chỗ, trước khi nó được lưu hoặc inline vào DOM.
 *
 * Rủi ro nó đóng (spec §13.2 S1): admin upload một file có <script>, <style>
 * hay onload=, file đó được inline vào trang admin, và nội dung đó chạy trong
 * ngữ cảnh Shopify Admin nơi có session token. Sanitize LÚC UPLOAD và chỉ lưu
 * bản đã lọc, để không tầng nào phía sau chạm bản gốc.
 *
 * Cơ chế là ALLOWLIST (xem `./policy`): mọi phần tử, thuộc tính và scheme URL
 * không nằm trong danh sách cho phép đều bị gỡ và ghi nhận. Cái gì chưa từng
 * được cân nhắc thì mặc định bị loại.
 *
 * URL `https:` ngoài KHÔNG bị gỡ — texture da hợp lệ chính là URL ngoài. Chúng
 * được ghi nhận vào `externalRefs` để caller tự áp allowlist host của mình.
 */
export function sanitizeSvgRoot(root: Element): SanitizeReport {
  const report: SanitizeReport = {
    removedElements: [],
    removedAttributes: [],
    externalRefs: [],
  };

  visit(root, report);

  return report;
}

/**
 * Duyệt đệ quy. Không đi xuống dưới một phần tử đã bị gỡ: cả cây con đi theo
 * nó, và ghi nhận từng con cháu chỉ làm nhiễu report.
 */
function visit(element: Element, report: SanitizeReport): void {
  if (!ALLOWED_ELEMENTS.has(element.localName.toLowerCase())) {
    report.removedElements.push(element.localName);
    element.parentNode?.removeChild(element);
    return;
  }

  // <use> trỏ sang tài liệu khác kéo nội dung ngoài vào cây — luôn gỡ, kể cả
  // khi scheme của nó (https:) hợp lệ cho một texture.
  if (element.localName.toLowerCase() === "use") {
    const target = element.getAttribute("href") ?? element.getAttribute("xlink:href") ?? "";
    const normalized = normalizeUrlForSchemeCheck(target);
    if (normalized !== "" && !normalized.startsWith("#")) {
      report.removedElements.push(element.localName);
      element.parentNode?.removeChild(element);
      return;
    }
  }

  sanitizeAttributes(element, report);

  for (const child of Array.from(element.children) as Element[]) {
    visit(child, report);
  }
}

function sanitizeAttributes(element: Element, report: SanitizeReport): void {
  for (const attribute of [...element.getAttributeNames()]) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;

    // Ngoài allowlist: gỡ. Đây là chỗ `on*`, `src`, `xl:href`, `formaction`,
    // `poster`, `data` và mọi cái tương lai chưa ai nghĩ ra bị chặn.
    if (!ALLOWED_ATTRIBUTES.has(attribute)) {
      report.removedAttributes.push(`${element.localName}@${attribute}`);
      element.removeAttribute(attribute);
      continue;
    }

    if (HREF_ATTRIBUTES.includes(attribute)) {
      if (!isAllowedUrlValue(value)) {
        report.removedAttributes.push(`${element.localName}@${attribute}`);
        element.removeAttribute(attribute);
        continue;
      }
      if (isExternalUrlValue(value)) {
        report.externalRefs.push(value);
      }
      continue;
    }

    if (!value.includes("url(")) continue;

    const references = extractUrlReferences(value);
    if (references.some((reference) => !isAllowedUrlValue(reference))) {
      report.removedAttributes.push(`${element.localName}@${attribute}`);
      element.removeAttribute(attribute);
      continue;
    }
    for (const reference of references) {
      if (isExternalUrlValue(reference)) {
        report.externalRefs.push(reference);
      }
    }
  }
}
