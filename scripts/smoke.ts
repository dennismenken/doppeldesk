// Boots DoppelDesk once per seed mode and checks that the server starts, serves seeded
// reference data, accepts a basic write and survives a reset. Used by CI and locally via
// "pnpm smoke"; set SMOKE_BASE_URL to check an already running server (e.g. a container)
// instead of spawning one.
import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const SEEDS = ["none", "basic", "demo"] as const;
const TOKEN = "doppeldesk";
const PORT = Number(process.env.SMOKE_PORT ?? "8790");

async function request(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: TOKEN, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/__doppeldesk/health`);
      if (response.ok) return;
    } catch {
      // Server not listening yet.
    }
    await delay(200);
  }
  throw new Error(`server at ${base} did not become healthy within ${timeoutMs} ms`);
}

async function checkServer(base: string, seed: string): Promise<void> {
  const countries = await request(base, "/api/v1/StaticCountry?countAll=true&limit=1");
  const total = Number((countries.body as { total?: unknown }).total);
  assert(
    countries.status === 200 && total > 0,
    `[${seed}] StaticCountry is empty or failed (${countries.status})`,
  );

  const contact = await request(base, "/api/v1/Contact", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke GmbH", category: { id: 3, objectName: "Category" } }),
  });
  assert(contact.status === 201, `[${seed}] POST /Contact answered ${contact.status}`);

  const unauthorized = await fetch(`${base}/api/v1/Contact?token=${TOKEN}`);
  assert(unauthorized.status === 401, `[${seed}] token query parameter must not authenticate`);

  const reset = await request(base, "/__doppeldesk/reset", {
    method: "POST",
    body: JSON.stringify({ seed }),
  });
  assert(reset.status === 200, `[${seed}] reset answered ${reset.status}`);
}

async function runSpawned(seed: string): Promise<void> {
  const base = `http://127.0.0.1:${PORT}`;
  const child: ChildProcess = spawn(process.execPath, ["src/main.ts"], {
    env: { ...process.env, DOPPELDESK_SPEC: "bundled", DOPPELDESK_SEED: seed, DOPPELDESK_PORT: String(PORT) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitForHealth(base, 15_000);
    await checkServer(base, seed);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function main(): Promise<void> {
  const external = process.env.SMOKE_BASE_URL;
  if (external) {
    await waitForHealth(external, 30_000);
    await checkServer(external, "basic");
    console.log(`smoke ok: ${external}`);
    return;
  }
  for (const seed of SEEDS) {
    await runSpawned(seed);
    console.log(`smoke ok: seed ${seed}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
