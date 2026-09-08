import { ARTWORK_TARGET_IDS, STITCH_CSS_VAR, type ArtworkTarget } from "./contract";
import { normalizeHex } from "./colors";
import { writeCssVar } from "./css";

export class MissingTargetError extends Error {
  constructor(readonly targetId: string) {
    super(`Missing SVG target: ${targetId}`);
    this.name = "MissingTargetError";
  }
}

/**
 * Gán hoặc gỡ ảnh texture cho một trong hai artwork target.
 *
 * Guide §5: gán thì đặt href, GỠ `hidden`, đặt visibility="visible".
 * Gỡ thì làm ngược lại. Các ngăn ví dùng `<use href="#body-artwork">` nên tự
 * cập nhật theo — engine không cần biết tới chúng.
 */
export function applyTexture(root: Element, target: ArtworkTarget, url: string | null): void {
  const id = ARTWORK_TARGET_IDS[target];
  const image = root.querySelector(`[id="${id}"]`);

  if (!image) throw new MissingTargetError(id);

  if (url) {
    image.setAttribute("href", url);
    image.removeAttribute("hidden");
    image.setAttribute("visibility", "visible");
    return;
  }

  image.removeAttribute("href");
  image.setAttribute("hidden", "");
  image.setAttribute("visibility", "hidden");
}

/**
 * Ghi màu chỉ vào CSS custom property ở root.
 *
 * Trả hex đã chuẩn hoá khi ghi thành công, `null` khi input không hợp lệ —
 * và khi `null` thì KHÔNG ghi gì cả, màu hiện tại giữ nguyên (guide §6).
 */
export function applyStitchColor(root: Element, value: unknown): string | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  writeCssVar(root, STITCH_CSS_VAR, hex);
  return hex;
}
