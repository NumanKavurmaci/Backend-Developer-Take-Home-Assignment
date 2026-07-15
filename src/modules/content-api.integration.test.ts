import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { CmsSecurityOptions } from "../shared/http/cms-security.js";
import { clearContentTables } from "../test/test-database.js";

const prisma = new PrismaClient();
const editorToken = "content-integration-editor-secret";
const cmsSecurity: CmsSecurityOptions = {
  credentials: [
    {
      actorId: "content-integration-editor",
      role: "editor",
      secret: editorToken,
    },
  ],
  authenticationAttemptLimitPerMinute: 100,
  maxBodyBytes: 10_000,
  mutationsEnabled: true,
  rateLimitPerMinute: 100,
};

beforeEach(async () => {
  await clearContentTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CMS and middleware content API integration", () => {
  it("reflects CMS mutations in resolved public metadata without exposing playback URLs", async () => {
    const app = createApp({ cmsSecurity });
    const series = await createContent(app, {
      type: "SERIES",
      title: "Integration Series",
      genre: "Drama",
      quality: "HD",
      playbackUrl: "https://cdn.saatcms.test/integration/series.m3u8",
    });
    const season = await createContent(app, {
      type: "SEASON",
      title: "Integration Season",
      parentId: series.id,
    });
    const episode = await createContent(app, {
      type: "EPISODE",
      title: "Integration Episode",
      parentId: season.id,
      quality: "SD",
      playbackUrl: "https://cdn.saatcms.test/integration/episode.m3u8",
    });

    await expectPublicMetadata(app, episode.id, {
      genre: "Drama",
      quality: "SD",
    });

    const updateSeries = await requestCms(app, `/api/v1/cms/content/${series.id}`, {
      method: "PATCH",
      body: JSON.stringify({ genre: "Mystery" }),
    });
    expect(updateSeries.status).toBe(200);

    await expectPublicMetadata(app, episode.id, {
      genre: "Mystery",
      quality: "SD",
    });

    const clearEpisodeOverride = await requestCms(
      app,
      `/api/v1/cms/content/${episode.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quality: null }),
      },
    );
    expect(clearEpisodeOverride.status).toBe(200);

    await expectPublicMetadata(app, episode.id, {
      genre: "Mystery",
      quality: "HD",
    });

    const rawCmsResponse = await requestCms(
      app,
      `/api/v1/cms/content/${episode.id}`,
    );
    const rawCmsContent = (await rawCmsResponse.json()) as Record<
      string,
      unknown
    >;

    expect(rawCmsResponse.status).toBe(200);
    expect(rawCmsContent).toMatchObject({
      id: episode.id,
      quality: null,
      playbackUrl: "https://cdn.saatcms.test/integration/episode.m3u8",
    });
  });
});

type TestApp = ReturnType<typeof createApp>;

async function createContent(
  app: TestApp,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await requestCms(app, "/api/v1/cms/content", {
    method: "POST",
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function requestCms(
  app: TestApp,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${editorToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function expectPublicMetadata(
  app: TestApp,
  contentId: string,
  expected: Record<string, unknown>,
): Promise<void> {
  const response = await app.request(`/api/v1/mw/content/${contentId}`);
  const body = (await response.json()) as Record<string, unknown>;

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ contentId, ...expected });
  expect(body).not.toHaveProperty("playbackUrl");
}
