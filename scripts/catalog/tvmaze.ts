import type {
  AdvancedSeedConfig,
  CatalogContentRow,
  CatalogGeoBlockRow,
  CatalogMetadataRow,
  NormalizedCatalogChunk,
} from "./types.js";
import { CachedJsonClient } from "./http.js";

interface TvMazeCountry {
  code: string | null;
}

interface TvMazeChannel {
  name: string | null;
  country: TvMazeCountry | null;
}

interface TvMazeImage {
  medium: string | null;
  original: string | null;
}

interface TvMazeRating {
  average: number | null;
}

interface TvMazeShow {
  id: number;
  url: string;
  name: string;
  type: string | null;
  language: string | null;
  genres: string[];
  status: string | null;
  runtime: number | null;
  averageRuntime: number | null;
  premiered: string | null;
  ended: string | null;
  officialSite: string | null;
  rating: TvMazeRating | null;
  weight: number | null;
  network: TvMazeChannel | null;
  webChannel: TvMazeChannel | null;
  image: TvMazeImage | null;
  summary: string | null;
  updated: number | null;
}

interface TvMazeEpisode {
  id: number;
  url: string;
  name: string;
  season: number | null;
  number: number | null;
  type: string | null;
  airdate: string | null;
  airtime: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: TvMazeRating | null;
  image: TvMazeImage | null;
  summary: string | null;
}

const TVMAZE_API_ROOT = "https://api.tvmaze.com";
const GEO_BLOCK_COUNTRIES = ["TR", "DE", "US", "GB", "FR", "IR", "SY"];
const PARENTAL_RATINGS = ["7+", "13+", "16+", "18+"];

export async function fetchTvMazeCatalog(
  config: AdvancedSeedConfig,
  contentBudget: number,
): Promise<NormalizedCatalogChunk> {
  const client = new CachedJsonClient({
    cacheDir: config.cacheDir,
    namespace: "tvmaze",
    userAgent:
      "SaatCMS-Advanced-Seed/1.0 (+https://github.com/NumanKavurmaci/Backend-Developer-Take-Home-Assignment)",
    minIntervalMs: 550,
    offline: config.offline,
  });
  const catalog = emptyCatalog();
  let page = config.tvmazeStartPage;
  let importedShows = 0;

  while (
    importedShows < config.maxShows &&
    catalog.content.length < contentBudget
  ) {
    const shows = await client.get<TvMazeShow[]>(
      `${TVMAZE_API_ROOT}/shows?page=${page}`,
      {
        cacheKey: `shows-page-${page}`,
        allowNotFound: true,
      },
    );

    if (shows === null) {
      break;
    }

    for (const show of shows) {
      if (
        importedShows >= config.maxShows ||
        catalog.content.length >= contentBudget
      ) {
        break;
      }

      if (!isEligibleShow(show, config.tvmazeMinRating)) {
        continue;
      }

      const episodes = await client.get<TvMazeEpisode[]>(
        `${TVMAZE_API_ROOT}/shows/${show.id}/episodes?specials=1`,
        {
          cacheKey: `show-${show.id}-episodes-with-specials`,
          allowNotFound: true,
        },
      );

      if (episodes === null || episodes.length < 2) {
        continue;
      }

      const chunk = normalizeShow(
        show,
        episodes.slice(0, config.maxEpisodesPerShow),
      );
      appendCatalog(catalog, chunk);
      importedShows += 1;

      if (importedShows % 25 === 0) {
        console.log(
          JSON.stringify({
            source: "TVmaze",
            importedShows,
            contentRows: catalog.content.length,
            page,
          }),
        );
      }
    }

    page += 1;
  }

  if (catalog.content.length === 0) {
    throw new Error("TVmaze import produced no eligible content.");
  }

  return catalog;
}

function normalizeShow(
  show: TvMazeShow,
  episodes: TvMazeEpisode[],
): NormalizedCatalogChunk {
  const catalog = emptyCatalog();
  const seriesId = `tvmaze-show-${show.id}`;
  const rootRules = rootBusinessRules(`tvmaze-show-${show.id}`, show.genres);
  const network = show.network ?? show.webChannel;

  catalog.content.push({
    id: seriesId,
    type: "SERIES",
    title: show.name,
    parentId: null,
    ...rootRules.content,
  });
  catalog.geoBlocks.push(
    ...rootRules.geoBlocks.map((countryCode) => ({
      contentId: seriesId,
      countryCode,
    })),
  );
  catalog.metadata.push({
    contentId: seriesId,
    source: "TVMAZE",
    sourceId: `show:${show.id}`,
    sourceUrl: show.url,
    originalTitle: null,
    summary: cleanText(show.summary),
    language: show.language,
    status: show.status,
    countryCode: network?.country?.code ?? null,
    networkName: network?.name ?? null,
    officialSiteUrl: show.officialSite,
    imageUrl: preferredImage(show.image),
    premieredAt: parseDate(show.premiered),
    endedAt: parseDate(show.ended),
    runtimeMinutes: show.averageRuntime ?? show.runtime,
    seasonNumber: null,
    episodeNumber: null,
    ratingAverage: show.rating?.average ?? null,
    genres: uniqueStrings(show.genres),
    sourceMetadata: {
      showType: show.type,
      tvmazeWeight: show.weight,
      tvmazeUpdatedAtUnix: show.updated,
    },
  });

  const episodesBySeason = new Map<number, TvMazeEpisode[]>();

  for (const episode of episodes) {
    const seasonNumber = episode.season ?? 0;
    const seasonEpisodes = episodesBySeason.get(seasonNumber) ?? [];
    seasonEpisodes.push(episode);
    episodesBySeason.set(seasonNumber, seasonEpisodes);
  }

  const sortedSeasons = [...episodesBySeason.entries()].sort(
    ([left], [right]) => left - right,
  );

  for (const [seasonNumber, seasonEpisodes] of sortedSeasons) {
    const seasonId = `tvmaze-show-${show.id}-season-${seasonNumber}`;
    const seasonHash = stableHash(seasonId);
    const seasonDates = seasonEpisodes
      .map((episode) => parseDate(episode.airdate))
      .filter((date): date is Date => date !== null)
      .sort((left, right) => left.getTime() - right.getTime());
    const seasonRatings = seasonEpisodes
      .map((episode) => episode.rating?.average)
      .filter((rating): rating is number => rating !== null && rating !== undefined);

    catalog.content.push({
      id: seasonId,
      type: "SEASON",
      title:
        seasonNumber === 0
          ? `${show.name} — Specials`
          : `${show.name} — Season ${seasonNumber}`,
      parentId: seriesId,
      parentalRating: null,
      genre:
        seasonHash % 11 === 0 && show.genres.length > 1
          ? (show.genres[1] ?? null)
          : null,
      quality: null,
      isPremium: null,
      playbackUrl: null,
      geoBlockCountriesOverride: false,
    });
    catalog.metadata.push({
      contentId: seasonId,
      source: "TVMAZE",
      sourceId: `season:${show.id}:${seasonNumber}`,
      sourceUrl: show.url,
      originalTitle: null,
      summary: `Season hierarchy derived from ${seasonEpisodes.length} TVmaze episode records.`,
      language: show.language,
      status: show.status,
      countryCode: network?.country?.code ?? null,
      networkName: network?.name ?? null,
      officialSiteUrl: show.officialSite,
      imageUrl: preferredImage(show.image),
      premieredAt: seasonDates[0] ?? null,
      endedAt: seasonDates.at(-1) ?? null,
      runtimeMinutes: averageInteger(
        seasonEpisodes
          .map((episode) => episode.runtime)
          .filter((runtime): runtime is number => runtime !== null),
      ),
      seasonNumber,
      episodeNumber: null,
      ratingAverage: averageNumber(seasonRatings),
      genres: uniqueStrings(show.genres),
      sourceMetadata: {
        derivedFromEpisodeCount: seasonEpisodes.length,
        tvmazeShowId: show.id,
      },
    });

    const sortedEpisodes = [...seasonEpisodes].sort(compareEpisodes);

    for (const episode of sortedEpisodes) {
      const episodeId = `tvmaze-episode-${episode.id}`;
      const episodeHash = stableHash(episodeId);
      const hasPlaybackOverride = episodeHash % 13 === 0;
      const hasPremium4kOverride = episodeHash % 29 === 0;
      const hasGeoOverride = episodeHash % 41 === 0;

      catalog.content.push({
        id: episodeId,
        type: "EPISODE",
        title:
          episode.name.trim() ||
          `Episode ${episode.number ?? episode.id}`,
        parentId: seasonId,
        parentalRating:
          episodeHash % 31 === 0
            ? PARENTAL_RATINGS[episodeHash % PARENTAL_RATINGS.length]!
            : null,
        genre: null,
        quality: hasPremium4kOverride ? "UHD_4K" : null,
        isPremium: hasPremium4kOverride ? true : null,
        playbackUrl: hasPlaybackOverride
          ? `https://cdn.saatcms.test/tvmaze/${show.id}/episodes/${episode.id}/master.m3u8`
          : null,
        geoBlockCountriesOverride: hasGeoOverride,
      });

      if (hasGeoOverride && episodeHash % 2 === 0) {
        catalog.geoBlocks.push({
          contentId: episodeId,
          countryCode:
            GEO_BLOCK_COUNTRIES[episodeHash % GEO_BLOCK_COUNTRIES.length]!,
        });
      }

      catalog.metadata.push({
        contentId: episodeId,
        source: "TVMAZE",
        sourceId: `episode:${episode.id}`,
        sourceUrl: episode.url,
        originalTitle: null,
        summary: cleanText(episode.summary),
        language: show.language,
        status: show.status,
        countryCode: network?.country?.code ?? null,
        networkName: network?.name ?? null,
        officialSiteUrl: show.officialSite,
        imageUrl: preferredImage(episode.image) ?? preferredImage(show.image),
        premieredAt: parseDate(episode.airdate),
        endedAt: null,
        runtimeMinutes: episode.runtime,
        seasonNumber,
        episodeNumber: episode.number,
        ratingAverage: episode.rating?.average ?? null,
        genres: uniqueStrings(show.genres),
        sourceMetadata: {
          episodeType: episode.type,
          airtime: episode.airtime,
          airstamp: episode.airstamp,
          tvmazeShowId: show.id,
        },
      });
    }
  }

  return catalog;
}

function rootBusinessRules(key: string, genres: string[]): {
  content: Omit<CatalogContentRow, "id" | "type" | "title" | "parentId">;
  geoBlocks: string[];
} {
  const hash = stableHash(key);
  const isPremium = hash % 5 === 0;
  const quality = isPremium && hash % 2 === 0 ? "UHD_4K" : "HD";
  const geoBlocks =
    hash % 6 === 0
      ? uniqueStrings([
          GEO_BLOCK_COUNTRIES[hash % GEO_BLOCK_COUNTRIES.length]!,
          GEO_BLOCK_COUNTRIES[(hash + 3) % GEO_BLOCK_COUNTRIES.length]!,
        ])
      : [];

  return {
    content: {
      parentalRating: PARENTAL_RATINGS[hash % PARENTAL_RATINGS.length]!,
      genre: genres[0] ?? "Television",
      quality,
      isPremium,
      playbackUrl: `https://cdn.saatcms.test/tvmaze/${key.replace("tvmaze-show-", "")}/master.m3u8`,
      geoBlockCountriesOverride: true,
    },
    geoBlocks,
  };
}

function isEligibleShow(show: TvMazeShow, minimumRating: number): boolean {
  if (!Number.isInteger(show.id) || show.id <= 0 || show.name.trim() === "") {
    return false;
  }

  if (show.premiered === null) {
    return false;
  }

  const rating = show.rating?.average;
  return rating === null || rating === undefined
    ? (show.weight ?? 0) >= 60
    : rating >= minimumRating;
}

function compareEpisodes(left: TvMazeEpisode, right: TvMazeEpisode): number {
  return (
    (left.number ?? Number.MAX_SAFE_INTEGER) -
      (right.number ?? Number.MAX_SAFE_INTEGER) ||
    (left.airdate ?? "").localeCompare(right.airdate ?? "") ||
    left.id - right.id
  );
}

function preferredImage(image: TvMazeImage | null): string | null {
  return image?.original ?? image?.medium ?? null;
}

function parseDate(value: string | null): Date | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const text = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text === "" ? null : text;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function averageInteger(values: number[]): number | null {
  const average = averageNumber(values);
  return average === null ? null : Math.round(average);
}

function averageNumber(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyCatalog(): NormalizedCatalogChunk {
  return { content: [], metadata: [], geoBlocks: [] };
}

function appendCatalog(
  destination: NormalizedCatalogChunk,
  source: NormalizedCatalogChunk,
): void {
  destination.content.push(...source.content);
  destination.metadata.push(...source.metadata);
  destination.geoBlocks.push(...source.geoBlocks);
}
