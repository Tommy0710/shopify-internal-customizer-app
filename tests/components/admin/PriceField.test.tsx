/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PriceField } from "@/components/admin/PriceField";
import { renderWithPolaris } from "../../helpers/renderWithPolaris";

afterEach(() => {
  cleanup();
});


/**
 * Wrapper mô phỏng đúng cách một màn hình thật (Task 3+) sẽ dùng PriceField:
 * giữ `value` ở state cha, chỉ cập nhật khi `onChange` được gọi. Test theo
 * dõi qua `onChangeSpy` cái gì THỰC SỰ được gửi lên cha — đó chính là cái sẽ
 * đi vào request PUT/PATCH sau này.
 */
function ControlledPriceField({ onChangeSpy }: { onChangeSpy: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <PriceField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy(next);
      }}
    />
  );
}

describe("PriceField", () => {
  it("chấp nhận '80' — onChange nhận đúng chuỗi đó", () => {
    const spy = vi.fn();
    renderWithPolaris(<ControlledPriceField onChangeSpy={spy} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "80" } });

    expect(spy).toHaveBeenCalledWith("80");
  });

  it("chấp nhận '80.50' — onChange nhận đúng chuỗi đó", () => {
    const spy = vi.fn();
    renderWithPolaris(<ControlledPriceField onChangeSpy={spy} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "80.50" } });

    expect(spy).toHaveBeenCalledWith("80.50");
  });

  it("từ chối '80.555' (quá 2 chữ số thập phân) TRƯỚC KHI đi ra ngoài qua onChange", () => {
    const spy = vi.fn();
    renderWithPolaris(<ControlledPriceField onChangeSpy={spy} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "80.555" } });

    expect(spy).not.toHaveBeenCalledWith("80.555");
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText(/80 hoặc 80\.50/)).toBeInTheDocument();
  });

  it("giá trị rỗng hợp lệ — đại diện 'chưa có giá', onChange nhận null", () => {
    const spy = vi.fn();
    renderWithPolaris(<ControlledPriceField onChangeSpy={spy} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "80" } });
    spy.mockClear();
    fireEvent.change(input, { target: { value: "" } });

    expect(spy).toHaveBeenCalledWith(null);
  });

  it("ô trống vẫn hiển thị hợp lệ (không có lỗi)", () => {
    renderWithPolaris(<ControlledPriceField onChangeSpy={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.queryByText(/80 hoặc 80\.50/)).not.toBeInTheDocument();
  });
});
