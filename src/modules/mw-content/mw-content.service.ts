import { prisma } from "../../db/client.js";
import { resolveContentMetadata } from "../../content/metadata-inheritance.js";
import { toResolvedContentView } from "../../content/resolved-content-view.js";
import type { ResolvedContentMetadata } from "../../shared/domain/domain-contracts.js";
import { readContentId } from "../../shared/http/content-id.js";

export type PublicContentResponse = Omit<
  ResolvedContentMetadata,
  "playbackUrl"
>;

export class MwContentService {
  async getResolvedContent(
    contentId: string | undefined,
  ): Promise<PublicContentResponse> {
    const metadata = await resolveContentMetadata(
      prisma,
      readContentId(contentId),
    );

    return toPublicContentResponse(metadata);
  }
}

export function toPublicContentResponse(
  metadata: ResolvedContentMetadata,
): PublicContentResponse {
  return {
    contentId: metadata.contentId,
    ...toResolvedContentView(metadata),
  };
}
