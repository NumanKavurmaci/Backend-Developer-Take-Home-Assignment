import type { LiveChannel, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/client.js";
import {
  createLiveChannel,
  deleteLiveChannel,
  getLiveChannelById,
  listLiveChannelsPage,
  updateLiveChannel,
} from "../../live-channel/live-channel-repository.js";
import { DomainError } from "../../shared/domain/domain-error.js";
import type { PaginatedResult } from "../../shared/domain/domain-contracts.js";
import { ApiError } from "../../shared/http/api-error.js";
import { readOptionalUpdatedAtEntityTag } from "../../shared/http/entity-tag.js";

const CREATE_FIELDS = new Set(["name", "slug"]);
const UPDATE_FIELDS = new Set(["name", "slug"]);
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export type CmsLiveChannelListRequestQuery = {
  name?: string;
  slug?: string;
  page?: string;
  pageSize?: string;
};

export class CmsLiveChannelService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async createChannel(body: unknown): Promise<LiveChannel> {
    const requestBody = readRequestBodyObject(body);
    assertOnlyKnownFields(requestBody, CREATE_FIELDS);

    return createLiveChannel(this.database, {
      name: readRequiredString(requestBody.name, "name"),
      slug: readRequiredString(requestBody.slug, "slug"),
    });
  }

  async getChannel(channelId: string | undefined): Promise<LiveChannel> {
    const channel = await getLiveChannelById(
      this.database,
      readChannelId(channelId),
    );

    if (!channel) {
      throw new DomainError("CHANNEL_NOT_FOUND", "Channel not found");
    }

    return channel;
  }

  async listChannels(
    query: CmsLiveChannelListRequestQuery,
  ): Promise<PaginatedResult<LiveChannel>> {
    const page = readPositiveInteger(query.page, "page", DEFAULT_PAGE);
    const pageSize = readPositiveInteger(
      query.pageSize,
      "pageSize",
      DEFAULT_PAGE_SIZE,
    );

    if (pageSize > MAX_PAGE_SIZE) {
      throw new ApiError(
        400,
        "INVALID_PAGINATION",
        `pageSize must be at most ${MAX_PAGE_SIZE}`,
      );
    }

    return listLiveChannelsPage(this.database, {
      name: normalizeOptionalFilter(query.name),
      slug: normalizeOptionalFilter(query.slug)?.toLowerCase(),
      page,
      pageSize,
    });
  }

  async updateChannel(
    channelId: string | undefined,
    body: unknown,
    ifMatch?: string,
  ): Promise<LiveChannel> {
    const id = readChannelId(channelId);
    const requestBody = readRequestBodyObject(body);
    assertOnlyKnownFields(requestBody, UPDATE_FIELDS);

    if (Object.keys(requestBody).length === 0) {
      throw new ApiError(
        400,
        "INVALID_REQUEST_BODY",
        "PATCH request body must include at least one mutable field",
      );
    }

    return updateLiveChannel(
      this.database,
      id,
      {
        ...(Object.hasOwn(requestBody, "name")
          ? { name: readRequiredString(requestBody.name, "name") }
          : {}),
        ...(Object.hasOwn(requestBody, "slug")
          ? { slug: readRequiredString(requestBody.slug, "slug") }
          : {}),
      },
      readOptionalUpdatedAtEntityTag(ifMatch),
    );
  }

  async deleteChannel(
    channelId: string | undefined,
    confirmation: string | undefined,
  ): Promise<void> {
    const id = readChannelId(channelId);

    if (confirmation !== "true") {
      throw new ApiError(
        400,
        "DELETE_CONFIRMATION_REQUIRED",
        "Set confirm=true to delete the channel, its EPG programs, and its schedule lock",
      );
    }

    await deleteLiveChannel(this.database, id);
  }
}

function readRequestBodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST_BODY",
      "Request body must be a JSON object",
    );
  }

  return body as Record<string, unknown>;
}

function assertOnlyKnownFields(
  body: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  const unknownField = Object.keys(body).find(
    (field) => !allowedFields.has(field),
  );

  if (unknownField) {
    throw new ApiError(
      400,
      "UNKNOWN_REQUEST_FIELD",
      `Unknown request field: ${unknownField}`,
    );
  }
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST_BODY", `${fieldName} is required`);
  }

  return value;
}

function readChannelId(channelId: string | undefined): string {
  if (!channelId || channelId.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "channelId is required");
  }

  return channelId.trim();
}

function readPositiveInteger(
  value: string | undefined,
  fieldName: string,
  defaultValue: number,
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

  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} must be a positive integer`,
    );
  }

  return parsed;
}

function normalizeOptionalFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
