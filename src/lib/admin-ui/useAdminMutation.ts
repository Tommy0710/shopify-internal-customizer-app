"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError, adminFetch } from "./adminFetch";

/**
 * `POST`/`PATCH`/`PUT`/`DELETE` hand-rolled, cùng triết lý với `useAdminQuery`.
 *
 * `mutate()` LUÔN reject bằng `AdminApiError` khi lỗi — caller nào muốn tự
 * `try/catch` (ví dụ chặn điều hướng sau khi tạo mới) vẫn làm được — ĐỒNG THỜI
 * set `error` state, để caller nào muốn render lỗi inline (qua
 * `<AdminErrorBanner error={error} />`) không bắt buộc phải bọc try/catch.
 * Task 3 trở đi dùng cả hai kiểu tuỳ màn hình, nên cả hai đường phải luôn
 * đúng cùng lúc — không phải "chọn một".
 *
 * `body` luôn đi qua `JSON.stringify` — đúng cho mọi route P2a (list PUT,
 * PATCH readiness, v.v). Upload file (multipart) KHÔNG dùng hook này —
 * `AssetUploadField` gọi thẳng `adminFetch` với `FormData` làm body.
 */
export interface UseAdminMutationResult<TBody, TResult> {
  mutate: (path: string, body?: TBody) => Promise<TResult>;
  loading: boolean;
  error: AdminApiError | null;
}

function toAdminApiError(error: unknown): AdminApiError {
  return error instanceof AdminApiError
    ? error
    : new AdminApiError(0, null, null, error instanceof Error ? error.message : String(error));
}

export function useAdminMutation<TBody = unknown, TResult = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
): UseAdminMutationResult<TBody, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (path: string, body?: TBody): Promise<TResult> => {
      setLoading(true);
      setError(null);

      try {
        const result = await adminFetch<TResult>(path, {
          method,
          headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (mountedRef.current) setLoading(false);
        return result;
      } catch (err) {
        const apiError = toAdminApiError(err);
        if (mountedRef.current) {
          setError(apiError);
          setLoading(false);
        }
        throw apiError;
      }
    },
    [method],
  );

  return { mutate, loading, error };
}
