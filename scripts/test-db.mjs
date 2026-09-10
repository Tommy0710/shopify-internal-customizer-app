#!/usr/bin/env node
/**
 * Chạy suite test DB (`tests-db/**`) trên Postgres THẬT.
 *
 * Mặc định dựng một container `postgres:16-alpine` trên port trống, áp schema
 * bằng `prisma db push --force-reset`, chạy Vitest với `vitest.db.config.ts`,
 * rồi LUÔN dừng container — kể cả khi test đỏ hay bị Ctrl+C.
 *
 * Đặt `WK_TEST_DATABASE_URL` để dùng một Postgres có sẵn (CI) thay vì Docker.
 *
 * AN TOÀN: harness này chạy `--force-reset`, xoá sạch schema. Nó TỪ CHỐI mọi
 * URL có host khác localhost / 127.0.0.1 — không có cờ nào vượt qua được, vì
 * cái giá của một lần gõ nhầm URL Supabase production là toàn bộ dữ liệu.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

const IMAGE = "postgres:16-alpine";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function assertLocal(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`test-db: URL không hợp lệ: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`test-db: TỪ CHỐI chạy --force-reset lên host "${host}". Chỉ localhost được phép.`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startContainer() {
  const port = await freePort();
  const name = `wk-test-pg-${process.pid}`;
  const status = run("docker", [
    "run", "-d", "--rm", "--name", name,
    "-e", "POSTGRES_PASSWORD=wk", "-e", "POSTGRES_DB=wk_test",
    "-p", `127.0.0.1:${port}:5432`, IMAGE,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  if (status !== 0) throw new Error("test-db: không dựng được container — Docker có đang chạy không?");

  container = { name, url: `postgresql://postgres:wk@127.0.0.1:${port}/wk_test` };

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "wk_test"], { stdio: "ignore" });
    if (ready.status === 0) {
      return container;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  spawnSync("docker", ["stop", name], { stdio: "ignore" });
  container = null;
  throw new Error("test-db: Postgres không sẵn sàng sau 30 giây");
}

let container = null;
function stopContainer() {
  if (container) {
    spawnSync("docker", ["stop", container.name], { stdio: "ignore" });
    container = null;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopContainer();
    process.exit(130);
  });
}

let exitCode = 1;
try {
  let url = process.env.WK_TEST_DATABASE_URL;
  if (!url) {
    container = await startContainer();
    url = container.url;
  }
  assertLocal(url);

  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  if (run("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate", "--accept-data-loss"], { env }) !== 0) {
    throw new Error("test-db: prisma db push thất bại");
  }
  exitCode = run("npx", ["vitest", "run", "--config", "vitest.db.config.ts", ...process.argv.slice(2)], { env });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  stopContainer();
}
process.exit(exitCode);
