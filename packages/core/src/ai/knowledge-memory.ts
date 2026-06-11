import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  type KnowledgeSummaryCompressionOptions,
  type KnowledgeSummaryCompressionPlan,
  type KnowledgeSummaryCompressionState,
  type KnowledgeSummaryDocument,
  createKnowledgeSummaryCompressionState,
  prepareKnowledgeSummaryCompression,
} from "../knowledge";
import type { AIConfig } from "../types";
import { createChatModel } from "./llm-provider";

export type KnowledgeSummaryCompressionStatus = "skipped" | "compressed" | "failed";

export interface KnowledgeSummaryCompressionResult {
  status: KnowledgeSummaryCompressionStatus;
  plan: KnowledgeSummaryCompressionPlan;
  state?: KnowledgeSummaryCompressionState;
  summaryMd?: string;
  error?: string;
}

function responseContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n");
}

function maxTokensForSummary(maxSummaryChars: number): number {
  return Math.min(1200, Math.max(256, Math.ceil(maxSummaryChars / 2)));
}

export async function maybeCompressKnowledgeSummary(
  document: KnowledgeSummaryDocument,
  aiConfig: AIConfig,
  state?: KnowledgeSummaryCompressionState,
  options: KnowledgeSummaryCompressionOptions = {},
): Promise<KnowledgeSummaryCompressionResult> {
  const plan = prepareKnowledgeSummaryCompression(document, state, options);
  if (!plan.shouldCompress || !plan.systemPrompt || !plan.userPrompt) {
    return { status: "skipped", plan, state };
  }

  try {
    const model = await createChatModel(aiConfig, {
      temperature: 0.2,
      maxTokens: maxTokensForSummary(plan.maxSummaryChars),
      streaming: false,
    });
    const response = await model.invoke([
      new SystemMessage(plan.systemPrompt),
      new HumanMessage(plan.userPrompt),
    ]);
    const summaryMd = responseContentToText(response.content).trim().slice(0, plan.maxSummaryChars);

    if (!summaryMd) {
      return {
        status: "failed",
        plan,
        state,
        error: "Knowledge summary compression returned an empty summary.",
      };
    }

    const nextState = createKnowledgeSummaryCompressionState(summaryMd, plan);
    return {
      status: "compressed",
      plan,
      state: nextState,
      summaryMd,
    };
  } catch (error) {
    console.warn("[knowledge-memory] Failed to compress knowledge document:", error);
    return {
      status: "failed",
      plan,
      state,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
