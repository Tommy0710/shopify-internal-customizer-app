/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { SvgGridDrawer } from "@/components/admin/products/SvgGridDrawer";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import {
  makeAnimalRelation,
  makeMockupSvgText,
  makeRelationAttribute,
  makeStitchRelation,
  makeStyleAnimalCell,
  makeStyleRelation,
} from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const leathersPath = "/api/admin/leathers";
const putPath = "/api/admin/products/prod-1/styles/s1/animals";

function svgFile(name = "mockup.svg"): File {
  return new File([makeMockupSvgText()], name, { type: "image/svg+xml" });
}

/**
 * `mockAdminFetchResponses` (Task 1) chỉ biết `/api/admin/*` — drawer còn phải
 * `fetch()` thẳng URL public của asset SVG (Supabase Storage, không đi qua
 * `adminFetch`/session token) để lấy TEXT rồi tự parse. Helper này gộp cả hai:
 * URL text khớp trả `Response` text/svg+xml; mọi request khác uỷ quyền cho
 * `mockAdminFetchResponses` (vẫn ném ồn ào nếu chưa khai, đúng triết lý gốc).
 */
function stubFetchWithText(
  adminResponses: Record<string, { status: number; body: unknown }>,
  textResponses: Record<string, string>,
): ReturnType<typeof vi.fn> {
  const adminFetchMock = mockAdminFetchResponses(adminResponses);
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url in textResponses && (!init?.method || init.method === "GET")) {
      return new Response(textResponses[url], { status: 200, headers: { "Content-Type": "image/svg+xml" } });
    }
    return (adminFetchMock as unknown as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(input, init);
  });
}

const style = makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [] });
const animal = makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true });
const stitches = [
  makeStitchRelation({ stitchId: "st1", name: "Gold", colorHex: "#FFD700", isActive: true }),
  makeStitchRelation({ stitchId: "st2", name: "Cream", colorHex: "#FFFDD0", isActive: true }),
];

describe("SvgGridDrawer", () => {
  it("mở trống cho ô chưa có mockup — không có displayLabel/description, không preview", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", mockAdminFetchResponses({ [`GET ${leathersPath}`]: { status: 200, body: { items: [] } } }));

    renderWithPolaris(
      <SvgGridDrawer
        productId="prod-1"
        style={style}
        animal={animal}
        cell={null}
        stitches={stitches}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Minimalist.*Alligator/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nhãn hiển thị/i)).toHaveValue("");
    expect(screen.getByLabelText(/Mô tả/i)).toHaveValue("");
    expect(document.querySelector("[data-testid='svg-grid-preview'] svg")).toBeNull();
  });

  it("mở với ô đã có sẵn — prefill displayLabel/description/defaultStitchId/isActive, fetch svgUrl và render preview qua svg-engine", async () => {
    stubAppBridge();
    const svgText = makeMockupSvgText();
    const cell = makeStyleAnimalCell({
      animalId: "a1",
      svgAssetId: "asset-1",
      svgUrl: "https://cdn.test/mockup.svg",
      displayLabel: "Nhãn cũ",
      description: "Mô tả cũ",
      defaultStitchId: "st1",
      isActive: true,
    });
    const fetchMock = stubFetchWithText(
      {
        [`GET ${leathersPath}`]: {
          status: 200,
          body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown", textureImage: { assetId: "tex-1", url: "https://cdn.test/suede.png" } })] },
        },
      },
      { "https://cdn.test/mockup.svg": svgText },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(
      <SvgGridDrawer
        productId="prod-1"
        style={style}
        animal={animal}
        cell={cell}
        stitches={stitches}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue("Nhãn cũ")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mô tả cũ")).toBeInTheDocument();
    expect(screen.getByLabelText(/Đang hoạt động/i)).toBeChecked();

    // Đã fetch nội dung SVG từ svgUrl để chạy qua svg-engine (không phải chỉ hiện <img src=svgUrl>).
    await waitFor(() => {
      const called = vi.mocked(fetchMock).mock.calls.some(([input]) => String(input) === "https://cdn.test/mockup.svg");
      expect(called).toBe(true);
    });

    // Preview render ra đúng <svg> — chứng tỏ đi qua parse+applyTexture/applyStitchColor,
    // không phải chỉ nhúng <img src=svgUrl>.
    await waitFor(() => {
      const svgEl = document.querySelector("[data-testid='svg-grid-preview'] svg");
      expect(svgEl).not.toBeNull();
    });
    // defaultStitchId="st1" (Gold, #FFD700) đã được áp mặc định vào preview.
    await waitFor(() => {
      const html = document.querySelector("[data-testid='svg-grid-preview']")!.innerHTML;
      expect(html).toContain("#FFD700");
    });
  });

  it("chọn leather ở dropdown preview → applyTexture chạy, gán href texture vào artwork — không fetch lại", async () => {
    stubAppBridge();
    const svgText = makeMockupSvgText();
    const cell = makeStyleAnimalCell({ animalId: "a1", svgAssetId: "asset-1", svgUrl: "https://cdn.test/mockup.svg" });
    const fetchMock = stubFetchWithText(
      {
        [`GET ${leathersPath}`]: {
          status: 200,
          body: {
            items: [
              makeRelationAttribute({ id: "l1", name: "Suede Brown", textureImage: { assetId: "tex-1", url: "https://cdn.test/suede.png" } }),
              makeRelationAttribute({ id: "l2", name: "Togo Brown", textureImage: { assetId: "tex-2", url: "https://cdn.test/togo.png" } }),
            ],
          },
        },
      },
      { "https://cdn.test/mockup.svg": svgText },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(
      <SvgGridDrawer productId="prod-1" style={style} animal={animal} cell={cell} stitches={stitches} open onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(document.querySelector("[data-testid='svg-grid-preview'] svg")).not.toBeNull());
    const fetchCallsBefore = vi.mocked(fetchMock).mock.calls.length;

    fireEvent.change(screen.getByLabelText(/Thử leather/i), { target: { value: "l2" } });

    await waitFor(() => {
      const html = document.querySelector("[data-testid='svg-grid-preview']")!.innerHTML;
      expect(html).toContain("https://cdn.test/togo.png");
    });
    // Không fetch thêm request nào (không re-fetch SVG, không gọi API mới) — mutate cây đã parse tại chỗ.
    expect(vi.mocked(fetchMock).mock.calls.length).toBe(fetchCallsBefore);
  });

  it("chọn stitch ở dropdown preview → applyStitchColor chạy, ghi CSS var vào root — không fetch lại", async () => {
    stubAppBridge();
    const svgText = makeMockupSvgText();
    const cell = makeStyleAnimalCell({ animalId: "a1", svgAssetId: "asset-1", svgUrl: "https://cdn.test/mockup.svg" });
    const fetchMock = stubFetchWithText(
      { [`GET ${leathersPath}`]: { status: 200, body: { items: [] } } },
      { "https://cdn.test/mockup.svg": svgText },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(
      <SvgGridDrawer productId="prod-1" style={style} animal={animal} cell={cell} stitches={stitches} open onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(document.querySelector("[data-testid='svg-grid-preview'] svg")).not.toBeNull());
    const fetchCallsBefore = vi.mocked(fetchMock).mock.calls.length;

    fireEvent.change(screen.getByLabelText(/Thử stitch/i), { target: { value: "st2" } });

    await waitFor(() => {
      const html = document.querySelector("[data-testid='svg-grid-preview']")!.innerHTML;
      expect(html.toUpperCase()).toContain("#FFFDD0");
    });
    expect(vi.mocked(fetchMock).mock.calls.length).toBe(fetchCallsBefore);
  });

  it("đổi dropdown preview nhiều lần KHÔNG làm mất phần đã áp trước đó (texture + stitch cộng dồn trên cùng cây đã parse)", async () => {
    stubAppBridge();
    const svgText = makeMockupSvgText();
    const cell = makeStyleAnimalCell({ animalId: "a1", svgAssetId: "asset-1", svgUrl: "https://cdn.test/mockup.svg" });
    const fetchMock = stubFetchWithText(
      {
        [`GET ${leathersPath}`]: {
          status: 200,
          body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown", textureImage: { assetId: "tex-1", url: "https://cdn.test/suede.png" } })] },
        },
      },
      { "https://cdn.test/mockup.svg": svgText },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(
      <SvgGridDrawer productId="prod-1" style={style} animal={animal} cell={cell} stitches={stitches} open onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    await waitFor(() => expect(document.querySelector("[data-testid='svg-grid-preview'] svg")).not.toBeNull());

    fireEvent.change(screen.getByLabelText(/Thử leather/i), { target: { value: "l1" } });
    await waitFor(() => {
      expect(document.querySelector("[data-testid='svg-grid-preview']")!.innerHTML).toContain("https://cdn.test/suede.png");
    });

    fireEvent.change(screen.getByLabelText(/Thử stitch/i), { target: { value: "st2" } });
    await waitFor(() => {
      const html = document.querySelector("[data-testid='svg-grid-preview']")!.innerHTML;
      expect(html).toContain("https://cdn.test/suede.png");
      expect(html.toUpperCase()).toContain("#FFFDD0");
    });
  });

  it("lưu — PUT toàn bộ danh sách animal cell của style (không chỉ ô vừa sửa), giữ nguyên sortOrder hàng cũ, hàng mới gán sortOrder sau max hiện có", async () => {
    stubAppBridge();
    const other = makeStyleAnimalCell({
      animalId: "a-other",
      svgAssetId: "asset-other",
      svgUrl: "https://cdn.test/other.svg",
      sortOrder: 5,
      isActive: true,
      displayLabel: "Khác",
    });
    const styleWithOther = makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [other] });

    const fetchMock = stubFetchWithText(
      {
        [`GET ${leathersPath}`]: { status: 200, body: { items: [] } },
        [`PUT ${putPath}`]: { status: 200, body: [] },
        "POST /api/admin/assets": {
          status: 201,
          body: {
            asset: {
              id: "asset-new",
              kind: "SVG_MOCKUP",
              publicUrl: "https://cdn.test/new.svg",
              mimeType: "image/svg+xml",
              byteSize: 10,
              width: 100,
              height: 100,
              originalFilename: "mockup.svg",
              createdAt: "2026-09-11T00:00:00.000Z",
            },
            created: true,
          },
        },
      },
      { "https://cdn.test/new.svg": makeMockupSvgText() },
    );
    vi.stubGlobal("fetch", fetchMock);

    const onSaved = vi.fn();
    renderWithPolaris(
      <SvgGridDrawer
        productId="prod-1"
        style={styleWithOther}
        animal={animal}
        cell={null}
        stitches={stitches}
        open
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    const fileInput = screen.getByLabelText(/Tệp SVG mockup/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [svgFile()] } });

    fireEvent.change(await screen.findByLabelText(/Nhãn hiển thị/i), { target: { value: "Nhãn mới" } });
    fireEvent.change(screen.getByLabelText(/Mô tả/i), { target: { value: "Mô tả mới" } });
    fireEvent.change(screen.getByLabelText(/Stitch mặc định/i), { target: { value: "st1" } });

    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/i }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath);
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath)!;
    const body = JSON.parse((init as RequestInit).body as string) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(2);
    const byAnimalId = Object.fromEntries(body.map((row) => [row.animalId, row]));

    // Hàng cũ (a-other) KHÔNG bị đụng — nguyên vẹn field + sortOrder cũ (5).
    expect(byAnimalId["a-other"]).toEqual(
      expect.objectContaining({ svgAssetId: "asset-other", isActive: true, sortOrder: 5, displayLabel: "Khác" }),
    );
    // Hàng mới (a1) — field vừa nhập, sortOrder gán SAU max hiện có (5 + 1 = 6), không phải index 0/1.
    expect(byAnimalId.a1).toEqual(
      expect.objectContaining({
        svgAssetId: "asset-new",
        displayLabel: "Nhãn mới",
        description: "Mô tả mới",
        defaultStitchId: "st1",
        isActive: true,
        sortOrder: 6,
      }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("sửa một ô rồi lưu — hàng khác trong style đó đã svgAssetArchived:true bị loại khỏi PUT, không chặn việc lưu ô đang sửa", async () => {
    stubAppBridge();
    const archived = makeStyleAnimalCell({
      animalId: "a-archived",
      svgAssetId: "asset-archived",
      svgUrl: "https://cdn.test/archived.svg",
      sortOrder: 3,
      isActive: true,
      svgAssetArchived: true,
    });
    const editing = makeStyleAnimalCell({
      animalId: "a1",
      svgAssetId: "asset-1",
      svgUrl: "https://cdn.test/mockup.svg",
      sortOrder: 1,
      isActive: true,
      displayLabel: "Nhãn cũ",
    });
    const styleWithBoth = makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [archived, editing] });

    const fetchMock = stubFetchWithText(
      {
        [`GET ${leathersPath}`]: { status: 200, body: { items: [] } },
        [`PUT ${putPath}`]: { status: 200, body: [] },
      },
      { "https://cdn.test/mockup.svg": makeMockupSvgText() },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(
      <SvgGridDrawer
        productId="prod-1"
        style={styleWithBoth}
        animal={animal}
        cell={editing}
        stitches={stitches}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(await screen.findByLabelText(/Nhãn hiển thị/i), { target: { value: "Nhãn sửa" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/i }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath);
      expect(call).toBeDefined();
    });
    const [, init] = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === putPath)!;
    const body = JSON.parse((init as RequestInit).body as string) as Array<Record<string, unknown>>;

    // Hàng archived bị loại HOÀN TOÀN — không phải chỉ isActive:false, mà vắng mặt (R4: vắng =
    // server tự deactivate); server 422 invalid_asset nếu bất kỳ svgAssetId nào trong mảng archived.
    expect(body.map((r) => r.animalId)).toEqual(["a1"]);
    expect(body[0]).toEqual(expect.objectContaining({ animalId: "a1", displayLabel: "Nhãn sửa", sortOrder: 1 }));

    // Không có banner lỗi 422 nào — request thành công.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hiện chỉ báo cảnh báo khi cell đang sửa có svgAssetArchived:true", async () => {
    stubAppBridge();
    const cell = makeStyleAnimalCell({ animalId: "a1", svgAssetId: "asset-1", svgUrl: "https://cdn.test/mockup.svg", svgAssetArchived: true });
    vi.stubGlobal(
      "fetch",
      stubFetchWithText(
        { [`GET ${leathersPath}`]: { status: 200, body: { items: [] } } },
        { "https://cdn.test/mockup.svg": makeMockupSvgText() },
      ),
    );

    renderWithPolaris(
      <SvgGridDrawer productId="prod-1" style={style} animal={animal} cell={cell} stitches={stitches} open onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    expect(await screen.findByText(/archive/i)).toBeInTheDocument();
  });
});
