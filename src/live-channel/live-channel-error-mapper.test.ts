import { describe, expect, it } from "vitest";
import { toLiveChannelDomainError } from "./live-channel-error-mapper.js";

describe("live channel database error mapper", () => {
  it("maps a Prisma slug uniqueness failure to a stable conflict", () => {
    const error = {
      code: "P2002",
      meta: {
        modelName: "LiveChannel",
        target: ["slug"],
      },
    };

    expect(toLiveChannelDomainError(error)).toMatchObject({
      errorCode: "LIVE_CHANNEL_SLUG_CONFLICT",
      message: "A live channel with this slug already exists",
    });
  });

  it("maps Prisma record-not-found failures", () => {
    expect(toLiveChannelDomainError({ code: "P2025" })).toMatchObject({
      errorCode: "CHANNEL_NOT_FOUND",
      message: "Channel not found",
    });
  });

  it("does not hide unrelated database failures", () => {
    expect(toLiveChannelDomainError({ code: "P2003" })).toBeUndefined();
  });
});
