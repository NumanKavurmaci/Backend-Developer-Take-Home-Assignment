import { pathToFileURL } from "node:url";

const playbackHeaders = {
  Accept: "application/json",
  "X-User-Id": "deployment-smoke-user",
  "X-User-Country": "TR",
  "X-Device-Type": "Web",
};

export async function runDeploymentSmoke(
  baseUrl = readBaseUrl(),
): Promise<void> {
  await expectResponse(baseUrl, "health", "/health", 200, { status: "ok" });
  await expectResponse(baseUrl, "PostgreSQL readiness", "/ready", 200, {
    status: "ready",
  });
  await expectResponse(
    baseUrl,
    "inherited content metadata",
    "/api/v1/mw/content/episode-galactic-odyssey-s1e2",
    200,
    { genre: "Space Adventure", quality: "HD", isPremium: false },
  );
  await expectResponse(
    baseUrl,
    "allowed playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
    200,
    {},
    { headers: playbackHeaders },
  );
  await expectResponse(
    baseUrl,
    "geo-blocked playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
    403,
    { errorCode: "GEO_BLOCKED" },
    {
      headers: { ...playbackHeaders, "X-User-Country": "IR" },
    },
  );
  await expectResponse(
    baseUrl,
    "device-blocked playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e3",
    403,
    { errorCode: "DEVICE_NOT_SUPPORTED" },
    {
      headers: { ...playbackHeaders, "X-Device-Type": "Mobile" },
    },
  );

  console.log(`Deployment smoke checks passed for ${baseUrl}.`);
}

function readBaseUrl(): string {
  const value = process.env.DEPLOYMENT_URL?.trim();

  if (!value) {
    throw new Error(
      "DEPLOYMENT_URL is required, for example https://service.example.com",
    );
  }

  return value.replace(/\/$/, "");
}

async function expectResponse(
  baseUrl: string,
  name: string,
  path: string,
  expectedStatus: number,
  expectedBody: Record<string, unknown>,
  init?: RequestInit,
): Promise<void> {
  const { response, body } = await request(baseUrl, name, path, init);

  if (response.status !== expectedStatus) {
    throw new Error(
      `${name}: expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  for (const [key, expectedValue] of Object.entries(expectedBody)) {
    if (body[key] !== expectedValue) {
      throw new Error(
        `${name}: expected ${key}=${JSON.stringify(expectedValue)}, received ${JSON.stringify(body[key])}.`,
      );
    }
  }

  console.log(`PASS ${name}`);
}

async function request(
  baseUrl: string,
  name: string,
  path: string,
  init?: RequestInit,
) {
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { response, body };
  } catch (error) {
    throw new Error(`${name}: request failed or timed out for ${url}.`, {
      cause: error,
    });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDeploymentSmoke().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
