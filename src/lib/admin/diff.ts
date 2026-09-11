/**
 * Diff thuần cho khuôn `PUT` của mọi quan hệ Product (host/style/animal/stitch,
 * §12.2). Admin luôn gửi TOÀN BỘ danh sách mong muốn; route so nó với hàng đã
 * có trong DB rồi quyết định tạo/cập nhật/(vô hiệu hoặc xoá tuỳ bảng — xem
 * R4 trong `products.ts`). Hàm này không chạm DB, không import Prisma — thuần
 * để test hermetic, và để logic diff không lẫn với quyết định ghi gì ở caller.
 */

/** Phần tử trùng khoá trong MỘT danh sách — dùng để phát hiện lỗi input trước khi diff. */
export function duplicateKeys<T>(items: readonly T[], key: (t: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const reported = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) {
      if (!reported.has(k)) {
        reported.add(k);
        duplicates.push(k);
      }
    } else {
      seen.add(k);
    }
  }
  return duplicates;
}

export interface DiffResult<D, E> {
  /** Phần tử `desired` không khớp khoá nào trong `existing` — giữ nguyên thứ tự của `desired`. */
  toCreate: D[];
  /** Cặp khớp khoá — `desired` là dữ liệu mới, `existing` là hàng DB hiện tại (để lấy `id`). */
  toUpdate: Array<{ desired: D; existing: E }>;
  /** Hàng `existing` không có khoá nào trong `desired` — "vắng mặt khỏi danh sách". */
  missing: E[];
}

export function diffByKey<D, E>(
  desired: readonly D[],
  existing: readonly E[],
  keyOfDesired: (d: D) => string,
  keyOfExisting: (e: E) => string,
): DiffResult<D, E> {
  const existingByKey = new Map<string, E>();
  for (const e of existing) existingByKey.set(keyOfExisting(e), e);

  const desiredKeys = new Set<string>();
  const toCreate: D[] = [];
  const toUpdate: Array<{ desired: D; existing: E }> = [];

  for (const d of desired) {
    const k = keyOfDesired(d);
    desiredKeys.add(k);
    const existingRow = existingByKey.get(k);
    if (existingRow) {
      toUpdate.push({ desired: d, existing: existingRow });
    } else {
      toCreate.push(d);
    }
  }

  const missing = existing.filter((e) => !desiredKeys.has(keyOfExisting(e)));

  return { toCreate, toUpdate, missing };
}
