import { describe, expect, it } from "vitest";
import { sanitizePlainText } from "./sanitize.js";

describe("provider plain-text sanitization", () => {
  it("removes markup, active content, and decodes text entities", () => {
    expect(sanitizePlainText(
      "<p>Hello <strong>world</strong> &amp; friends.</p><script>alert('x')</script><p>Next&nbsp;line.</p>",
    )).toBe("Hello world & friends.\nNext line.");
  });

  it("turns empty markup and missing values into null", () => {
    expect(sanitizePlainText("<p> </p>")).toBeNull();
    expect(sanitizePlainText(null)).toBeNull();
  });
});
