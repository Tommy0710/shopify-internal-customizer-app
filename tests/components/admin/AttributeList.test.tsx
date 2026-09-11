/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { AttributeList } from "@/components/admin/AttributeList";
import { ATTRIBUTE_FIELD_CONFIG } from "@/components/admin/AttributeDrawer";
import { renderWithPolaris } from "../../helpers/renderWithPolaris";
import { ATTRIBUTE_KINDS, ATTRIBUTE_PATH, makeAttribute, pngFile, uploadAssetResponse } from "../../helpers/attributeFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Chờ đúng một upload settle (thành công hay lỗi) trước khi làm bước tiếp
 * theo — tránh đua giữa hai `AssetUploadField` khác nhau trong cùng drawer. */
async function fillAndUpload(label: string, filename: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [pngFile(filename)] } });
  await waitFor(() => expect(screen.queryByText("Đang tải lên…")).not.toBeInTheDocument());
}

describe("AttributeList", () => {
  it.each(ATTRIBUTE_KINDS)("kind=%s: danh sách hiển thị theo sortOrder tăng dần", async (kind) => {
    stubAppBridge();
    const items = [
      makeAttribute(kind, { id: "c", name: "Third", sortOrder: 2 }),
      makeAttribute(kind, { id: "a", name: "First", sortOrder: 0 }),
      makeAttribute(kind, { id: "b", name: "Second", sortOrder: 1 }),
    ];
    vi.stubGlobal("fetch", mockAdminFetchResponses({ [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items } } }));

    renderWithPolaris(<AttributeList kind={kind} />);

    await waitFor(() => expect(screen.getByTestId("attribute-active-list")).toBeInTheDocument());
    const rows = within(screen.getByTestId("attribute-active-list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("Third"),
    ]);
  });

  it.each(ATTRIBUTE_KINDS)("kind=%s: ẩn item đã lưu trữ mặc định, toggle 'Hiện cả đã lưu trữ' hiện lại", async (kind) => {
    stubAppBridge();
    const active = makeAttribute(kind, { id: "a", name: "Active One", sortOrder: 0 });
    const archived = makeAttribute(kind, {
      id: "b",
      name: "Archived One",
      sortOrder: 1,
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [active] } },
        [`GET ${ATTRIBUTE_PATH[kind]}?includeArchived=true`]: { status: 200, body: { items: [active, archived] } },
      }),
    );

    renderWithPolaris(<AttributeList kind={kind} />);

    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    expect(screen.queryByText("Archived One")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Hiện cả đã lưu trữ"));

    await waitFor(() => expect(screen.getByText("Archived One")).toBeInTheDocument());
  });

  it.each(ATTRIBUTE_KINDS)("kind=%s: click vào hàng mở drawer đã điền sẵn tên", async (kind) => {
    stubAppBridge();
    const item = makeAttribute(kind, { id: "a", name: "Edit Me", sortOrder: 0 });
    vi.stubGlobal("fetch", mockAdminFetchResponses({ [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [item] } } }));

    renderWithPolaris(<AttributeList kind={kind} />);
    await waitFor(() => expect(screen.getByText("Edit Me")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Edit Me" }));

    await screen.findByText("Sửa Edit Me");
    expect(screen.getByDisplayValue("Edit Me")).toBeInTheDocument();
  });

  it.each(ATTRIBUTE_KINDS)(
    "kind=%s: lưu (PATCH) đóng drawer, cập nhật danh sách từ response mutation, KHÔNG gọi GET lần hai",
    async (kind) => {
      stubAppBridge();
      const item = makeAttribute(kind, { id: "a", name: "Old Name", sortOrder: 0 });
      const updated = { ...item, name: "New Name" };
      const fetchMock = mockAdminFetchResponses({
        [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [item] } },
        [`PATCH ${ATTRIBUTE_PATH[kind]}/a`]: { status: 200, body: updated },
      });
      vi.stubGlobal("fetch", fetchMock);

      renderWithPolaris(<AttributeList kind={kind} />);
      await waitFor(() => expect(screen.getByText("Old Name")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Old Name" }));
      const nameInput = await screen.findByDisplayValue("Old Name");
      fireEvent.change(nameInput, { target: { value: "New Name" } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

      await waitFor(() => expect(screen.getByText("New Name")).toBeInTheDocument());
      expect(screen.queryByText("Old Name")).not.toBeInTheDocument();
      // Modal Polaris giữ nội dung trong DOM một nhịp cho animation đóng —
      // đợi nó biến mất thay vì kiểm ngay lập tức (transition, không phải
      // lỗi state).
      await waitFor(() => expect(screen.queryByText("Sửa Old Name")).not.toBeInTheDocument());

      const getCalls = vi.mocked(fetchMock).mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET");
      expect(getCalls).toHaveLength(1);
    },
  );

  it.each(ATTRIBUTE_KINDS)("kind=%s: tạo mới (POST) thêm vào danh sách", async (kind) => {
    stubAppBridge();
    const config = ATTRIBUTE_FIELD_CONFIG[kind];
    const created = makeAttribute(kind, { id: "new-1", name: "New Item", sortOrder: 0 });

    const responses: Record<string, ReturnType<typeof uploadAssetResponse>> = {
      [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [] } },
      [`POST ${ATTRIBUTE_PATH[kind]}`]: { status: 201, body: created },
    };
    if (config.hasDisplayImage) responses["POST /api/admin/assets"] = uploadAssetResponse("DISPLAY");
    vi.stubGlobal("fetch", mockAdminFetchResponses(responses));

    renderWithPolaris(<AttributeList kind={kind} />);
    await waitFor(() => expect(screen.getByText("Chưa có mục nào.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Thêm mới" }));
    const nameInput = await screen.findByLabelText("Tên");
    fireEvent.change(nameInput, { target: { value: "New Item" } });

    if (config.displayRequired) await fillAndUpload("Ảnh hiển thị", "display.png");
    if (config.hasTexture) await fillAndUpload("Ảnh texture", "texture.png");
    if (config.hasColor) fireEvent.change(screen.getByLabelText("Mã màu (hex)"), { target: { value: "#abcdef" } });

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(screen.getByText("New Item")).toBeInTheDocument());
  });

  it.each(ATTRIBUTE_KINDS)("kind=%s: lưu trữ (DELETE) xoá khỏi danh sách mặc định", async (kind) => {
    stubAppBridge();
    const item = makeAttribute(kind, { id: "a", name: "To Archive", sortOrder: 0 });
    const archived = { ...item, archivedAt: "2026-01-01T00:00:00.000Z" };
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [item] } },
        [`DELETE ${ATTRIBUTE_PATH[kind]}/a`]: { status: 200, body: archived },
      }),
    );

    renderWithPolaris(<AttributeList kind={kind} />);
    await waitFor(() => expect(screen.getByText("To Archive")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Lưu trữ" }));

    await waitFor(() => expect(screen.queryByText("To Archive")).not.toBeInTheDocument());
  });

  it.each(ATTRIBUTE_KINDS)("kind=%s: sắp lại thứ tự gửi POST reorder với đầy đủ id đang hiển thị", async (kind) => {
    stubAppBridge();
    const a = makeAttribute(kind, { id: "a", name: "First", sortOrder: 0 });
    const b = makeAttribute(kind, { id: "b", name: "Second", sortOrder: 1 });
    const fetchMock = mockAdminFetchResponses({
      [`GET ${ATTRIBUTE_PATH[kind]}`]: { status: 200, body: { items: [a, b] } },
      [`POST ${ATTRIBUTE_PATH[kind]}/reorder`]: { status: 200, body: { ok: true } },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<AttributeList kind={kind} />);
    await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Di chuyển Second lên" }));

    await waitFor(() => {
      const reorderCall = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input).includes("/reorder"));
      expect(reorderCall).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input).includes("/reorder"))!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ orderedIds: ["b", "a"] });
  });

  it.each(ATTRIBUTE_KINDS)(
    "kind=%s: reorder 409 STALE_ORDER hiện banner và tự refetch, không lặng lẽ bỏ qua",
    async (kind) => {
      stubAppBridge();
      const a = makeAttribute(kind, { id: "a", name: "First", sortOrder: 0 });
      const b = makeAttribute(kind, { id: "b", name: "Second", sortOrder: 1 });
      const refreshed = [
        makeAttribute(kind, { id: "a", name: "First", sortOrder: 0 }),
        makeAttribute(kind, { id: "b", name: "Second", sortOrder: 1 }),
        makeAttribute(kind, { id: "c", name: "Third moi", sortOrder: 2 }),
      ];
      let getCallCount = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = typeof input === "string" ? input : String(input);
        if (method === "GET" && path === ATTRIBUTE_PATH[kind]) {
          getCallCount += 1;
          const body = getCallCount === 1 ? { items: [a, b] } : { items: refreshed };
          return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (method === "POST" && path === `${ATTRIBUTE_PATH[kind]}/reorder`) {
          return new Response(JSON.stringify({ error: "STALE_ORDER" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unmocked ${method} ${path}`);
      }) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      renderWithPolaris(<AttributeList kind={kind} />);
      await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Di chuyển Second lên" }));

      await waitFor(() => expect(screen.getByText(/đã bị thay đổi/i)).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText("Third moi")).toBeInTheDocument());
    },
  );
});
