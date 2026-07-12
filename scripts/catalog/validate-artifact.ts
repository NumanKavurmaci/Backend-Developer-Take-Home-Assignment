import path from "node:path";
import { validateCatalogArtifact } from "./artifact-validator.js";

const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1) {
  throw new Error("Usage: npm run catalog:validate -- [artifact-directory]");
}
const directory = path.resolve(argumentsList[0] ?? "data/catalog/current");

validateCatalogArtifact(directory)
  .then(({ manifest }) => {
    console.log(JSON.stringify({
      valid: true,
      artifactSchemaVersion: manifest.artifactSchemaVersion,
      counts: manifest.counts,
      totals: manifest.totals,
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
