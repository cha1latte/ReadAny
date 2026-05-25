export type { TextSegment, ChapterData } from "./rag-types";

export { chunkContent, estimateTokens } from "./chunker";
export type { ChunkerConfig } from "./chunker";

export { EmbeddingService } from "./embedding-service";
export type { EmbeddingConfig } from "./embedding-service";

export {
  detectRemoteEmbeddingDimension,
  normalizeEmbeddingsUrl,
  requestRemoteEmbeddings,
} from "./embedding-request";
export type { RemoteEmbeddingModel } from "./embedding-request";

export {
  getEmbeddingModels,
  getDefaultModel,
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
} from "./embedding";

export {
  search,
  configureSearch,
  invalidateChunkCache,
  clearChunkCache,
} from "./search";

// Tokenizer exports
export { tokenize, tokenizeQuery, getTokenFrequencies } from "./tokenizer";

// Inverted index exports
export {
  buildInvertedIndex,
  searchInvertedIndex,
  getMatchingDocIds,
  getIntersectingDocIds,
  getIndexStats,
} from "./inverted-index";
export type {
  Posting,
  IndexEntry,
  DocMeta,
  InvertedIndex,
} from "./inverted-index";

export { vectorizeBook } from "./vectorize";
export type { VectorizeCallback } from "./vectorize";

export { triggerVectorizeBook } from "./vectorize-trigger";
export type {
  VectorizeStatusCallback,
  VectorizeTriggerConfig,
  VectorizeTriggerCallbacks,
} from "./vectorize-trigger";

export {
  setVectorDB,
  getVectorDB,
  hasVectorDB,
} from "./vector-db";
export type {
  IVectorDB,
  VectorRecord,
  VectorSearchResult,
} from "./vector-db";
