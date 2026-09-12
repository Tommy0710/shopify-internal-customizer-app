"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "./adminFetch";

/**
 * `GET` hand-rolled: không SWR/react-query (Global Constraints P2c) — bề mặt
 * API đã biết trước và bounded, một hook `useState`/`useEffect` là đủ.
 *
 * `enabled:false` không bao giờ gọi `adminFetch` — dùng cho query phụ thuộc
 * (ví dụ chờ có `productId` mới fetch chi tiết sản phẩm).
 *
 * `refetch()` đổi một token nội bộ để buộc effect chạy lại mà không cần đổi
 * `path` — Task 3 dùng nó sau khi `PUT`/`POST` xong để lấy lại danh sách mới
 * nhất khi không dùng được response của chính mutation đó.
 *
 * Mọi nhánh set state đều được gác bởi cờ `cancelled` cục bộ của LẦN CHẠY
 * EFFECT đó — unmount (cleanup effect) hay đổi `path`/`enabled` giữa chừng
 * đều bật cờ, nên request cũ trả về sau không bao giờ gọi `setState` trên một
 * component đã rời cây hoặc ghi đè kết quả của request mới hơn.
 */
export interface UseAdminQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: AdminApiError | null;
  refetch: () => void;
}

function toAdminApiError(error: unknown): AdminApiError {
  return error instanceof AdminApiError
    ? error
    : new AdminApiError(0, null, null, error instanceof Error ? error.message : String(error));
}

export function useAdminQuery<T>(path: string, opts?: { enabled?: boolean }): UseAdminQueryResult<T> {
  const enabled = opts?.enabled ?? true;

  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    adminFetch<T>(path).then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(toAdminApiError(err));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, reloadToken]);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { data, loading, error, refetch };
}
