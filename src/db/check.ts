import { prisma } from "./client.js";

async function main() {
  await prisma.$connect();

  const [[connection], contentCount, channelCount, epgProgramCount] =
    await Promise.all([
      prisma.$queryRaw<
        Array<{ databaseName: string; databaseUser: string; version: string }>
      >`SELECT current_database() AS "databaseName", current_user AS "databaseUser", version() AS version`,
      prisma.content.count(),
      prisma.liveChannel.count(),
      prisma.epgProgram.count(),
    ]);

  console.log(
    JSON.stringify(
      {
        database: "connected",
        databaseName: connection?.databaseName,
        databaseUser: connection?.databaseUser,
        version: connection?.version,
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
