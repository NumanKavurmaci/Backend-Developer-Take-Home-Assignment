import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import {
  CATALOG_ARTIFACT_SCHEMA_VERSION,
  CONTENT_ARTIFACT_FILE,
  GEO_BLOCKS_ARTIFACT_FILE,
  MANIFEST_FILE,
  type ArtifactContentRow,
  type ArtifactFileManifest,
  type ArtifactGeoBlockRow,
  type CatalogArtifactManifest,
} from "./artifact-types.js";
import { createHash } from "node:crypto";

export interface CatalogArtifactValidationReport {
  manifest: CatalogArtifactManifest;
  contentIdsRetained: number;
}

export async function validateCatalogArtifact(
  artifactDirectory: string,
): Promise<CatalogArtifactValidationReport> {
  const directory = path.resolve(artifactDirectory);
  const manifest = await readManifest(path.join(directory, MANIFEST_FILE));
  assertSupportedManifest(manifest);

  const contentResult = await validateContentFile(
    path.join(directory, CONTENT_ARTIFACT_FILE),
    manifest.files.content,
  );
  const geoResult = await validateGeoBlockFile(
    path.join(directory, GEO_BLOCKS_ARTIFACT_FILE),
    manifest.files.geoBlocks,
    contentResult.typesById,
  );
  const actualCounts = {
    content: contentResult.rows,
    series: contentResult.series,
    seasons: contentResult.seasons,
    episodes: contentResult.episodes,
    movies: contentResult.movies,
    geoBlocks: geoResult.rows,
    derivedSeasons: manifest.derivedSeasons.length,
  };
  if (
    Object.entries(actualCounts).some(
      ([key, count]) => manifest.counts[key as keyof typeof actualCounts] !== count,
    )
  ) {
    throw new Error(
      `Artifact manifest counts do not match rows: expected ${JSON.stringify(manifest.counts)}, received ${JSON.stringify(actualCounts)}.`,
    );
  }
  const normalizedBytes =
    contentResult.normalizedBytes + geoResult.normalizedBytes;
  const compressedBytes =
    manifest.files.content.compressedBytes +
    manifest.files.geoBlocks.compressedBytes;
  if (
    manifest.totals.normalizedBytes !== normalizedBytes ||
    manifest.totals.compressedBytes !== compressedBytes
  ) {
    throw new Error("Artifact manifest byte totals do not match its files.");
  }

  for (const contentId of Object.values(manifest.scenarioIds)) {
    if (contentId !== undefined && !contentResult.typesById.has(contentId)) {
      throw new Error(`Artifact scenario points to missing Content: ${contentId}.`);
    }
  }
  for (const fallback of manifest.derivedSeasons) {
    if (contentResult.typesById.get(fallback.contentId) !== "SEASON") {
      throw new Error(`Artifact derived Season is missing: ${fallback.contentId}.`);
    }
  }

  return { manifest, contentIdsRetained: contentResult.typesById.size };
}

async function readManifest(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error("Catalog artifact manifest is missing or malformed.", {
      cause: error,
    });
  }
}

function assertSupportedManifest(value: unknown): asserts value is CatalogArtifactManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Catalog artifact manifest must be an object.");
  }
  const manifest = value as Partial<CatalogArtifactManifest>;
  if (manifest.artifactSchemaVersion !== CATALOG_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported catalog artifact schema version: ${String(manifest.artifactSchemaVersion)}.`,
    );
  }
  if (
    manifest.files?.content?.fileName !== CONTENT_ARTIFACT_FILE ||
    manifest.files?.geoBlocks?.fileName !== GEO_BLOCKS_ARTIFACT_FILE
  ) {
    throw new Error("Catalog artifact manifest contains unsupported file names.");
  }
  if (
    manifest.counts === undefined ||
    manifest.totals === undefined ||
    manifest.scenarioIds === undefined ||
    !Array.isArray(manifest.derivedSeasons) ||
    !Array.isArray(manifest.provenance)
  ) {
    throw new Error("Catalog artifact manifest is incomplete.");
  }
}

async function validateContentFile(
  filePath: string,
  expected: ArtifactFileManifest,
): Promise<{
  rows: number;
  normalizedBytes: number;
  series: number;
  seasons: number;
  episodes: number;
  movies: number;
  typesById: Map<string, ArtifactContentRow["type"]>;
}> {
  await validateCompressedFile(filePath, expected);
  const typesById = new Map<string, ArtifactContentRow["type"]>();
  const sourceIdentities = new Set<string>();
  let previous: ArtifactContentRow | undefined;
  let rows = 0;
  let normalizedBytes = 0;
  const counts = { series: 0, seasons: 0, episodes: 0, movies: 0 };

  for await (const line of ndjsonLines(filePath)) {
    normalizedBytes += Buffer.byteLength(line, "utf8") + 1;
    const row = parseContentRow(line, rows + 1);
    if (previous !== undefined && compareContent(previous, row) >= 0) {
      throw new Error(`Content artifact ordering is not deterministic at row ${rows + 1}.`);
    }
    previous = row;
    if (typesById.has(row.id)) throw new Error(`Duplicate artifact Content ID: ${row.id}.`);
    const sourceKey = `${row.source}/${row.sourceId}`;
    if (sourceIdentities.has(sourceKey)) {
      throw new Error(`Duplicate artifact source identity: ${sourceKey}.`);
    }
    assertArtifactParent(row, typesById);
    typesById.set(row.id, row.type);
    sourceIdentities.add(sourceKey);
    rows += 1;
    if (row.type === "SERIES") counts.series += 1;
    else if (row.type === "SEASON") counts.seasons += 1;
    else if (row.type === "EPISODE") counts.episodes += 1;
    else counts.movies += 1;
  }
  assertFileMeasurements(expected, rows, normalizedBytes);
  return { rows, normalizedBytes, ...counts, typesById };
}

async function validateGeoBlockFile(
  filePath: string,
  expected: ArtifactFileManifest,
  contentTypes: Map<string, ArtifactContentRow["type"]>,
): Promise<{ rows: number; normalizedBytes: number }> {
  await validateCompressedFile(filePath, expected);
  let previous: ArtifactGeoBlockRow | undefined;
  let rows = 0;
  let normalizedBytes = 0;
  for await (const line of ndjsonLines(filePath)) {
    normalizedBytes += Buffer.byteLength(line, "utf8") + 1;
    const row = parseGeoBlockRow(line, rows + 1);
    if (!contentTypes.has(row.contentId)) {
      throw new Error(`Artifact geo-block points to missing Content: ${row.contentId}.`);
    }
    if (previous !== undefined && compareGeoBlocks(previous, row) >= 0) {
      throw new Error(`Geo-block artifact ordering is invalid at row ${rows + 1}.`);
    }
    previous = row;
    rows += 1;
  }
  assertFileMeasurements(expected, rows, normalizedBytes);
  return { rows, normalizedBytes };
}

async function validateCompressedFile(
  filePath: string,
  expected: ArtifactFileManifest,
): Promise<void> {
  const fileStat = await stat(filePath);
  if (fileStat.size !== expected.compressedBytes) {
    throw new Error(`Artifact compressed byte count mismatch: ${expected.fileName}.`);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  if (hash.digest("hex") !== expected.sha256) {
    throw new Error(`Artifact checksum mismatch: ${expected.fileName}.`);
  }
}

async function* ndjsonLines(filePath: string): AsyncGenerator<string> {
  const compressed = createReadStream(filePath);
  const decompressed = compressed.pipe(createGunzip());
  const lines = readline.createInterface({ input: decompressed, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim() === "") throw new Error("Artifact NDJSON contains an empty row.");
      yield line;
    }
  } catch (error) {
    throw new Error(`Artifact compressed NDJSON is truncated or malformed: ${path.basename(filePath)}.`, {
      cause: error,
    });
  } finally {
    lines.close();
    compressed.destroy();
  }
}

function parseContentRow(line: string, rowNumber: number): ArtifactContentRow {
  let value: unknown;
  try { value = JSON.parse(line) as unknown; } catch { throw new Error(`Malformed Content JSON at row ${rowNumber}.`); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Content row ${rowNumber}.`);
  }
  const row = value as Partial<ArtifactContentRow>;
  if (
    typeof row.id !== "string" || row.id === "" ||
    !["SERIES", "SEASON", "EPISODE", "MOVIE"].includes(row.type ?? "") ||
    typeof row.title !== "string" || row.title.trim() === "" ||
    typeof row.source !== "string" || typeof row.sourceId !== "string" ||
    !Array.isArray(row.genres) || typeof row.geoBlockCountriesOverride !== "boolean"
  ) {
    throw new Error(`Invalid Content row ${rowNumber}.`);
  }
  return row as ArtifactContentRow;
}

function parseGeoBlockRow(line: string, rowNumber: number): ArtifactGeoBlockRow {
  let value: unknown;
  try { value = JSON.parse(line) as unknown; } catch { throw new Error(`Malformed geo-block JSON at row ${rowNumber}.`); }
  const row = value as Partial<ArtifactGeoBlockRow> | null;
  if (
    typeof row?.contentId !== "string" || row.contentId === "" ||
    typeof row.countryCode !== "string" || !/^[A-Z]{2}$/.test(row.countryCode)
  ) {
    throw new Error(`Invalid geo-block row ${rowNumber}.`);
  }
  return row as ArtifactGeoBlockRow;
}

function assertArtifactParent(
  row: ArtifactContentRow,
  typesById: Map<string, ArtifactContentRow["type"]>,
): void {
  if (row.type === "SERIES" || row.type === "MOVIE") {
    if (row.parentId !== null) throw new Error(`${row.type} artifact row must not have a parent: ${row.id}.`);
    return;
  }
  if (typeof row.parentId !== "string") throw new Error(`Artifact row is missing a parent: ${row.id}.`);
  const expectedType = row.type === "SEASON" ? "SERIES" : "SEASON";
  if (typesById.get(row.parentId) !== expectedType) {
    throw new Error(`Artifact parent is missing or invalid: ${row.id} -> ${row.parentId}.`);
  }
}

function compareContent(left: ArtifactContentRow, right: ArtifactContentRow): number {
  return typeRank(left.type) - typeRank(right.type) || left.id.localeCompare(right.id);
}

function typeRank(type: ArtifactContentRow["type"]): number {
  if (type === "SERIES" || type === "MOVIE") return 0;
  return type === "SEASON" ? 1 : 2;
}

function compareGeoBlocks(left: ArtifactGeoBlockRow, right: ArtifactGeoBlockRow): number {
  return left.contentId.localeCompare(right.contentId) || left.countryCode.localeCompare(right.countryCode);
}

function assertFileMeasurements(
  expected: ArtifactFileManifest,
  rows: number,
  normalizedBytes: number,
): void {
  if (expected.rows !== rows || expected.normalizedBytes !== normalizedBytes) {
    throw new Error(`Artifact row or normalized byte count mismatch: ${expected.fileName}.`);
  }
}
