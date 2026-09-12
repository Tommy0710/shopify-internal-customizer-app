/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge, type MockAdminFetchResponse } from "@/lib/admin-ui/testFetch";
import { ATTRIBUTE_FIELD_CONFIG, AttributeDrawer } from "@/components/admin/AttributeDrawer";
import { renderWithPolaris } from "../../helpers/renderWithPolaris";
import { ATTRIBUTE_KINDS, ATTRIBUTE_PATH, makeAttribute, pngFile, uploadAssetResponse } from "../../helpers/attributeFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillAndUpload(label: string, filename: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [pngFile(filename)] } });
  await waitFor(() => expect(screen.queryByText("Đang tải lên…")).not.toBeInTheDocument());
}

describe("AttributeDrawer — field differences theo nhóm (spec §12.1)", () => {
  it.each(ATTRIBUTE_KINDS)("kind=%s: hiển thị đúng field", (kind) => {
    const config = ATTRIBUTE_FIELD_CONFIG[kind];
    renderWithPolaris(<AttributeDrawer kind={kind} item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText("Tên")).toBeInTheDocument();

    if (config.hasDisplayImage) {
      expect(screen.getByLabelText("Ảnh hiển thị")).toBeInTheDocument();
    } else {
      expect(screen.queryByLabelText("Ảnh hiển thị")).not.toBeInTheDocument();
    }

    if (config.hasTexture) {
      expect(screen.getByLabelText("Ảnh texture")).toBeInTheDocument();
    } else {
      expect(screen.queryByLabelText("Ảnh texture")).not.toBeInTheDocument();
    }

    if (config.hasColor) {
      expect(screen.getByLabelText("Mã màu (hex)")).toBeInTheDocument();
    } else {
      expect(screen.queryByLabelText("Mã màu (hex)")).not.toBeInTheDocument();
    }
  });

  // Khoá đúng bảng field của spec §12.1 — không chỉ kiểm cấu hình nội bộ mà
  // kiểm CHÍNH XÁC leathers có cả hai field ảnh (điểm khác biệt duy nhất so
  // với animals/styles chỉ có một).
  it("leathers: có cả ảnh hiển thị lẫn ảnh texture, không có màu", () => {
    renderWithPolaris(<AttributeDrawer kind="leathers" item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Ảnh hiển thị")).toBeInTheDocument();
    expect(screen.getByLabelText("Ảnh texture")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mã màu (hex)")).not.toBeInTheDocument();
  });

  it("stitches: có màu, không có ảnh texture", () => {
    renderWithPolaris(<AttributeDrawer kind="stitches" item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Mã màu (hex)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ảnh texture")).not.toBeInTheDocument();
  });

  it.each(["animals", "styles"] as const)("kind=%s: chỉ có một ảnh hiển thị, không texture, không màu", (kind) => {
    renderWithPolaris(<AttributeDrawer kind={kind} item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Ảnh hiển thị")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ảnh texture")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mã màu (hex)")).not.toBeInTheDocument();
  });
});

describe("AttributeDrawer — prefill khi sửa", () => {
  it.each(ATTRIBUTE_KINDS)("kind=%s: điền sẵn tên, trạng thái active, và ảnh/màu hiện có", (kind) => {
    const item = makeAttribute(kind, { name: "Existing Item", isActive: false });
    renderWithPolaris(<AttributeDrawer kind={kind} item={item} open onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByDisplayValue("Existing Item")).toBeInTheDocument();
    expect(screen.getByLabelText("Đang hoạt động")).not.toBeChecked();
    expect(screen.getByAltText("display-1.png")).toHaveAttribute("src", "https://cdn.test/display-1.png");

    if (kind === "leathers") {
      expect(screen.getByAltText("texture-1.png")).toHaveAttribute("src", "https://cdn.test/texture-1.png");
    }
    if (kind === "stitches") {
      expect(screen.getByDisplayValue("#112233")).toBeInTheDocument();
    }
  });
});

describe("AttributeDrawer — validate bắt buộc trước khi submit", () => {
  it.each(ATTRIBUTE_KINDS)("kind=%s: thiếu field bắt buộc chặn submit, không gọi API", async (kind) => {
    stubAppBridge();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<AttributeDrawer kind={kind} item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "Something" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    const config = ATTRIBUTE_FIELD_CONFIG[kind];
    const expectedMessage = config.displayRequired ? /Ảnh hiển thị là bắt buộc/ : /Mã màu là bắt buộc/;
    await waitFor(() => expect(screen.getByText(expectedMessage)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leathers: có ảnh hiển thị nhưng thiếu ảnh texture vẫn bị chặn", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", mockAdminFetchResponses({ "POST /api/admin/assets": uploadAssetResponse("DISPLAY") }));

    renderWithPolaris(<AttributeDrawer kind="leathers" item={null} open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "Leather X" } });
    await fillAndUpload("Ảnh hiển thị", "display.png");

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.getByText(/Ảnh texture là bắt buộc/)).toBeInTheDocument());
  });
});

describe("AttributeDrawer — submit", () => {
  it.each(ATTRIBUTE_KINDS)("kind=%s: tạo mới gửi đúng body lên POST /api/admin/%s", async (kind) => {
    stubAppBridge();
    const config = ATTRIBUTE_FIELD_CONFIG[kind];
    const created = makeAttribute(kind, { id: "new-1", name: "Brand New" });

    const responses: Record<string, MockAdminFetchResponse> = {
      [`POST ${ATTRIBUTE_PATH[kind]}`]: { status: 201, body: created },
    };
    if (config.hasDisplayImage) responses["POST /api/admin/assets"] = uploadAssetResponse("DISPLAY");
    const fetchMock = mockAdminFetchResponses(responses);
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithPolaris(<AttributeDrawer kind={kind} item={null} open onClose={onClose} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Tên"), { target: { value: "Brand New" } });
    if (config.displayRequired) await fillAndUpload("Ảnh hiển thị", "display.png");
    if (config.hasTexture) await fillAndUpload("Ảnh texture", "texture.png");
    if (config.hasColor) fireEvent.change(screen.getByLabelText("Mã màu (hex)"), { target: { value: "#ffffff" } });

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();

    const postCall = vi
      .mocked(fetchMock)
      .mock.calls.find(([input, init]) => String(input) === ATTRIBUTE_PATH[kind] && (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.name).toBe("Brand New");
    expect(body.isActive).toBe(true);
    if (config.hasColor) expect(body.colorHex).toBe("#ffffff");
    if (config.hasTexture) expect(body.textureImageAssetId).toBeTruthy();
    if (config.displayRequired) expect(body.displayImageAssetId).toBeTruthy();
  });

  it.each(ATTRIBUTE_KINDS)("kind=%s: sửa gửi PATCH /api/admin/%s/:id, gọi onSaved với response mutation", async (kind) => {
    stubAppBridge();
    const item = makeAttribute(kind, { id: "edit-1", name: "Before" });
    const updated = { ...item, name: "After" };
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({ [`PATCH ${ATTRIBUTE_PATH[kind]}/edit-1`]: { status: 200, body: updated } }),
    );

    const onSaved = vi.fn();
    renderWithPolaris(<AttributeDrawer kind={kind} item={item} open onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByDisplayValue("Before"), { target: { value: "After" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  });

  it("hiển thị banner lỗi khi PATCH thất bại, drawer KHÔNG tự đóng", async () => {
    stubAppBridge();
    const item = makeAttribute("animals", { id: "e1", name: "Foo" });
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({ "PATCH /api/admin/animals/e1": { status: 409, body: { error: "SOME_CONFLICT" } } }),
    );
    const onClose = vi.fn();
    renderWithPolaris(<AttributeDrawer kind="animals" item={item} open onClose={onClose} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(screen.getByText(/SOME_CONFLICT/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
