import { prisma } from "../src/db/client.js";

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

async function clearExistingData() {
  await prisma.$transaction([
    prisma.epgProgram.deleteMany(),
    prisma.epgScheduleLock.deleteMany(),
    prisma.liveChannel.deleteMany(),
    prisma.contentGeoBlockCountry.deleteMany(),
    prisma.content.deleteMany(),
  ]);
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
            startTime: new Date("2026-07-02T08:00:00.000Z"),
            endTime: new Date("2026-07-02T09:00:00.000Z"),
          },
          {
            id: "epg-saat-news-market-watch",
            programName: "Market Watch",
            startTime: new Date("2026-07-02T09:00:00.000Z"),
            endTime: new Date("2026-07-02T10:00:00.000Z"),
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
            startTime: new Date("2026-07-02T08:00:00.000Z"),
            endTime: new Date("2026-07-02T09:00:00.000Z"),
          },
        ],
      },
    },
  });
}

async function main() {
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
