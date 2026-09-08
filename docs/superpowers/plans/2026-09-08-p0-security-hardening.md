# P0 — Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng ba lỗ hổng đang chạy trên production — `/api/admin/*` không xác thực, HMAC bị bỏ qua theo `NODE_ENV`, và credential thật nằm trong `README.md` đã vào git history.

**Architecture:** Thêm `src/lib/auth/` gồm một hàm thuần verify Shopify App Bridge session token (JWT HS256) và một wrapper cho Next.js route handler. Đổi cơ chế bỏ qua HMAC từ suy ra theo `NODE_ENV` thành biến môi trường opt-in tường minh có fail-fast. Xoá credential khỏi README và thay bằng runbook rotate.

**Tech Stack:** Next.js 14 App Router · TypeScript · `jose` (JWT) · Vitest (test runner mới)

**Spec:** `docs/superpowers/specs/2026-09-08-wk-customizer-redesign-design.md` §13.1

## Global Constraints

- Phase này **độc lập hoàn toàn** với phần redesign còn lại. Không đụng Prisma schema, không đụng storefront, không đụng admin UI. Deploy được ngay sau khi xong.
- Branch làm việc: `feat/customizer-redesign` (đã tồn tại, đã có commit spec).
- Không sửa `extensions/product-customizer-block/assets/customizer-bundle.js` bằng tay — file sinh tự động.
- Mọi commit kết thúc bằng trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Shop allowlist đọc từ biến môi trường `WK_ALLOWED_SHOPS` (danh sách ngăn cách bằng dấu phẩy). Giá trị hiện tại: `wildandking-demo.myshopify.com`.
- Biến bỏ qua HMAC là `WK_SKIP_HMAC`, chỉ nhận đúng chuỗi `"1"` để bật.
- Test đặt tại `tests/`, mirror cấu trúc `src/`.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `vitest.config.ts` | Tạo | Cấu hình test runner, alias `@/` → `src/` |
| `tests/lib/auth/sessionToken.test.ts` | Tạo | Test đơn vị cho verify session token |
| `src/lib/auth/sessionToken.ts` | Tạo | Hàm **thuần**: verify JWT, không đọc `process.env`, không biết Next.js |
| `tests/lib/auth/requireAdminSession.test.ts` | Tạo | Test wrapper trả 401/403 |
| `src/lib/auth/requireAdminSession.ts` | Tạo | Wrapper Next.js: đọc env, đọc header, trả `NextResponse` khi lỗi |
| `src/app/api/admin/products/route.ts` | Sửa | Gắn guard vào `GET` và `POST` |
| `src/app/api/admin/orders/route.ts` | Sửa | Gắn guard vào `GET` và `PATCH` |
| `tests/lib/hmac.test.ts` | Tạo | Test cờ bypass |
| `src/lib/hmac.ts` | Sửa | Thêm `hmacBypassEnabled()`, bỏ nhánh dev tự động trả `true` |
| `src/app/api/proxy/customizer-config/route.ts` | Sửa | Dùng `hmacBypassEnabled()` thay `NODE_ENV` |
| `src/app/api/proxy/save-design/route.ts` | Sửa | Như trên |
| `src/app/api/webhooks/orders-create/route.ts` | Sửa | Như trên |
| `src/app/api/webhooks/app-uninstalled/route.ts` | Sửa | Như trên |
| `src/app/api/auth/callback/route.ts` | Sửa | Như trên |
| `README.md` | Sửa | Xoá khối credential thật |
| `docs/runbooks/credential-rotation.md` | Tạo | Quy trình rotate secret + password DB |
| `.env.example` | Sửa | Thêm `WK_ALLOWED_SHOPS`, `WK_SKIP_HMAC` |
| `package.json` | Sửa | Thêm `jose`, `vitest`, script `test` |

**Lý do tách `sessionToken.ts` khỏi `requireAdminSession.ts`:** hàm verify là logic thuần, nhận mọi thứ qua tham số nên test được không cần env hay mock Next.js. Wrapper mỏng chỉ làm việc đọc env và dựng response — chỗ duy nhất biết tới Next.js.

---

## Task 1: Test infrastructure + session token verifier

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/lib/auth/sessionToken.test.ts`
- Create: `src/lib/auth/sessionToken.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces:
  - `verifySessionToken(token: string | null | undefined, opts: VerifyOptions): Promise<AdminSession>`
  - `interface AdminSession { shopDomain: string; userId: string }`
  - `interface VerifyOptions { apiKey: string; apiSecret: string; allowedShops: string[] }`
  - `class SessionTokenError extends Error { readonly code: SessionTokenErrorCode }`
  - `type SessionTokenErrorCode = "MISSING_TOKEN" | "INVALID_TOKEN" | "SHOP_NOT_ALLOWED"`

- [ ] **Step 1: Cài dependency và thêm script test**

```bash
npm install jose@^5.9.6
npm install --save-dev vitest@^2.1.8
```

Sửa `package.json`, thêm vào `scripts` (ngay sau dòng `"lint"`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 2: Tạo cấu hình Vitest**

Tạo `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Viết test thất bại**

Tạo `tests/lib/auth/sessionToken.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  SessionTokenError,
  verifySessionToken,
} from "@/lib/auth/sessionToken";

const API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
const API_SECRET = "test_secret_that_is_long_enough_for_hs256";
const SHOP = "wildandking-demo.myshopify.com";

const secret = new TextEncoder().encode(API_SECRET);
const opts = { apiKey: API_KEY, apiSecret: API_SECRET, allowedShops: [SHOP] };

async function mintToken(
  overrides: Record<string, unknown> = {},
  signingKey: Uint8Array = secret,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: "42",
    nbf: now - 10,
    iat: now - 10,
    ...overrides,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(typeof overrides.exp === "number" ? overrides.exp : now + 60)
    .sign(signingKey);
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SessionTokenError);
  await promise.catch((error) => {
    expect((error as SessionTokenError).code).toBe(code);
  });
}

describe("verifySessionToken", () => {
  it("accepts a well-formed token and returns shop and user", async () => {
    const session = await verifySessionToken(await mintToken(), opts);
    expect(session).toEqual({ shopDomain: SHOP, userId: "42" });
  });

  it("rejects a missing token", async () => {
    await expectCode(verifySessionToken(null, opts), "MISSING_TOKEN");
    await expectCode(verifySessionToken("", opts), "MISSING_TOKEN");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrongKey = new TextEncoder().encode("a_completely_different_secret_value");
    await expectCode(
      verifySessionToken(await mintToken({}, wrongKey), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects a token minted for another app", async () => {
    await expectCode(
      verifySessionToken(await mintToken({ aud: "some_other_app_key" }), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expectCode(
      verifySessionToken(await mintToken({ exp: past }), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects a token whose iss host differs from dest", async () => {
    await expectCode(
      verifySessionToken(
        await mintToken({ iss: "https://attacker.myshopify.com/admin" }),
        opts,
      ),
      "INVALID_TOKEN",
    );
  });

  it("rejects a shop outside the allowlist", async () => {
    const other = "someone-else.myshopify.com";
    await expectCode(
      verifySessionToken(
        await mintToken({ iss: `https://${other}/admin`, dest: `https://${other}` }),
        opts,
      ),
      "SHOP_NOT_ALLOWED",
    );
  });

  it("rejects a token without a sub claim", async () => {
    await expectCode(
      verifySessionToken(await mintToken({ sub: undefined }), opts),
      "INVALID_TOKEN",
    );
  });
});
```

- [ ] **Step 4: Chạy test để xác nhận nó fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@/lib/auth/sessionToken"`

- [ ] **Step 5: Viết implementation tối thiểu**

Tạo `src/lib/auth/sessionToken.ts`:

```ts
import { jwtVerify } from "jose";

export type SessionTokenErrorCode =
  | "MISSING_TOKEN"
  | "INVALID_TOKEN"
  | "SHOP_NOT_ALLOWED";

export class SessionTokenError extends Error {
  constructor(
    readonly code: SessionTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionTokenError";
  }
}

export interface AdminSession {
  /** e.g. "wildandking-demo.myshopify.com" */
  shopDomain: string;
  /** Shopify staff user id, from the `sub` claim. Used for audit fields. */
  userId: string;
}

export interface VerifyOptions {
  apiKey: string;
  apiSecret: string;
  allowedShops: string[];
}

function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Verify a Shopify App Bridge session token.
 *
 * Pure: every input arrives as an argument so this is testable without env
 * vars or a Next.js request. The wrapper in requireAdminSession.ts reads env.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  opts: VerifyOptions,
): Promise<AdminSession> {
  if (!token) {
    throw new SessionTokenError("MISSING_TOKEN", "Missing session token");
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode(opts.apiSecret),
      { algorithms: ["HS256"], audience: opts.apiKey, clockTolerance: 5 },
    );
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw new SessionTokenError(
      "INVALID_TOKEN",
      "Session token failed signature, audience or expiry verification",
    );
  }

  const destHost = hostOf(payload.dest);
  if (!destHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no valid dest claim");
  }

  const issHost = hostOf(payload.iss);
  if (!issHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no valid iss claim");
  }

  if (issHost !== destHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token iss does not match dest");
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no sub claim");
  }

  if (!opts.allowedShops.includes(destHost)) {
    throw new SessionTokenError("SHOP_NOT_ALLOWED", `Shop ${destHost} is not allowed`);
  }

  return { shopDomain: destHost, userId };
}
```

- [ ] **Step 6: Chạy test để xác nhận pass**

Run: `npm test`
Expected: PASS — 8 test trong `tests/lib/auth/sessionToken.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts \
        tests/lib/auth/sessionToken.test.ts src/lib/auth/sessionToken.ts
git commit -m "feat(auth): verify Shopify App Bridge session tokens

Hàm thuần verify JWT HS256: chữ ký, aud khớp API key, exp/nbf, iss host
khớp dest host, và shop nằm trong allowlist. Mọi input qua tham số nên
test được không cần env.

Kèm hạ tầng test đầu tiên của repo (Vitest + alias @/).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Guard cho `/api/admin/*`

**Files:**
- Create: `tests/lib/auth/requireAdminSession.test.ts`
- Create: `src/lib/auth/requireAdminSession.ts`
- Modify: `src/app/api/admin/products/route.ts`
- Modify: `src/app/api/admin/orders/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `verifySessionToken`, `SessionTokenError`, `AdminSession` từ Task 1
- Produces:
  - `requireAdminSession(req: Request): Promise<AdminGuardResult>`
  - `type AdminGuardResult = { session: AdminSession } | { response: NextResponse }`
  - `getAllowedShops(): string[]`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/lib/auth/requireAdminSession.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { requireAdminSession } from "@/lib/auth/requireAdminSession";

const API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
const API_SECRET = "test_secret_that_is_long_enough_for_hs256";
const SHOP = "wildandking-demo.myshopify.com";

function useEnv() {
  vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
  vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
  vi.stubEnv("WK_ALLOWED_SHOPS", `${SHOP}, another-shop.myshopify.com`);
}

async function mintToken(shop = SHOP): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: API_KEY,
    sub: "42",
    nbf: now - 10,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(API_SECRET));
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/admin/products", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireAdminSession", () => {
  it("returns the session for a valid Bearer token", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken()}` }),
    );
    expect(result).toEqual({ session: { shopDomain: SHOP, userId: "42" } });
  });

  it("accepts a lowercase bearer scheme", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `bearer ${await mintToken()}` }),
    );
    expect("session" in result).toBe(true);
  });

  it("returns 401 when the Authorization header is absent", async () => {
    useEnv();
    const result = await requireAdminSession(request());
    expect("response" in result).toBe(true);
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "MISSING_TOKEN" });
  });

  it("returns 401 when the scheme is not Bearer", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Basic ${await mintToken()}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
  });

  it("returns 401 for a token this app did not sign", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: "Bearer not.a.jwt" }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual({ error: "INVALID_TOKEN" });
  });

  it("returns 403 for a shop outside the allowlist", async () => {
    useEnv();
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken("intruder.myshopify.com")}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ error: "SHOP_NOT_ALLOWED" });
  });

  it("denies every shop when WK_ALLOWED_SHOPS is unset", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", API_KEY);
    vi.stubEnv("SHOPIFY_API_SECRET", API_SECRET);
    vi.stubEnv("WK_ALLOWED_SHOPS", "");
    const result = await requireAdminSession(
      request({ authorization: `Bearer ${await mintToken()}` }),
    );
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- requireAdminSession`
Expected: FAIL — `Failed to resolve import "@/lib/auth/requireAdminSession"`

- [ ] **Step 3: Viết implementation**

Tạo `src/lib/auth/requireAdminSession.ts`:

```ts
import { NextResponse } from "next/server";
import {
  type AdminSession,
  SessionTokenError,
  verifySessionToken,
} from "./sessionToken";

export type AdminGuardResult =
  | { session: AdminSession }
  | { response: NextResponse };

/**
 * Shops allowed to reach the embedded admin. Empty means deny everything —
 * a missing env var must never widen access.
 */
export function getAllowedShops(): string[] {
  return (process.env.WK_ALLOWED_SHOPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token === "" ? null : token;
}

export async function requireAdminSession(req: Request): Promise<AdminGuardResult> {
  try {
    const session = await verifySessionToken(bearerToken(req), {
      apiKey: process.env.SHOPIFY_API_KEY ?? "",
      apiSecret: process.env.SHOPIFY_API_SECRET ?? "",
      allowedShops: getAllowedShops(),
    });
    return { session };
  } catch (error) {
    const code =
      error instanceof SessionTokenError ? error.code : "INVALID_TOKEN";
    return {
      response: NextResponse.json(
        { error: code },
        { status: code === "SHOP_NOT_ALLOWED" ? 403 : 401 },
      ),
    };
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- requireAdminSession`
Expected: PASS — 7 test

- [ ] **Step 5: Gắn guard vào route products**

Trong `src/app/api/admin/products/route.ts`, thêm import ngay sau dòng `import { db } from "@/lib/db";`:

```ts
import { requireAdminSession } from "@/lib/auth/requireAdminSession";
```

Thêm ba dòng đầu tiên vào **thân** của cả `GET` và `POST`, ngay trước `try {`:

```ts
  const auth = await requireAdminSession(req);
  if ("response" in auth) return auth.response;
```

- [ ] **Step 6: Gắn guard vào route orders**

Làm y hệt Step 5 với `src/app/api/admin/orders/route.ts`, áp cho cả `GET` và `PATCH`.

- [ ] **Step 7: Khai báo biến môi trường mới**

Thêm vào cuối `.env.example`:

```dotenv
# Danh sách shop được phép vào embedded admin, ngăn cách bằng dấu phẩy.
# Để trống = chặn tất cả. Không bao giờ dùng "*".
WK_ALLOWED_SHOPS="wildandking-demo.myshopify.com"
```

- [ ] **Step 8: Kiểm tra thủ công rằng route thật sự bị chặn**

Run:
```bash
npm run dev:app
```
Trong terminal khác:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/products
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/orders
```
Expected: in ra `401` cho cả hai. Trước thay đổi này chúng trả `200` kèm dữ liệu.

- [ ] **Step 9: Commit**

```bash
git add tests/lib/auth/requireAdminSession.test.ts \
        src/lib/auth/requireAdminSession.ts \
        src/app/api/admin/products/route.ts \
        src/app/api/admin/orders/route.ts \
        .env.example
git commit -m "fix(security): require a session token on every /api/admin route

Trước thay đổi này cả hai route admin không kiểm tra danh tính — ai biết
URL đều đọc và sửa được dữ liệu đơn hàng trên production.

Allowlist rỗng nghĩa là chặn tất cả, để biến môi trường thiếu không bao
giờ nới quyền.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Bỏ qua HMAC phải là opt-in tường minh

**Files:**
- Create: `tests/lib/hmac.test.ts`
- Modify: `src/lib/hmac.ts`
- Modify: `src/app/api/proxy/customizer-config/route.ts`
- Modify: `src/app/api/proxy/save-design/route.ts`
- Modify: `src/app/api/webhooks/orders-create/route.ts`
- Modify: `src/app/api/webhooks/app-uninstalled/route.ts`
- Modify: `src/app/api/auth/callback/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `verifyShopifyProxySignature`, `verifyShopifyWebhook` (đã có sẵn trong `src/lib/hmac.ts`)
- Produces: `hmacBypassEnabled(): boolean` — ném lỗi nếu bật cùng `NODE_ENV=production`

**Bối cảnh:** hiện mọi route đều viết `if (process.env.NODE_ENV === "production") { verify }`. Nghĩa là bất kỳ môi trường nào không phải production đều tắt xác thực — kể cả preview deployment công khai trên Vercel. Ngoài ra `verifyShopifyProxySignature` còn có nhánh tự trả `true` khi thiếu secret ở dev.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/lib/hmac.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacBypassEnabled, verifyShopifyProxySignature } from "@/lib/hmac";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hmacBypassEnabled", () => {
  it("is off when the variable is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "");
    expect(hmacBypassEnabled()).toBe(false);
  });

  it("is off for any value other than the exact string 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of ["true", "yes", "0", "01", " 1"]) {
      vi.stubEnv("WK_SKIP_HMAC", value);
      expect(hmacBypassEnabled()).toBe(false);
    }
  });

  it("is on outside production when explicitly set to 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WK_SKIP_HMAC", "1");
    expect(hmacBypassEnabled()).toBe(true);
  });

  it("throws rather than disabling verification in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WK_SKIP_HMAC", "1");
    expect(() => hmacBypassEnabled()).toThrow(/production/i);
  });
});

describe("verifyShopifyProxySignature", () => {
  it("rejects a request with no signature even when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    const params = new URLSearchParams({ shop: "wildandking-demo.myshopify.com" });
    expect(verifyShopifyProxySignature(params, "")).toBe(false);
  });

  it("accepts a correctly signed request", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "test_secret";
    const params = new URLSearchParams({
      productId: "8129384729101",
      shop: "wildandking-demo.myshopify.com",
    });
    const message = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("");
    params.set("signature", createHmac("sha256", secret).update(message).digest("hex"));
    expect(verifyShopifyProxySignature(params, secret)).toBe(true);
  });

  it("rejects a tampered request", () => {
    const params = new URLSearchParams({
      productId: "999",
      shop: "wildandking-demo.myshopify.com",
      signature: "deadbeef",
    });
    expect(verifyShopifyProxySignature(params, "test_secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npm test -- hmac`
Expected: FAIL — `hmacBypassEnabled is not a function`, và test "rejects a request with no signature even when no secret is configured" cũng fail vì nhánh dev hiện trả `true`.

- [ ] **Step 3: Thêm `hmacBypassEnabled` và bỏ nhánh dev**

Trong `src/lib/hmac.ts`, thêm vào **đầu file**, ngay sau `import crypto from "crypto";`:

```ts
/**
 * Có được phép bỏ qua xác thực HMAC không.
 *
 * Trước đây điều này suy ra từ NODE_ENV, nghĩa là mọi môi trường không phải
 * production — kể cả preview deployment công khai — đều chạy không xác thực.
 * Giờ phải bật tường minh, và không bao giờ bật được ở production.
 */
export function hmacBypassEnabled(): boolean {
  const enabled = process.env.WK_SKIP_HMAC === "1";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "WK_SKIP_HMAC=1 while NODE_ENV=production. Refusing to serve requests with HMAC verification disabled.",
    );
  }
  return enabled;
}
```

Trong cùng file, **xoá** hai dòng sau khỏi `verifyShopifyProxySignature`:

```ts
    // In local dev without secret, allow mock testing if needed
    if (process.env.NODE_ENV === "development" && !apiSecret) return true;
```

sao cho khối đó còn lại đúng:

```ts
  const signature = searchParams.get("signature");
  if (!signature || !apiSecret) {
    return false;
  }
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `npm test -- hmac`
Expected: PASS — 7 test

- [ ] **Step 5: Đổi năm route sang dùng cờ mới**

Trong **mỗi** file dưới đây, thay điều kiện `process.env.NODE_ENV === "production"` bao quanh phần verify bằng `!hmacBypassEnabled()`, và thêm `hmacBypassEnabled` vào dòng import từ `@/lib/hmac`.

| File | Dòng cần đổi |
|---|---|
| `src/app/api/proxy/customizer-config/route.ts` | `if (process.env.NODE_ENV === "production") {` → `if (!hmacBypassEnabled()) {` |
| `src/app/api/proxy/save-design/route.ts` | như trên |
| `src/app/api/webhooks/orders-create/route.ts` | như trên |
| `src/app/api/webhooks/app-uninstalled/route.ts` | như trên |

Ví dụ đầy đủ cho `customizer-config/route.ts`:

```ts
import { hmacBypassEnabled, verifyShopifyProxySignature } from "@/lib/hmac";

// …

    if (!hmacBypassEnabled()) {
      const isValid = verifyShopifyProxySignature(url.searchParams);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 401 });
      }
    }
```

Với `src/app/api/auth/callback/route.ts`, điều kiện đang viết ngược nên đổi thành:

```ts
import { hmacBypassEnabled } from "@/lib/hmac";

// …

  if (calculatedHmac !== hmac && !hmacBypassEnabled()) {
    return NextResponse.json({ error: "Invalid HMAC signature" }, { status: 400 });
  }
```

- [ ] **Step 6: Xác nhận không còn chỗ nào suy ra bảo mật từ NODE_ENV**

Run:
```bash
grep -rn 'NODE_ENV === "production"' src/app
```
Expected: **không có kết quả**. Trước thay đổi này có đúng 5 kết quả — 5 file vừa sửa ở Step 5.

Run:
```bash
grep -rn 'NODE_ENV === "production"' src/lib
```
Expected: **đúng một** kết quả, trong `src/lib/hmac.ts`, là guard bên trong `hmacBypassEnabled()`. Đây là chỗ duy nhất được phép so sánh `NODE_ENV` cho mục đích bảo mật, và nó ném lỗi chứ không nới quyền.

`src/lib/db.ts` và `src/lib/shopify.ts` cũng đọc `NODE_ENV` nhưng chỉ để chọn mức log, và dùng `=== "development"` / `!== "production"` nên không khớp pattern trên. Không đụng vào.

- [ ] **Step 7: Khai báo biến môi trường mới**

Thêm vào cuối `.env.example`:

```dotenv
# Chỉ dùng khi phát triển cục bộ. Đặt "1" để bỏ qua xác thực HMAC của
# App Proxy và webhook. App sẽ NÉM LỖI nếu biến này bật cùng
# NODE_ENV=production. Không bao giờ đặt trên Vercel.
WK_SKIP_HMAC=""
```

- [ ] **Step 8: Commit**

```bash
git add tests/lib/hmac.test.ts src/lib/hmac.ts \
        src/app/api/proxy/customizer-config/route.ts \
        src/app/api/proxy/save-design/route.ts \
        src/app/api/webhooks/orders-create/route.ts \
        src/app/api/webhooks/app-uninstalled/route.ts \
        src/app/api/auth/callback/route.ts \
        .env.example
git commit -m "fix(security): make HMAC bypass an explicit opt-in with a production guard

Trước đây mọi môi trường khác production đều chạy không xác thực HMAC,
kể cả preview deployment công khai trên Vercel. Giờ phải đặt WK_SKIP_HMAC=1
tường minh, và app ném lỗi nếu cờ này bật cùng NODE_ENV=production.

Bỏ luôn nhánh trong verifyShopifyProxySignature tự trả true khi thiếu
secret ở dev.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Xoá credential khỏi README và viết runbook rotate

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/credential-rotation.md`

**Interfaces:**
- Consumes: không có
- Produces: không có (thay đổi tài liệu)

**Bối cảnh:** `README.md` chứa `SHOPIFY_API_SECRET` và password Supabase **thật**, đã được commit. Xoá khỏi file **không đủ** — giá trị vẫn nằm trong git history và trong mọi bản clone. Bắt buộc phải rotate.

- [ ] **Step 1: Xác nhận phạm vi khối cần xoá**

Run:
```bash
grep -n "File \`.env\` thực tế đang dùng\|## 💻 Setup môi trường local" README.md
```
Expected: hai số dòng, khối cần xoá nằm giữa chúng.

- [ ] **Step 2: Xoá khối credential khỏi README**

Run:
```bash
python3 - <<'PY'
import pathlib, re
p = pathlib.Path("README.md")
s = p.read_text()
start = s.index("### 🔑 File `.env` thực tế đang dùng")
end = s.index("## 💻 Setup môi trường local")
s = s[:start] + (
    "### 🔑 Lấy giá trị `.env` ở đâu\n\n"
    "Giá trị thật **không** được ghi trong repo. Lấy từ:\n\n"
    "- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — Shopify Partners → App → API credentials\n"
    "- `DATABASE_URL`, `DIRECT_URL` — Supabase → Project Settings → Database\n"
    "- `WK_ALLOWED_SHOPS` — `wildandking-demo.myshopify.com`\n"
    "- `WK_SKIP_HMAC` — để trống, trừ khi test cục bộ\n\n"
    "Xem `docs/runbooks/credential-rotation.md` khi cần đổi secret.\n\n"
    "---\n\n"
) + s[end:]
p.write_text(s)
print("Đã xoá khối credential")
PY
```

- [ ] **Step 3: Xác nhận không còn secret nào trong file đang theo dõi**

Run:
```bash
grep -rn "shpss_\|pooler.supabase.com:6543/postgres" README.md docs/ || echo "SẠCH"
```
Expected: in ra `SẠCH`

- [ ] **Step 4: Viết runbook rotate**

Tạo `docs/runbooks/credential-rotation.md`:

```markdown
# Runbook — Rotate credential

Chạy quy trình này khi: có người rời dự án, nghi ngờ lộ secret, hoặc secret
từng bị commit vào git.

> **Lịch sử:** `SHOPIFY_API_SECRET` và password Supabase từng được commit
> trong `README.md` (đã xoá ở commit của P0). Giá trị vẫn nằm trong git
> history, nên **hai secret đó phải được rotate** — xoá file không đủ.

## 1. Shopify API secret

1. Shopify Partners → Apps → **Wild & King Customizer** → API credentials.
2. Bấm **Rotate** cho client secret. Ghi lại giá trị mới.
3. Cập nhật `SHOPIFY_API_SECRET`:
   - Vercel → project `wild-king-customizer` → Settings → Environment Variables (scope Production)
   - File `.env` cục bộ của từng người
4. Vercel → Deployments → **Redeploy** (biến môi trường chỉ có hiệu lực sau redeploy).
5. Kiểm chứng: một request App Proxy thật phải trả 200, và một request sai
   chữ ký phải trả 401.

**Ảnh hưởng:** secret này dùng để verify HMAC của App Proxy và webhook.
Giữa lúc rotate và lúc redeploy xong, request sẽ bị từ chối. Làm ngoài giờ
cao điểm.

## 2. Password database Supabase

1. Supabase → Project Settings → Database → **Reset database password**.
2. Cập nhật **cả hai** connection string — chúng dùng chung một password:
   - `DATABASE_URL` — pooled, port `6543`, giữ nguyên `?pgbouncer=true&connection_limit=1`
   - `DIRECT_URL` — direct, port `5432`
3. Cập nhật ở cả Vercel và `.env` cục bộ.
4. Vercel → Redeploy.
5. Kiểm chứng: mở `/admin`, KPI phải load được (không có `PrismaClientInitializationError`).

## 3. Access token của shop

Access token lưu trong bảng `Shop` không tự hết hạn. Nếu cần thu hồi:

1. Shopify Admin của shop → Settings → Apps → gỡ cài **Wild & King Customizer**.
   Webhook `app/uninstalled` sẽ đặt `Shop.installed = false`.
2. Cài lại app để cấp token mới.

## 4. Sau khi rotate

- [ ] Xác nhận không còn secret trong file đang theo dõi:
      `git grep -n "shpss_\|pooler.supabase.com"`
- [ ] Repo vẫn để **private**.
- [ ] Ghi lại ngày rotate ở cuối file này.

## Nhật ký rotate

| Ngày | Secret | Người thực hiện | Lý do |
|---|---|---|---|
| | | | |
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/runbooks/credential-rotation.md
git commit -m "docs(security): xoá credential thật khỏi README, thêm runbook rotate

README từng chứa SHOPIFY_API_SECRET và password Supabase thật, đã commit
vào git history. Xoá khỏi file không đủ — runbook ghi rõ hai secret này
BẮT BUỘC phải rotate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Gate nghiệm thu P0

Chạy toàn bộ trước khi coi phase này là xong:

- [ ] `npm test` — toàn bộ test xanh (22 test trên 3 file)
- [ ] `npx tsc --noEmit` — không có lỗi type
- [ ] `npm run build` — build thành công
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/products` → `401`
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/orders` → `401`
- [ ] `grep -rn 'NODE_ENV === "production"' src/app` → không có kết quả
- [ ] `git grep -n "shpss_"` → không có kết quả trong file đang theo dõi
- [ ] Đặt `WK_SKIP_HMAC=1 NODE_ENV=production` rồi gọi một route proxy → app ném lỗi, không phục vụ request

## Việc thủ công ngoài phạm vi code

Hai việc này **con người phải làm**, agent không làm thay được:

1. **Rotate `SHOPIFY_API_SECRET`** trên Shopify Partners, cập nhật Vercel, redeploy.
2. **Reset password Supabase**, cập nhật cả `DATABASE_URL` và `DIRECT_URL` trên Vercel, redeploy.

Thêm `WK_ALLOWED_SHOPS=wildandking-demo.myshopify.com` vào Vercel Environment Variables trong cùng lần chỉnh.
