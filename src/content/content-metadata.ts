import { DomainError } from "../shared/domain/domain-error.js";

export const INHERITABLE_METADATA_FIELDS = [
  "parentalRating",
  "genre",
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;

export type InheritableMetadataField =
  (typeof INHERITABLE_METADATA_FIELDS)[number];

// Playback authorization depends on these resolved fields, so they are tracked explicitly.
export const PLAYBACK_METADATA_FIELDS = [
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;

export type PlaybackMetadataField = (typeof PLAYBACK_METADATA_FIELDS)[number];

// Stored as strings in PostgreSQL, validated in the domain layer before writes.
export const VIDEO_QUALITIES = {
  SD: "SD",
  HD: "HD",
  UHD_4K: "UHD_4K",
} as const;

export type VideoQuality =
  (typeof VIDEO_QUALITIES)[keyof typeof VIDEO_QUALITIES];

export const VIDEO_QUALITY_VALUES = Object.values(VIDEO_QUALITIES);

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
