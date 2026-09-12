/**
 * Hợp đồng SVG — nguồn sự thật là docs/SVG_CUSTOMIZER_ACTION_GUIDE.md §2.
 *
 * Danh sách ID ở đây là hằng số compile-time và PHẢI giữ nguyên như vậy.
 * Guide §8: không bao giờ nối chuỗi không tin cậy vào CSS selector.
 */

export const CONTRACT_VERSION = "animal-v1";

export const SVG_ROOT_ID = "wallet-preview";

export const STITCH_CSS_VAR = "--wallet-stitches";

/** SVG mẫu cũ dùng bộ ID này. Guide §2 cấm hỗ trợ song song — chỉ dùng để sinh hint. */
export const LEGACY_ID_PREFIX = "fish-";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * `element: null` nghĩa là hợp đồng không ràng buộc loại phần tử — chỉ cần
 * ID tồn tại đúng một lần. `wallet-body-shape` và `animal-shape` có thể là
 * <path> hoặc bất kỳ shape tương đương nào (guide §2).
 */
export const REQUIRED_ELEMENTS: ReadonlyArray<{
  readonly id: string;
  readonly element: string | null;
}> = [
  { id: "wallet-preview", element: "svg" },
  { id: "wallet-body-shape", element: null },
  { id: "animal-shape", element: null },
  { id: "wallet-body-clip", element: "clipPath" },
  { id: "animal-clip", element: "clipPath" },
  { id: "body-artwork", element: "image" },
  { id: "animal-artwork", element: "image" },
  { id: "stitches", element: "g" },
] as const;

/**
 * Guide §8: "mỗi artwork target tham chiếu đúng `clipPath` tương ứng".
 *
 * Đây là ràng buộc SỐNG CÒN chứ không phải trang trí — guide §13 xếp "chỉ gán
 * ID nhưng không dùng clipPath" là lỗi đầu bảng: ảnh biến thành hình chữ nhật
 * phủ toàn canvas. Ngược lại, `clip-path` trỏ vào ID không tồn tại thì phần tử
 * KHÔNG render gì cả — artwork biến mất im lặng.
 */
export const ARTWORK_CLIP_BINDINGS: ReadonlyArray<{
  readonly artworkId: string;
  readonly clipId: string;
}> = [
  { artworkId: "body-artwork", clipId: "wallet-body-clip" },
  { artworkId: "animal-artwork", clipId: "animal-clip" },
] as const;

export const ARTWORK_TARGET_IDS = {
  body: "body-artwork",
  animal: "animal-artwork",
} as const;

export type ArtworkTarget = keyof typeof ARTWORK_TARGET_IDS;
