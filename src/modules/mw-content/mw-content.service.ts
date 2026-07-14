import { prisma } from "../../db/client.js";
import { resolveContentMetadata } from "../../content/metadata-inheritance.js";
import type { ResolvedContentMetadata } from "../../shared/domain/domain-contracts.js";
import { ApiError } from "../../shared/http/api-error.js";

export type PublicContentResponse = Omit<
  ResolvedContentMetadata,
  "playbackUrl"
>;

export class MwContentService {
  async getResolvedContent(
    contentId: string | undefined,
  ): Promise<PublicContentResponse> {
    if (!contentId || contentId.trim() === "") {
      throw new ApiError(400, "INVALID_REQUEST", "contentId is required");
    }

    const metadata = await resolveContentMetadata(prisma, contentId);

    return toPublicContentResponse(metadata);
  }
}

export function toPublicContentResponse(
  metadata: ResolvedContentMetadata,
): PublicContentResponse {
  return {
    contentId: metadata.contentId,
    type: metadata.type,
    title: metadata.title,
    parentalRating: metadata.parentalRating,
    genre: metadata.genre,
    quality: metadata.quality,
    isPremium: metadata.isPremium,
    geoBlockCountries: metadata.geoBlockCountries,
  };
}
