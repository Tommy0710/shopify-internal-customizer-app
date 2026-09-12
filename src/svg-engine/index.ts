export {
  ARTWORK_CLIP_BINDINGS,
  ARTWORK_TARGET_IDS,
  CONTRACT_VERSION,
  LEGACY_ID_PREFIX,
  REQUIRED_ELEMENTS,
  STITCH_CSS_VAR,
  SVG_NAMESPACE,
  SVG_ROOT_ID,
  type ArtworkTarget,
} from "./contract";

export { normalizeHex } from "./colors";
// `writeCssVar` cố tình KHÔNG được export: nó ghi chuỗi tuỳ ý thẳng vào thuộc
// tính `style`. Đường ghi màu duy nhất được phép là `applyStitchColor`, nơi giá
// trị đi qua `normalizeHex` — guide §6: giá trị không hợp lệ KHÔNG BAO GIỜ được
// ghi vào SVG.
export { readCssVar } from "./css";
export {
  REFERENCE_CHECK_ID,
  SAFETY_CHECK_ID,
  validateSvgContract,
  type CheckStatus,
  type ContractCheck,
  type ValidationReport,
} from "./validate";
export { MissingTargetError, applyStitchColor, applyTexture } from "./apply";
export { createMockupLoader, type LoadOutcome } from "./loader";
export { sanitizeSvgRoot, type SanitizeReport } from "./sanitize";
export { BakeError, bakeDesign, type BakeInput } from "./bake";
