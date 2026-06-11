import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSummaryDocument } from "../../knowledge";
import type { AIConfig } from "../../types";

const llmMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createChatModel: vi.fn(),
}));

vi.mock("../llm-provider", () => ({
  createChatModel: llmMocks.createChatModel,
}));

const { maybeCompressKnowledgeSummary } = await import("../knowledge-memory");

function aiConfig(): AIConfig {
  return {
    endpoints: [
      {
        id: "endpoint-1",
        name: "Test",
        provider: "custom",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        models: ["test-model"],
        modelsFetched: true,
      },
    ],
    activeEndpointId: "endpoint-1",
    activeModel: "test-model",
    temperature: 0.7,
    maxTokens: 4096,
    slidingWindowSize: 8,
  };
}

function document(overrides: Partial<KnowledgeSummaryDocument> = {}): KnowledgeSummaryDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Book Home",
    contentMd: "Short.",
    excerpt: "Short.",
    tags: ["reading"],
    sourceKind: "book",
    sourceId: "book-1",
    updatedAt: 100,
    ...overrides,
  };
}

function longMarkdown(): string {
  return Array.from(
    { length: 90 },
    (_, index) => `## Idea ${index + 1}\nReading note ${index + 1} with enough evidence.`,
  ).join("\n\n");
}

describe("knowledge memory compression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmMocks.createChatModel.mockResolvedValue({ invoke: llmMocks.invoke });
    llmMocks.invoke.mockResolvedValue({ content: "## Durable memory\n- Keep this idea." });
  });

  it("skips short documents without calling the model", async () => {
    const result = await maybeCompressKnowledgeSummary(document(), aiConfig(), undefined, {
      minSourceChars: 100,
    });

    expect(result.status).toBe("skipped");
    expect(result.plan.reason).toBe("below_threshold");
    expect(llmMocks.createChatModel).not.toHaveBeenCalled();
  });

  it("compresses long documents into a state tied to the source fingerprint", async () => {
    const result = await maybeCompressKnowledgeSummary(
      document({ contentMd: longMarkdown(), updatedAt: 200 }),
      aiConfig(),
      undefined,
      { minSourceChars: 200, maxSummaryChars: 80 },
    );

    expect(result.status).toBe("compressed");
    expect(result.summaryMd).toBe("## Durable memory\n- Keep this idea.");
    expect(result.state).toMatchObject({
      summaryMd: "## Durable memory\n- Keep this idea.",
      sourceFingerprint: result.plan.sourceFingerprint,
      sourceUpdatedAt: 200,
    });
    expect(llmMocks.createChatModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ temperature: 0.2, streaming: false }),
    );
    expect(llmMocks.invoke).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
  });

  it("returns failed status instead of throwing when the model fails", async () => {
    llmMocks.invoke.mockRejectedValue(new Error("model offline"));

    const result = await maybeCompressKnowledgeSummary(
      document({ contentMd: longMarkdown() }),
      aiConfig(),
      undefined,
      { minSourceChars: 200 },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("model offline");
    expect(result.plan.shouldCompress).toBe(true);
  });
});
