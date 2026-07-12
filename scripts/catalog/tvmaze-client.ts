import path from "node:path";
import { CachedJsonClient } from "./http.js";

export const TVMAZE_MIN_REQUEST_INTERVAL_MS = 550;
export const TVMAZE_USER_AGENT =
  "SaatCMS-Catalog/0.1 (+https://github.com/NumanKavurmaci/Backend-Developer-Take-Home-Assignment)";

export function createTvMazeClient(options: {
  cacheDir?: string;
  offline?: boolean;
  fetch?: typeof fetch;
} = {}): CachedJsonClient {
  return new CachedJsonClient({
    provider: "TVmaze",
    namespace: "tvmaze-v1",
    cacheDir: path.resolve(options.cacheDir ?? ".cache/catalog"),
    userAgent: TVMAZE_USER_AGENT,
    minIntervalMs: TVMAZE_MIN_REQUEST_INTERVAL_MS,
    timeoutMs: 45_000,
    maxAttempts: 6,
    maxRetryDelayMs: 30_000,
    offline: options.offline ?? false,
    fetch: options.fetch,
  });
}
