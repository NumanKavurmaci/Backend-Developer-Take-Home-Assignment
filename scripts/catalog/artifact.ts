import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import {
  CATALOG_ARTIFACT_SCHEMA_VERSION,
  CATALOG_GENERATOR_NAME,
  CONTENT_ARTIFACT_FILE,
  GEO_BLOCKS_ARTIFACT_FILE,
  MANIFEST_FILE,
  type ArtifactContentRow,
  type ArtifactFileManifest,
  type ArtifactGeoBlockRow,
  type CatalogArtifactManifest,
  type CatalogArtifactConfiguration,
} from "./artifact-types.js";
import { assertEstimatedDatabaseBudget } from "./budget.js";
import type {
  CatalogScenarioIds,
  CatalogSourceProvenance,
  NormalizedCatalogChunk,
  NormalizedContentRow,
} from "./types.js";
import { validateCatalogPolicies } from "./policies.js";

export interface WriteCatalogArtifactOptions {
  generatedAt: string;
  generatorVersion: string;
  provenance: CatalogSourceProvenance[];
  configuration: CatalogArtifactConfiguration;
  scenarioIds: CatalogScenarioIds;
  estimatedDatabaseBytes: number;
}

export async function writeCatalogArtifact(
  outputDirectory: string,
  chunk: NormalizedCatalogChunk,
  options: WriteCatalogArtifactOptions,
): Promise<CatalogArtifactManifest> {
  validateCatalogPolicies(chunk);
  validateWriteOptions(options);
  const output = path.resolve(outputDirectory);
  await assertPathDoesNotExist(output);
  const staging = `${output}.partial-${randomUUID()}`;

  try {
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(staging, { recursive: false });
    const contentRows = [...chunk.content]
      .sort(compareNormalizedContent)
      .map(flattenContentRow);
    const geoBlockRows = [...chunk.geoBlocks].sort(compareGeoBlocks);
    const contentFile = await writeNdjsonGzip(
      path.join(staging, CONTENT_ARTIFACT_FILE),
      contentRows,
      CONTENT_ARTIFACT_FILE,
    );
    const geoBlocksFile = await writeNdjsonGzip(
      path.join(staging, GEO_BLOCKS_ARTIFACT_FILE),
      geoBlockRows,
      GEO_BLOCKS_ARTIFACT_FILE,
    );
    const totalNormalizedBytes =
      contentFile.normalizedBytes + geoBlocksFile.normalizedBytes;
    if (totalNormalizedBytes > options.configuration.maxNormalizedArtifactBytes) {
      throw new Error(
        `Catalog artifact exceeds normalized byte limit: ${totalNormalizedBytes} > ${options.configuration.maxNormalizedArtifactBytes}.`,
      );
    }
    assertEstimatedDatabaseBudget(
      options.estimatedDatabaseBytes,
      options.configuration,
    );
    const counts = countRows(contentRows, geoBlockRows.length, chunk.derivedSeasons.length);
    const manifest: CatalogArtifactManifest = {
      artifactSchemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
      generator: { name: CATALOG_GENERATOR_NAME, version: options.generatorVersion },
      generatedAt: options.generatedAt,
      provenance: structuredClone(options.provenance),
      configuration: structuredClone(options.configuration),
      counts,
      scenarioIds: structuredClone(options.scenarioIds),
      derivedSeasons: structuredClone(chunk.derivedSeasons),
      estimatedDatabaseBytes: options.estimatedDatabaseBytes,
      totals: {
        normalizedBytes: totalNormalizedBytes,
        compressedBytes: contentFile.compressedBytes + geoBlocksFile.compressedBytes,
      },
      files: {
        content: { ...contentFile, fileName: CONTENT_ARTIFACT_FILE },
        geoBlocks: { ...geoBlocksFile, fileName: GEO_BLOCKS_ARTIFACT_FILE },
      },
    };
    await writeFile(
      path.join(staging, MANIFEST_FILE),
      `${stableStringify(manifest, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await renameWithTransientRetries(staging, output);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function flattenContentRow(row: NormalizedContentRow): ArtifactContentRow {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    parentId: row.parentId,
    parentalRating: row.policies.parentalRating,
    genre: row.policies.genre,
    quality: row.policies.quality,
    isPremium: row.policies.isPremium,
    playbackUrl: row.policies.playbackUrl,
    geoBlockCountriesOverride: row.policies.geoBlockCountriesOverride,
    source: row.sourceFacts.source,
    sourceId: row.sourceFacts.sourceId,
    sourceUrl: row.sourceFacts.sourceUrl,
    originalTitle: row.sourceFacts.originalTitle,
    summary: row.sourceFacts.summary,
    language: row.sourceFacts.language,
    status: row.sourceFacts.status,
    countryCode: row.sourceFacts.countryCode,
    networkName: row.sourceFacts.networkName,
    officialSiteUrl: row.sourceFacts.officialSiteUrl,
    imageUrl: row.sourceFacts.imageUrl,
    premieredAt: row.sourceFacts.premieredAt,
    endedAt: row.sourceFacts.endedAt,
    runtimeMinutes: row.sourceFacts.runtimeMinutes,
    seasonNumber: row.sourceFacts.seasonNumber,
    episodeNumber: row.sourceFacts.episodeNumber,
    ratingAverage: row.sourceFacts.ratingAverage,
    genres: [...row.sourceFacts.genres],
    sourceMetadata: structuredClone(row.sourceFacts.sourceMetadata),
  };
}

export function calculateArtifactNormalizedBytes(
  chunk: NormalizedCatalogChunk,
): number {
  const contentBytes = [...chunk.content]
    .sort(compareNormalizedContent)
    .map(flattenContentRow)
    .reduce(
      (total, row) => total + Buffer.byteLength(`${stableStringify(row)}\n`, "utf8"),
      0,
    );
  const geoBlockBytes = [...chunk.geoBlocks]
    .sort(compareGeoBlocks)
    .reduce(
      (total, row) => total + Buffer.byteLength(`${stableStringify(row)}\n`, "utf8"),
      0,
    );
  return contentBytes + geoBlockBytes;
}

async function writeNdjsonGzip<T>(
  filePath: string,
  rows: T[],
  fileName: string,
): Promise<ArtifactFileManifest> {
  let normalizedBytes = 0;
  function* lines(): Generator<string> {
    for (const row of rows) {
      const line = `${stableStringify(row)}\n`;
      normalizedBytes += Buffer.byteLength(line, "utf8");
      yield line;
    }
  }
  await pipeline(
    Readable.from(lines()),
    createGzip({ level: 9 }),
    createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
  );
  const fileStat = await stat(filePath);
  return {
    fileName,
    rows: rows.length,
    normalizedBytes,
    compressedBytes: fileStat.size,
    sha256: await sha256File(filePath),
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function countRows(content: ArtifactContentRow[], geoBlocks: number, derivedSeasons: number) {
  return {
    content: content.length,
    series: content.filter((row) => row.type === "SERIES").length,
    seasons: content.filter((row) => row.type === "SEASON").length,
    episodes: content.filter((row) => row.type === "EPISODE").length,
    movies: content.filter((row) => row.type === "MOVIE").length,
    geoBlocks,
    derivedSeasons,
  };
}

function compareNormalizedContent(left: NormalizedContentRow, right: NormalizedContentRow): number {
  return typeRank(left.type) - typeRank(right.type) || left.id.localeCompare(right.id);
}

function typeRank(type: NormalizedContentRow["type"]): number {
  if (type === "SERIES" || type === "MOVIE") return 0;
  if (type === "SEASON") return 1;
  return 2;
}

function compareGeoBlocks(left: ArtifactGeoBlockRow, right: ArtifactGeoBlockRow): number {
  return left.contentId.localeCompare(right.contentId) ||
    left.countryCode.localeCompare(right.countryCode);
}

function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortJson(value), null, space);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function validateWriteOptions(options: WriteCatalogArtifactOptions): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.generatedAt)) {
    throw new Error("Artifact generatedAt must be an explicit UTC timestamp.");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(options.generatorVersion)) {
    throw new Error("Artifact generator version is invalid.");
  }
  if (!Number.isSafeInteger(options.estimatedDatabaseBytes) || options.estimatedDatabaseBytes < 0) {
    throw new Error("Artifact estimated database bytes are invalid.");
  }
  if (options.provenance.length === 0) throw new Error("Artifact provenance is required.");
  for (const source of options.provenance) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(source.snapshotKey)) {
      throw new Error("Artifact snapshot key must not contain a filesystem path.");
    }
  }
}

async function assertPathDoesNotExist(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new Error(`Refusing to replace an existing catalog artifact directory: ${filePath}.`);
}

async function renameWithTransientRetries(source: string, target: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!(["EPERM", "EBUSY"] as const).includes(code as "EPERM" | "EBUSY") || attempt === 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
