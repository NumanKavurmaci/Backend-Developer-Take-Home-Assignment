import type { CachedJsonClient } from "./http.js";
import type {
  TvMazeEpisode,
  TvMazeImage,
  TvMazeNetwork,
  TvMazeRating,
  TvMazeSeason,
  TvMazeShow,
} from "./tvmaze-contracts.js";

export interface TvMazeCatalogSource {
  getShowPage(page: number): Promise<TvMazeShow[] | null>;
  getShowSeasons(showId: number): Promise<TvMazeSeason[]>;
  getShowEpisodes(showId: number): Promise<TvMazeEpisode[]>;
}

export class HttpTvMazeCatalogSource implements TvMazeCatalogSource {
  constructor(private readonly client: CachedJsonClient) {}

  async getShowPage(page: number): Promise<TvMazeShow[] | null> {
    const operation = `show-page-${page}`;
    const payload = await this.client.getJson<unknown>(
      `https://api.tvmaze.com/shows?page=${page}`,
      { operation, allowNotFound: true },
    );
    return payload === null ? null : decodeArray(payload, operation, decodeShow);
  }

  async getShowSeasons(showId: number): Promise<TvMazeSeason[]> {
    const operation = `show-${showId}-seasons`;
    const payload = await this.client.getJson<unknown>(
      `https://api.tvmaze.com/shows/${showId}/seasons`,
      { operation },
    );
    return decodeArray(payload, operation, decodeSeason);
  }

  async getShowEpisodes(showId: number): Promise<TvMazeEpisode[]> {
    const operation = `show-${showId}-episodes`;
    const payload = await this.client.getJson<unknown>(
      `https://api.tvmaze.com/shows/${showId}/episodes`,
      { operation },
    );
    return decodeArray(payload, operation, decodeEpisode);
  }
}

function decodeArray<T>(
  value: unknown,
  operation: string,
  decode: (record: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw malformed(operation, "expected an array");
  return value.map((item, index) => {
    try {
      return decode(record(item, `row ${index}`));
    } catch (error) {
      throw malformed(
        operation,
        `invalid row ${index}: ${error instanceof Error ? error.message : "unknown shape"}`,
      );
    }
  });
}

function decodeShow(value: Record<string, unknown>): TvMazeShow {
  return {
    id: number(value.id, "id"),
    name: string(value.name, "name"),
    url: nullableString(value.url, "url"),
    language: nullableString(value.language, "language"),
    status: nullableString(value.status, "status"),
    runtime: nullableNumber(value.runtime, "runtime"),
    premiered: nullableString(value.premiered, "premiered"),
    ended: nullableString(value.ended, "ended"),
    officialSite: nullableString(value.officialSite, "officialSite"),
    genres: stringArray(value.genres, "genres"),
    rating: rating(value.rating),
    network: nullableNetwork(value.network, "network"),
    webChannel: nullableNetwork(value.webChannel, "webChannel"),
    image: nullableImage(value.image),
    summary: nullableString(value.summary, "summary"),
  };
}

function decodeSeason(value: Record<string, unknown>): TvMazeSeason {
  return {
    id: number(value.id, "id"),
    number: number(value.number, "number"),
    url: nullableString(value.url, "url"),
    name: nullableString(value.name, "name"),
    premiereDate: nullableString(value.premiereDate, "premiereDate"),
    endDate: nullableString(value.endDate, "endDate"),
    network: nullableNetwork(value.network, "network"),
    webChannel: nullableNetwork(value.webChannel, "webChannel"),
    image: nullableImage(value.image),
    summary: nullableString(value.summary, "summary"),
  };
}

function decodeEpisode(value: Record<string, unknown>): TvMazeEpisode {
  return {
    id: number(value.id, "id"),
    name: string(value.name, "name"),
    url: nullableString(value.url, "url"),
    type: nullableString(value.type, "type"),
    season: nullableNumber(value.season, "season"),
    number: nullableNumber(value.number, "number"),
    airdate: nullableString(value.airdate, "airdate"),
    runtime: nullableNumber(value.runtime, "runtime"),
    rating: rating(value.rating),
    image: nullableImage(value.image),
    summary: nullableString(value.summary, "summary"),
  };
}

function rating(value: unknown): TvMazeRating {
  if (value === null || value === undefined) return { average: null };
  const item = record(value, "rating");
  return { average: nullableNumber(item.average, "rating.average") };
}

function nullableNetwork(value: unknown, label: string): TvMazeNetwork | null {
  if (value === null || value === undefined) return null;
  const item = record(value, label);
  return {
    name: string(item.name, `${label}.name`),
    country:
      item.country === null || item.country === undefined
        ? null
        : {
            code: nullableString(
              record(item.country, `${label}.country`).code,
              `${label}.country.code`,
            ),
          },
  };
}

function nullableImage(value: unknown): TvMazeImage | null {
  if (value === null || value === undefined) return null;
  const item = record(value, "image");
  return {
    medium: nullableString(item.medium, "image.medium"),
    original: nullableString(item.original, "image.original"),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, label);
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return number(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function malformed(operation: string, reason: string): Error {
  return new Error(`TVmaze ${operation} returned malformed data: ${reason}.`);
}
