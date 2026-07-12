import { afterEach, describe, expect, it, vi } from "vitest";
import { runDeploymentSmoke } from "./deployment-smoke.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deployment smoke suite", () => {
  it("is repeatable and performs only bounded read requests", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const body = responseFor(path);
        const headers = init?.headers as Record<string, string> | undefined;
        return new Response(JSON.stringify(body), {
          status: path.includes("playback/episode-galactic-odyssey-s1e3")
            ? 403
            : path.includes("playback/episode-galactic-odyssey-s1e2") &&
                headers?.["X-User-Country"] === "IR"
              ? 403
              : 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await runDeploymentSmoke("https://deployment.example");
    await runDeploymentSmoke("https://deployment.example");

    expect(fetchMock).toHaveBeenCalledTimes(12);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

function responseFor(path: string): Record<string, unknown> {
  if (path === "/health") return { status: "ok" };
  if (path === "/ready") return { status: "ready" };
  if (path.includes("/content/")) {
    return { genre: "Space Adventure", quality: "HD", isPremium: false };
  }
  if (path.includes("s1e3")) return { errorCode: "DEVICE_NOT_SUPPORTED" };
  return { playbackUrl: "https://cdn.example", errorCode: "GEO_BLOCKED" };
}
