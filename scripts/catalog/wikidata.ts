import type {
  AdvancedSeedConfig,
  NormalizedCatalogChunk,
} from "./types.js";
import { CachedJsonClient } from "./http.js";

interface SparqlValue {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

interface WikidataMovieBinding {
  film: SparqlValue;
  filmLabel: SparqlValue;
  filmDescription?: SparqlValue;
  releaseDate?: SparqlValue;
  duration?: SparqlValue;
  image?: SparqlValue;
  imdb?: SparqlValue;
  officialSite?: SparqlValue;
  genres?: SparqlValue;
  countries?: SparqlValue;
}

interface SparqlResponse {
  results: {
    bindings: WikidataMovieBinding[];
  };
}

const WIKIDATA_QUERY_ENDPOINT = "https://query.wikidata.org/sparql";
const GEO_BLOCK_COUNTRIES = ["TR", "DE", "US", "GB", "FR", "IR", "SY"];
const PARENTAL_RATINGS = ["7+", "13+", "16+", "18+"];

export async function fetchWikidataMovies(
  config: AdvancedSeedConfig,
  movieBudget: number,
): Promise<NormalizedCatalogChunk> {
  const catalog = emptyCatalog();

  if (movieBudget <= 0 || config.maxMovies <= 0) {
    return catalog;
  }

  const client = new CachedJsonClient({
    cacheDir: config.cacheDir,
    namespace: "wikidata",
    userAgent:
      "SaatCMS-Advanced-Seed/1.0 (+https://github.com/NumanKavurmaci/Backend-Developer-Take-Home-Assignment)",
    minIntervalMs: 1_100,
    offline: config.offline,
  });
  const seenEntityIds = new Set<string>();
  const maximumMovies = Math.min(movieBudget, config.maxMovies);

  for (
    let year = config.movieToYear;
    year >= config.movieFromYear && catalog.content.length < maximumMovies;
    year -= 1
  ) {
    const query = buildMovieQuery(year, config.moviesPerYear);
    const response = await client.postForm<SparqlResponse>(
      WIKIDATA_QUERY_ENDPOINT,
      new URLSearchParams({ query, format: "json" }),
      {
        cacheKey: `films-${year}-limit-${config.moviesPerYear}-v1`,
        headers: {
          Accept: "application/sparql-results+json",
        },
      },
    );

    if (response === null) {
      continue;
    }

    for (const binding of response.results.bindings) {
      if (catalog.content.length >= maximumMovies) {
        break;
      }

      const entityId = readEntityId(binding.film.value);
      const title = binding.filmLabel.value.trim();

      if (
        entityId === null ||
        seenEntityIds.has(entityId) ||
        title === "" ||
        title === entityId
      ) {
        continue;
      }

      seenEntityIds.add(entityId);
      appendMovie(catalog, entityId, title, binding);
    }

    console.log(
      JSON.stringify({
        source: "Wikidata",
        year,
        movies: catalog.content.length,
      }),
    );
  }

  if (catalog.content.length === 0) {
    throw new Error("Wikidata import produced no movie records.");
  }

  return catalog;
}

function appendMovie(
  catalog: NormalizedCatalogChunk,
  entityId: string,
  title: string,
  binding: WikidataMovieBinding,
): void {
  const contentId = `wikidata-film-${entityId.toLowerCase()}`;
  const hash = stableHash(contentId);
  const genres = splitGroupedValues(binding.genres?.value);
  const countries = splitGroupedValues(binding.countries?.value);
  const isPremium = hash % 4 === 0;
  const quality = isPremium && hash % 2 === 0 ? "UHD_4K" : "HD";
  const geoBlocks =
    hash % 7 === 0
      ? uniqueStrings([
          GEO_BLOCK_COUNTRIES[hash % GEO_BLOCK_COUNTRIES.length]!,
          GEO_BLOCK_COUNTRIES[(hash + 2) % GEO_BLOCK_COUNTRIES.length]!,
        ])
      : [];

  catalog.content.push({
    id: contentId,
    type: "MOVIE",
    title,
    parentId: null,
    parentalRating: PARENTAL_RATINGS[hash % PARENTAL_RATINGS.length]!,
    genre: genres[0] ?? "Film",
    quality,
    isPremium,
    playbackUrl: `https://cdn.saatcms.test/wikidata/${entityId.toLowerCase()}/master.m3u8`,
    geoBlockCountriesOverride: true,
  });
  catalog.geoBlocks.push(
    ...geoBlocks.map((countryCode) => ({ contentId, countryCode })),
  );
  catalog.metadata.push({
    contentId,
    source: "WIKIDATA",
    sourceId: `film:${entityId}`,
    sourceUrl: `https://www.wikidata.org/wiki/${entityId}`,
    originalTitle: null,
    summary: binding.filmDescription?.value.trim() || null,
    language: null,
    status: "Released",
    countryCode: null,
    networkName: null,
    officialSiteUrl: binding.officialSite?.value ?? null,
    imageUrl: normalizeCommonsUrl(binding.image?.value),
    premieredAt: parseDateTime(binding.releaseDate?.value),
    endedAt: null,
    runtimeMinutes: parsePositiveInteger(binding.duration?.value),
    seasonNumber: null,
    episodeNumber: null,
    ratingAverage: null,
    genres,
    sourceMetadata: {
      wikidataEntityId: entityId,
      imdbId: binding.imdb?.value ?? null,
      countries: countries.join(" | ") || null,
    },
  });
}

function buildMovieQuery(year: number, limit: number): string {
  const nextYear = year + 1;

  return `
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX schema: <http://schema.org/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT
  ?film
  ?filmLabel
  ?filmDescription
  (MIN(?date) AS ?releaseDate)
  (SAMPLE(?duration) AS ?duration)
  (SAMPLE(?image) AS ?image)
  (SAMPLE(?imdbId) AS ?imdb)
  (SAMPLE(?officialWebsite) AS ?officialSite)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries)
WHERE {
  VALUES ?filmType { wd:Q11424 wd:Q24869 }
  ?film wdt:P31 ?filmType;
        wdt:P577 ?date.

  FILTER(?date >= "${year}-01-01T00:00:00Z"^^xsd:dateTime)
  FILTER(?date < "${nextYear}-01-01T00:00:00Z"^^xsd:dateTime)

  OPTIONAL { ?film wdt:P2047 ?duration. }
  OPTIONAL { ?film wdt:P18 ?image. }
  OPTIONAL { ?film wdt:P345 ?imdbId. }
  OPTIONAL { ?film wdt:P856 ?officialWebsite. }
  OPTIONAL { ?film wdt:P136 ?genre. }
  OPTIONAL { ?film wdt:P495 ?country. }

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
  }
}
GROUP BY ?film ?filmLabel ?filmDescription
ORDER BY ?film
LIMIT ${limit}
`.trim();
}

function readEntityId(value: string): string | null {
  const match = /\/entity\/(Q\d+)$/.exec(value);
  return match?.[1] ?? null;
}

function splitGroupedValues(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  return uniqueStrings(value.split("|").map((part) => part.trim()));
}

function parseDateTime(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCommonsUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.replace(/^http:\/\//, "https://");
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

function emptyCatalog(): NormalizedCatalogChunk {
  return { content: [], metadata: [], geoBlocks: [] };
}
