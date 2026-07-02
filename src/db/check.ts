import { prisma } from "./client.js";

async function main() {
  await prisma.$connect();

  const [contentCount, channelCount, epgProgramCount] = await Promise.all([
    prisma.content.count(),
    prisma.liveChannel.count(),
    prisma.epgProgram.count(),
  ]);

  console.log(
    JSON.stringify(
      {
        database: "connected",
        contentCount,
        channelCount,
        epgProgramCount,
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
