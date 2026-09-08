import { DOMParser } from "linkedom";
import { SVG_NAMESPACE } from "@/svg-engine/contract";

/**
 * Parse SVG text thành một Element dùng được cho svg-engine.
 * Chỉ dùng trong test — code production tự parse ở tầng của nó
 * (DOMParser trình duyệt ở storefront, linkedom ở server).
 *
 * LINKEDOM SHIM: LinkedOM does not populate namespaceURI from the xmlns
 * attribute — all elements default to http://www.w3.org/1999/xhtml
 * regardless. If the SVG declares xmlns correctly, we compensate here by
 * explicitly setting namespaceURI so the validator receives what a browser's
 * DOMParser would produce. If xmlns is absent or wrong, we leave the broken
 * namespace as-is, so the validator still rejects it — same outcome as a
 * browser would give.
 */
export function parseSvg(text: string): Element {
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg") {
    throw new Error("Fixture is not an <svg> document");
  }

  // Shim: If xmlns is exactly the SVG namespace, set namespaceURI to match.
  // This emulates the namespace resolution a browser DOMParser performs.
  const xmlns = root.getAttribute("xmlns");
  if (xmlns === SVG_NAMESPACE) {
    Object.defineProperty(root, "namespaceURI", {
      value: SVG_NAMESPACE,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  }
  // If xmlns is absent or any other value (e.g., XHTML), leave namespaceURI
  // as linkedom set it, so the validator rejects the document.

  return root as unknown as Element;
}
