import { randomBytes } from "node:crypto";
import { DESIGN_ID_PREFIX, DESIGN_ID_BODY_LENGTH, ID_ALPHABET, SHARE_TOKEN_LENGTH } from "@/shared/ids";

/**
 * Sinh id ngẫu nhiên trên alphabet 64 ký tự.
 *
 * Alphabet dài đúng 64 nên `byte & 63` phủ đều — không cần rejection sampling và
 * không có lệch modulo. Nếu ai đó đổi `ID_ALPHABET`, hằng số dưới đây sẽ ném lỗi
 * ngay lúc nạp module thay vì âm thầm sinh id lệch phân phối.
 */
if (ID_ALPHABET.length !== 64) {
  throw new Error(`ID_ALPHABET phải dài đúng 64 ký tự, đang là ${ID_ALPHABET.length}`);
}

function randomId(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] & 63];
  return out;
}

export function newDesignId(): string {
  return DESIGN_ID_PREFIX + randomId(DESIGN_ID_BODY_LENGTH);
}

export function newShareToken(): string {
  return randomId(SHARE_TOKEN_LENGTH);
}
