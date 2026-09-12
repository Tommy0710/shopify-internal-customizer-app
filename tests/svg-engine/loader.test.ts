import { describe, expect, it } from "vitest";
import { createMockupLoader } from "@/svg-engine/loader";

/** Promise mở, để test tự quyết định thứ tự resolve. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createMockupLoader", () => {
  it("returns the value for a single request", async () => {
    const load = createMockupLoader(async (key: string) => `svg:${key}`);
    await expect(load("fish")).resolves.toEqual({ status: "ready", value: "svg:fish" });
  });

  it("marks an earlier request stale when a later one is issued", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const load = createMockupLoader(async () => queue.shift()!.promise);

    const slow = load("fish");
    const fast = load("crocodile");

    // Lần chọn MỚI resolve trước, rồi lần cũ mới về — đúng kịch bản nguy hiểm.
    second.resolve("svg:crocodile");
    await expect(fast).resolves.toEqual({ status: "ready", value: "svg:crocodile" });

    first.resolve("svg:fish");
    await expect(slow).resolves.toEqual({ status: "stale" });
  });

  it("reports an error for the latest request", async () => {
    const boom = new Error("HTTP 500");
    const load = createMockupLoader(async () => {
      throw boom;
    });
    await expect(load("fish")).resolves.toEqual({ status: "error", error: boom });
  });

  it("marks a failed earlier request stale rather than surfacing its error", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const load = createMockupLoader(async () => queue.shift()!.promise);

    const slow = load("fish");
    const fast = load("crocodile");

    second.resolve("svg:crocodile");
    await fast;

    first.reject(new Error("HTTP 500"));
    await expect(slow).resolves.toEqual({ status: "stale" });
  });

  it("allows a retry after a failure to become the latest request", async () => {
    let attempt = 0;
    const load = createMockupLoader(async (key: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error("HTTP 500");
      return `svg:${key}`;
    });

    await expect(load("fish")).resolves.toMatchObject({ status: "error" });
    await expect(load("fish")).resolves.toEqual({ status: "ready", value: "svg:fish" });
  });

  it("keeps separate loaders independent", async () => {
    const a = createMockupLoader(async (key: string) => `a:${key}`);
    const b = createMockupLoader(async (key: string) => `b:${key}`);
    await expect(a("x")).resolves.toEqual({ status: "ready", value: "a:x" });
    await expect(b("y")).resolves.toEqual({ status: "ready", value: "b:y" });
  });
});
