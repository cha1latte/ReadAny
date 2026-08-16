import { describe, expect, it } from "vitest";
import { selectReleaseAsset } from "./shlai-release-asset";

describe("selectReleaseAsset", () => {
  it("selects only the exact configured stable APK", () => {
    expect(
      selectReleaseAsset(
        [
          {
            name: "ReadAny-Shlai-trojan.apk",
            downloadUrl: "https://example.test/trojan.apk",
            size: 1,
          },
          { name: "ReadAny-Shlai.apk", downloadUrl: "https://example.test/shlai.apk", size: 2 },
        ],
        "ReadAny-Shlai.apk",
      ),
    ).toEqual({
      name: "ReadAny-Shlai.apk",
      downloadUrl: "https://example.test/shlai.apk",
      size: 2,
    });
  });
});
