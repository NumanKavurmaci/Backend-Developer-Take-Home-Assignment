const baseUrl = readBaseUrl();
const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};
const playbackHeaders = {
  Accept: "application/json",
  "X-User-Id": "deployment-smoke-user",
  "X-User-Country": "TR",
  "X-Device-Type": "Web",
};

async function main(): Promise<void> {
  await expectResponse("health", "/health", 200, { status: "ok" });
  await expectResponse("PostgreSQL readiness", "/ready", 200, {
    status: "ready",
  });
  await expectResponse(
    "inherited content metadata",
    "/api/v1/mw/content/episode-galactic-odyssey-s1e2",
    200,
    { genre: "Space Adventure", quality: "HD", isPremium: false },
  );
  await expectResponse(
    "allowed playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
    200,
    {},
    { headers: playbackHeaders },
  );
  await expectResponse(
    "geo-blocked playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e2",
    403,
    { errorCode: "GEO_BLOCKED" },
    {
      headers: { ...playbackHeaders, "X-User-Country": "IR" },
    },
  );
  await expectResponse(
    "device-blocked playback",
    "/api/v1/mw/playback/episode-galactic-odyssey-s1e3",
    403,
    { errorCode: "DEVICE_NOT_SUPPORTED" },
    {
      headers: { ...playbackHeaders, "X-Device-Type": "Mobile" },
    },
  );

  const runId = Date.now();
  const firstStart = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
  const firstEnd = new Date(firstStart.getTime() + 60 * 60 * 1000);
  const successfulProgram = programRequest(
    `Deployment smoke ${runId}`,
    firstStart,
    firstEnd,
  );

  await expectResponse(
    "successful EPG creation",
    "/api/v1/cms/channels/channel-saat-news/epg",
    201,
    { channelId: "channel-saat-news" },
    successfulProgram,
  );
  await expectResponse(
    "rejected EPG overlap",
    "/api/v1/cms/channels/channel-saat-news/epg",
    400,
    { errorCode: "EPG_OVERLAP" },
    programRequest(
      `Deployment smoke overlap ${runId}`,
      new Date(firstStart.getTime() + 30 * 60 * 1000),
      new Date(firstEnd.getTime() + 30 * 60 * 1000),
    ),
  );

  const concurrentStart = new Date(firstStart.getTime() + 3 * 60 * 60 * 1000);
  const concurrentEnd = new Date(concurrentStart.getTime() + 60 * 60 * 1000);
  const concurrentResponses = await Promise.all([
    request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      programRequest(`Concurrent smoke A ${runId}`, concurrentStart, concurrentEnd),
    ),
    request(
      "/api/v1/cms/channels/channel-saat-news/epg",
      programRequest(`Concurrent smoke B ${runId}`, concurrentStart, concurrentEnd),
    ),
  ]);
  const concurrentStatuses = concurrentResponses
    .map(({ response }) => response.status)
    .sort((left, right) => left - right);

  if (JSON.stringify(concurrentStatuses) !== JSON.stringify([201, 400])) {
    throw new Error(
      `concurrent EPG writes: expected statuses 201 and 400, received ${concurrentStatuses.join(" and ")}.`,
    );
  }

  console.log("PASS concurrent EPG writes (one created, one rejected)");
  console.log(`Deployment smoke checks passed for ${baseUrl}.`);
}

function readBaseUrl(): string {
  const value = process.env.DEPLOYMENT_URL?.trim();

  if (!value) {
    throw new Error("DEPLOYMENT_URL is required, for example https://service.example.com");
  }

  return value.replace(/\/$/, "");
}

function programRequest(programName: string, startTime: Date, endTime: Date) {
  return {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      programName,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    }),
  } satisfies RequestInit;
}

async function expectResponse(
  name: string,
  path: string,
  expectedStatus: number,
  expectedBody: Record<string, unknown>,
  init?: RequestInit,
): Promise<void> {
  const { response, body } = await request(path, init);

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

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;

  return { response, body };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
