import type { Content, Prisma, PrismaClient } from "@prisma/client";
import { assertContentType, type ContentType } from "./content-types.js";
import {
  assertVideoQuality,
  type VideoQuality,
} from "./content-metadata.js";
import { validateContentParent } from "./content-hierarchy.js";

export type CreateContentInput = {
  id: string;
  type: ContentType;
  title: string;
  parentId?: string | null;
  parentalRating?: string | null;
  genre?: string | null;
  quality?: VideoQuality | null;
  isPremium?: boolean | null;
  playbackUrl?: string | null;
  geoBlockCountriesOverride?: boolean;
  geoBlockCountries?: string[];
};

export type ContentWithChildren = Content & {
  children: Content[];
};

export type ContentWithParent = Content & {
  parent: Content | null;
};

export const MAX_CONTENT_HIERARCHY_DEPTH = 10;

export class ContentGeoBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentGeoBlockError";
  }
}

export function normalizeGeoBlockCountries(
  geoBlockCountries: string[] = [],
): string[] {
  const normalized = geoBlockCountries.map((countryCode) =>
    countryCode.trim().toUpperCase(),
  );

  const invalidCountryCode = normalized.find(
    (countryCode) => !/^[A-Z]{2}$/.test(countryCode),
  );

  if (invalidCountryCode !== undefined) {
    throw new ContentGeoBlockError(
      "Country codes must be ISO-3166 alpha-2 codes like TR, DE, or US.",
    );
  }

  return [...new Set(normalized)];
}

export async function createContent(
  prisma: PrismaClient,
  input: CreateContentInput,
): Promise<Content> {
  assertContentType(input.type);
  assertVideoQuality(input.quality);

  const geoBlockCountriesOverride = input.geoBlockCountriesOverride ?? false;
  const geoBlockCountries = normalizeGeoBlockCountries(input.geoBlockCountries);

  if (!geoBlockCountriesOverride && geoBlockCountries.length > 0) {
    throw new ContentGeoBlockError(
      "geoBlockCountries can only be provided when geoBlockCountriesOverride is true.",
    );
  }

  const parent = input.parentId
    ? await prisma.content.findUnique({
        where: { id: input.parentId },
        select: { id: true, type: true },
      })
    : null;

  validateContentParent(input.type, parent);

  const _geoBlockCountries =
    geoBlockCountries.length > 0
      ? {
          create: geoBlockCountries.map((countryCode) => ({
            countryCode,
          })),
        }
      : undefined;

  return prisma.content.create({
    data: {
      id: input.id,
      type: input.type,
      title: input.title,
      parentId: input.parentId ?? null,
      parentalRating: input.parentalRating,
      genre: input.genre,
      quality: input.quality,
      isPremium: input.isPremium,
      playbackUrl: input.playbackUrl,
      geoBlockCountriesOverride,
      geoBlockCountries: _geoBlockCountries,
    },
  });
}

export async function getContentWithChildren(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentWithChildren | null> {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: {
      children: {
        orderBy: [{ type: "asc" }, { title: "asc" }],
      },
    },
  });
}

export async function getContentWithParent(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentWithParent | null> {
  return prisma.content.findUnique({
    where: { id: contentId },
    include: { parent: true },
  });
}

type ContentAncestorRow = Content & {
  depth: number;
  hasCycle: number | boolean;
};

export async function getContentAncestorPath(
  prisma: PrismaClient,
  contentId: string,
): Promise<Content[]> {
  const rows = await fetchContentAncestorRows(prisma, contentId);

  assertAncestorPathHasNoCycle(rows);
  assertAncestorPathIsWithinDepthLimit(rows);

  return rows.map(toContent);
}

async function fetchContentAncestorRows(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentAncestorRow[]> {
  return prisma.$queryRaw<ContentAncestorRow[]>`
    WITH RECURSIVE ancestors (
      id,
      type,
      title,
      parentId,
      parentalRating,
      genre,
      quality,
      isPremium,
      playbackUrl,
      geoBlockCountriesOverride,
      createdAt,
      updatedAt,
      depth,
      path,
      hasCycle
    ) AS (
      SELECT
        id,
        type,
        title,
        parentId,
        parentalRating,
        genre,
        quality,
        isPremium,
        playbackUrl,
        geoBlockCountriesOverride,
        createdAt,
        updatedAt,
        0 AS depth,
        ',' || id || ',' AS path,
        0 AS hasCycle
      FROM "Content"
      WHERE id = ${contentId}

      UNION ALL

      SELECT
        parent.id,
        parent.type,
        parent.title,
        parent.parentId,
        parent.parentalRating,
        parent.genre,
        parent.quality,
        parent.isPremium,
        parent.playbackUrl,
        parent.geoBlockCountriesOverride,
        parent.createdAt,
        parent.updatedAt,
        ancestors.depth + 1 AS depth,
        ancestors.path || parent.id || ',' AS path,
        CASE
          WHEN instr(ancestors.path, ',' || parent.id || ',') > 0 THEN 1
          ELSE 0
        END AS hasCycle
      FROM "Content" parent
      JOIN ancestors ON parent.id = ancestors.parentId
      WHERE ancestors.parentId IS NOT NULL
        AND ancestors.depth < ${MAX_CONTENT_HIERARCHY_DEPTH - 1}
        AND ancestors.hasCycle = 0
    )
    SELECT
      id,
      type,
      title,
      parentId,
      parentalRating,
      genre,
      quality,
      isPremium,
      playbackUrl,
      geoBlockCountriesOverride,
      createdAt,
      updatedAt,
      depth,
      hasCycle
    FROM ancestors
    ORDER BY depth DESC;
  `;
}

function assertAncestorPathHasNoCycle(rows: ContentAncestorRow[]): void {
  const cycleRow = rows.find((row) => Boolean(row.hasCycle));

  if (cycleRow) {
    throw new Error(`Content hierarchy cycle detected at ${cycleRow.id}.`);
  }
}

function assertAncestorPathIsWithinDepthLimit(
  rows: ContentAncestorRow[],
): void {
  const highestAncestor = rows[0];

  if (
    highestAncestor &&
    rows.length >= MAX_CONTENT_HIERARCHY_DEPTH &&
    highestAncestor.parentId !== null
  ) {
    throw new Error(
      `Content hierarchy exceeds max depth of ${MAX_CONTENT_HIERARCHY_DEPTH}.`,
    );
  }
}

function toContent({
  depth,
  hasCycle,
  ...content
}: ContentAncestorRow): Content {
  return content;
}

export async function listContentChildren(
  prisma: PrismaClient,
  parentId: string,
): Promise<Content[]> {
  return prisma.content.findMany({
    where: { parentId },
    orderBy: [{ type: "asc" }, { title: "asc" }],
  });
}

export function contentSelectForHierarchy(): Prisma.ContentSelect {
  return {
    id: true,
    type: true,
    title: true,
    parentId: true,
  };
}
