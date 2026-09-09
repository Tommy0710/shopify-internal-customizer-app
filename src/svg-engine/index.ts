export {
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
export { readCssVar, writeCssVar } from "./css";
export {
  validateSvgContract,
  type CheckStatus,
  type ContractCheck,
  type ValidationReport,
} from "./validate";
export { MissingTargetError, applyStitchColor, applyTexture } from "./apply";
export { createMockupLoader, type LoadOutcome } from "./loader";
export { sanitizeSvgRoot, type SanitizeReport } from "./sanitize";
export { BakeError, bakeDesign, type BakeInput } from "./bake";
