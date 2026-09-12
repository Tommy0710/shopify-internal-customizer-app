/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { SvgGridSection } from "@/components/admin/products/SvgGridSection";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import {
  makeAnimalRelation,
  makeProductTree,
  makeRelationAttribute,
  makeStyleAnimalCell,
  makeStyleRelation,
} from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const leathersPath = "/api/admin/leathers";

function baseFetch(extra: Record<string, { status: number; body: unknown }> = {}) {
  return mockAdminFetchResponses({
    [`GET ${leathersPath}`]: { status: 200, body: { items: [makeRelationAttribute({ id: "l1", name: "Suede Brown" })] } },
    ...extra,
  });
}

describe("SvgGridSection", () => {
  it("hiện một hàng cho mỗi style active, một cột cho mỗi animal active — style/animal không active bị loại", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const product = makeProductTree({
      id: "prod-1",
      styles: [
        makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [] }),
        makeStyleRelation({ styleId: "s2", name: "Classic", isActive: true, animals: [] }),
        makeStyleRelation({ styleId: "s3", name: "Ngừng bán", isActive: false, animals: [] }),
      ],
      animals: [
        makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true }),
        makeAnimalRelation({ animalId: "a2", name: "Angler Fish", isActive: true }),
        makeAnimalRelation({ animalId: "a3", name: "Không dùng nữa", isActive: false }),
      ],
    });

    renderWithPolaris(<SvgGridSection product={product} />);

    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());
    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.queryByText("Ngừng bán")).not.toBeInTheDocument();

    expect(screen.getByText("Alligator")).toBeInTheDocument();
    expect(screen.getByText("Angler Fish")).toBeInTheDocument();
    expect(screen.queryByText("Không dùng nữa")).not.toBeInTheDocument();

    // 2 style active × 2 animal active = 4 ô.
    expect(screen.getAllByRole("button", { name: /SVG|missing/ })).toHaveLength(4);
  });

  it("ô có StyleAnimalCellDto active hiện ✓ SVG, ô không có hiện ⚠ missing", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const cell = makeStyleAnimalCell({ animalId: "a1", isActive: true });
    const product = makeProductTree({
      id: "prod-1",
      styles: [makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [cell] })],
      animals: [
        makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true }),
        makeAnimalRelation({ animalId: "a2", name: "Angler Fish", isActive: true }),
      ],
    });

    renderWithPolaris(<SvgGridSection product={product} />);

    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Minimalist.*Alligator.*✓ SVG/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Minimalist.*Angler Fish.*⚠ missing/ })).toBeInTheDocument();
  });

  it("một cell isActive:false vẫn hiện ⚠ missing (đã bị deactivate, không tính là có mockup)", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const cell = makeStyleAnimalCell({ animalId: "a1", isActive: false });
    const product = makeProductTree({
      id: "prod-1",
      styles: [makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [cell] })],
      animals: [makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true })],
    });

    renderWithPolaris(<SvgGridSection product={product} />);

    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Minimalist.*Alligator.*⚠ missing/ })).toBeInTheDocument();
  });

  it("click ô ✓ SVG mở drawer, hiện sẵn dữ liệu đã lưu của cặp đó", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const cell = makeStyleAnimalCell({
      animalId: "a1",
      isActive: true,
      displayLabel: "Nhãn cũ",
      description: "Mô tả cũ",
      svgUrl: "https://cdn.test/mockup-existing.svg",
    });
    const product = makeProductTree({
      id: "prod-1",
      styles: [makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [cell] })],
      animals: [makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true })],
    });

    renderWithPolaris(<SvgGridSection product={product} />);
    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Minimalist.*Alligator.*✓ SVG/ }));

    expect(await screen.findByText(/Minimalist.*Alligator/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nhãn cũ")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mô tả cũ")).toBeInTheDocument();
  });

  it("click ô ⚠ missing mở drawer trống — không có displayLabel/description sẵn", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const product = makeProductTree({
      id: "prod-1",
      styles: [makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [] })],
      animals: [makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true })],
    });

    renderWithPolaris(<SvgGridSection product={product} />);
    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Minimalist.*Alligator.*⚠ missing/ }));

    expect(await screen.findByText(/Minimalist.*Alligator/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nhãn hiển thị/i)).toHaveValue("");
    expect(screen.getByLabelText(/Mô tả/i)).toHaveValue("");
  });

  it("ô có svgAssetArchived hiện chỉ báo cảnh báo trực quan", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const cell = makeStyleAnimalCell({ animalId: "a1", isActive: true, svgAssetArchived: true });
    const product = makeProductTree({
      id: "prod-1",
      styles: [makeStyleRelation({ styleId: "s1", name: "Minimalist", isActive: true, animals: [cell] })],
      animals: [makeAnimalRelation({ animalId: "a1", name: "Alligator", isActive: true })],
    });

    renderWithPolaris(<SvgGridSection product={product} />);
    await waitFor(() => expect(screen.getByText("Minimalist")).toBeInTheDocument());
    expect(screen.getByText(/archive/i)).toBeInTheDocument();
  });

  it("không có style/animal active nào — hiện thông báo trống, không có ô nào", async () => {
    stubAppBridge();
    vi.stubGlobal("fetch", baseFetch());

    const product = makeProductTree({ id: "prod-1", styles: [], animals: [] });
    renderWithPolaris(<SvgGridSection product={product} />);

    expect(await screen.findByText(/chưa có style|chưa có animal/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /SVG|missing/ })).toHaveLength(0);
  });
});
