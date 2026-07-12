import type { CatalogHttpEvent } from "./http.js";
import type { CatalogBuildProgressEvent } from "./catalog-builder.js";
import type { CatalogArtifactConfiguration } from "./artifact-types.js";

export interface CatalogSourceProgressSnapshot {
  operationsCompleted: number;
  cacheHits: number;
  networkResponses: number;
  networkAttempts: number;
  retries: number;
  cachedSourceBytesRead: number;
  networkSourceBytesCached: number;
}

export class CatalogBuildProgressReporter {
  readonly #config: CatalogArtifactConfiguration;
  readonly #write: (message: string) => void;
  #snapshot: CatalogSourceProgressSnapshot = {
    operationsCompleted: 0,
    cacheHits: 0,
    networkResponses: 0,
    networkAttempts: 0,
    retries: 0,
    cachedSourceBytesRead: 0,
    networkSourceBytesCached: 0,
  };

  constructor(
    config: CatalogArtifactConfiguration,
    write: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
  ) {
    this.#config = config;
    this.#write = write;
  }

  get snapshot(): Readonly<CatalogSourceProgressSnapshot> {
    return { ...this.#snapshot };
  }

  onHttpEvent = (event: CatalogHttpEvent): void => {
    if (event.type === "cache-hit") {
      this.#snapshot.cacheHits += 1;
      this.#snapshot.operationsCompleted += 1;
      this.#snapshot.cachedSourceBytesRead += event.bytes;
      this.#writeSourceProgress(event.operation);
    } else if (event.type === "request-start") {
      this.#snapshot.networkAttempts += 1;
    } else if (event.type === "response-cached") {
      this.#snapshot.networkResponses += 1;
      this.#snapshot.operationsCompleted += 1;
      this.#snapshot.networkSourceBytesCached += event.bytes;
      this.#writeSourceProgress(event.operation);
    } else if (event.type === "retry") {
      this.#snapshot.retries += 1;
      this.#write(
        `[source] retry ${event.operation} in ${event.delayMs}ms${event.status === undefined ? "" : ` after HTTP ${event.status}`}`,
      );
    }
  };

  onBuildEvent = (event: CatalogBuildProgressEvent): void => {
    if (event.type === "page") {
      this.#write(
        `[catalog] page=${event.page} pagesFetched=${event.pagesFetched}/${this.#config.maxPages} showsDiscovered=${event.showsDiscovered}`,
      );
    } else if (event.type === "show-skipped") {
      this.#write(`[catalog] skipped show=${event.showId} reason=${event.reason}`);
    } else if (
      event.type === "show-included" &&
      (event.showsIncluded <= 5 || event.showsIncluded % 10 === 0)
    ) {
      this.#write(
        `[catalog] shows=${event.showsIncluded}/${this.#config.maxShows} rows=${event.totalRows}/${this.#config.maxContentRows} remainingShows=${event.remainingShows} remainingRows=${event.remainingRows} lastShow=${event.showId} (+${event.showRows} rows)`,
      );
    } else if (event.type === "complete") {
      this.#write(
        `[budget] normalized=${formatBytes(event.normalizedBytes)}/${formatBytes(this.#config.maxNormalizedArtifactBytes)} remaining=${formatBytes(this.#config.maxNormalizedArtifactBytes - event.normalizedBytes)}`,
      );
      this.#write(
        `[budget] estimatedDatabase=${formatBytes(event.estimatedDatabaseBytes)}/${formatBytes(this.#config.maxEstimatedDatabaseBytes)} remaining=${formatBytes(this.#config.maxEstimatedDatabaseBytes - event.estimatedDatabaseBytes)} stop=${event.stopReason}`,
      );
    }
  };

  #writeSourceProgress(operation: string): void {
    const completed = this.#snapshot.operationsCompleted;
    if (completed <= 5 || completed % 25 === 0) {
      this.#write(
        `[source] operations=${completed} cacheHits=${this.#snapshot.cacheHits} network=${this.#snapshot.networkResponses} cachedRead=${formatBytes(this.#snapshot.cachedSourceBytesRead)} downloaded=${formatBytes(this.#snapshot.networkSourceBytesCached)} current=${operation}`,
      );
    }
  }
}

export function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1_000) return `${bytes}B`;
  if (Math.abs(bytes) < 1_000_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  if (Math.abs(bytes) < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
}
