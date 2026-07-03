import { VIDEO_QUALITIES } from "../../content/content-metadata.js";
import { prisma } from "../../db/client.js";
import {
  resolveContentMetadata,
  type ResolvedContentMetadata,
} from "../../content/metadata-inheritance.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { ApiError } from "../../shared/http/api-error.js";
import type { PlaybackRequestHeaders } from "./playback-request-headers.js";

type PlaybackContentResolver = (
  contentId: string,
) => Promise<ResolvedContentMetadata>;

type PlaybackResponseMetadata = Pick<
  ResolvedContentMetadata,
  | "type"
  | "title"
  | "parentalRating"
  | "genre"
  | "quality"
  | "isPremium"
  | "geoBlockCountries"
>;

export type PlaybackResponse = {
  contentId: string;
  requestContext: PlaybackRequestHeaders;
  playback: {
    playbackUrl: string | null;
  };
  metadata: PlaybackResponseMetadata;
};

export class MwPlaybackService {
  constructor(
    private readonly contentResolver: PlaybackContentResolver = (contentId) =>
      resolveContentMetadata(prisma, contentId),
  ) {}

  async getPlayback(
    contentId: string | undefined,
    requestContext: PlaybackRequestHeaders,
  ): Promise<PlaybackResponse> {
    const normalizedContentId = this.normalizeContentId(contentId);
    const metadata = await this.resolvePlaybackMetadata(normalizedContentId);
    this.assertUserCountryAllowed(requestContext, metadata);
    this.assertDeviceSupported(requestContext, metadata);

    return {
      contentId: normalizedContentId,
      requestContext,
      playback: {
        playbackUrl: metadata.playbackUrl,
      },
      metadata: {
        type: metadata.type,
        title: metadata.title,
        parentalRating: metadata.parentalRating,
        genre: metadata.genre,
        quality: metadata.quality,
        isPremium: metadata.isPremium,
        geoBlockCountries: metadata.geoBlockCountries,
      },
    };
  }

  private async resolvePlaybackMetadata(contentId: string) {
    return this.contentResolver(contentId);
  }

  private normalizeContentId(contentId: string | undefined): string {
    const normalizedContentId = contentId?.trim();

    if (!normalizedContentId) {
      throw new ApiError(400, "INVALID_REQUEST", "contentId is required");
    }

    return normalizedContentId;
  }

  private assertUserCountryAllowed(
    requestContext: PlaybackRequestHeaders,
    metadata: ResolvedContentMetadata,
  ): void {
    const userCountry = requestContext.userCountry.toUpperCase();
    const blockedCountries = metadata.geoBlockCountries.map((country) =>
      country.toUpperCase(),
    );

    if (blockedCountries.includes(userCountry)) {
      throw new DomainError(
        "GEO_BLOCKED",
        "Playback is not available in the user's country.",
      );
    }
  }

  private assertDeviceSupported(
    requestContext: PlaybackRequestHeaders,
    metadata: ResolvedContentMetadata,
  ): void {
    const isPremium4K =
      metadata.isPremium === true && metadata.quality === VIDEO_QUALITIES.UHD_4K;

    if (isPremium4K && requestContext.deviceType === "Mobile") {
      throw new DomainError(
        "DEVICE_NOT_SUPPORTED",
        "Playback is not available on this device type.",
      );
    }
  }
}
