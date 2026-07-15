import type { Content, Prisma, PrismaClient } from "@prisma/client";
import { assertContentType } from "./content-types.js";
import { assertVideoQuality } from "./content-metadata.js";
import { validateContentParent } from "./content-hierarchy.js";
import { DomainError } from "../shared/domain/domain-error.js";
import type {
  ContentCreateInput,
  ContentListQuery,
  ContentRecord,
  ContentUpdateInput,
  PaginatedResult,
} from "../shared/domain/domain-contracts.js";
import { isPrismaErrorCode } from "../db/database-error.js";
import { nextEntityUpdatedAt } from "../shared/http/entity-tag.js";

// Safety limit for corrupted or unexpectedly deep hierarchy data, not a business depth rule.
export const MAX_CONTENT_HIERARCHY_DEPTH = 10;

const ISO_3166_ALPHA_2_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export function normalizeGeoBlockCountries(
  geoBlockCountries: string[] = [],
): string[] {
  const normalized = geoBlockCountries.map((countryCode) =>
    countryCode.trim().toUpperCase(),
  );

  const invalidCountryCode = normalized.find(
    (countryCode) => !ISO_3166_ALPHA_2_COUNTRY_CODE_PATTERN.test(countryCode),
  );

  if (invalidCountryCode !== undefined) {
    throw new DomainError(
      "INVALID_CONTENT_GEO_BLOCK_COUNTRIES",
      "Country codes must be ISO-3166 alpha-2 codes like TR, DE, or US.",
    );
  }

  return [...new Set(normalized)];
}

function createGeoBlockCountryRows(geoBlockCountries: string[]) {
  return geoBlockCountries.length > 0
    ? {
        create: geoBlockCountries.map((countryCode) => ({
          countryCode,
        })),
      }
    : undefined;
}

export async function createContent(
  prisma: PrismaClient,
  input: ContentCreateInput,
): Promise<Content> {
  assertContentType(input.type);
  assertVideoQuality(input.quality);

  const geoBlockCountriesOverride = input.geoBlockCountriesOverride ?? false;
  const geoBlockCountries = normalizeGeoBlockCountries(input.geoBlockCountries);

  if (!geoBlockCountriesOverride && geoBlockCountries.length > 0) {
    throw new DomainError(
      "INVALID_CONTENT_GEO_BLOCK_COUNTRIES",
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
      geoBlockCountries: createGeoBlockCountryRows(geoBlockCountries),
    },
  });
}

const cmsContentSelect = {
  id: true,
  type: true,
  title: true,
  parentId: true,
  parentalRating: true,
  genre: true,
  quality: true,
  isPremium: true,
  playbackUrl: true,
  geoBlockCountriesOverride: true,
  createdAt: true,
  updatedAt: true,
  geoBlockCountries: {
    orderBy: { countryCode: "asc" },
  },
} satisfies Prisma.ContentSelect;

type ContentWithGeoBlockRows = Prisma.ContentGetPayload<{
  select: typeof cmsContentSelect;
}>;

type ContentWithChildren = Prisma.ContentGetPayload<{
  include: { children: true };
}>;

type ContentWithParent = Prisma.ContentGetPayload<{
  include: { parent: true };
}>;

export async function createCmsContent(
  prisma: PrismaClient,
  input: ContentCreateInput,
): Promise<ContentRecord> {
  try {
    const content = await prisma.$transaction(async (transaction) => {
      assertContentType(input.type);
      assertVideoQuality(input.quality);

      const geoBlockCountriesOverride =
        input.geoBlockCountriesOverride ?? false;
      const geoBlockCountries = normalizeGeoBlockCountries(
        input.geoBlockCountries,
      );

      assertGeoBlockCountryOverride(
        geoBlockCountriesOverride,
        geoBlockCountries,
      );

      const parent = input.parentId
        ? await transaction.content.findUnique({
            where: { id: input.parentId },
            select: { id: true, type: true },
          })
        : null;

      validateContentParent(input.type, parent);

      return transaction.content.create({
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
          geoBlockCountries: createGeoBlockCountryRows(geoBlockCountries),
        },
        select: cmsContentSelect,
      });
    });

    return toContentRecord(content);
  } catch (error) {
    throw toContentWriteError(error);
  }
}

export async function getCmsContent(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentRecord | null> {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: cmsContentSelect,
  });

  return content ? toContentRecord(content) : null;
}

export async function listCmsContent(
  prisma: PrismaClient,
  input: ContentListQuery,
): Promise<PaginatedResult<ContentRecord>> {
  const where: Prisma.ContentWhereInput = {
    type: input.type,
    parentId: input.parentId,
    title: input.title
      ? { contains: input.title, mode: "insensitive" }
      : undefined,
  };
  const [contents, total] = await prisma.$transaction([
    prisma.content.findMany({
      where,
      select: cmsContentSelect,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.content.count({ where }),
  ]);

  return {
    items: contents.map(toContentRecord),
    page: input.page,
    pageSize: input.pageSize,
    total,
  };
}

export async function updateCmsContent(
  prisma: PrismaClient,
  contentId: string,
  input: ContentUpdateInput,
  expectedUpdatedAt?: Date,
): Promise<ContentRecord> {
  try {
    const content = await prisma.$transaction(async (transaction) => {
      const current = await transaction.content.findUnique({
        where: { id: contentId },
        select: cmsContentSelect,
      });

      if (!current) {
        throw new DomainError("CONTENT_NOT_FOUND", "Content not found");
      }

      assertContentType(current.type);
      assertVideoQuality(input.quality);

      const nextParentId = input.parentId !== undefined
        ? input.parentId ?? null
        : current.parentId;
      const parent = nextParentId
        ? await transaction.content.findUnique({
            where: { id: nextParentId },
            select: { id: true, type: true },
          })
        : null;

      validateContentParent(current.type, parent);
      await assertReparentingDoesNotCreateCycle(
        transaction,
        contentId,
        nextParentId,
      );

      const nextGeoBlockCountriesOverride =
        input.geoBlockCountriesOverride ??
        current.geoBlockCountriesOverride;
      const nextGeoBlockCountries = input.geoBlockCountries !== undefined
        ? normalizeGeoBlockCountries(input.geoBlockCountries)
        : current.geoBlockCountries.map((row) => row.countryCode);

      if (input.geoBlockCountries !== undefined) {
        assertGeoBlockCountryOverride(
          nextGeoBlockCountriesOverride,
          nextGeoBlockCountries,
        );
      }

      const updateResult = await transaction.content.updateMany({
        where: {
          id: contentId,
          updatedAt: expectedUpdatedAt,
        },
        data: {
          title: input.title,
          parentId: input.parentId,
          parentalRating: input.parentalRating,
          genre: input.genre,
          quality: input.quality,
          isPremium: input.isPremium,
          playbackUrl: input.playbackUrl,
          geoBlockCountriesOverride: input.geoBlockCountriesOverride,
          updatedAt: nextEntityUpdatedAt(current.updatedAt),
        },
      });

      if (updateResult.count === 0) {
        throw new DomainError(
          "CONTENT_WRITE_CONFLICT",
          "Content changed after it was read. Fetch the latest version and retry.",
        );
      }

      if (
        input.geoBlockCountries !== undefined ||
        input.geoBlockCountriesOverride === false
      ) {
        await transaction.contentGeoBlockCountry.deleteMany({
          where: { contentId },
        });

        if (nextGeoBlockCountriesOverride && nextGeoBlockCountries.length > 0) {
          await transaction.contentGeoBlockCountry.createMany({
            data: nextGeoBlockCountries.map((countryCode) => ({
              contentId,
              countryCode,
            })),
          });
        }
      }

      const updated = await transaction.content.findUnique({
        where: { id: contentId },
        select: cmsContentSelect,
      });

      if (!updated) {
        throw new DomainError("CONTENT_NOT_FOUND", "Content not found");
      }

      return updated;
    });

    return toContentRecord(content);
  } catch (error) {
    throw toContentWriteError(error);
  }
}

export async function deleteCmsContent(
  prisma: PrismaClient,
  contentId: string,
): Promise<void> {
  try {
    await prisma.$transaction(async (transaction) => {
      const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Content"
        WHERE "id" = ${contentId}
        FOR UPDATE
      `;

      if (lockedRows.length === 0) {
        throw new DomainError("CONTENT_NOT_FOUND", "Content not found");
      }

      const childCount = await transaction.content.count({
        where: { parentId: contentId },
      });

      if (childCount > 0) {
        throw new DomainError(
          "CONTENT_HAS_CHILDREN",
          "Content with children cannot be deleted.",
        );
      }

      await transaction.content.delete({ where: { id: contentId } });
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2003")) {
      throw new DomainError(
        "CONTENT_HAS_CHILDREN",
        "Content with children cannot be deleted.",
      );
    }

    throw toContentWriteError(error);
  }
}

function assertGeoBlockCountryOverride(
  geoBlockCountriesOverride: boolean,
  geoBlockCountries: string[],
): void {
  if (!geoBlockCountriesOverride && geoBlockCountries.length > 0) {
    throw new DomainError(
      "INVALID_CONTENT_GEO_BLOCK_COUNTRIES",
      "geoBlockCountries can only be provided when geoBlockCountriesOverride is true.",
    );
  }
}

async function assertReparentingDoesNotCreateCycle(
  transaction: Prisma.TransactionClient,
  contentId: string,
  parentId: string | null,
): Promise<void> {
  let ancestorId = parentId;

  for (let depth = 0; ancestorId !== null; depth += 1) {
    if (ancestorId === contentId) {
      throw new DomainError(
        "INVALID_CONTENT_HIERARCHY",
        "A content item cannot be parented to itself or one of its descendants.",
      );
    }

    if (depth >= MAX_CONTENT_HIERARCHY_DEPTH) {
      throw new DomainError(
        "INVALID_CONTENT_HIERARCHY",
        `Content hierarchy exceeds max depth of ${MAX_CONTENT_HIERARCHY_DEPTH}.`,
      );
    }

    const ancestor: { parentId: string | null } | null =
      await transaction.content.findUnique({
        where: { id: ancestorId },
        select: { parentId: true },
      });
    ancestorId = ancestor?.parentId ?? null;
  }
}

function toContentRecord(
  content: ContentWithGeoBlockRows,
): ContentRecord {
  assertContentType(content.type);
  assertVideoQuality(content.quality);

  return {
    id: content.id,
    type: content.type,
    title: content.title,
    parentId: content.parentId,
    parentalRating: content.parentalRating,
    genre: content.genre,
    quality: content.quality,
    isPremium: content.isPremium,
    playbackUrl: content.playbackUrl,
    geoBlockCountriesOverride: content.geoBlockCountriesOverride,
    geoBlockCountries: content.geoBlockCountries.map(
      ({ countryCode }) => countryCode,
    ),
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  };
}

function toContentWriteError(error: unknown): unknown {
  if (error instanceof DomainError) {
    return error;
  }

  if (isPrismaErrorCode(error, "P2002")) {
    return new DomainError(
      "CONTENT_ID_CONFLICT",
      "A content item with this ID already exists.",
    );
  }

  if (isPrismaErrorCode(error, "P2003")) {
    return new DomainError(
      "INVALID_CONTENT_HIERARCHY",
      "The selected content parent no longer exists.",
    );
  }

  return error;
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

// Loads the full parent path in one query to avoid one query per hierarchy level.
export async function getContentAncestorPath(
  prisma: PrismaClient,
  contentId: string,
): Promise<Content[]> {
  const rows = await fetchContentAncestorRows(prisma, contentId);

  assertAncestorPathHasNoCycle(rows);
  assertAncestorPathIsWithinDepthLimit(rows);

  return rows.map(toContent);
}

// Recursive PostgreSQL CTE walks upward from the requested content to its root parent.
async function fetchContentAncestorRows(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentAncestorRow[]> {
  return prisma.$queryRaw<ContentAncestorRow[]>`
    WITH RECURSIVE ancestors (
      id,
      type,
      title,
      "parentId",
      "parentalRating",
      genre,
      quality,
      "isPremium",
      "playbackUrl",
      "geoBlockCountriesOverride",
      "createdAt",
      "updatedAt",
      depth,
      path,
      "hasCycle"
    ) AS (
      SELECT
        "id",
        "type",
        "title",
        "parentId",
        "parentalRating",
        "genre",
        "quality",
        "isPremium",
        "playbackUrl",
        "geoBlockCountriesOverride",
        "createdAt",
        "updatedAt",
        0 AS depth,
        ',' || "id" || ',' AS path,
        false AS "hasCycle"
      FROM "Content"
      WHERE "id" = ${contentId}

      UNION ALL

      SELECT
        parent."id",
        parent."type",
        parent."title",
        parent."parentId",
        parent."parentalRating",
        parent."genre",
        parent."quality",
        parent."isPremium",
        parent."playbackUrl",
        parent."geoBlockCountriesOverride",
        parent."createdAt",
        parent."updatedAt",
        ancestors.depth + 1 AS depth,
        ancestors.path || parent."id" || ',' AS path,
        CASE
          WHEN POSITION(',' || parent."id" || ',' IN ancestors.path) > 0 THEN true
          ELSE false
        END AS "hasCycle"
      FROM "Content" parent
      JOIN ancestors ON parent."id" = ancestors."parentId"
      WHERE ancestors."parentId" IS NOT NULL
        AND ancestors.depth < ${MAX_CONTENT_HIERARCHY_DEPTH - 1}
        AND NOT ancestors."hasCycle"
    )
    SELECT
      id,
      type,
      title,
      "parentId",
      "parentalRating",
      genre,
      quality,
      "isPremium",
      "playbackUrl",
      "geoBlockCountriesOverride",
      "createdAt",
      "updatedAt",
      depth,
      "hasCycle"
    FROM ancestors
    ORDER BY depth DESC;
  `;
}

// Protects later metadata resolution from corrupted parent cycles.
function assertAncestorPathHasNoCycle(rows: ContentAncestorRow[]): void {
  const cycleRow = rows.find((row) => Boolean(row.hasCycle));

  if (cycleRow) {
    throw new Error(`Content hierarchy cycle detected at ${cycleRow.id}.`);
  }
}

// Stops traversal from silently accepting hierarchy data beyond the supported safety window.
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
