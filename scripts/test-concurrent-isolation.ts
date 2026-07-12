import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

async function run(): Promise<void> {
  const vitestCli = fileURLToPath(
    new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
  );
  const args = [vitestCli, "run", "src/test/test-database.test.ts"];
  const childEnvironment = {
    ...process.env,
    NODE_ENV: "test",
    DEPLOYMENT_ENV: "test",
  };

  await Promise.all([
    execFileAsync(process.execPath, args, {
      env: childEnvironment,
      timeout: 60_000,
    }),
    execFileAsync(process.execPath, args, {
      env: childEnvironment,
      timeout: 60_000,
    }),
  ]);

  console.log("Two concurrent isolated Vitest runs passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
