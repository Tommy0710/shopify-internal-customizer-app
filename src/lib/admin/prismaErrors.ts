import { Prisma } from "@prisma/client";

/**
 * Dịch lỗi Prisma đã biết thành phản hồi HTTP. Trả null cho mọi thứ khác — lỗi
 * lạ phải nổi lên thành 500 và vào log, không được nuốt thành một 4xx lịch sự.
 */
export function toAdminResponse(error: unknown): Response | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (error.code) {
    case "P2002": {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
      return Response.json({ error: "CONFLICT", fields }, { status: 409 });
    }
    case "P2003":
      return Response.json({ error: "IN_USE" }, { status: 409 });
    case "P2025":
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    default:
      return null;
  }
}
