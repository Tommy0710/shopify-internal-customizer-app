import { applyStitchColor, applyTexture } from "./apply";
import { normalizeHex } from "./colors";
import { isAllowedUrlValue } from "./policy";
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
 *
 * ATOMIC: mọi input được kiểm TRƯỚC lần mutate đầu tiên, nên khi hàm này ném
 * lỗi thì tài liệu vẫn nguyên vẹn. Nửa vời còn tệ hơn thất bại: một design đã
 * gắn texture nhưng thiếu màu chỉ vẫn trông "xong" với tầng gọi.
 */
export function bakeDesign(root: Element, input: BakeInput): void {
  const report = validateSvgContract(root);

  // Khác cổng PREVIEW: ở đây "warning" cũng là từ chối. Bản bake là hồ sơ lưu
  // trữ của một đơn hàng (spec §6.6) và phải tái hiện trung thực thứ đã bán.
  // Một mockup có #stitches không dùng var(--wallet-stitches) vẫn "valid" cho
  // preview, nhưng bake nó ra thì màu chỉ khách chọn rơi vào một CSS custom
  // property KHÔNG AI ĐỌC: file lưu vĩnh viễn sai màu mà không báo gì.
  const broken = report.checks.filter((check) => check.status !== "ok");
  if (broken.length > 0) {
    const summary = broken.map((check) => `${check.id}:${check.status}`).join(", ");
    throw new BakeError(`Mockup does not satisfy the contract (${summary})`);
  }

  const stitchHex = normalizeHex(input.stitchHex);
  if (stitchHex === null) {
    throw new BakeError(`Invalid stitch colour: ${String(input.stitchHex)}`);
  }

  const bodyTextureUrl = checkedTextureUrl(input.bodyTextureUrl, "body");
  const animalTextureUrl = checkedTextureUrl(input.animalTextureUrl, "animal");

  // Từ đây không còn nhánh nào ném lỗi: validate ở trên đã bảo đảm cả hai
  // artwork target tồn tại, nên applyTexture không thể ném MissingTargetError.
  applyTexture(root, "body", bodyTextureUrl);
  applyTexture(root, "animal", animalTextureUrl);
  applyStitchColor(root, stitchHex);
}

/**
 * `applyTexture` coi chuỗi rỗng là TÍN HIỆU GỠ ảnh: nó set `hidden` và
 * `visibility="hidden"`. Trên đường bake, một URL rỗng hoặc toàn khoảng trắng
 * vì thế sinh ra bản lưu trữ có lớp da vô hình mà không hề báo lỗi. Bake không
 * bao giờ có ý gỡ ảnh, nên ở đây rỗng là lỗi.
 *
 * Scheme cũng được kiểm bằng đúng chính sách mà validator dùng: nếu không,
 * bake ghi ra một tài liệu mà chính validator sẽ từ chối ở lần đọc sau.
 */
function checkedTextureUrl(url: string, target: string): string {
  if (typeof url !== "string" || url.trim() === "") {
    throw new BakeError(`Missing ${target} texture URL; a baked design must show both layers`);
  }
  if (!isAllowedUrlValue(url)) {
    throw new BakeError(`Unsafe ${target} texture URL: ${url.slice(0, 60)}`);
  }
  return url;
}
