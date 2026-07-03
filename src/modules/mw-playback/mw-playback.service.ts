import { HTTPException } from "hono/http-exception";
import { prisma } from "../../db/client.js";
import {
  ContentNotFoundError,
  resolveContentMetadata,
  type ResolvedContentMetadata,
} from "../../content/metadata-inheritance.js";
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

class GeoBlockedPlaybackError extends Error {
  readonly errorCode = "GEO_BLOCKED";
  readonly statusCode = 403;
}

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
    try {
      return await this.contentResolver(contentId);
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new HTTPException(404, {
          message: "Content not found",
        });
      }

      throw error;
    }
  }

  private normalizeContentId(contentId: string | undefined): string {
    const normalizedContentId = contentId?.trim();

    if (!normalizedContentId) {
      throw new HTTPException(400, {
        message: "contentId is required",
      });
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
      throw new GeoBlockedPlaybackError();
    }
  }
}
