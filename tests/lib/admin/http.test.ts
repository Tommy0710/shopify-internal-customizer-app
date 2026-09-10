import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonError, parseJson, AdminHttpError } from "@/lib/admin/http";

/**
 * Hình lỗi DUY NHẤT mà UI P2c đọc: 422 → `{ errors: [{ field, code, message }] }`,
 * mọi thứ khác → `{ error: "<CODE>", ...extra }`. `parseJson` là chỗ duy nhất
 * biến zod issue thành field error, nên test ở đây khoá luôn hình đó lại.
 */

function req(body: unknown): Request {
  return new Request("https://app.test/api/admin/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("parseJson", () => {
  it("trả dữ liệu đã parse, strip khoá lạ không có trong schema", async () => {
    const schema = z.object({ name: z.string() });
    const result = await parseJson(req({ name: "Suede Brown", extra: "bỏ" }), schema);
    expect(result).toEqual({ name: "Suede Brown" });
  });

  it("body không phải JSON → ném AdminHttpError 422 với code invalid_json", async () => {
    const schema = z.object({ name: z.string() });
    const promise = parseJson(req("không phải json {"), schema);
    await expect(promise).rejects.toBeInstanceOf(AdminHttpError);
    await promise.catch((error: AdminHttpError) => {
      expect(error.status).toBe(422);
      expect(error.body).toEqual({
        errors: [{ field: "", code: "invalid_json", message: expect.any(String) }],
      });
    });
  });

  it("vi phạm schema → 422, mỗi issue thành { field: path.join('.'), code, message }", async () => {
    const schema = z.object({
      a: z.object({ b: z.array(z.object({ c: z.string() })) }),
    });
    const promise = parseJson(req({ a: { b: [{ c: 123 }] } }), schema);
    await expect(promise).rejects.toBeInstanceOf(AdminHttpError);
    await promise.catch((error: AdminHttpError) => {
      expect(error.status).toBe(422);
      const body = error.body as { errors: Array<{ field: string; code: string; message: string }> };
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].field).toBe("a.b.0.c");
      expect(typeof body.errors[0].code).toBe("string");
      expect(typeof body.errors[0].message).toBe("string");
    });
  });
});

describe("jsonError", () => {
  it("trả Response đúng status, body { error, ...extra }, content-type JSON", async () => {
    const res = jsonError(404, "NOT_FOUND");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    await expect(res.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("gộp extra vào body", async () => {
    const res = jsonError(409, "CONFLICT", { fields: ["shopId", "slug"] });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "CONFLICT", fields: ["shopId", "slug"] });
  });
});
