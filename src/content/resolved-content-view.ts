import type { ResolvedContentMetadata } from "../shared/domain/domain-contracts.js";

export type ResolvedContentView = Omit<
  ResolvedContentMetadata,
  "contentId" | "playbackUrl"
>;

export function toResolvedContentView(
  metadata: ResolvedContentMetadata,
): ResolvedContentView {
  return {
    type: metadata.type,
    title: metadata.title,
    parentalRating: metadata.parentalRating,
    genre: metadata.genre,
    quality: metadata.quality,
    isPremium: metadata.isPremium,
    geoBlockCountries: metadata.geoBlockCountries,
  };
}
