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

/**
 * INTERNAL — không export ra `src/svg-engine/index.ts` và đừng thêm vào đó.
 *
 * Hàm này ghi `value` vào thuộc tính `style` nguyên xi, không chuẩn hoá gì.
 * Đường ghi màu chỉ được phép của engine là `applyStitchColor`, nơi giá trị đã
 * qua `normalizeHex` trước. Gọi thẳng hàm này từ ngoài là đi vòng qua guide §6
 * ("giá trị không hợp lệ không bao giờ được ghi vào SVG").
 */
export function writeCssVar(element: Element, name: string, value: string): void {
  const kept = declarations(element).filter((declaration) => nameOf(declaration) !== name);
  kept.push(`${name}: ${value}`);
  element.setAttribute("style", kept.join("; "));
}
