import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("catalog contract boundary", () => {
  it("keeps TVmaze wire contracts out of application source modules", async () => {
    const files = await typescriptFiles(path.join(process.cwd(), "src"));
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/tvmaze-contracts|TvMaze(?:Show|Season|Episode)/);
  });

  it("keeps catalog HTTP tooling out of runtime, migration, seed, and deployment paths", async () => {
    const runtimeFiles = [
      ...(await typescriptFiles(path.join(process.cwd(), "src"))),
      path.join(process.cwd(), "prisma", "seed.ts"),
      path.join(process.cwd(), "render.yaml"),
      ...(await filesUnder(path.join(process.cwd(), ".github"))),
    ];
    const source = (await Promise.all(runtimeFiles.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/scripts\/catalog\/http|catalog\/http|catalog:build/);

    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const scriptName of ["start", "deploy:setup", "db:migrate:deploy", "db:seed"]) {
      expect(packageJson.scripts[scriptName]).not.toMatch(/catalog:build|scripts\/catalog\/http/);
    }
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(entryPath);
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  }));
  return nested.flat();
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  }));
  return nested.flat();
}
