# Content Domain Index

This document maps the current `src/content/` domain files, their exported types/functions/classes, and the role each file plays in the SaatCMS middleware implementation.

The purpose is to help future maintainers or AI assistants quickly understand where content hierarchy validation, metadata validation, repository/database access, and metadata inheritance logic live.

## Folder Overview

```text
src/content/
  content-hierarchy.test.ts
  content-hierarchy.ts
  content-metadata.ts
  content-repository.ts
  content-types.ts
  metadata-inheritance.ts
```

## High-Level Responsibilities

| File                        | Responsibility                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `content-types.ts`          | Defines allowed content type constants and type guards.                                                                            |
| `content-hierarchy.ts`      | Defines valid parent-child hierarchy rules and validates parent relationships.                                                     |
| `content-metadata.ts`       | Defines inheritable metadata fields, playback metadata fields, video quality values, and video quality validation.                 |
| `content-repository.ts`     | Handles Prisma database access for content creation, parent/child lookup, ancestor traversal, and geo-block country normalization. |
| `metadata-inheritance.ts`   | Resolves final middleware metadata by walking the ancestor path and applying inheritance rules.                                    |
| `content-hierarchy.test.ts` | Tests hierarchy validation behavior.                                                                                               |

---

# `content-types.ts`

## Purpose

Defines the supported CMS content types and helper functions for validating them.

## Exports

### `CONTENT_TYPES`

```ts
export const CONTENT_TYPES = {
  SERIES: "SERIES",
  SEASON: "SEASON",
  EPISODE: "EPISODE",
  MOVIE: "MOVIE",
} as const;
```

Central source of truth for allowed content type strings.

Supported values:

- `SERIES`
- `SEASON`
- `EPISODE`
- `MOVIE`

`MOVIE` is included because the playback requirement mentions premium 4K movies.

### `ContentType`

```ts
export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];
```

Union type of all allowed content type values.

Equivalent to:

```ts
type ContentType = "SERIES" | "SEASON" | "EPISODE" | "MOVIE";
```

### `CONTENT_TYPE_VALUES`

```ts
export const CONTENT_TYPE_VALUES = Object.values(CONTENT_TYPES);
```

Array of allowed content type values.

Used by validation helpers.

### `isContentType(value)`

```ts
export function isContentType(value: string): value is ContentType;
```

Checks whether a string is one of the allowed content types.

Returns:

- `true` if the value is a valid `ContentType`
- `false` otherwise

### `assertContentType(value)`

```ts
export function assertContentType(value: string): asserts value is ContentType;
```

Throws if the provided string is not a valid content type.

Used before writing or resolving content rows to make sure database strings are safe to treat as domain values.

---

# `content-hierarchy.ts`

## Purpose

Defines and validates the allowed parent-child relationships for CMS content.

Required hierarchy:

```text
Series -> Season -> Episode
```

Allowed parent rules:

| Content Type | Required Parent |
| ------------ | --------------- |
| `SERIES`     | none            |
| `SEASON`     | `SERIES`        |
| `EPISODE`    | `SEASON`        |
| `MOVIE`      | none            |

## Imports

```ts
import { CONTENT_TYPES, type ContentType } from "./content-types.js";
```

Uses the canonical content type constants from `content-types.ts`.

## Exports

### `DomainError`

```ts
export class DomainError extends Error
```

Shared domain error thrown when expected content-domain rules are violated.

Examples:

- A `SERIES` has a parent.
- A `MOVIE` has a parent.
- A `SEASON` has no parent.
- An `EPISODE` is attached directly to a `SERIES`.

### `getAllowedParentType(type)`

```ts
export function getAllowedParentType(type: ContentType): ContentType | null;
```

Returns the expected parent type for a content type.

Examples:

```ts
getAllowedParentType("SERIES"); // null
getAllowedParentType("SEASON"); // "SERIES"
getAllowedParentType("EPISODE"); // "SEASON"
getAllowedParentType("MOVIE"); // null
```

### `validateContentParent(type, parent)`

```ts
export function validateContentParent(
  type: ContentType,
  parent: { id: string; type: string } | null,
): void;
```

Validates whether a content item can belong to the provided parent.

Behavior:

1. Looks up the expected parent type using `getAllowedParentType`.
2. If expected parent is `null`, rejects any provided parent.
3. If expected parent is required, rejects missing parent.
4. If parent exists but has wrong type, throws `DomainError` with `INVALID_CONTENT_HIERARCHY`.
5. Otherwise returns normally.

Used in:

- `createContent(...)` before inserting rows.
- `metadata-inheritance.ts` when validating loaded ancestor paths before resolving metadata.

---

# `content-metadata.ts`

## Purpose

Defines the metadata fields that can be inherited and validates metadata-related values, especially video quality.

## Exports

### `INHERITABLE_METADATA_FIELDS`

```ts
export const INHERITABLE_METADATA_FIELDS = [
  "parentalRating",
  "genre",
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;
```

Fields that can be inherited from parent content.

For an episode, inheritance priority is:

```text
Episode -> Season -> Series
```

### `InheritableMetadataField`

```ts
export type InheritableMetadataField =
  (typeof INHERITABLE_METADATA_FIELDS)[number];
```

Union type of inheritable metadata field names.

### `PLAYBACK_METADATA_FIELDS`

```ts
export const PLAYBACK_METADATA_FIELDS = [
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountries",
] as const;
```

Resolved fields needed by playback authorization logic.

These fields are important for later endpoint:

```http
GET /api/v1/mw/playback/{contentId}
```

### `PlaybackMetadataField`

```ts
export type PlaybackMetadataField = (typeof PLAYBACK_METADATA_FIELDS)[number];
```

Union type of playback metadata field names.

### `VIDEO_QUALITIES`

```ts
export const VIDEO_QUALITIES = {
  SD: "SD",
  HD: "HD",
  UHD_4K: "UHD_4K",
} as const;
```

Allowed video quality values.

### `VideoQuality`

```ts
export type VideoQuality =
  (typeof VIDEO_QUALITIES)[keyof typeof VIDEO_QUALITIES];
```

Union type of allowed video quality values.

Equivalent to:

```ts
type VideoQuality = "SD" | "HD" | "UHD_4K";
```

### `VIDEO_QUALITY_VALUES`

```ts
export const VIDEO_QUALITY_VALUES = Object.values(VIDEO_QUALITIES);
```

Array of allowed video quality values.

Used by validation helpers.

### `DomainError`

```ts
export class DomainError extends Error
```

Shared domain error thrown when metadata validation fails.

Currently used for invalid video quality values.

### `isVideoQuality(value)`

```ts
export function isVideoQuality(value: string): value is VideoQuality;
```

Checks whether a string is one of the allowed video qualities.

### `assertVideoQuality(value)`

```ts
export function assertVideoQuality(
  value: string | null | undefined,
): asserts value is VideoQuality | null | undefined;
```

Validates a possibly nullish quality value.

Important inheritance rule:

- `null` or `undefined` is allowed because missing metadata means “inherit from parent”.
- A non-null value must be one of `SD`, `HD`, or `UHD_4K`.

Used in:

- `createContent(...)` before writing content.
- `resolveContentMetadata(...)` after resolving quality.

---

# `content-repository.ts`

## Purpose

Database access layer for content-related operations.

Uses Prisma with PostgreSQL.

Responsibilities:

- Create content safely.
- Validate parent relationship before insert.
- Normalize geo-block country codes.
- Load content with children.
- Load content with parent.
- Load the full ancestor path using one recursive PostgreSQL query.
- Detect corrupted cyclic or unexpectedly deep hierarchy data.

## Imports

```ts
import type { Content, Prisma, PrismaClient } from "@prisma/client";
import { assertContentType, type ContentType } from "./content-types.js";
import { assertVideoQuality, type VideoQuality } from "./content-metadata.js";
import { validateContentParent } from "./content-hierarchy.js";
```

## Exported Types

### `CreateContentInput`

```ts
export type CreateContentInput = {
  id: string;
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
};
```

Input shape for creating content rows.

Important behavior:

- `parentId` connects content to its parent.
- `null` metadata means “inherit”.
- `geoBlockCountriesOverride` controls geo-block inheritance.
- `geoBlockCountries` can only be provided when `geoBlockCountriesOverride` is `true`.

### `ContentWithChildren`

```ts
export type ContentWithChildren = Content & {
  children: Content[];
};
```

Returned by `getContentWithChildren(...)`.

### `ContentWithParent`

```ts
export type ContentWithParent = Content & {
  parent: Content | null;
};
```

Returned by `getContentWithParent(...)`.

### `MAX_CONTENT_HIERARCHY_DEPTH`

```ts
export const MAX_CONTENT_HIERARCHY_DEPTH = 10;
```

Safety limit for corrupted or unexpectedly deep hierarchy data.

This is not the business hierarchy depth rule. The business rule is still:

```text
Series -> Season -> Episode
```

The depth limit prevents infinite or excessive traversal if database hierarchy data is corrupted.

### `DomainError`

```ts
export class DomainError extends Error
```

Shared domain error thrown when geo-block country input is invalid.

Examples:

- Invalid country code like `Turkey` or `TUR`.
- Providing `geoBlockCountries` while `geoBlockCountriesOverride` is false.

## Exported Functions

### `normalizeGeoBlockCountries(geoBlockCountries?)`

```ts
export function normalizeGeoBlockCountries(
  geoBlockCountries: string[] = [],
): string[];
```

Normalizes country codes before saving.

Behavior:

1. Trims whitespace.
2. Converts to uppercase.
3. Validates each code against `/^[A-Z]{2}$/`.
4. Removes duplicates.

Examples:

```ts
normalizeGeoBlockCountries(["tr", " TR ", "de"]);
// ["TR", "DE"]
```

Throws `DomainError` with `INVALID_CONTENT_GEO_BLOCK_COUNTRIES` if any code is not ISO-3166 alpha-2 style.

### `createContent(prisma, input)`

```ts
export async function createContent(
  prisma: PrismaClient,
  input: CreateContentInput,
): Promise<Content>;
```

Creates a content row after domain validation.

Validation flow:

1. Validates `input.type` with `assertContentType`.
2. Validates `input.quality` with `assertVideoQuality`.
3. Normalizes `geoBlockCountries`.
4. Rejects countries if `geoBlockCountriesOverride` is false.
5. Loads parent row if `parentId` is provided.
6. Validates parent relationship with `validateContentParent`.
7. Creates `Content` and nested `ContentGeoBlockCountry` rows.

Used by seed scripts or CMS write endpoints.

### `getContentWithChildren(prisma, contentId)`

```ts
export async function getContentWithChildren(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentWithChildren | null>;
```

Loads a content row and its direct children.

Children are ordered by:

1. `type` ascending
2. `title` ascending

Useful for CMS browse/detail screens.

### `getContentWithParent(prisma, contentId)`

```ts
export async function getContentWithParent(
  prisma: PrismaClient,
  contentId: string,
): Promise<ContentWithParent | null>;
```

Loads a content row and its direct parent.

Useful for simple parent checks or debugging.

### `getContentAncestorPath(prisma, contentId)`

```ts
export async function getContentAncestorPath(
  prisma: PrismaClient,
  contentId: string,
): Promise<Content[]>;
```

Loads the full parent path for a content item in one database query.

This function is important for Requirement 1 because it avoids one query per hierarchy level.

Return order is root-first:

```text
Series -> Season -> Episode
```

For a movie or series, the path contains only that item.

Behavior:

1. Calls internal recursive PostgreSQL CTE function `fetchContentAncestorRows(...)`.
2. Checks for cycles with `assertAncestorPathHasNoCycle(...)`.
3. Checks depth limit with `assertAncestorPathIsWithinDepthLimit(...)`.
4. Removes helper fields like `depth` and `hasCycle` before returning `Content[]`.

### `listContentChildren(prisma, parentId)`

```ts
export async function listContentChildren(
  prisma: PrismaClient,
  parentId: string,
): Promise<Content[]>;
```

Lists direct children of a content item.

Ordered by:

1. `type` ascending
2. `title` ascending

### `contentSelectForHierarchy()`

```ts
export function contentSelectForHierarchy(): Prisma.ContentSelect;
```

Returns a reusable Prisma select object for hierarchy-related reads.

Selected fields:

```ts
{
  id: true,
  type: true,
  title: true,
  parentId: true,
}
```

Useful when a caller only needs hierarchy identity fields instead of full content metadata.

## Important Internal Functions

These are not exported but are important for understanding behavior.

### `createGeoBlockCountryRows(geoBlockCountries)`

Creates nested Prisma `create` data for `ContentGeoBlockCountry` rows.

Returns `undefined` when the list is empty.

### `fetchContentAncestorRows(prisma, contentId)`

Uses a recursive PostgreSQL CTE to walk upward from requested content to root parent.

Starts from the requested content at depth `0`, then recursively joins parent rows.

Important details:

- Tracks `path` to detect cycles.
- Tracks `depth` to enforce `MAX_CONTENT_HIERARCHY_DEPTH`.
- Orders result by `depth DESC`, which returns root-first order.

### `assertAncestorPathHasNoCycle(rows)`

Throws if the recursive CTE detects a repeated content ID in the path.

Protects metadata resolution from corrupted cyclic hierarchy data.

### `assertAncestorPathIsWithinDepthLimit(rows)`

Throws if the path reaches the safety depth limit and still appears to have a parent.

Prevents silently resolving unexpectedly deep or corrupted hierarchies.

### `toContent(row)`

Removes CTE helper fields:

- `depth`
- `hasCycle`

Returns a normal Prisma `Content` object.

---

# `metadata-inheritance.ts`

## Purpose

Central metadata inheritance service for middleware reads.

This file resolves the final metadata payload for:

```http
GET /api/v1/mw/content/{contentId}
```

It applies the core inheritance rule:

```text
Closest non-null value wins.
```

For an episode, the priority order is:

```text
Episode -> Season -> Series
```

This means each field is resolved independently.

Example:

```text
Episode.parentalRating = null
Season.parentalRating = "16+"
Series.parentalRating = "13+"
```

Resolved value:

```text
"16+"
```

## Imports

```ts
import type { Content, PrismaClient } from "@prisma/client";
import { assertContentType, type ContentType } from "./content-types.js";
import { validateContentParent } from "./content-hierarchy.js";
import { assertVideoQuality, type VideoQuality } from "./content-metadata.js";
import { getContentAncestorPath } from "./content-repository.js";
```

## Exported Types

### `ResolvedContentMetadata`

```ts
export type ResolvedContentMetadata = ResolvedContentBase & {
  contentId: string;
  type: ContentType;
  quality: VideoQuality | null;
  geoBlockCountries: string[];
};
```

Final resolved metadata returned by the middleware domain logic.

Fields:

| Field               | Meaning                                           |
| ------------------- | ------------------------------------------------- |
| `contentId`         | Requested content ID.                             |
| `type`              | Validated content type.                           |
| `title`             | Requested content title. Currently not inherited. |
| `parentalRating`    | Resolved closest non-null parental rating.        |
| `genre`             | Resolved closest non-null genre.                  |
| `quality`           | Resolved closest non-null video quality.          |
| `isPremium`         | Resolved closest non-null premium flag.           |
| `playbackUrl`       | Resolved closest non-null playback URL.           |
| `geoBlockCountries` | Resolved blocked country list.                    |

## Exported Classes

### `DomainError`

```ts
export class DomainError extends Error
```

Thrown when `resolveContentMetadata(...)` cannot find the requested content.

The API layer maps `CONTENT_NOT_FOUND` to HTTP `404 Not Found`.

## Exported Functions

### `resolveContentMetadata(prisma, contentId)`

```ts
export async function resolveContentMetadata(
  prisma: PrismaClient,
  contentId: string,
): Promise<ResolvedContentMetadata>;
```

Main function for resolving metadata.

Flow:

1. Loads ancestor path using `getContentAncestorPath(prisma, contentId)`.
2. Throws `DomainError` with `CONTENT_NOT_FOUND` if no rows are found.
3. Validates ancestor path with `assertAncestorPathMatchesContentHierarchyRules(...)`.
4. Reverses root-first ancestor path into closest-first priority path.
5. Loads geo-block country rows for all content IDs in the path.
6. Resolves scalar metadata values from closest to farthest ancestor.
7. Validates resolved quality with `assertVideoQuality(...)`.
8. Resolves geo-block countries using `geoBlockCountriesOverride` logic.
9. Returns `ResolvedContentMetadata`.

Input path from repository:

```text
Series -> Season -> Episode
```

Internal priority path after reverse:

```text
Episode -> Season -> Series
```

## Important Internal Types

### `ResolvedContentBase`

```ts
type ResolvedContentBase = Pick<
  Content,
  "title" | "parentalRating" | "genre" | "isPremium" | "playbackUrl"
>;
```

Base scalar metadata fields included in the resolved response.

## Important Internal Functions

### `resolveFirstDefinedMetadataValue(metadataPriorityPath, field)`

```ts
function resolveFirstDefinedMetadataValue<Field extends keyof Content>(
  metadataPriorityPath: Content[],
  field: Field,
): Content[Field] | null;
```

Finds the first content item in closest-first order where the field is not `null`.

Returns:

- The closest non-null field value.
- `null` if all values are `null`.

Important: this checks `!== null`, so `false` is preserved for boolean fields like `isPremium`.

Example:

```text
Episode.isPremium = null
Season.isPremium = false
Series.isPremium = true
```

Resolved value:

```text
false
```

This is correct because `false` is a real override value, not “missing”.

### `assertAncestorPathMatchesContentHierarchyRules(ancestorPath)`

```ts
function assertAncestorPathMatchesContentHierarchyRules(
  ancestorPath: Content[],
): void;
```

Validates that loaded database rows still form a legal content hierarchy before metadata inheritance is applied.

Checks:

1. Every row has a valid content type.
2. Root item has no parent.
3. Every child points to the expected parent from the path.
4. Parent-child type combinations match domain hierarchy rules through `validateContentParent(...)`.

This protects the middleware from returning misleading resolved metadata if database rows are corrupted.

### `loadGeoBlockCountriesForPath(prisma, contentIds)`

```ts
async function loadGeoBlockCountriesForPath(
  prisma: PrismaClient,
  contentIds: string[],
): Promise<Map<string, string[]>>;
```

Loads all geo-block country rows for the ancestor path in one Prisma query.

Returns a map:

```ts
Map<contentId, countryCode[]>;
```

Country rows are ordered by:

1. `contentId` ascending
2. `countryCode` ascending

### `resolveGeoBlockCountries(metadataPriorityPath, countriesByContentId)`

```ts
function resolveGeoBlockCountries(
  metadataPriorityPath: Content[],
  countriesByContentId: Map<string, string[]>,
): string[];
```

Resolves blocked countries using the `geoBlockCountriesOverride` flag.

Rule:

1. Start from requested content.
2. Walk upward through parents.
3. Use the first content item where `geoBlockCountriesOverride === true`.
4. Return that content item's country list.
5. If no item has override enabled, return an empty list.

Important distinction:

| Case                                                 | Meaning                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `geoBlockCountriesOverride = false`                  | Keep looking at parent.                               |
| `geoBlockCountriesOverride = true` and rows exist    | Use this item's rows.                                 |
| `geoBlockCountriesOverride = true` and no rows exist | Override with empty list. Do not inherit parent list. |

This distinction is needed for cases where an episode intentionally clears a series-level block list.

---

# End-to-End Flow for `GET /api/v1/mw/content/{contentId}`

The Hono middleware content route calls the existing domain function instead of reimplementing inheritance.

Expected service call:

```ts
const metadata = await resolveContentMetadata(prisma, contentId);
```

Flow:

```text
HTTP request
  -> Hono route: GET /api/v1/mw/content/:contentId
  -> Controller reads c.req.param("contentId")
  -> Service calls resolveContentMetadata(prisma, contentId)
  -> metadata-inheritance.ts
  -> content-repository.ts getContentAncestorPath(...)
  -> PostgreSQL recursive CTE loads ancestor path in one query
  -> metadata-inheritance.ts validates hierarchy
  -> metadata-inheritance.ts loads geo-block countries in one query
  -> metadata-inheritance.ts resolves final metadata
  -> Service maps internal metadata to a public response DTO
  -> Controller returns JSON without protected playback asset data
```

## Success Response Shapes

Internal domain output shape from `ResolvedContentMetadata`:

```json
{
  "contentId": "episode-galactic-odyssey-s1e1",
  "type": "EPISODE",
  "title": "Episode title",
  "parentalRating": "13+",
  "genre": "Sci-Fi Adventure",
  "quality": "HD",
  "isPremium": false,
  "playbackUrl": "https://cdn.example.com/example.m3u8",
  "geoBlockCountries": ["IR", "SY"]
}
```

Public `GET /api/v1/mw/content/{contentId}` responses intentionally omit `playbackUrl`:

```json
{
  "contentId": "episode-galactic-odyssey-s1e1",
  "type": "EPISODE",
  "title": "Episode title",
  "parentalRating": "13+",
  "genre": "Sci-Fi Adventure",
  "quality": "HD",
  "isPremium": false,
  "geoBlockCountries": ["IR", "SY"]
}
```

## Expected Missing Content Behavior

If content does not exist, `resolveContentMetadata(...)` throws:

```ts
DomainError;
```

With:

```ts
errorCode = "CONTENT_NOT_FOUND";
```

The HTTP error handler should map this to:

```http
404 Not Found
```

Possible JSON body:

```json
{
  "errorCode": "CONTENT_NOT_FOUND",
  "message": "Content not-existing-id was not found."
}
```

---

# Key Design Notes

## 1. Domain logic is already separated from HTTP logic

The current `src/content/` folder is a domain layer.

It should not depend on Hono `Context` or HTTP request/response objects.

The HTTP module lives separately from the domain layer:

```text
src/modules/mw-content/
  mw-content.module.ts
  mw-content.route.ts
  mw-content.controller.ts
  mw-content.service.ts
```

That module should call `resolveContentMetadata(...)`.

## 2. Inheritance is centralized

Do not duplicate inheritance logic in controllers or route handlers.

Use:

```ts
resolveContentMetadata(prisma, contentId);
```

## 3. Repository avoids N+1 parent lookup

`getContentAncestorPath(...)` loads the whole parent path with one recursive PostgreSQL CTE.

This is better than doing:

```text
find episode
find season
find series
```

as separate sequential lookups.

## 4. Geo-block inheritance needs the override flag

For scalar fields, `null` means inherit.

For geo-block countries, an empty array can mean two different things:

1. No countries are blocked here, but parent might still apply.
2. This content intentionally overrides parent with an empty block list.

That is why the schema uses:

```ts
geoBlockCountriesOverride: boolean;
```

## 5. Boolean inheritance must preserve `false`

`isPremium = false` is a valid explicit override.

The resolver correctly checks:

```ts
content[field] !== null;
```

instead of truthiness.

This prevents accidentally skipping `false`.

---

# Quick Function Index

| Function/Class/Type                              | File                      | Exported | Purpose                                       |
| ------------------------------------------------ | ------------------------- | -------- | --------------------------------------------- |
| `CONTENT_TYPES`                                  | `content-types.ts`        | Yes      | Content type constants.                       |
| `ContentType`                                    | `content-types.ts`        | Yes      | Union type of content types.                  |
| `CONTENT_TYPE_VALUES`                            | `content-types.ts`        | Yes      | Array of allowed content types.               |
| `isContentType`                                  | `content-types.ts`        | Yes      | Runtime content type guard.                   |
| `assertContentType`                              | `content-types.ts`        | Yes      | Throws on invalid content type.               |
| `DomainError`                                    | `shared/domain/domain-error.ts` | Yes | Shared expected domain error type.            |
| `getAllowedParentType`                           | `content-hierarchy.ts`    | Yes      | Returns expected parent type.                 |
| `validateContentParent`                          | `content-hierarchy.ts`    | Yes      | Validates parent-child relationship.          |
| `INHERITABLE_METADATA_FIELDS`                    | `content-metadata.ts`     | Yes      | Fields that can be inherited.                 |
| `InheritableMetadataField`                       | `content-metadata.ts`     | Yes      | Union type of inheritable field names.        |
| `PLAYBACK_METADATA_FIELDS`                       | `content-metadata.ts`     | Yes      | Fields needed by playback checks.             |
| `PlaybackMetadataField`                          | `content-metadata.ts`     | Yes      | Union type of playback metadata field names.  |
| `VIDEO_QUALITIES`                                | `content-metadata.ts`     | Yes      | Allowed quality constants.                    |
| `VideoQuality`                                   | `content-metadata.ts`     | Yes      | Union type of quality values.                 |
| `VIDEO_QUALITY_VALUES`                           | `content-metadata.ts`     | Yes      | Array of allowed quality values.              |
| `isVideoQuality`                                 | `content-metadata.ts`     | Yes      | Runtime video quality guard.                  |
| `assertVideoQuality`                             | `content-metadata.ts`     | Yes      | Throws on invalid non-null quality.           |
| `CreateContentInput`                             | `content-repository.ts`   | Yes      | Input type for creating content.              |
| `ContentWithChildren`                            | `content-repository.ts`   | Yes      | Content with direct children.                 |
| `ContentWithParent`                              | `content-repository.ts`   | Yes      | Content with direct parent.                   |
| `MAX_CONTENT_HIERARCHY_DEPTH`                    | `content-repository.ts`   | Yes      | Safety depth limit.                           |
| `normalizeGeoBlockCountries`                     | `content-repository.ts`   | Yes      | Normalizes and validates country codes.       |
| `createContent`                                  | `content-repository.ts`   | Yes      | Validates and creates content row.            |
| `getContentWithChildren`                         | `content-repository.ts`   | Yes      | Loads content with direct children.           |
| `getContentWithParent`                           | `content-repository.ts`   | Yes      | Loads content with direct parent.             |
| `getContentAncestorPath`                         | `content-repository.ts`   | Yes      | Loads root-to-requested ancestor path.        |
| `listContentChildren`                            | `content-repository.ts`   | Yes      | Lists direct children by parent ID.           |
| `contentSelectForHierarchy`                      | `content-repository.ts`   | Yes      | Reusable Prisma select for hierarchy fields.  |
| `ResolvedContentMetadata`                        | `metadata-inheritance.ts` | Yes      | Final resolved metadata type.                 |
| `resolveContentMetadata`                         | `metadata-inheritance.ts` | Yes      | Main metadata inheritance resolver.           |
| `resolveFirstDefinedMetadataValue`               | `metadata-inheritance.ts` | No       | Resolves scalar fields from closest ancestor. |
| `assertAncestorPathMatchesContentHierarchyRules` | `metadata-inheritance.ts` | No       | Validates loaded path before inheritance.     |
| `loadGeoBlockCountriesForPath`                   | `metadata-inheritance.ts` | No       | Loads country rows for the ancestor path.     |
| `resolveGeoBlockCountries`                       | `metadata-inheritance.ts` | No       | Resolves country list using override flag.    |
