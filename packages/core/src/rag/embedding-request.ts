import { getPlatformService } from "../services";

export interface RemoteEmbeddingModel {
  url: string;
  apiKey?: string;
  modelId: string;
}

interface OpenAIEmbeddingItem {
  embedding: number[];
  index?: number;
}

export function normalizeEmbeddingsUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isOllamaEmbeddingUrl(url: string): boolean {
  return url.endsWith("/api/embed");
}

function getAuthHeader(apiKey?: string): Record<string, string> {
  const trimmedApiKey = apiKey?.trim();
  return trimmedApiKey ? { Authorization: `Bearer ${trimmedApiKey}` } : {};
}

function getRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

async function fetchEmbeddingEndpoint(url: string, init: RequestInit): Promise<Response> {
  try {
    return await getPlatformService().fetch(url, {
      ...init,
      timeoutMs: 60000,
      responseType: "text",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("PlatformService not initialized")) {
      return fetch(url, init);
    }
    throw error;
  }
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  return text || response.statusText;
}

function parseRemoteEmbeddingResponse(json: unknown, isOllama: boolean): number[][] {
  if (isOllama) {
    const embeddings = getRecordValue(json, "embeddings");
    if (Array.isArray(embeddings)) {
      return embeddings as number[][];
    }
    const embedding = getRecordValue(json, "embedding");
    if (Array.isArray(embedding)) {
      return [embedding as number[]];
    }
    return [];
  }

  const data = getRecordValue(json, "data");
  if (!Array.isArray(data)) {
    return [];
  }

  return (data as OpenAIEmbeddingItem[])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding);
}

export async function requestRemoteEmbeddings(
  model: RemoteEmbeddingModel,
  input: string | string[],
): Promise<number[][]> {
  const requestUrl = normalizeEmbeddingsUrl(model.url);
  const isOllama = isOllamaEmbeddingUrl(requestUrl);
  const requestBody = isOllama
    ? { model: model.modelId, input }
    : {
        input: Array.isArray(input) ? input : [input],
        model: model.modelId,
        encoding_format: "float",
      };

  const response = await fetchEmbeddingEndpoint(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(model.apiKey),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error (${response.status}): ${await readErrorBody(response)}`);
  }

  return parseRemoteEmbeddingResponse(await response.json(), isOllama);
}

export async function detectRemoteEmbeddingDimension(model: RemoteEmbeddingModel): Promise<number> {
  const embeddings = await requestRemoteEmbeddings(model, "test");
  const dimension = embeddings[0]?.length ?? 0;
  if (dimension <= 0) {
    throw new Error("Embedding API returned an empty embedding.");
  }
  return dimension;
}
