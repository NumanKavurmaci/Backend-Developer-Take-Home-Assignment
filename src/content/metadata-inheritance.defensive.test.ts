import type { Content, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_TYPES } from "./content-types.js";

const now = new Date("2026-07-02T12:00:00.000Z");

function contentRow(overrides: Partial<Content> & Pick<Content, "id">): Content {
  const { id, ...rest } = overrides;

  return {
    id,
    type: CONTENT_TYPES.SERIES,
    title: "Defensive Test Content",
    parentId: null,
    parentalRating: null,
    genre: null,
    quality: null,
    isPremium: null,
    playbackUrl: null,
    geoBlockCountriesOverride: false,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

function fakePrisma(): PrismaClient {
  return {
    contentGeoBlockCountry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

afterEach(() => {
  vi.doUnmock("./content-repository.js");
  vi.resetModules();
});

describe("metadata inheritance defensive guards", () => {
  it("rejects malformed non-empty ancestor paths with no requested content", async () => {
    const malformedAncestorPath = {
      length: 1,
      entries: function* entries() {},
      map: () => [],
      [Symbol.iterator]: function* iterator() {},
    } as unknown as Content[];

    vi.doMock("./content-repository.js", () => ({
      getContentAncestorPath: vi.fn().mockResolvedValue(malformedAncestorPath),
    }));

    const { resolveContentMetadata } = await import(
      "./metadata-inheritance.js"
    );

    await expect(
      resolveContentMetadata(fakePrisma(), "malformed-content"),
    ).rejects.toMatchObject({
      errorCode: "CONTENT_NOT_FOUND",
      message: "Content not found",
    });
  });

  it("rejects inconsistent ancestor paths before resolving metadata", async () => {
    vi.doMock("./content-repository.js", () => ({
      getContentAncestorPath: vi.fn().mockResolvedValue([
        contentRow({
          id: "series-root",
          type: CONTENT_TYPES.SERIES,
          title: "Series Root",
        }),
        contentRow({
          id: "season-with-wrong-parent",
          type: CONTENT_TYPES.SEASON,
          title: "Season With Wrong Parent",
          parentId: "different-series",
        }),
      ]),
    }));

    const { resolveContentMetadata } = await import(
      "./metadata-inheritance.js"
    );

    await expect(
      resolveContentMetadata(fakePrisma(), "season-with-wrong-parent"),
    ).rejects.toThrow(
      "Content hierarchy is inconsistent for season-with-wrong-parent; expected parent series-root.",
    );
  });
});
