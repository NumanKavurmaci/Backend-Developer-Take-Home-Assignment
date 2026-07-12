import { writeCatalogArtifact } from "./artifact.js";
import { validateCatalogArtifact } from "./artifact-validator.js";
import { readCatalogBuildConfig } from "./build-config.js";
import { buildCatalogFromTvMaze } from "./catalog-builder.js";
import { createTvMazeClient } from "./tvmaze-client.js";
import { HttpTvMazeCatalogSource } from "./tvmaze-source.js";

async function main(): Promise<void> {
  const config = readCatalogBuildConfig();
  const source = new HttpTvMazeCatalogSource(
    createTvMazeClient({
      cacheDir: config.cacheDir,
      offline: config.artifactConfiguration.offline,
    }),
  );
  const built = await buildCatalogFromTvMaze(
    source,
    config.artifactConfiguration,
  );
  const manifest = await writeCatalogArtifact(config.outputDir, built.chunk, {
    generatedAt: new Date().toISOString(),
    generatorVersion: "0.1.0",
    provenance: [
      {
        source: "TVMAZE",
        providerName: "TVmaze",
        providerUrl: "https://www.tvmaze.com/api",
        license: "CC BY-SA",
        attribution: "Data provided by TVmaze; normalized and modified by SaatCMS.",
        snapshotKey: "tvmaze-public-api-cache-v1",
      },
    ],
    configuration: config.artifactConfiguration,
    scenarioIds: built.scenarioIds,
    estimatedDatabaseBytes: built.estimatedDatabaseBytes,
  });
  await validateCatalogArtifact(config.outputDir);

  console.log(
    JSON.stringify(
      {
        built: true,
        outputDirectory: config.outputDir,
        offline: config.artifactConfiguration.offline,
        counts: manifest.counts,
        normalizedBytes: manifest.totals.normalizedBytes,
        compressedBytes: manifest.totals.compressedBytes,
        estimatedDatabaseBytes: manifest.estimatedDatabaseBytes,
        scenarioIds: manifest.scenarioIds,
        summary: {
          ...built.summary,
          excludedEpisodes: built.summary.excludedEpisodes.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Catalog build failed.");
  process.exitCode = 1;
});
