"use client";

import { useEffect, useState } from "react";
import { TextField } from "@shopify/polaris";

/**
 * Mirror RÚT GỌN của `priceSchema` (`src/lib/admin/money.ts`) — chỉ phần
 * "hình chuỗi có hợp lệ không", KHÔNG mirror cách quy đổi ra cent hay giới
 * hạn `MAX_CENTS`. Đây là kiểm phía client cho UX rẻ tiền (chặn gõ sai TRƯỚC
 * khi request đi ra); server (`priceSchema`) vẫn là nơi quyết định cuối cùng.
 */
const PRICE_STRING = /^\d{1,8}(?:\.\d{1,2})?$/;

export function isPriceShapeValid(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || PRICE_STRING.test(trimmed);
}

export interface PriceFieldProps {
  /** `null` = chưa có giá (API cho `price` nullable) */
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  disabled?: boolean;
}

/**
 * Text input ràng hình chuỗi tiền. Giữ một bản nháp (`draft`) tách khỏi
 * `value` của cha: người dùng gõ tự do (kể cả trạng thái tạm thời như "80."
 * trước khi gõ tiếp chữ số thập phân), nhưng `onChange` — cái cha dùng để
 * dựng body request — CHỈ được gọi khi chuỗi đã hợp lệ hoặc rỗng. Một chuỗi
 * như "80.555" không hợp lệ không bao giờ chạm tới `onChange`, tức không bao
 * giờ có cơ hội lọt vào một request PUT/PATCH — đúng yêu cầu "reject trước
 * khi request đi ra", không phải "reject lúc submit".
 */
export function PriceField({ value, onChange, label = "Giá", disabled }: PriceFieldProps) {
  const [draft, setDraft] = useState(value ?? "");

  // Đồng bộ lại khi cha đổi `value` từ bên ngoài (ví dụ nạp lại sau khi lưu
  // thành công, hoặc reset form) — không đồng bộ theo hướng ngược lại vì
  // draft không hợp lệ cố tình không lan lên `value` của cha.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const trimmed = draft.trim();
  const invalid = trimmed !== "" && !PRICE_STRING.test(trimmed);

  function handleChange(next: string): void {
    setDraft(next);
    const nextTrimmed = next.trim();
    if (nextTrimmed === "") {
      onChange(null);
      return;
    }
    if (PRICE_STRING.test(nextTrimmed)) {
      onChange(nextTrimmed);
    }
    // Hình sai (quá 2 chữ số thập phân, chữ cái, số âm, …): giữ draft để
    // người dùng thấy cái mình vừa gõ và lỗi tương ứng, không gọi onChange.
  }

  return (
    <TextField
      label={label}
      labelHidden
      value={draft}
      onChange={handleChange}
      autoComplete="off"
      disabled={disabled}
      placeholder="80.00"
      error={invalid ? "Giá phải có dạng 80 hoặc 80.50" : undefined}
    />
  );
}
