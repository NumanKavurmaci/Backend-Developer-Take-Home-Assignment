import { DomainError } from "../shared/domain/domain-error.js";
import {
  VIDEO_QUALITY_VALUES,
  type VideoQuality,
} from "../shared/domain/domain-contracts.js";

export function isVideoQuality(value: string): value is VideoQuality {
  return VIDEO_QUALITY_VALUES.includes(value as VideoQuality);
}

// Allows nullish values because empty metadata means "inherit from parent".
export function assertVideoQuality(
  value: string | null | undefined,
): asserts value is VideoQuality | null | undefined {
  if (value !== null && value !== undefined && !isVideoQuality(value)) {
    throw new DomainError(
      "INVALID_CONTENT_METADATA",
      `Invalid video quality "${value}". Allowed values: ${VIDEO_QUALITY_VALUES.join(", ")}.`,
    );
  }
}
