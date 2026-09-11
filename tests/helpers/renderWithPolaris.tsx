import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

/**
 * Mọi component Polaris cần `useI18n()`, chỉ có khi cây bọc trong
 * `<AppProvider>` (xem `src/components/admin/AdminShell.tsx` — trong app
 * thật, `AdminShell` là `AppProvider` duy nhất; test component lẻ tự bọc lại
 * một bản mỏng bằng helper này để không phải phụ thuộc `AdminShell`).
 *
 * Dùng chung cho mọi test component Polaris thay vì mỗi file tự định nghĩa
 * lại — trước khi có file này, `PriceField.test.tsx` và
 * `AssetUploadField.test.tsx` mỗi cái có một bản sao giống hệt nhau.
 */
export function renderWithPolaris(ui: ReactElement) {
  return render(<AppProvider i18n={enTranslations}>{ui}</AppProvider>);
}
