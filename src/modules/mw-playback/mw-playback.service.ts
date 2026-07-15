import { prisma } from "../../db/client.js";
import { resolveContentMetadata } from "../../content/metadata-inheritance.js";
import {
  toResolvedContentView,
  type ResolvedContentView,
} from "../../content/resolved-content-view.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import {
  VIDEO_QUALITIES,
  type ResolvedContentMetadata,
} from "../../shared/domain/domain-contracts.js";
import { readContentId } from "../../shared/http/content-id.js";
import type { PlaybackRequestHeaders } from "./playback-request-headers.js";

type PlaybackContentResolver = (
  contentId: string,
) => Promise<ResolvedContentMetadata>;

export type PlaybackResponse = {
  contentId: string;
  requestContext: PlaybackRequestHeaders;
  playback: {
    playbackUrl: string | null;
  };
  metadata: ResolvedContentView;
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
    const normalizedContentId = readContentId(contentId);
    const metadata = await this.resolvePlaybackMetadata(normalizedContentId);
    this.assertUserCountryAllowed(requestContext, metadata);
    this.assertDeviceSupported(requestContext, metadata);

    return {
      contentId: normalizedContentId,
      requestContext,
      playback: {
        playbackUrl: metadata.playbackUrl,
      },
      metadata: toResolvedContentView(metadata),
    };
  }

  private async resolvePlaybackMetadata(contentId: string) {
    return this.contentResolver(contentId);
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
      metadata.isPremium === true &&
      metadata.quality === VIDEO_QUALITIES.UHD_4K;

    if (isPremium4K && requestContext.deviceType === "Mobile") {
      throw new DomainError(
        "DEVICE_NOT_SUPPORTED",
        "Playback is not available on this device type.",
      );
    }
  }
}
