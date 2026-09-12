import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_ELEMENTS,
  HREF_ATTRIBUTES,
  extractUrlReferences,
  foreignUseTarget,
  isAllowedUrlValue,
  isExternalUrlValue,
  unsafeNodeName,
} from "./policy";

export interface SanitizeReport {
  /**
   * localName của các phần tử đã bị gỡ, cộng `nodeName` của các node không phải
   * phần tử đã bị gỡ (`#comment`, `#processing-instruction`, `#cdata-section`).
   *
   * Chúng nằm chung một trường có chủ đích: câu hỏi mà mọi caller thực sự hỏi
   * là "sanitize có gỡ gì không", và đó phải là một câu hỏi trả lời được bằng
   * hai trường này — đúng bằng khẳng định mà `checkSafety` trong `./validate`
   * mirror. Một trường thứ ba sẽ là thứ mà một caller quên kiểm tra.
   *
   * Tên ở đây không bảo đảm duy nhất: `<#comment/>` parse được và cho
   * `localName === "#comment"`, nên nó ghi ra cùng chuỗi với một node comment
   * bị gỡ. Không ai đọc trường này để phân biệt hai thứ đó — cả hai đều nghĩa
   * là "có thứ gì đó đã bị gỡ".
   */
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
  // khi scheme của nó (https:) hợp lệ cho một texture. Quy tắc nằm ở
  // `foreignUseTarget` trong `./policy` vì `checkSafety` phải đọc ĐÚNG nó.
  if (foreignUseTarget(element) !== null) {
    report.removedElements.push(element.localName);
    element.parentNode?.removeChild(element);
    return;
  }

  sanitizeAttributes(element, report);

  // Node không phải phần tử. `element.children` bỏ qua chúng hoàn toàn, nên
  // trước bản vá này một node comment đi qua NGUYÊN VĂN — và một comment chứa
  // `--!>` mở ra một `<script>` thật khi markup đã lưu được inline vào trang
  // HTML của Admin (xem `unsafeNodeName` trong `./policy`).
  for (const child of Array.from(element.childNodes)) {
    const nodeName = unsafeNodeName(child);
    if (nodeName === null) continue;
    report.removedElements.push(nodeName);
    element.removeChild(child);
  }

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

    // KHÔNG có cổng `value.includes("url(")` ở đây. Cổng viết tay đó phân biệt
    // hoa thường trong khi tên hàm CSS thì không, nên `URL(`, `Url(` và `url (`
    // đi thẳng qua nó; `extractUrlReferences` (cờ `i`, cho phép khoảng trắng)
    // là định nghĩa duy nhất, và mảng rỗng chính là "không có url() nào".
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
