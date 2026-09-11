/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockAdminFetchResponses, stubAppBridge } from "@/lib/admin-ui/testFetch";
import { RelationChecklist, type RelationKind } from "@/components/admin/products/RelationChecklist";
import { renderWithPolaris } from "../../../helpers/renderWithPolaris";
import {
  makeAnimalRelation,
  makeProductTree,
  makeRelationAttribute,
  makeStitchRelation,
  makeStyleRelation,
} from "../../../helpers/productFixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const KINDS: RelationKind[] = ["styles", "animals", "stitches"];

const KEY_FIELD: Record<RelationKind, string> = { styles: "styleId", animals: "animalId", stitches: "stitchId" };

function makeRelationEntry(kind: RelationKind, overrides: { id: string; name: string; isActive: boolean; sortOrder?: number }) {
  const base = { isActive: overrides.isActive, sortOrder: overrides.sortOrder ?? 0, name: overrides.name };
  if (kind === "styles") return makeStyleRelation({ ...base, styleId: overrides.id });
  if (kind === "animals") return makeAnimalRelation({ ...base, animalId: overrides.id });
  return makeStitchRelation({ ...base, stitchId: overrides.id });
}

function productWith(kind: RelationKind, entries: ReturnType<typeof makeRelationEntry>[]) {
  return makeProductTree({ id: "prod-1", [kind]: entries } as Partial<ReturnType<typeof makeProductTree>>);
}

describe.each(KINDS)("RelationChecklist kind=%s", (kind) => {
  const path = `/api/admin/${kind}`;

  it("hiển thị checkbox cho toàn bộ attribute của shop, đã tick đúng phần active trong product", async () => {
    stubAppBridge();
    const attrs = [makeRelationAttribute({ id: "x", name: "Offered" }), makeRelationAttribute({ id: "y", name: "Not offered" })];
    const entries = [makeRelationEntry(kind, { id: "x", name: "Offered", isActive: true })];
    vi.stubGlobal("fetch", mockAdminFetchResponses({ [`GET ${path}`]: { status: 200, body: { items: attrs } } }));

    renderWithPolaris(<RelationChecklist kind={kind} product={productWith(kind, entries)} />);

    await waitFor(() => expect(screen.getByLabelText("Offered")).toBeInTheDocument());
    expect(screen.getByLabelText("Offered")).toBeChecked();
    expect(screen.getByLabelText("Not offered")).not.toBeChecked();
  });

  it("lưu PUT danh sách id đã tick đầy đủ", async () => {
    stubAppBridge();
    const attrs = [makeRelationAttribute({ id: "x", name: "Offered" }), makeRelationAttribute({ id: "y", name: "Not offered" })];
    const entries = [makeRelationEntry(kind, { id: "x", name: "Offered", isActive: true })];
    const fetchMock = mockAdminFetchResponses({
      [`GET ${path}`]: { status: 200, body: { items: attrs } },
      [`PUT /api/admin/products/prod-1/${kind}`]: { status: 200, body: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<RelationChecklist kind={kind} product={productWith(kind, entries)} />);
    await waitFor(() => expect(screen.getByLabelText("Not offered")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Not offered"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Lưu ${kind}$`, "i") }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === `/api/admin/products/prod-1/${kind}`);
      expect(call).toBeDefined();
    });
    const [, init] = vi
      .mocked(fetchMock)
      .mock.calls.find(([input]) => String(input) === `/api/admin/products/prod-1/${kind}`)!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ [KEY_FIELD[kind]]: "x", isActive: true }),
        expect.objectContaining({ [KEY_FIELD[kind]]: "y", isActive: true }),
      ]),
    );
    expect(body).toHaveLength(2);
  });

  it("bỏ tick một hàng đang active rồi lưu — hàng vẫn còn trong checklist (chỉ đổi trạng thái 'chưa cung cấp', không biến mất)", async () => {
    stubAppBridge();
    const attrs = [makeRelationAttribute({ id: "x", name: "Offered" })];
    const entries = [makeRelationEntry(kind, { id: "x", name: "Offered", isActive: true })];
    const fetchMock = mockAdminFetchResponses({
      [`GET ${path}`]: { status: 200, body: { items: attrs } },
      [`PUT /api/admin/products/prod-1/${kind}`]: { status: 200, body: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithPolaris(<RelationChecklist kind={kind} product={productWith(kind, entries)} />);
    await waitFor(() => expect(screen.getByLabelText("Offered")).toBeChecked());

    fireEvent.click(screen.getByLabelText("Offered"));
    expect(screen.getByLabelText("Offered")).not.toBeChecked();
    // Vẫn hiện diện trong danh sách — không claim là "không còn tồn tại".
    expect(screen.getByText("Offered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Lưu ${kind}$`, "i") }));

    await waitFor(() => {
      const call = vi.mocked(fetchMock).mock.calls.find(([input]) => String(input) === `/api/admin/products/prod-1/${kind}`);
      expect(call).toBeDefined();
    });
    const [, init] = vi
      .mocked(fetchMock)
      .mock.calls.find(([input]) => String(input) === `/api/admin/products/prod-1/${kind}`)!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual([]);
  });

  it("gọi onSaved sau khi lưu thành công để cha refetch readiness", async () => {
    stubAppBridge();
    const attrs = [makeRelationAttribute({ id: "x", name: "Offered" })];
    const entries = [makeRelationEntry(kind, { id: "x", name: "Offered", isActive: true })];
    vi.stubGlobal(
      "fetch",
      mockAdminFetchResponses({
        [`GET ${path}`]: { status: 200, body: { items: attrs } },
        [`PUT /api/admin/products/prod-1/${kind}`]: { status: 200, body: [] },
      }),
    );
    const onSaved = vi.fn();

    renderWithPolaris(<RelationChecklist kind={kind} product={productWith(kind, entries)} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByLabelText("Offered")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Lưu ${kind}$`, "i") }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
