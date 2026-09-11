import { describe, expect, it } from "vitest";
import { diffByKey, duplicateKeys } from "@/lib/admin/diff";

interface Desired {
  key: string;
  value: number;
}
interface Existing {
  id: string;
  key: string;
  value: number;
}

const keyOfDesired = (d: Desired) => d.key;
const keyOfExisting = (e: Existing) => e.key;

describe("diffByKey", () => {
  it("cả hai danh sách rỗng → ba mảng rỗng", () => {
    const result = diffByKey<Desired, Existing>([], [], keyOfDesired, keyOfExisting);
    expect(result).toEqual({ toCreate: [], toUpdate: [], missing: [] });
  });

  it("existing rỗng → mọi desired đi vào toCreate, giữ nguyên thứ tự", () => {
    const desired: Desired[] = [
      { key: "b", value: 2 },
      { key: "a", value: 1 },
      { key: "c", value: 3 },
    ];
    const result = diffByKey<Desired, Existing>(desired, [], keyOfDesired, keyOfExisting);
    expect(result.toCreate).toEqual(desired); // cùng object, cùng thứ tự
    expect(result.toUpdate).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("desired rỗng → mọi existing đi vào missing", () => {
    const existing: Existing[] = [
      { id: "e1", key: "a", value: 1 },
      { id: "e2", key: "b", value: 2 },
    ];
    const result = diffByKey<Desired, Existing>([], existing, keyOfDesired, keyOfExisting);
    expect(result.toCreate).toEqual([]);
    expect(result.toUpdate).toEqual([]);
    expect(result.missing).toEqual(existing);
  });

  it("khớp khoá → toUpdate giữ đúng cặp desired/existing (không lẫn cặp)", () => {
    const desired: Desired[] = [
      { key: "a", value: 100 },
      { key: "b", value: 200 },
    ];
    const existing: Existing[] = [
      { id: "e-b", key: "b", value: 2 },
      { id: "e-a", key: "a", value: 1 },
    ];
    const result = diffByKey<Desired, Existing>(desired, existing, keyOfDesired, keyOfExisting);
    expect(result.toCreate).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.toUpdate).toHaveLength(2);
    const byKey = Object.fromEntries(result.toUpdate.map((pair) => [pair.desired.key, pair]));
    expect(byKey.a).toEqual({ desired: { key: "a", value: 100 }, existing: { id: "e-a", key: "a", value: 1 } });
    expect(byKey.b).toEqual({ desired: { key: "b", value: 200 }, existing: { id: "e-b", key: "b", value: 2 } });
  });

  it("trộn cả ba: create + update + missing trong cùng một lần diff", () => {
    const desired: Desired[] = [
      { key: "keep", value: 10 },
      { key: "new", value: 20 },
    ];
    const existing: Existing[] = [
      { id: "e-keep", key: "keep", value: 1 },
      { id: "e-gone", key: "gone", value: 2 },
    ];
    const result = diffByKey<Desired, Existing>(desired, existing, keyOfDesired, keyOfExisting);
    expect(result.toCreate).toEqual([{ key: "new", value: 20 }]);
    expect(result.toUpdate).toEqual([{ desired: { key: "keep", value: 10 }, existing: { id: "e-keep", key: "keep", value: 1 } }]);
    expect(result.missing).toEqual([{ id: "e-gone", key: "gone", value: 2 }]);
  });
});

describe("duplicateKeys", () => {
  it("không có khoá trùng → mảng rỗng", () => {
    expect(duplicateKeys(["a", "b", "c"], (s) => s)).toEqual([]);
  });

  it("mảng rỗng → mảng rỗng", () => {
    expect(duplicateKeys([] as string[], (s) => s)).toEqual([]);
  });

  it("một khoá lặp ba lần → chỉ trả về một lần", () => {
    expect(duplicateKeys(["a", "a", "a"], (s) => s)).toEqual(["a"]);
  });

  it("nhiều khoá trùng → mỗi khoá xuất hiện đúng một lần, theo thứ tự lần trùng đầu tiên", () => {
    expect(duplicateKeys(["a", "b", "a", "c", "b", "b"], (s) => s)).toEqual(["a", "b"]);
  });
});
