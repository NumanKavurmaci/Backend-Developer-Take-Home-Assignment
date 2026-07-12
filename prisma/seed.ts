import { pathToFileURL } from "node:url";
import { loadEnvFile } from "node:process";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertConnectedToDestructiveTarget,
  validateDestructiveDatabaseTarget,
} from "../src/db/destructive-operation-guard.js";

function assertDemoSeedWasExplicitlyRequested(): void {
  const explicitlyRequested = process.argv.includes("--demo");

  if (!explicitlyRequested) {
    throw new Error(
      "Demo seed refused. The destructive seed must be explicitly requested with --demo.",
    );
  }
}

const contentIds = {
  series: "series-galactic-odyssey",
  season: "season-galactic-odyssey-s1",
  episodeInherited: "episode-galactic-odyssey-s1e1",
  episodeSeasonOverride: "episode-galactic-odyssey-s1e2",
  episodePremium4k: "episode-galactic-odyssey-s1e3",
  moviePremium4k: "movie-crystal-frontier",
} as const;

const channelIds = {
  news: "channel-saat-news",
  sports: "channel-saat-sports",
} as const;

const epgScheduleTimes = {
  morningBriefingStart: "2026-07-02T08:00:00.000Z",
  morningBriefingEnd: "2026-07-02T09:00:00.000Z",
  marketWatchStart: "2026-07-02T09:00:00.000Z",
  marketWatchEnd: "2026-07-02T10:00:00.000Z",
} as const;

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function readSeedUtcDate(value: string): Date {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`Seed EPG timestamp must be explicit UTC: ${value}`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Seed EPG timestamp is invalid: ${value}`);
  }

  return date;
}

async function clearExistingData(transaction: Prisma.TransactionClient) {
  await transaction.epgProgram.deleteMany();
  await transaction.epgScheduleLock.deleteMany();
  await transaction.liveChannel.deleteMany();
  await transaction.catalogSeedManifest.deleteMany();
  await transaction.contentGeoBlockCountry.deleteMany();
  await transaction.content.updateMany({ data: { parentId: null } });
  await transaction.content.deleteMany();
}

async function seedContent(transaction: Prisma.TransactionClient) {
  await transaction.content.create({
    data: {
      id: contentIds.series,
      type: "SERIES",
      title: "Galactic Odyssey",
      parentalRating: "13+",
      genre: "Sci-Fi",
      quality: "HD",
      isPremium: false,
      playbackUrl: "https://cdn.saatcms.test/galactic-odyssey/default.m3u8",
      geoBlockCountriesOverride: true,
      geoBlockCountries: {
        create: [{ countryCode: "IR" }, { countryCode: "SY" }],
      },
    },
  });

  await transaction.content.create({
    data: {
      id: contentIds.season,
      type: "SEASON",
      title: "Galactic Odyssey - Season 1",
      parentId: contentIds.series,
      genre: "Space Adventure",
      geoBlockCountriesOverride: false,
    },
  });

  await transaction.content.createMany({
    data: [
      {
        id: contentIds.episodeInherited,
        type: "EPISODE",
        title: "The Signal",
        parentId: contentIds.season,
        geoBlockCountriesOverride: false,
      },
      {
        id: contentIds.episodeSeasonOverride,
        type: "EPISODE",
        title: "Dark Side Relay",
        parentId: contentIds.season,
        parentalRating: "16+",
        playbackUrl: "https://cdn.saatcms.test/galactic-odyssey/s1/e2.m3u8",
        geoBlockCountriesOverride: false,
      },
      {
        id: contentIds.episodePremium4k,
        type: "EPISODE",
        title: "The 4K Rift",
        parentId: contentIds.season,
        quality: "UHD_4K",
        isPremium: true,
        playbackUrl: "https://cdn.saatcms.test/galactic-odyssey/s1/e3-4k.m3u8",
        geoBlockCountriesOverride: true,
      },
      {
        id: contentIds.moviePremium4k,
        type: "MOVIE",
        title: "Crystal Frontier",
        parentalRating: "18+",
        genre: "Action",
        quality: "UHD_4K",
        isPremium: true,
        playbackUrl: "https://cdn.saatcms.test/crystal-frontier/4k.m3u8",
        geoBlockCountriesOverride: true,
      },
    ],
  });

  await transaction.contentGeoBlockCountry.createMany({
    data: [
      {
        contentId: contentIds.moviePremium4k,
        countryCode: "TR",
      },
      {
        contentId: contentIds.moviePremium4k,
        countryCode: "DE",
      },
    ],
  });
}

async function seedLiveChannels(transaction: Prisma.TransactionClient) {
  await transaction.liveChannel.create({
    data: {
      id: channelIds.news,
      name: "Saat News",
      slug: "saat-news",
      scheduleLock: {
        create: {
          version: 0,
        },
      },
      epgPrograms: {
        create: [
          {
            id: "epg-saat-news-morning-briefing",
            programName: "Morning Briefing",
            startTime: readSeedUtcDate(epgScheduleTimes.morningBriefingStart),
            endTime: readSeedUtcDate(epgScheduleTimes.morningBriefingEnd),
          },
          {
            id: "epg-saat-news-market-watch",
            programName: "Market Watch",
            startTime: readSeedUtcDate(epgScheduleTimes.marketWatchStart),
            endTime: readSeedUtcDate(epgScheduleTimes.marketWatchEnd),
          },
        ],
      },
    },
  });

  await transaction.liveChannel.create({
    data: {
      id: channelIds.sports,
      name: "Saat Sports",
      slug: "saat-sports",
      scheduleLock: {
        create: {
          version: 0,
        },
      },
      epgPrograms: {
        create: [
          {
            id: "epg-saat-sports-morning-briefing",
            programName: "Morning Briefing Simulcast",
            startTime: readSeedUtcDate(epgScheduleTimes.morningBriefingStart),
            endTime: readSeedUtcDate(epgScheduleTimes.morningBriefingEnd),
          },
        ],
      },
    },
  });
}

export async function seedDemoData(
  prisma: PrismaClient,
  afterClear?: () => void | Promise<void>,
) {
  const target = validateDestructiveDatabaseTarget();
  await assertConnectedToDestructiveTarget(prisma, target);

  return prisma.$transaction(
    async (transaction) => {
      await clearExistingData(transaction);
      await afterClear?.();
      await seedContent(transaction);
      await seedLiveChannels(transaction);

      const [contentCount, channelCount, epgProgramCount] = await Promise.all([
        transaction.content.count(),
        transaction.liveChannel.count(),
        transaction.epgProgram.count(),
      ]);

      if (contentCount !== 6 || channelCount !== 2 || epgProgramCount !== 3) {
        throw new Error(
          `Demo seed verification failed inside transaction: content=${contentCount}, channels=${channelCount}, epgPrograms=${epgProgramCount}.`,
        );
      }

      return { contentCount, channelCount, epgProgramCount };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

async function main() {
  loadEnvironmentFileIfPresent();
  assertDemoSeedWasExplicitlyRequested();
  validateDestructiveDatabaseTarget();
  const { prisma } = await import("../src/db/client.js");
  try {
    const { contentCount, channelCount, epgProgramCount } =
      await seedDemoData(prisma);

    console.log(
      JSON.stringify(
        {
          seeded: true,
          contentCount,
          channelCount,
          epgProgramCount,
          usefulIds: {
            inheritedEpisode: contentIds.episodeInherited,
            seasonOverrideEpisode: contentIds.episodeSeasonOverride,
            premium4kEpisode: contentIds.episodePremium4k,
            geoBlockedPremiumMovie: contentIds.moviePremium4k,
            newsChannel: channelIds.news,
            sportsChannel: channelIds.sports,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function loadEnvironmentFileIfPresent(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
