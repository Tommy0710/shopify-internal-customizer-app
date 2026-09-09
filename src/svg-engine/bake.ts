import { applyStitchColor, applyTexture } from "./apply";
import { validateSvgContract } from "./validate";

export interface BakeInput {
  bodyTextureUrl: string;
  animalTextureUrl: string;
  stitchHex: string;
}

export class BakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BakeError";
  }
}

/**
 * Ghi cứng texture và màu chỉ vào một mockup, tạo bản SVG độc lập của một design.
 *
 * Vì sao cần (spec §6.6): đơn hàng cũ vẫn phải mở ra đúng hình đã bán kể cả khi
 * admin thay master SVG của tổ hợp đó về sau. Kết quả deterministic nên hai đơn
 * cùng tổ hợp cho ra cùng một chuỗi byte, và ràng buộc unique theo sha256 tự
 * dedupe — storage tăng theo số TỔ HỢP, không theo số ĐƠN.
 *
 * Mutate `root` tại chỗ; caller serialize.
 */
export function bakeDesign(root: Element, input: BakeInput): void {
  const report = validateSvgContract(root);
  if (!report.valid) {
    const broken = report.checks
      .filter((check) => check.status !== "ok" && check.status !== "warning")
      .map((check) => `${check.id}:${check.status}`)
      .join(", ");
    throw new BakeError(`Mockup does not satisfy the contract (${broken})`);
  }

  applyTexture(root, "body", input.bodyTextureUrl);
  applyTexture(root, "animal", input.animalTextureUrl);

  if (applyStitchColor(root, input.stitchHex) === null) {
    throw new BakeError(`Invalid stitch colour: ${String(input.stitchHex)}`);
  }
}
