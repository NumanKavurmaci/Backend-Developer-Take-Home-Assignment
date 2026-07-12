import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/client.js";
import {
  createCmsContent,
  deleteCmsContent,
  getCmsContent,
  listCmsContent,
  updateCmsContent,
  type CmsContentRecord,
  type CreateContentInput,
  type ListCmsContentResult,
  type UpdateCmsContentInput,
} from "../../content/content-repository.js";
import {
  CONTENT_TYPE_VALUES,
  isContentType,
  type ContentType,
} from "../../content/content-types.js";
import {
  VIDEO_QUALITY_VALUES,
  isVideoQuality,
  type VideoQuality,
} from "../../content/content-metadata.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import { ApiError } from "../../shared/http/api-error.js";
import {
  createUpdatedAtEntityTag,
  readOptionalUpdatedAtEntityTag,
} from "../../shared/http/entity-tag.js";

const CREATE_FIELDS = new Set([
  "type",
  "title",
  "parentId",
  "parentalRating",
  "genre",
  "quality",
  "isPremium",
  "playbackUrl",
  "geoBlockCountriesOverride",
  "geoBlockCountries",
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS]);
const LIST_FIELDS = new Set([
  "type",
  "parentId",
  "title",
  "page",
  "pageSize",
]);

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type UnknownRecord = Record<string, unknown>;

export class CmsContentService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async createContent(body: unknown): Promise<CmsContentRecord> {
    const input = buildCreateInput(body);

    return this.runMutation(() => createCmsContent(this.database, input));
  }

  async getContent(contentId: string | undefined): Promise<CmsContentRecord> {
    const id = readContentId(contentId);
    const content = await getCmsContent(this.database, id);

    if (!content) {
      throw new ApiError(404, "CONTENT_NOT_FOUND", "Content not found");
    }

    return content;
  }

  async listContent(
    query: Record<string, string | undefined>,
  ): Promise<ListCmsContentResult> {
    assertAllowedFields(query, LIST_FIELDS);

    return listCmsContent(this.database, {
      type: readOptionalContentType(query.type),
      parentId: readOptionalFilter(query.parentId, "parentId"),
      title: readOptionalFilter(query.title, "title"),
      page: readPositiveInteger(query.page, "page", DEFAULT_PAGE),
      pageSize: readPositiveInteger(
        query.pageSize,
        "pageSize",
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE,
      ),
    });
  }

  async updateContent(
    contentId: string | undefined,
    body: unknown,
    ifMatch?: string,
  ): Promise<CmsContentRecord> {
    const id = readContentId(contentId);
    const input = buildUpdateInput(body, ifMatch);

    return this.runMutation(() => updateCmsContent(this.database, id, input));
  }

  async deleteContent(contentId: string | undefined): Promise<void> {
    const id = readContentId(contentId);

    await this.runMutation(() => deleteCmsContent(this.database, id));
  }

  private async runMutation<Result>(operation: () => Promise<Result>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DomainError) {
        throw mapContentDomainError(error);
      }

      throw error;
    }
  }
}

export function createContentEtag(updatedAt: Date): string {
  return createUpdatedAtEntityTag(updatedAt);
}

function buildCreateInput(body: unknown): CreateContentInput {
  const requestBody = readRequestBodyObject(body);
  assertAllowedFields(requestBody, CREATE_FIELDS);

  return {
    type: readRequiredContentType(requestBody.type),
    title: readRequiredString(requestBody.title, "title"),
    parentId: readOptionalNullableString(requestBody, "parentId"),
    parentalRating: readOptionalNullableString(requestBody, "parentalRating"),
    genre: readOptionalNullableString(requestBody, "genre"),
    quality: readOptionalNullableQuality(requestBody),
    isPremium: readOptionalNullableBoolean(requestBody, "isPremium"),
    playbackUrl: readOptionalNullableString(requestBody, "playbackUrl"),
    geoBlockCountriesOverride: readOptionalBoolean(
      requestBody,
      "geoBlockCountriesOverride",
    ),
    geoBlockCountries: readOptionalStringArray(
      requestBody,
      "geoBlockCountries",
    ),
  };
}

function buildUpdateInput(
  body: unknown,
  ifMatch: string | undefined,
): UpdateCmsContentInput {
  const requestBody = readRequestBodyObject(body);

  if (Object.keys(requestBody).length === 0) {
    throw new ApiError(
      400,
      "EMPTY_PATCH",
      "PATCH request body must include at least one mutable field",
    );
  }

  assertAllowedFields(requestBody, PATCH_FIELDS);

  if (hasOwn(requestBody, "type")) {
    throw new ApiError(
      400,
      "CONTENT_TYPE_IMMUTABLE",
      "Content type cannot be changed",
    );
  }

  return {
    title: readOptionalString(requestBody, "title"),
    parentId: readOptionalNullableString(requestBody, "parentId"),
    parentalRating: readOptionalNullableString(requestBody, "parentalRating"),
    genre: readOptionalNullableString(requestBody, "genre"),
    quality: readOptionalNullableQuality(requestBody),
    isPremium: readOptionalNullableBoolean(requestBody, "isPremium"),
    playbackUrl: readOptionalNullableString(requestBody, "playbackUrl"),
    geoBlockCountriesOverride: readOptionalBoolean(
      requestBody,
      "geoBlockCountriesOverride",
    ),
    geoBlockCountries: readOptionalStringArray(
      requestBody,
      "geoBlockCountries",
    ),
    expectedUpdatedAt: readOptionalUpdatedAtEntityTag(ifMatch),
  };
}

function readContentId(value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "contentId is required");
  }

  return value;
}

function readRequestBodyObject(body: unknown): UnknownRecord {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      "Request body must be a JSON object",
    );
  }

  return body as UnknownRecord;
}

function assertAllowedFields(
  value: UnknownRecord | Record<string, string | undefined>,
  allowedFields: Set<string>,
): void {
  const unknownFields = Object.keys(value).filter(
    (field) => !allowedFields.has(field),
  );

  if (unknownFields.length > 0) {
    throw new ApiError(
      400,
      "UNKNOWN_FIELDS",
      `Unknown field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields.join(", ")}`,
    );
  }
}

function readRequiredContentType(value: unknown): ContentType {
  if (typeof value !== "string" || !isContentType(value)) {
    throw new ApiError(
      400,
      "INVALID_CONTENT_TYPE",
      `type must be one of: ${CONTENT_TYPE_VALUES.join(", ")}`,
    );
  }

  return value;
}

function readOptionalContentType(value: string | undefined) {
  return value === undefined ? undefined : readRequiredContentType(value);
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${fieldName} must be a non-empty string`,
    );
  }

  return value.trim();
}

function readOptionalString(
  body: UnknownRecord,
  fieldName: string,
): string | undefined {
  if (!hasOwn(body, fieldName)) {
    return undefined;
  }

  return readRequiredString(body[fieldName], fieldName);
}

function readOptionalNullableString(
  body: UnknownRecord,
  fieldName: string,
): string | null | undefined {
  if (!hasOwn(body, fieldName)) {
    return undefined;
  }

  return body[fieldName] === null
    ? null
    : readRequiredString(body[fieldName], fieldName);
}

function readOptionalNullableQuality(
  body: UnknownRecord,
): VideoQuality | null | undefined {
  if (!hasOwn(body, "quality")) {
    return undefined;
  }

  const value = body.quality;

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !isVideoQuality(value)) {
    throw new ApiError(
      400,
      "INVALID_CONTENT_METADATA",
      `quality must be one of: ${VIDEO_QUALITY_VALUES.join(", ")}, or null`,
    );
  }

  return value;
}

function readOptionalNullableBoolean(
  body: UnknownRecord,
  fieldName: string,
): boolean | null | undefined {
  if (!hasOwn(body, fieldName)) {
    return undefined;
  }

  const value = body[fieldName];

  if (value !== null && typeof value !== "boolean") {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${fieldName} must be a boolean or null`,
    );
  }

  return value as boolean | null;
}

function readOptionalBoolean(
  body: UnknownRecord,
  fieldName: string,
): boolean | undefined {
  if (!hasOwn(body, fieldName)) {
    return undefined;
  }

  const value = body[fieldName];

  if (typeof value !== "boolean") {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${fieldName} must be a boolean`,
    );
  }

  return value;
}

function readOptionalStringArray(
  body: UnknownRecord,
  fieldName: string,
): string[] | undefined {
  if (!hasOwn(body, fieldName)) {
    return undefined;
  }

  const value = body[fieldName];

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      `${fieldName} must be an array of strings`,
    );
  }

  return value;
}

function readOptionalFilter(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.trim() === "") {
    throw new ApiError(
      400,
      "INVALID_QUERY",
      `${fieldName} must be a non-empty string`,
    );
  }

  return value.trim();
}

function readPositiveInteger(
  value: string | undefined,
  fieldName: string,
  defaultValue: number,
  maximum?: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be a positive integer`,
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || (maximum && parsed > maximum)) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be at most ${maximum ?? Number.MAX_SAFE_INTEGER}`,
    );
  }

  return parsed;
}

function mapContentDomainError(error: DomainError): ApiError {
  const statuses: Record<string, 400 | 404 | 409> = {
    CONTENT_NOT_FOUND: 404,
    CONTENT_HAS_CHILDREN: 409,
    CONTENT_ID_CONFLICT: 409,
    CONTENT_WRITE_CONFLICT: 409,
  };

  return new ApiError(
    statuses[error.errorCode] ?? 400,
    error.errorCode,
    error.message,
  );
}

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}
