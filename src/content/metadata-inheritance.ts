import type { Content, PrismaClient } from "@prisma/client";
import { assertContentType, type ContentType } from "./content-types.js";
import { validateContentParent } from "./content-hierarchy.js";
import { assertVideoQuality, type VideoQuality } from "./content-metadata.js";
import { getContentAncestorPath } from "./content-repository.js";

type ResolvedContentBase = Pick<
  Content,
  "title" | "parentalRating" | "genre" | "isPremium" | "playbackUrl"
>;

export type ResolvedContentMetadata = ResolvedContentBase & {
  contentId: string;
  type: ContentType;
  quality: VideoQuality | null;
  geoBlockCountries: string[];
};

export class ContentNotFoundError extends Error {
  readonly errorCode = "CONTENT_NOT_FOUND";
  readonly statusCode = 404;

  constructor(contentId: string) {
    super(`Content ${contentId} was not found.`);
    this.name = "ContentNotFoundError";
  }
}

// Resolves final metadata from closest content first: Episode -> Season -> Series.
export async function resolveContentMetadata(
  prisma: PrismaClient,
  contentId: string,
): Promise<ResolvedContentMetadata> {
  const ancestorPath = await getContentAncestorPath(prisma, contentId);

  if (ancestorPath.length === 0) {
    throw new ContentNotFoundError(contentId);
  }

  assertAncestorPathMatchesContentHierarchyRules(ancestorPath);

  const metadataPriorityPath = [...ancestorPath].reverse();
  const geoBlockCountriesByContentId = await loadGeoBlockCountriesForPath(
    prisma,
    ancestorPath.map((content) => content.id),
  );
  const requestedContent = metadataPriorityPath[0];

  if (!requestedContent) {
    throw new ContentNotFoundError(contentId);
  }

  const resolvedQuality = resolveFirstDefinedMetadataValue(
    metadataPriorityPath,
    "quality",
  );

  assertVideoQuality(resolvedQuality);

  return {
    contentId: requestedContent.id,
    type: requestedContent.type as ContentType,
    title: requestedContent.title,
    parentalRating: resolveFirstDefinedMetadataValue(
      metadataPriorityPath,
      "parentalRating",
    ),
    genre: resolveFirstDefinedMetadataValue(metadataPriorityPath, "genre"),
    quality: resolvedQuality,
    isPremium: resolveFirstDefinedMetadataValue(
      metadataPriorityPath,
      "isPremium",
    ),
    playbackUrl: resolveFirstDefinedMetadataValue(
      metadataPriorityPath,
      "playbackUrl",
    ),
    geoBlockCountries: resolveGeoBlockCountries(
      metadataPriorityPath,
      geoBlockCountriesByContentId,
    ),
  };
}

// Picks the first non-null value from Episode -> Season -> Series priority order.
function resolveFirstDefinedMetadataValue<Field extends keyof Content>(
  metadataPriorityPath: Content[],
  field: Field,
): Content[Field] | null {
  const owner = metadataPriorityPath.find((content) => content[field] !== null);
  return owner ? owner[field] : null;
}

// Verifies raw database rows still form a valid CMS hierarchy before inheritance.
function assertAncestorPathMatchesContentHierarchyRules(
  ancestorPath: Content[],
): void {
  for (const [index, content] of ancestorPath.entries()) {
    assertContentType(content.type);

    const parent = index === 0 ? null : ancestorPath[index - 1];

    if (index === 0 && content.parentId !== null) {
      throw new Error(
        `Content hierarchy is incomplete for ${content.id}; missing parent ${content.parentId}.`,
      );
    }

    if (parent && content.parentId !== parent.id) {
      throw new Error(
        `Content hierarchy is inconsistent for ${content.id}; expected parent ${parent.id}.`,
      );
    }

    validateContentParent(content.type, parent);
  }
}

async function loadGeoBlockCountriesForPath(
  prisma: PrismaClient,
  contentIds: string[],
): Promise<Map<string, string[]>> {
  const rows = await prisma.contentGeoBlockCountry.findMany({
    where: {
      contentId: {
        in: contentIds,
      },
    },
    orderBy: [{ contentId: "asc" }, { countryCode: "asc" }],
  });
  const countriesByContentId = new Map<string, string[]>();

  for (const row of rows) {
    const countries = countriesByContentId.get(row.contentId) ?? [];
    countries.push(row.countryCode);
    countriesByContentId.set(row.contentId, countries);
  }

  return countriesByContentId;
}

function resolveGeoBlockCountries(
  metadataPriorityPath: Content[],
  countriesByContentId: Map<string, string[]>,
): string[] {
  const owner = metadataPriorityPath.find(
    (content) => content.geoBlockCountriesOverride,
  );

  if (!owner) {
    return [];
  }

  return countriesByContentId.get(owner.id) ?? [];
}
