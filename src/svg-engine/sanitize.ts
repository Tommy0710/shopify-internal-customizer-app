export interface SanitizeReport {
  /** localName của các phần tử đã bị gỡ */
  removedElements: string[];
  /** "localName@attributeName" của các thuộc tính đã bị gỡ */
  removedAttributes: string[];
  /** URL tuyệt đối còn lại — hợp lệ (texture), ghi nhận để caller quyết định */
  externalRefs: string[];
}

const FORBIDDEN_ELEMENTS = new Set(["script", "foreignobject"]);
const HREF_ATTRIBUTES = ["href", "xlink:href"];
const DANGEROUS_SCHEME = /^\s*(javascript:|data:text\/html)/i;

function isEventHandler(name: string): boolean {
  return name.toLowerCase().startsWith("on");
}

function isExternal(value: string): boolean {
  return /^(https?:)?\/\//i.test(value.trim());
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

    for (const attribute of element.getAttributeNames()) {
      if (isEventHandler(attribute)) {
        report.removedAttributes.push(`${element.localName}@${attribute}`);
        element.removeAttribute(attribute);
      }
    }

    for (const attribute of HREF_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;

      if (DANGEROUS_SCHEME.test(value)) {
        report.removedAttributes.push(`${element.localName}@${attribute}`);
        element.removeAttribute(attribute);
        continue;
      }

      if (isExternal(value)) {
        report.externalRefs.push(value);
      }
    }
  }

  return report;
}
