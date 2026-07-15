import { ApiError } from "./api-error.js";

export function readContentId(value: string | undefined): string {
  const contentId = value?.trim();

  if (!contentId) {
    throw new ApiError(400, "INVALID_REQUEST", "contentId is required");
  }

  return contentId;
}
