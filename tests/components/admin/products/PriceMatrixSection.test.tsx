/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { PriceMatrixSection, type PriceMatrixKind } from "@/components/admin/products/PriceMatrixSection";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import {
  makeAnimalRelation,
  makePriceCell,
  makePriceCellVariant,
  makeProductTree,
  makeRelationAttribute,
  makeStyleRelation,
} from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MATRICES: PriceMatrixKind[] = ["style", "animal"];

function groupPutPath(matrix: PriceMatrixKind, productId: string, groupId: string): string {
  return matrix === "style"
    ? `/api/admin/products/${productId}/styles/${groupId}/leathers`
    : `/api/admin/products/${productId}/animals/${groupId}/leathers`;
}

function productWithGroup(
  matrix: PriceMatrixKind,
  groupId: string,
  groupName: string,
  leathers: ReturnType<typeof makePriceCell>[],
) {
  if (matrix === "style") {
    return makeProductTree({ id: "prod-1", styles: [makeStyleRelation({ styleId: groupId, name: groupName, leathers })] });
  }
  return makeProductTree({ id: "prod-1", animals: [makeAnimalRelation({ animalId: groupId, name: groupName, leathers })] });
}

async function openGroup(groupName: string): Promise<void> {
  await waitFor(() => expect(screen.getByText(groupName)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: `Mở/đóng nhóm ${groupName}` }));
}

describe.each(MATRICES)("PriceMatrixSection matrix=%s", (matrix) => {
  const leathersPath = "/api/admin/leathers";

  it("hiện cấu trúc nhóm gấp/mở — hàng leather chỉ lộ ra sau khi bấm mở nhóm", async () => {
    stubAppBridge();
    const cell = makePriceCell({ leatherId: "l1", name: "Suede Brown" });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${leathersPath}`]: { status: 200, body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown" })] } },
      }),
    );

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [cell])} />);

    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());
    expect(screen.queryByLabelText("Suede Brown")).not.toBeInTheDocument();

    await openGroup("Minimalist");

    expect(await screen.findByLabelText("Suede Brown")).toBeInTheDocument();
  });

  it("sửa giá một hàng rồi lưu — PUT toàn bộ danh sách hàng đang active của nhóm, không chỉ hàng vừa sửa", async () => {
    stubAppBridge();
    const cellA = makePriceCell({ leatherId: "l1", name: "Suede Brown", price: "80.00", sortOrder: 0 });
    const cellB = makePriceCell({ leatherId: "l2", name: "Togo Brown", price: "95.00", sortOrder: 1 });
    const putPath = groupPutPath(matrix, "prod-1", "g1");
    const fetchMock = mockAdminFetchResponses({
      [`GET ${leathersPath}`]: {
        status: 200,
        body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown" }), makeRelationAttribute({ id: "l2", name: "Togo Brown" })] },
      },
      [`PUT ${putPath}`]: { status: 200, body: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [cellA, cellB])} />);
    await openGroup("Minimalist");

    const priceInput = await screen.findByLabelText("Giá Suede Brown");
    fireEvent.change(priceInput, { target: { value: "82.50" } });

    fireEvent.click(screen.getByRole("button", { name: /^Lưu giá Minimalist$/i }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath);
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath)!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ leatherId: "l1", price: "82.50", isActive: true, sortOrder: 0 }),
        expect.objectContaining({ leatherId: "l2", price: "95.00", isActive: true, sortOrder: 1 }),
      ]),
    );
    expect(body).toHaveLength(2);
  });

  it("bỏ tick một hàng đang active rồi lưu — hàng vẫn hiện trong danh sách, không claim 'không còn tồn tại', và không có trong PUT", async () => {
    stubAppBridge();
    const cell = makePriceCell({ leatherId: "l1", name: "Suede Brown", price: "80.00", sortOrder: 0, isActive: true });
    const putPath = groupPutPath(matrix, "prod-1", "g1");
    const fetchMock = mockAdminFetchResponses({
      [`GET ${leathersPath}`]: { status: 200, body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown" })] } },
      [`PUT ${putPath}`]: { status: 200, body: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [cell])} />);
    await openGroup("Minimalist");

    const checkbox = await screen.findByLabelText("Suede Brown");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    // Vẫn hiện diện — không biến mất khỏi danh sách.
    expect(screen.getByText("Suede Brown")).toBeInTheDocument();
    expect(screen.queryByText(/không còn tồn tại/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer exist/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Lưu giá Minimalist$/i }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath);
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath)!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([]);
  });

  it("cột trạng thái variant hiện đúng ba trạng thái: chưa có / có và khoẻ mạnh / có nhưng missing", async () => {
    stubAppBridge();
    const cells = [
      makePriceCell({ leatherId: "l1", name: "No Variant", variant: null }),
      makePriceCell({ leatherId: "l2", name: "Healthy", variant: makePriceCellVariant({ shopifyVariantId: "44920001", missing: false }) }),
      makePriceCell({ leatherId: "l3", name: "Missing Variant", variant: makePriceCellVariant({ shopifyVariantId: "44930002", missing: true }) }),
    ];
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${leathersPath}`]: { status: 200, body: { items: cells.map((c) => makeRelationAttribute({ id: c.leatherId, name: c.name })) } },
      }),
    );

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", cells)} />);
    await openGroup("Minimalist");

    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.getByText(/^✓ 4492/)).toBeInTheDocument();
    expect(screen.getByText("⚠ missing")).toBeInTheDocument();
  });

  it("nút Generate variants hiện disabled kèm tooltip, không gọi endpoint nào", async () => {
    stubAppBridge();
    const fetchMock = mockAdminFetchResponses({ [`GET ${leathersPath}`]: { status: 200, body: { items: [] } } });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [])} />);
    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());

    const btn = screen.getByRole("button", { name: /Generate variants/i });
    // Polaris giữ nút vẫn focusable (không phải `disabled` DOM thật) khi bọc
    // trong Tooltip — để còn nhận focus/hover và hiện được lời giải thích;
    // trạng thái "đã tắt" thật sự phơi ra qua `aria-disabled` + class.
    expect(btn).toHaveAttribute("aria-disabled", "true");
    // Được bọc Tooltip thật (không chỉ text tĩnh) — `data-polaris-tooltip-activator`
    // được Tooltip tự gắn lúc mount, không cần giả lập hover (PositionedOverlay
    // cần geometry thật, tránh phụ thuộc điều đó — xem ghi chú Task 3 về jsdom).
    expect(document.querySelector('[data-polaris-tooltip-activator="true"]')).not.toBeNull();

    fireEvent.click(btn);
    expect(vi.mocked(fetchMock).mock.calls.filter(([input]) => String(input).includes("generate"))).toHaveLength(0);
  });

  it("gọi onSaved sau khi lưu nhóm thành công", async () => {
    stubAppBridge();
    const cell = makePriceCell({ leatherId: "l1", name: "Suede Brown" });
    const putPath = groupPutPath(matrix, "prod-1", "g1");
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${leathersPath}`]: { status: 200, body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown" })] } },
        [`PUT ${putPath}`]: { status: 200, body: [] },
      }),
    );
    const onSaved = vi.fn();

    renderWithPolaris(
      <PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [cell])} onSaved={onSaved} />,
    );
    await openGroup("Minimalist");
    await screen.findByLabelText("Suede Brown");

    fireEvent.click(screen.getByRole("button", { name: /^Lưu giá Minimalist$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("giữ nguyên sortOrder của hàng đã có khi lưu; hàng mới thêm được gán sortOrder mới, không recompute lại theo index (quyết định sortOrder của Task 5)", async () => {
    stubAppBridge();
    const cellA = makePriceCell({ leatherId: "l1", name: "A", sortOrder: 5, isActive: true });
    const cellB = makePriceCell({ leatherId: "l2", name: "B", sortOrder: 9, isActive: false });
    const putPath = groupPutPath(matrix, "prod-1", "g1");
    const fetchMock = mockAdminFetchResponses({
      [`GET ${leathersPath}`]: {
        status: 200,
        body: {
          items: [
            makeRelationAttribute({ id: "l1", name: "A" }),
            makeRelationAttribute({ id: "l2", name: "B" }),
            makeRelationAttribute({ id: "l3", name: "C" }),
          ],
        },
      },
      [`PUT ${putPath}`]: { status: 200, body: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<PriceMatrixSection matrix={matrix} product={productWithGroup(matrix, "g1", "Minimalist", [cellA, cellB])} />);
    await openGroup("Minimalist");

    // "C" chưa từng được thêm vào nhóm — tick để thêm mới.
    fireEvent.click(await screen.findByLabelText("C"));
    // "B" đang inactive — tick lại để bật.
    fireEvent.click(screen.getByLabelText("B"));

    fireEvent.click(screen.getByRole("button", { name: /^Lưu giá Minimalist$/i }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath);
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath)!;
    const body = JSON.parse((init as RequestInit).body as string) as Array<{ leatherId: string; sortOrder: number }>;
    const byId = Object.fromEntries(body.map((row) => [row.leatherId, row.sortOrder]));

    expect(byId.l1).toBe(5); // hàng cũ, không đụng tới — giữ nguyên sortOrder cũ.
    expect(byId.l2).toBe(9); // hàng cũ, chỉ bật lại — giữ nguyên sortOrder cũ, không recompute theo vị trí.
    expect(byId.l3).toBe(10); // hàng mới — gán sau max sortOrder hiện có (9 + 1).
  });
});
