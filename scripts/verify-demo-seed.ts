import { prisma } from "../src/db/client.js";

const expectedIds = {
  content: [
    "series-galactic-odyssey",
    "season-galactic-odyssey-s1",
    "episode-galactic-odyssey-s1e1",
    "episode-galactic-odyssey-s1e2",
    "episode-galactic-odyssey-s1e3",
    "movie-crystal-frontier",
  ],
  channels: ["channel-saat-news", "channel-saat-sports"],
  programs: [
    "epg-saat-news-morning-briefing",
    "epg-saat-news-market-watch",
    "epg-saat-sports-morning-briefing",
  ],
} as const;

async function main(): Promise<void> {
  const [contentCount, channelCount, epgProgramCount] = await Promise.all([
    prisma.content.count({ where: { id: { in: [...expectedIds.content] } } }),
    prisma.liveChannel.count({
      where: { id: { in: [...expectedIds.channels] } },
    }),
    prisma.epgProgram.count({
      where: { id: { in: [...expectedIds.programs] } },
    }),
  ]);

  const actual = { contentCount, channelCount, epgProgramCount };
  const expected = { contentCount: 6, channelCount: 2, epgProgramCount: 3 };

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Demo seed verification failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }

  console.log(JSON.stringify({ verified: true, ...actual }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
