import { describe, expect, it } from "vitest";
import {
  basenameFromPath,
  createKnowledgeAttachmentHash,
  createKnowledgeAttachmentUri,
  inferKnowledgeAttachmentKind,
  inferKnowledgeAttachmentMimeType,
  parseKnowledgeAttachmentUri,
  sanitizeKnowledgeAttachmentFileName,
} from "./attachments";

describe("knowledge attachments", () => {
  it("creates and parses stable attachment URIs", () => {
    const uri = createKnowledgeAttachmentUri("att/一");
    expect(uri).toBe("readany-attachment://att%2F%E4%B8%80");
    expect(parseKnowledgeAttachmentUri(uri)).toBe("att/一");
    expect(parseKnowledgeAttachmentUri("https://example.com/image.png")).toBeUndefined();
  });

  it("normalizes file names and infers attachment metadata", () => {
    expect(basenameFromPath("/tmp/My Cover.PNG?cache=1")).toBe("My Cover.PNG");
    expect(sanitizeKnowledgeAttachmentFileName("bad:/cover?.png")).toBe("bad cover .png");
    expect(inferKnowledgeAttachmentKind("cover.png")).toBe("image");
    expect(inferKnowledgeAttachmentKind("chapter.mp3")).toBe("audio");
    expect(inferKnowledgeAttachmentKind("paper.pdf")).toBe("pdf");
    expect(inferKnowledgeAttachmentMimeType("cover.png")).toBe("image/png");
  });

  it("creates deterministic lightweight hashes for local asset identity", () => {
    expect(createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3]))).toBe(
      createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3])),
    );
    expect(createKnowledgeAttachmentHash(new Uint8Array([1, 2, 4]))).not.toBe(
      createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3])),
    );
  });
});
