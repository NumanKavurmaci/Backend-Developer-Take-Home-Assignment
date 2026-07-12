import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface JsonRequestOptions {
  cacheKey: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  allowNotFound?: boolean;
}

interface CachedJsonClientOptions {
  cacheDir: string;
  namespace: string;
  userAgent: string;
  minIntervalMs: number;
  offline: boolean;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class CachedJsonClient {
  private lastRequestStartedAt = 0;

  constructor(private readonly options: CachedJsonClientOptions) {}

  async get<T>(
    url: string,
    options: JsonRequestOptions,
  ): Promise<T | null> {
    return this.request<T>(url, { ...options, method: "GET" });
  }

  async postForm<T>(
    url: string,
    form: URLSearchParams,
    options: JsonRequestOptions,
  ): Promise<T | null> {
    return this.request<T>(url, {
      ...options,
      method: "POST",
      body: form.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...options.headers,
      },
    });
  }

  private async request<T>(
    url: string,
    options: JsonRequestOptions,
  ): Promise<T | null> {
    const cachePath = this.cachePath(options.cacheKey);
    const cached = await readCachedJson<T>(cachePath);

    if (cached !== undefined) {
      return cached;
    }

    if (this.options.offline) {
      throw new Error(`Offline catalog seed cache miss: ${cachePath}`);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await this.waitForRateLimit();

      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          body: options.body,
          headers: {
            Accept: "application/json",
            "User-Agent": this.options.userAgent,
            ...options.headers,
          },
          signal: AbortSignal.timeout(45_000),
        });

        if (response.status === 404 && options.allowNotFound) {
          return null;
        }

        if (!response.ok) {
          const responsePreview = (await response.text()).slice(0, 500);
          const error = new Error(
            `Catalog source request failed: ${response.status} ${response.statusText} ${url} ${responsePreview}`,
          );

          if (!RETRYABLE_STATUS_CODES.has(response.status)) {
            throw error;
          }

          lastError = error;
          await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
          continue;
        }

        const payload = (await response.json()) as T;
        await writeCachedJson(cachePath, payload);
        return payload;
      } catch (error) {
        lastError = error;

        if (attempt === 5) {
          break;
        }

        await sleep(retryDelayMs(null, attempt));
      }
    }

    throw new Error(`Catalog source request exhausted retries for ${url}`, {
      cause: lastError,
    });
  }

  private cachePath(cacheKey: string): string {
    const safeKey = cacheKey.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return path.join(
      this.options.cacheDir,
      this.options.namespace,
      `${safeKey}.json`,
    );
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const remaining = this.options.minIntervalMs - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    this.lastRequestStartedAt = Date.now();
  }
}

async function readCachedJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw new Error(`Unable to read catalog cache file: ${filePath}`, {
      cause: error,
    });
  }
}

async function writeCachedJson<T>(filePath: string, payload: T): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(payload), "utf8");
  await rename(temporaryPath, filePath);
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1_000;
  }

  return Math.min(30_000, 1_000 * 2 ** attempt);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
