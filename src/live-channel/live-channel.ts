import type { CreateLiveChannelInput } from "./live-channel-types.js";

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

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
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
