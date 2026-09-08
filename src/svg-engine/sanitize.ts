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
