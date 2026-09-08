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
