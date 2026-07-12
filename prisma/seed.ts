import { prisma } from "../src/db/client.js";

const ALLOWED_DEMO_SEED_ENVIRONMENTS = new Set(["local", "demo", "test"]);

function assertDemoSeedWasExplicitlyRequested(): void {
  const deploymentEnvironment = process.env.DEPLOYMENT_ENV ?? "local";
  const explicitlyRequested = process.argv.includes("--demo");

  if (
    !explicitlyRequested ||
    !ALLOWED_DEMO_SEED_ENVIRONMENTS.has(deploymentEnvironment)
  ) {
    throw new Error(
      "Demo seed refused. Run npm run db:seed only with DEPLOYMENT_ENV=local, demo, or test. Production seeding is disabled.",
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

async function clearExistingData() {
  await prisma.$transaction(async (transaction) => {
    await transaction.epgProgram.deleteMany();
    await transaction.epgScheduleLock.deleteMany();
    await transaction.liveChannel.deleteMany();
    await transaction.contentGeoBlockCountry.deleteMany();
    await transaction.content.updateMany({ data: { parentId: null } });
    await transaction.content.deleteMany();
  });
}

async function seedContent() {
  await prisma.content.create({
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

  await prisma.content.create({
    data: {
      id: contentIds.season,
      type: "SEASON",
      title: "Galactic Odyssey - Season 1",
      parentId: contentIds.series,
      genre: "Space Adventure",
      geoBlockCountriesOverride: false,
    },
  });

  await prisma.content.createMany({
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

  await prisma.contentGeoBlockCountry.createMany({
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

async function seedLiveChannels() {
  await prisma.liveChannel.create({
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

  await prisma.liveChannel.create({
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

async function main() {
  assertDemoSeedWasExplicitlyRequested();
  await clearExistingData();
  await seedContent();
  await seedLiveChannels();

  const [contentCount, channelCount, epgProgramCount] = await Promise.all([
    prisma.content.count(),
    prisma.liveChannel.count(),
    prisma.epgProgram.count(),
  ]);

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
