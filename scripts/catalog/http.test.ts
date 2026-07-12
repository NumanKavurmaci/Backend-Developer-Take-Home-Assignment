import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachedJsonClient, CatalogSourceError, type CatalogJsonClientOptions } from "./http.js";

let cacheDir: string;

beforeEach(async () => { cacheDir = await mkdtemp(path.join(os.tmpdir(), "saatcms-catalog-http-")); });
afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }); });

function client(overrides: Partial<CatalogJsonClientOptions> = {}): CachedJsonClient {
  return new CachedJsonClient({
    provider: "TVmaze", namespace: "test", cacheDir, userAgent: "SaatCMS-Test/1.0",
    minIntervalMs: 0, offline: false, timeoutMs: 100, maxAttempts: 3,
    maxRetryDelayMs: 5_000, sleep: async () => undefined,
    fetch: vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch,
    ...overrides,
  });
}

describe("CachedJsonClient", () => {
  it("uses a successful cached response without a second HTTP request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 1 }));
    const events: string[] = [];
    const source = client({
      fetch: fetchMock as unknown as typeof fetch,
      onEvent: (event) => events.push(event.type),
    });
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).resolves.toEqual({ id: 1 });
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "cache-miss",
      "request-start",
      "response-cached",
      "cache-hit",
    ]);
  });

  it("serves an offline cache hit without network access", async () => {
    await client().getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" });
    const fetchMock = vi.fn();
    const offline = client({ offline: true, fetch: fetchMock as unknown as typeof fetch });
    await expect(offline.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).resolves.toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an actionable offline cache miss", async () => {
    await expect(client({ offline: true }).getJson("https://api.tvmaze.com/shows/2", { operation: "show-2" })).rejects.toThrow(/offline cache miss; run the catalog fetch online first/);
  });

  it("respects the configured minimum interval", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const source = client({
      minIntervalMs: 550,
      now: () => now,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); now += milliseconds; },
    });
    await source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" });
    await source.getJson("https://api.tvmaze.com/shows/2", { operation: "show-2" });
    expect(sleeps).toEqual([550]);
  });

  it("backs off using Retry-After on 429 and retries transient failures", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const source = client({ fetch: fetchMock as typeof fetch, sleep: async (milliseconds) => { sleeps.push(milliseconds); } });
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2_000, 2_000]);
  });

  it("does not retry non-transient HTTP failures", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    await expect(client({ fetch: fetchMock as unknown as typeof fetch }).getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds timeouts and exhausts the configured attempts", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      }),
    );
    const source = client({ fetch: fetchMock as unknown as typeof fetch, timeoutMs: 5, maxAttempts: 2 });
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).rejects.toThrow(/after 2 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports exhausted retryable status attempts", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    await expect(client({ fetch: fetchMock as unknown as typeof fetch, maxAttempts: 2 }).getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).rejects.toThrow(/exhausted 2 attempts/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON without caching it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ valid: true }));
    const source = client({ fetch: fetchMock as typeof fetch });
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).rejects.toThrow(/malformed JSON/);
    await expect(source.getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" })).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends only required identifying request headers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true }));
    await client({ fetch: fetchMock as unknown as typeof fetch }).getJson("https://api.tvmaze.com/shows/1", { operation: "show-1" });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get("User-Agent")).toBe("SaatCMS-Test/1.0");
    expect(headers.get("Accept")).toBe("application/json");
    expect([...headers.keys()].sort()).toEqual(["accept", "user-agent"]);
  });

  it("uses stable collision-resistant keys without writing request secrets", async () => {
    const source = client();
    const first = source.cachePath("https://api.tvmaze.com/search/shows?api_key=secret&q=a", "search");
    const reordered = source.cachePath("https://api.tvmaze.com/search/shows?q=a&api_key=secret", "search");
    const different = source.cachePath("https://api.tvmaze.com/search/shows?q=b&api_key=secret", "search");
    expect(first).toBe(reordered);
    expect(first).not.toBe(different);
    expect(first).not.toContain("secret");
    await source.getJson("https://api.tvmaze.com/search/shows?api_key=secret&q=a", { operation: "search" });
    expect(await readFile(first, "utf8")).toBe('{"ok":true}');
  });

  it("keeps provider errors actionable and sanitized", async () => {
    const source = client({ fetch: vi.fn(async () => new Response("token=secret", { status: 400 })) as unknown as typeof fetch });
    const error = await captureError(source.getJson("https://api.tvmaze.com/shows/1?token=secret", { operation: "show-details" }));
    expect(error).toBeInstanceOf(CatalogSourceError);
    expect((error as Error).message).toContain("TVmaze show-details");
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("api.tvmaze.com");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to fail.");
}
