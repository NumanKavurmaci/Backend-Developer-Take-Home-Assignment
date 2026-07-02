import { HTTPException } from "hono/http-exception";
import { prisma } from "../../db/client.js";
import {
  ContentNotFoundError,
  resolveContentMetadata,
} from "../../content/metadata-inheritance.js";

export class MwContentService {
  async getResolvedContent(contentId: string | undefined) {
    if (!contentId || contentId.trim() === "") {
      throw new HTTPException(400, {
        message: "contentId is required",
      });
    }

    try {
      return await resolveContentMetadata(prisma, contentId);
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new HTTPException(404, {
          message: "Content not found",
        });
      }

      throw error;
    }
  }
}
