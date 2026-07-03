import { prisma } from "../../db/client.js";
import { resolveContentMetadata } from "../../content/metadata-inheritance.js";
import { ApiError } from "../../shared/http/api-error.js";

export class MwContentService {
  async getResolvedContent(contentId: string | undefined) {
    if (!contentId || contentId.trim() === "") {
      throw new ApiError(400, "INVALID_REQUEST", "contentId is required");
    }

    return resolveContentMetadata(prisma, contentId);
  }
}
