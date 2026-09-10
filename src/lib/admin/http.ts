import { z } from "zod";

/**
 * Hình lỗi DUY NHẤT của admin API. UI P2c đọc đúng hai hình này:
 *   422 → { errors: [{ field, code, message }] }   (cùng hình spec §8.2)
 *   khác → { error: "<CODE>", ...extra }
 * Code nghiệp vụ ném `AdminHttpError`; `adminApi` bắt và trả nó. Không route nào
 * tự dựng `NextResponse.json({ error })` riêng — hai hình lỗi là hai hình, không hơn.
 */
export class AdminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "AdminHttpError";
  }
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status });
}

/**
 * Khai báo dạng function declaration với return type `: never` tường minh —
 * để `tsc` hiểu nhánh gọi hàm này trong `parseJson` không bao giờ rơi qua,
 * mà không cần non-null assertion sau đó.
 */
export function validationFailed(errors: FieldError[]): never {
  throw new AdminHttpError(422, { errors });
}

export function notFound(): never {
  throw new AdminHttpError(404, { error: "NOT_FOUND" });
}

export function conflict(error: string, extra: Record<string, unknown> = {}): never {
  throw new AdminHttpError(409, { error, ...extra });
}

export function issuesToFieldErrors(issues: z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/** Đọc body JSON và parse bằng schema. Ném 422 — không bao giờ trả dữ liệu chưa parse. */
export async function parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    validationFailed([{ field: "", code: "invalid_json", message: "Body phải là JSON hợp lệ" }]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) validationFailed(issuesToFieldErrors(result.error.issues));
  return result.data;
}
