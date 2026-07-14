export const CONTENT_TYPES = {
  SERIES: "SERIES",
  SEASON: "SEASON",
  EPISODE: "EPISODE",
  MOVIE: "MOVIE",
} as const;

export type ContentType =
  (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

export const CONTENT_TYPE_VALUES = Object.values(CONTENT_TYPES);

export const INHERITABLE_METADATA_FIELDS = [
  "parentalRating",
  "genre",
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;

export const PLAYBACK_METADATA_FIELDS = [
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;

export const VIDEO_QUALITIES = {
  SD: "SD",
  HD: "HD",
  UHD_4K: "UHD_4K",
} as const;

export type VideoQuality =
  (typeof VIDEO_QUALITIES)[keyof typeof VIDEO_QUALITIES];

export const VIDEO_QUALITY_VALUES = Object.values(VIDEO_QUALITIES);

export interface PaginationQuery {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<Item> extends PaginationQuery {
  items: Item[];
  total: number;
}

export interface ContentCreateInput {
  id?: string;
  type: ContentType;
  title: string;
  parentId?: string | null;
  parentalRating?: string | null;
  genre?: string | null;
  quality?: VideoQuality | null;
  isPremium?: boolean | null;
  playbackUrl?: string | null;
  geoBlockCountriesOverride?: boolean;
  geoBlockCountries?: string[];
}

export interface ContentUpdateInput {
  title?: string;
  parentId?: string | null;
  parentalRating?: string | null;
  genre?: string | null;
  quality?: VideoQuality | null;
  isPremium?: boolean | null;
  playbackUrl?: string | null;
  geoBlockCountriesOverride?: boolean;
  geoBlockCountries?: string[];
}

export interface ContentListQuery extends PaginationQuery {
  type?: ContentType;
  parentId?: string;
  title?: string;
}

export interface ContentRecord {
  id: string;
  type: ContentType;
  title: string;
  parentId: string | null;
  parentalRating: string | null;
  genre: string | null;
  quality: VideoQuality | null;
  isPremium: boolean | null;
  playbackUrl: string | null;
  geoBlockCountriesOverride: boolean;
  geoBlockCountries: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedContentMetadata {
  contentId: string;
  type: ContentType;
  title: string;
  parentalRating: string | null;
  genre: string | null;
  quality: VideoQuality | null;
  isPremium: boolean | null;
  playbackUrl: string | null;
  geoBlockCountries: string[];
}

export interface LiveChannelCreateInput {
  id?: string;
  name: string;
  slug: string;
}

export interface LiveChannelUpdateInput {
  name?: string;
  slug?: string;
}

export interface LiveChannelListQuery extends PaginationQuery {
  name?: string;
  slug?: string;
}

export interface LiveChannelRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EpgProgramCreateInput {
  id?: string;
  channelId: string;
  programName: string;
  startTime: Date;
  endTime: Date;
}

export interface EpgProgramUpdateInput {
  programName?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface EpgProgramListQuery extends PaginationQuery {
  channelId: string;
  windowStart: Date;
  windowEnd: Date;
}

export interface EpgProgramRecord {
  id: string;
  channelId: string;
  programName: string;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
  updatedAt: Date;
}
