import { z } from "zod";

/** Alphabet URL-safe của nanoid. Dùng chung cho designId và shareToken. */
export const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
export const DESIGN_ID_PREFIX = "cd_";
export const DESIGN_ID_BODY_LENGTH = 21;
export const SHARE_TOKEN_LENGTH = 22;

const BODY = "[A-Za-z0-9_-]";

export const designIdSchema = z
  .string()
  .regex(new RegExp(`^${DESIGN_ID_PREFIX}${BODY}{${DESIGN_ID_BODY_LENGTH}}$`), "designId sai định dạng");

export const shareTokenSchema = z
  .string()
  .regex(new RegExp(`^${BODY}{${SHARE_TOKEN_LENGTH}}$`), "shareToken sai định dạng");

export type DesignId = z.infer<typeof designIdSchema>;
export type ShareToken = z.infer<typeof shareTokenSchema>;
