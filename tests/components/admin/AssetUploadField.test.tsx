/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { AssetUploadField } from "@/components/admin/AssetUploadField";
import type { AdminUploadKind, AssetDto } from "@/lib/admin/assets";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWithPolaris(ui: ReactElement) {
  return render(<AppProvider i18n={enTranslations}>{ui}</AppProvider>);
}

function ControlledAssetField({
  kind,
  onChangeSpy,
}: {
  kind: AdminUploadKind;
  onChangeSpy?: (asset: AssetDto) => void;
}) {
  const [value, setValue] = useState<AssetDto | null>(null);
  return (
    <AssetUploadField
      kind={kind}
      value={value}
      onChange={(asset) => {
        setValue(asset);
        onChangeSpy?.(asset);
      }}
      label="Mockup"
    />
  );
}

function svgFile(name = "mockup.svg"): File {
  return new File(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], name, { type: "image/svg+xml" });
}

function pngFile(name = "texture.png"): File {
  return new File(["\x89PNG"], name, { type: "image/png" });
}

function selectFile(label: string, file: File): void {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AssetUploadField", () => {
  it("chọn file → gọi upload POST /api/admin/assets", async () => {
    stubAppBridge();
    const fetchMock = mockAdminFetchResponses({
      "POST /api/admin/assets": {
        status: 201,
        body: {
          asset: {
            id: "a1",
            kind: "SVG_MOCKUP",
            publicUrl: "https://cdn.test/a1.svg",
            mimeType: "image/svg+xml",
            byteSize: 42,
            width: 10,
            height: 10,
            originalFilename: "mockup.svg",
            createdAt: "2026-09-11T00:00:00.000Z",
          },
          created: true,
          validation: { valid: true, contractVersion: "animal-v1", viewBox: "0 0 10 10", checks: [] },
          sanitization: { removedElements: [], removedAttributes: [], externalRefs: [] },
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<ControlledAssetField kind="SVG_MOCKUP" />);
    selectFile("Mockup", svgFile());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetchMock).mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("201 hiển thị thumbnail từ publicUrl", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/assets": {
          status: 201,
          body: {
            asset: {
              id: "a1",
              kind: "SVG_MOCKUP",
              publicUrl: "https://cdn.test/a1.svg",
              mimeType: "image/svg+xml",
              byteSize: 42,
              width: 10,
              height: 10,
              originalFilename: "mockup.svg",
              createdAt: "2026-09-11T00:00:00.000Z",
            },
            created: true,
            validation: { valid: true, contractVersion: "animal-v1", viewBox: "0 0 10 10", checks: [] },
            sanitization: { removedElements: [], removedAttributes: [], externalRefs: [] },
          },
        },
      }),
    );

    const onChangeSpy = vi.fn();
    renderWithPolaris(<ControlledAssetField kind="SVG_MOCKUP" onChangeSpy={onChangeSpy} />);
    selectFile("Mockup", svgFile());

    await waitFor(() => expect(onChangeSpy).toHaveBeenCalledTimes(1));
    const img = await screen.findByAltText("mockup.svg");
    expect(img).toHaveAttribute("src", "https://cdn.test/a1.svg");
  });

  it("422 code:svg_contract hiển thị báo cáo validation.checks theo từng id", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/assets": {
          status: 422,
          body: {
            errors: [{ field: "file", code: "svg_contract", message: "SVG không thoả hợp đồng customizer" }],
            validation: {
              valid: false,
              contractVersion: "animal-v1",
              viewBox: "0 0 1427 1102",
              checks: [
                { id: "wallet-preview", status: "ok" },
                {
                  id: "animal-shape",
                  status: "missing",
                  hint: "Found 'fish-shape'. File not migrated to the animal-* contract.",
                },
              ],
            },
          },
        },
      }),
    );

    renderWithPolaris(<ControlledAssetField kind="SVG_MOCKUP" />);
    selectFile("Mockup", svgFile("bad.svg"));

    await waitFor(() => expect(screen.getByText(/SVG không thoả hợp đồng customizer/)).toBeInTheDocument());
    expect(screen.getByText(/animal-shape/)).toBeInTheDocument();
    expect(screen.getByText(/missing/)).toBeInTheDocument();
    expect(screen.getByText(/Found 'fish-shape'/)).toBeInTheDocument();
    expect(screen.getByText(/wallet-preview/)).toBeInTheDocument();
  });

  it("422 code:embedded_resource hiển thị embeddedRefs", async () => {
    stubAppBridge();
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        "POST /api/admin/assets": {
          status: 422,
          body: {
            errors: [
              {
                field: "file",
                code: "embedded_resource",
                message: "SVG nhúng tài nguyên data: URI — không được phép cho mockup master",
              },
            ],
            embeddedRefs: ["data:image/png;base64,AAAA"],
          },
        },
      }),
    );

    renderWithPolaris(<ControlledAssetField kind="SVG_MOCKUP" />);
    selectFile("Mockup", svgFile("embed.svg"));

    await waitFor(() => expect(screen.getByText(/nhúng tài nguyên data:/)).toBeInTheDocument());
    expect(screen.getByText(/data:image\/png;base64,AAAA/)).toBeInTheDocument();
  });

  it.each<AdminUploadKind>(["TEXTURE", "DISPLAY"])(
    "kind=%s: lỗi invalid_image hiển thị message chung, KHÔNG render báo cáo SVG",
    async (kind) => {
      stubAppBridge();
      vi.stubGlobal(
        "fetch",
        mockAdminFetchResponses({
          "POST /api/admin/assets": {
            status: 422,
            body: { errors: [{ field: "file", code: "invalid_image", message: "File không phải ảnh hợp lệ" }] },
          },
        }),
      );

      renderWithPolaris(<ControlledAssetField kind={kind} />);
      selectFile("Mockup", pngFile("bad.png"));

      await waitFor(() => expect(screen.getByText(/File không phải ảnh hợp lệ/)).toBeInTheDocument());
      expect(screen.queryByText(/checks/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/contractVersion/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/wallet-preview/)).not.toBeInTheDocument();
    },
  );
});
