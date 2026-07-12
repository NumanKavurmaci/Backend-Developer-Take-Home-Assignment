import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("catalog contract boundary", () => {
  it("keeps TVmaze wire contracts out of application source modules", async () => {
    const files = await typescriptFiles(path.join(process.cwd(), "src"));
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/tvmaze-contracts|TvMaze(?:Show|Season|Episode)/);
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
