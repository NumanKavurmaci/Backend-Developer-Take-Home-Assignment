import type { CreateLiveChannelInput } from "./live-channel-types.js";

const LIVE_CHANNEL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeLiveChannelName(name: string): string {
  return name.trim();
}

export function normalizeLiveChannelSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function assertValidLiveChannelInput(
  input: CreateLiveChannelInput,
): void {
  const name = normalizeLiveChannelName(input.name);
  const slug = normalizeLiveChannelSlug(input.slug);

  if (!name) {
    throw new Error("Live channel name is required");
  }

  if (!slug) {
    throw new Error("Live channel slug is required");
  }

  if (!LIVE_CHANNEL_SLUG_PATTERN.test(slug)) {
    throw new Error(
      "Live channel slug must contain lowercase letters, numbers, and hyphens only",
    );
  }
}

export function prepareLiveChannelCreateInput(
  input: CreateLiveChannelInput,
): CreateLiveChannelInput {
  assertValidLiveChannelInput(input);

  return {
    id: input.id,
    name: normalizeLiveChannelName(input.name),
    slug: normalizeLiveChannelSlug(input.slug),
  };
}
