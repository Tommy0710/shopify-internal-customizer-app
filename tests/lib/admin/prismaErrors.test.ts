import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { toAdminResponse } from "@/lib/admin/prismaErrors";

/**
 * `toAdminResponse` dịch đúng ba mã Prisma admin route hay đụng phải; mọi mã
 * khác — và mọi lỗi không phải Prisma — phải trả `null` để `adminApi` ném
 * tiếp thành 500, không được nuốt thành một 4xx lịch sự.
 *
 * Lỗi dựng thật bằng constructor của Prisma, không phải object giả tay —
 * đúng shape `PrismaClientKnownRequestError` mà Prisma thật sự ném.
 */
function prismaError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("x", {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}

describe("toAdminResponse", () => {
  it("P2002 với meta.target → 409 CONFLICT kèm fields", async () => {
    const res = toAdminResponse(prismaError("P2002", { target: ["shopId", "slug"] }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    await expect(res!.json()).resolves.toEqual({ error: "CONFLICT", fields: ["shopId", "slug"] });
  });

  it("P2003 → 409 IN_USE", async () => {
    const res = toAdminResponse(prismaError("P2003"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    await expect(res!.json()).resolves.toEqual({ error: "IN_USE" });
  });

  it("P2025 → 404 NOT_FOUND", async () => {
    const res = toAdminResponse(prismaError("P2025"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    await expect(res!.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("mã Prisma khác (ví dụ P2034) → null", () => {
    expect(toAdminResponse(prismaError("P2034"))).toBeNull();
  });

  it("lỗi không phải của Prisma → null", () => {
    expect(toAdminResponse(new Error("boom"))).toBeNull();
    expect(toAdminResponse("không phải Error")).toBeNull();
    expect(toAdminResponse(undefined)).toBeNull();
  });
});
