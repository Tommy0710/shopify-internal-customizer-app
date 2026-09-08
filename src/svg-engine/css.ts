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
