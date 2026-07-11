import { describe, expect, it } from "vitest";
import { DomainError } from "../domain/domain-error.js";
import { toApiError } from "./domain-error-mapper.js";

describe("domain error mapper", () => {
  it("maps unknown domain errors to client errors by default", () => {
    expect(
      toApiError(new DomainError("UNMAPPED_DOMAIN_RULE", "Unmapped rule")),
    ).toMatchObject({
      statusCode: 400,
      errorCode: "UNMAPPED_DOMAIN_RULE",
      message: "Unmapped rule",
    });
  });
});
