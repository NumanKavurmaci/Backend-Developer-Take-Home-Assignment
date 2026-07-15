import { describe, expect, it } from "vitest";
import { readContentId } from "./content-id.js";

describe("content ID request parsing", () => {
  it("trims a supplied content ID", () => {
    expect(readContentId("  content-1  ")).toBe("content-1");
  });

  it.each([undefined, "", "   "])("rejects a missing content ID", (value) => {
    expect(() => readContentId(value)).toThrow(
      expect.objectContaining({
        statusCode: 400,
        errorCode: "INVALID_REQUEST",
        message: "contentId is required",
      }),
    );
  });
});
