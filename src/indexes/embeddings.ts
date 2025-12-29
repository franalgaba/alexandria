/**
 * Embedding generation using Xenova Transformers
 * Uses all-MiniLM-L6-v2 for 384-dimensional embeddings
 */

import { type FeatureExtractionPipeline, pipeline } from '@xenova/transformers';

let embedder: FeatureExtractionPipeline | null = null;
let isLoading = false;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Get or initialize the embedding model
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) {
    return embedder;
  }

  if (loadPromise) {
    return loadPromise;
  }

  isLoading = true;
  loadPromise = pipeline('feature-extraction', MODEL_NAME);

  try {
    embedder = await loadPromise;
    return embedder;
  } finally {
    isLoading = false;
    loadPromise = null;
  }
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const embed = await getEmbedder();

  // Truncate text if too long (model has max sequence length)
  const truncated = text.slice(0, 8000);

  const result = await embed(truncated, { pooling: 'mean', normalize: true });

  // Extract the embedding data
  const data = result.data as Float32Array;
  return new Float32Array(data);
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const embed = await getEmbedder();

  // Truncate texts
  const truncated = texts.map((t) => t.slice(0, 8000));

  const results = await embed(truncated, { pooling: 'mean', normalize: true });

  // Handle batch results
  const embeddings: Float32Array[] = [];
  const data = results.data as Float32Array;

  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    const end = start + EMBEDDING_DIM;
    embeddings.push(new Float32Array(data.slice(start, end)));
  }

  return embeddings;
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}

/**
 * Check if the model is loaded
 */
export function isModelLoaded(): boolean {
  return embedder !== null;
}

/**
 * Check if the model is currently loading
 */
export function isModelLoading(): boolean {
  return isLoading;
}

/**
 * Preload the model (useful at startup)
 */
export async function preloadModel(): Promise<void> {
  await getEmbedder();
}
