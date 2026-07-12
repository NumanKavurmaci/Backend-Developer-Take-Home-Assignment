import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface CatalogJsonClientOptions {
  provider: string;
  cacheDir: string;
  namespace: string;
  userAgent: string;
  minIntervalMs: number;
  offline: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onEvent?: (event: CatalogHttpEvent) => void;
}

export type CatalogHttpEvent =
  | { type: "cache-hit"; provider: string; operation: string; bytes: number }
  | { type: "cache-miss"; provider: string; operation: string }
  | { type: "request-start"; provider: string; operation: string; attempt: number; maxAttempts: number }
  | { type: "response-cached"; provider: string; operation: string; bytes: number }
  | { type: "retry"; provider: string; operation: string; delayMs: number; status?: number };
type CatalogHttpEventDetails = CatalogHttpEvent extends infer Event
  ? Event extends CatalogHttpEvent
    ? Omit<Event, "provider" | "operation">
    : never
  : never;

export interface CatalogJsonRequestOptions {
  operation: string;
  allowNotFound?: boolean;
}

export class CatalogSourceError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly operation: string,
    readonly status?: number,
  ) {
    super(`${provider} ${operation}: ${message}`);
    this.name = "CatalogSourceError";
  }
}

export class CachedJsonClient {
  readonly #options: Required<Omit<CatalogJsonClientOptions, "fetch" | "now" | "sleep" | "onEvent">>;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #onEvent: (event: CatalogHttpEvent) => void;
  #lastRequestStartedAt: number | null = null;
  #pacingTail: Promise<void> = Promise.resolve();

  constructor(options: CatalogJsonClientOptions) {
    validateOptions(options);
    this.#options = {
      provider: options.provider,
      cacheDir: options.cacheDir,
      namespace: options.namespace,
      userAgent: options.userAgent,
      minIntervalMs: options.minIntervalMs,
      offline: options.offline,
      timeoutMs: options.timeoutMs ?? 45_000,
      maxAttempts: options.maxAttempts ?? 6,
      maxRetryDelayMs: options.maxRetryDelayMs ?? 30_000,
    };
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? sleep;
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  async getJson<T>(url: string, request: CatalogJsonRequestOptions): Promise<T | null> {
    const operation = safeOperation(request.operation);
    const cachePath = this.cachePath(url, operation);
    const cached = await readCachedJson<T>(cachePath, this.#options.provider, operation);
    if (cached.found) {
      this.#emit({ type: "cache-hit", bytes: cached.bytes }, operation);
      return cached.value;
    }
    this.#emit({ type: "cache-miss" }, operation);

    if (this.#options.offline) {
      throw new CatalogSourceError(
        `offline cache miss; run the catalog fetch online first (cache key ${path.basename(cachePath)})`,
        this.#options.provider,
        operation,
      );
    }

    for (let attempt = 0; attempt < this.#options.maxAttempts; attempt += 1) {
      await this.#waitForRateLimit();
      this.#emit({
        type: "request-start",
        attempt: attempt + 1,
        maxAttempts: this.#options.maxAttempts,
      }, operation);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": this.#options.userAgent,
          },
          signal: AbortSignal.timeout(this.#options.timeoutMs),
        });
      } catch {
        if (attempt + 1 >= this.#options.maxAttempts) {
          throw new CatalogSourceError(
            `request timed out or failed after ${this.#options.maxAttempts} attempts`,
            this.#options.provider,
            operation,
          );
        }
        const delayMs = retryDelayMs(null, attempt, this.#options.maxRetryDelayMs);
        this.#emit({ type: "retry", delayMs }, operation);
        await this.#sleep(delayMs);
        continue;
      }

      if (response.status === 404 && request.allowNotFound) {
        await writeCachedJson(cachePath, null);
        return null;
      }

      if (!response.ok) {
        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          throw new CatalogSourceError(
            `request failed with non-retryable HTTP ${response.status}`,
            this.#options.provider,
            operation,
            response.status,
          );
        }
        if (attempt + 1 >= this.#options.maxAttempts) {
          throw new CatalogSourceError(
            `exhausted ${this.#options.maxAttempts} attempts after HTTP ${response.status}`,
            this.#options.provider,
            operation,
            response.status,
          );
        }
        const delayMs = retryDelayMs(
          response.headers.get("retry-after"), attempt, this.#options.maxRetryDelayMs,
        );
        this.#emit({ type: "retry", delayMs, status: response.status }, operation);
        await this.#sleep(delayMs);
        continue;
      }

      let payload: T;
      try {
        payload = JSON.parse(await response.text()) as T;
      } catch {
        throw new CatalogSourceError(
          "received malformed JSON; response was not cached",
          this.#options.provider,
          operation,
        );
      }
      await writeCachedJson(cachePath, payload);
      this.#emit(
        { type: "response-cached", bytes: Buffer.byteLength(JSON.stringify(payload), "utf8") },
        operation,
      );
      return payload;
    }

    throw new CatalogSourceError("request failed", this.#options.provider, operation);
  }

  #emit(
    event: CatalogHttpEventDetails,
    operation: string,
  ): void {
    this.#onEvent({
      ...event,
      provider: this.#options.provider,
      operation,
    } as CatalogHttpEvent);
  }

  cachePath(url: string, operation: string): string {
    const canonicalUrl = canonicalizeUrl(url);
    const digest = createHash("sha256").update(`GET\n${canonicalUrl}`).digest("hex");
    return path.join(
      path.resolve(this.#options.cacheDir),
      safeSegment(this.#options.namespace, "namespace"),
      `${safeOperation(operation)}-${digest}.json`,
    );
  }

  async #waitForRateLimit(): Promise<void> {
    const turn = this.#pacingTail.then(async () => {
      if (this.#lastRequestStartedAt !== null) {
        const remaining = this.#options.minIntervalMs - (this.#now() - this.#lastRequestStartedAt);
        if (remaining > 0) await this.#sleep(remaining);
      }
      this.#lastRequestStartedAt = this.#now();
    });
    this.#pacingTail = turn.catch(() => undefined);
    await turn;
  }
}

function validateOptions(options: CatalogJsonClientOptions): void {
  if (options.provider.trim() === "") throw new Error("Catalog provider is required.");
  if (options.userAgent.trim() === "") throw new Error("An identifying User-Agent is required.");
  boundedInteger(options.minIntervalMs, 0, 60_000, "minimum request interval");
  boundedInteger(options.timeoutMs ?? 45_000, 1, 120_000, "request timeout");
  boundedInteger(options.maxAttempts ?? 6, 1, 10, "maximum attempts");
  boundedInteger(options.maxRetryDelayMs ?? 30_000, 0, 60_000, "maximum retry delay");
  safeSegment(options.namespace, "namespace");
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}: expected ${minimum}-${maximum}.`);
  }
}

function safeOperation(value: string): string {
  return safeSegment(value, "operation");
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) {
    throw new Error(`Invalid catalog ${label}.`);
  }
  return value;
}

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  const parameters = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  url.search = "";
  for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue);
  url.hash = "";
  return url.toString();
}

async function readCachedJson<T>(filePath: string, provider: string, operation: string): Promise<{ found: true; value: T | null; bytes: number } | { found: false }> {
  try {
    const text = await readFile(filePath, "utf8");
    return {
      found: true,
      value: JSON.parse(text) as T,
      bytes: Buffer.byteLength(text, "utf8"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
    throw new CatalogSourceError("cached response is unreadable or malformed", provider, operation);
  }
}

async function writeCachedJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function retryDelayMs(retryAfter: string | null, attempt: number, maximum: number): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maximum, seconds * 1_000);
  return Math.min(maximum, 1_000 * 2 ** attempt);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
