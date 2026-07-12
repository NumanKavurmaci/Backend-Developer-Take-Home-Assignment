import { describe, expect, it } from "vitest";
import {
  createUpdatedAtEntityTag,
  nextEntityUpdatedAt,
  readOptionalUpdatedAtEntityTag,
} from "./entity-tag.js";

describe("updated-at entity tags", () => {
  it("round-trips strong timestamp ETags", () => {
    const updatedAt = new Date("2026-07-12T12:00:00.123Z");
    const etag = createUpdatedAtEntityTag(updatedAt);

    expect(etag).toBe('"2026-07-12T12:00:00.123Z"');
    expect(readOptionalUpdatedAtEntityTag(etag)).toEqual(updatedAt);
    expect(readOptionalUpdatedAtEntityTag(undefined)).toBeUndefined();
  });

  it.each([
    "2026-07-12T12:00:00.000Z",
    'W/"2026-07-12T12:00:00.000Z"',
    '"not-a-date"',
    '"2026-07-12T12:00:00Z"',
  ])("rejects invalid or non-canonical ETags: %s", (etag) => {
    expect(() => readOptionalUpdatedAtEntityTag(etag)).toThrow(
      expect.objectContaining({ errorCode: "INVALID_IF_MATCH" }),
    );
  });

  it("always advances timestamps by at least one millisecond", () => {
    const future = new Date(Date.now() + 60_000);
    expect(nextEntityUpdatedAt(future).getTime()).toBe(future.getTime() + 1);
  });
});
