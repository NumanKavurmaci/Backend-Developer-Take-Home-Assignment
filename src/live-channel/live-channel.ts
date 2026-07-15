import { DomainError } from "../shared/domain/domain-error.js";
import type {
  LiveChannelCreateInput,
  LiveChannelUpdateInput,
} from "../shared/domain/domain-contracts.js";

const LIVE_CHANNEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeLiveChannelName(name: string): string {
  return name.trim();
}

export function normalizeLiveChannelSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function assertValidLiveChannelInput(
  input: LiveChannelCreateInput,
): void {
  const name = normalizeLiveChannelName(input.name);
  const slug = normalizeLiveChannelSlug(input.slug);

  if (!name) {
    throw new DomainError(
      "INVALID_LIVE_CHANNEL",
      "Live channel name is required",
    );
  }

  if (!slug) {
    throw new DomainError(
      "INVALID_LIVE_CHANNEL",
      "Live channel slug is required",
    );
  }

  if (!LIVE_CHANNEL_SLUG_PATTERN.test(slug)) {
    throw new DomainError(
      "INVALID_LIVE_CHANNEL",
      "Live channel slug must contain lowercase letters, numbers, and hyphens only",
    );
  }
}

export function prepareLiveChannelCreateInput(
  input: LiveChannelCreateInput,
): LiveChannelCreateInput {
  assertValidLiveChannelInput(input);

  return {
    id: input.id,
    name: normalizeLiveChannelName(input.name),
    slug: normalizeLiveChannelSlug(input.slug),
  };
}

export function prepareLiveChannelUpdateInput(
  input: LiveChannelUpdateInput,
): LiveChannelUpdateInput {
  const prepared: LiveChannelUpdateInput = {};

  if (input.name !== undefined) {
    const name = normalizeLiveChannelName(input.name);

    if (!name) {
      throw new DomainError(
        "INVALID_LIVE_CHANNEL",
        "Live channel name is required",
      );
    }

    prepared.name = name;
  }

  if (input.slug !== undefined) {
    const slug = normalizeLiveChannelSlug(input.slug);

    if (!slug) {
      throw new DomainError(
        "INVALID_LIVE_CHANNEL",
        "Live channel slug is required",
      );
    }

    if (!LIVE_CHANNEL_SLUG_PATTERN.test(slug)) {
      throw new DomainError(
        "INVALID_LIVE_CHANNEL",
        "Live channel slug must contain lowercase letters, numbers, and hyphens only",
      );
    }

    prepared.slug = slug;
  }

  if (Object.keys(prepared).length === 0) {
    throw new DomainError(
      "INVALID_REQUEST_BODY",
      "PATCH request body must include at least one mutable field",
    );
  }

  return prepared;
}
