import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const requiredProjectFiles = [
  "assignment.md",
  "Saat_Teknoloji_CMS_MW_Assignment_Final.pdf",
  "project-steps.md",
  "SaatCMS_Technical_Improvement_Recommendations.md",
  "post-release-fixes.md",
];

describe("documentation consistency", () => {
  it("keeps every documentation artifact in a category folder", async () => {
    const docsEntries = await readdir(path.join(rootDir, "docs"), {
      withFileTypes: true,
    });

    expect(
      docsEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    ).toEqual([]);
    expect(
      docsEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["api", "ci-cd", "database", "domain", "project"]);
  });

  it("keeps project documentation under docs/project only", async () => {
    expect(existsSync(path.join(rootDir, "project"))).toBe(false);

    for (const file of requiredProjectFiles) {
      expect(existsSync(path.join(rootDir, "docs", "project", file))).toBe(
        true,
      );
    }
  });

  it("keeps local Markdown links resolvable", async () => {
    const markdownFiles = await listMarkdownFiles(rootDir);
    const brokenLinks: string[] = [];

    for (const markdownFile of markdownFiles) {
      const markdown = await readFile(markdownFile, "utf8");
      const links = extractLocalMarkdownLinks(markdown);

      for (const link of links) {
        const targetPath = path.resolve(path.dirname(markdownFile), link);

        if (!existsSync(targetPath)) {
          brokenLinks.push(
            `${path.relative(rootDir, markdownFile)} -> ${link}`,
          );
        }
      }
    }

    expect(brokenLinks).toEqual([]);
  });

  it("keeps content metadata examples free of playbackUrl", async () => {
    const contentApiDoc = await readFile(
      path.join(rootDir, "docs", "api", "content-metadata-api.md"),
      "utf8",
    );
    const apiExamplesDoc = await readFile(
      path.join(rootDir, "docs", "api", "api-test-examples.md"),
      "utf8",
    );
    const metadataExampleSection = sectionBetween(
      apiExamplesDoc,
      "### 1. Successful Metadata Resolution",
      "### 2. Successful EPG Creation",
    );

    expect(contentApiDoc).toContain(
      "playbackUrl` is resolved internally for the playback gatekeeper",
    );
    expect(metadataExampleSection).not.toContain("playbackUrl");
  });

  it("keeps the managed PostgreSQL deployment safety controls documented", async () => {
    const [blueprint, readme, runbook, databaseStructure] = await Promise.all([
      readFile(path.join(rootDir, "render.yaml"), "utf8"),
      readFile(path.join(rootDir, "README.md"), "utf8"),
      readFile(
        path.join(rootDir, "docs", "ci-cd", "deployment-runbook.md"),
        "utf8",
      ),
      readFile(
        path.join(rootDir, "docs", "database", "database-structure.md"),
        "utf8",
      ),
    ]);

    expect(blueprint).toContain('postgresMajorVersion: "18"');
    expect(blueprint).toContain("preDeployCommand: npm run db:migrate:deploy");
    expect(blueprint).toContain("healthCheckPath: /ready");
    expect(blueprint).toContain("ipAllowList: []");
    expect(blueprint).toContain("fromDatabase:");
    expect(readme).toContain("## Migration Responsibilities");
    expect(runbook).toContain("## Backup and Restore Rehearsal");
    expect(runbook).toContain("## Rollback");
    expect(databaseStructure).toContain("TIMESTAMPTZ(3)");
    expect(databaseStructure).toContain("EpgProgram_no_overlap_excl");
  });

  it("keeps the Postman collection aligned with current success and failure examples", async () => {
    const collection = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          "docs",
          "api",
          "saatcms-api-tests.postman_collection.json",
        ),
        "utf8",
      ),
    ) as { item: Array<{ name: string }> };
    const requestNames = collection.item.map((item) => item.name);

    expect(requestNames).toEqual(
      expect.arrayContaining([
        "Successful metadata resolution",
        "Successful EPG creation",
        "CMS authentication required",
        "EPG overlap blocked",
        "Successful playback request",
        "Geo-blocked playback request",
        "Device-blocked playback request",
        "Malformed country header",
        "Create CMS content",
        "Update CMS content with ETag",
        "Delete CMS content",
        "Create live channel",
        "Delete live channel with confirmation",
        "List EPG programs",
        "Update EPG program with ETag",
        "Delete EPG program",
      ]),
    );
  });

  it("publishes the complete authenticated CMS CRUD contract", async () => {
    const [openApi, cmsCrudDoc, readme, collection] = await Promise.all([
      readFile(
        path.join(rootDir, "docs", "api", "cms-crud-openapi.yaml"),
        "utf8",
      ),
      readFile(
        path.join(rootDir, "docs", "api", "cms-crud-api.md"),
        "utf8",
      ),
      readFile(path.join(rootDir, "README.md"), "utf8"),
      readFile(
        path.join(
          rootDir,
          "docs",
          "api",
          "saatcms-api-tests.postman_collection.json",
        ),
        "utf8",
      ),
    ]);

    for (const route of [
      "/api/v1/cms/content:",
      "/api/v1/cms/content/{id}:",
      "/api/v1/cms/channels:",
      "/api/v1/cms/channels/{channelId}:",
      "/api/v1/cms/channels/{channelId}/epg:",
      "/api/v1/cms/channels/{channelId}/epg/{programId}:",
    ]) {
      expect(openApi).toContain(route);
    }

    expect(openApi).toContain("bearerAuth:");
    expect(openApi).toContain("If-Match");
    expect(cmsCrudDoc).toContain("CONTENT_HAS_CHILDREN");
    expect(cmsCrudDoc).toContain("LIVE_CHANNEL_WRITE_CONFLICT");
    expect(cmsCrudDoc).toContain("EPG_WRITE_CONFLICT");
    expect(readme).toContain("CMS Authentication and Write Safety");
    expect(collection).toContain("Bearer {{cmsEditorKey}}");
    expect(collection).toContain("Bearer {{cmsAdminKey}}");
  });
});

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function extractLocalMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(markdown)) !== null) {
    const rawLink = match[1].trim().replace(/^<|>$/g, "");

    if (
      rawLink.startsWith("http://") ||
      rawLink.startsWith("https://") ||
      rawLink.startsWith("#") ||
      rawLink.startsWith("mailto:")
    ) {
      continue;
    }

    const withoutAnchor = rawLink.split("#")[0];

    if (withoutAnchor) {
      links.push(decodeURI(withoutAnchor));
    }
  }

  return links;
}

function sectionBetween(
  text: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}
