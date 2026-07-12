import { Buffer } from "node:buffer";
import type { CatalogLimits } from "./config.js";

export type BudgetStopReason = "max-shows" | "max-episodes-per-show" | "max-content-rows" | "max-normalized-artifact-bytes";
export interface CatalogBudgetState { shows: number; contentRows: number; normalizedArtifactBytes: number; stopped: boolean; stopReason?: BudgetStopReason }
export interface CatalogCandidate { row: unknown; showId?: string; type: "SERIES" | "SEASON" | "EPISODE" }

/** Tracks the exact UTF-8 bytes of a normalized JSON array without adding rejected rows. */
export class CatalogBudget {
  readonly #limits: CatalogLimits;
  readonly #episodesByShow = new Map<string, number>();
  #state: CatalogBudgetState = { shows: 0, contentRows: 0, normalizedArtifactBytes: 2, stopped: false };

  constructor(limits: CatalogLimits) { this.#limits = limits; }
  get state(): Readonly<CatalogBudgetState> { return { ...this.#state }; }

  tryAdd(candidate: CatalogCandidate): boolean {
    if (this.#state.stopped) return false;
    if (candidate.type === "SERIES" && this.#state.shows >= this.#limits.maxShows) return this.#stop("max-shows");
    if (candidate.type === "EPISODE") {
      if (candidate.showId === undefined) throw new Error("Episode candidates require a showId for budget accounting.");
      if ((this.#episodesByShow.get(candidate.showId) ?? 0) >= this.#limits.maxEpisodesPerShow) return this.#stop("max-episodes-per-show");
    }
    if (this.#state.contentRows >= this.#limits.maxContentRows) return this.#stop("max-content-rows");
    const nextBytes = this.#state.normalizedArtifactBytes + (this.#state.contentRows === 0 ? 0 : 1) + Buffer.byteLength(JSON.stringify(candidate.row), "utf8");
    if (nextBytes > this.#limits.maxNormalizedArtifactBytes) return this.#stop("max-normalized-artifact-bytes");
    this.#state.contentRows += 1;
    this.#state.normalizedArtifactBytes = nextBytes;
    if (candidate.type === "SERIES") this.#state.shows += 1;
    if (candidate.type === "EPISODE") this.#episodesByShow.set(candidate.showId!, (this.#episodesByShow.get(candidate.showId!) ?? 0) + 1);
    return true;
  }

  #stop(reason: BudgetStopReason): false { this.#state.stopped = true; this.#state.stopReason = reason; return false; }
}

export function assertEstimatedDatabaseBudget(estimatedDatabaseBytes: number, limits: Pick<CatalogLimits, "maxEstimatedDatabaseBytes">): void {
  if (!Number.isSafeInteger(estimatedDatabaseBytes) || estimatedDatabaseBytes < 0) throw new Error("Estimated database bytes must be a non-negative safe integer.");
  if (estimatedDatabaseBytes > limits.maxEstimatedDatabaseBytes) throw new Error(`Estimated database size ${estimatedDatabaseBytes} exceeds the hard guard ${limits.maxEstimatedDatabaseBytes}.`);
}
