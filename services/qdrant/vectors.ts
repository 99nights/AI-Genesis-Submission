/**
 * Vector Utilities
 * 
 * Handles vector creation, validation, and point ID generation.
 */

import { v5 as uuidv5 } from 'uuid';
import { CollectionKey, UUID_NAMESPACE, VECTOR_CONFIG } from './core';
import { getCollectionVectorConfig } from './collections';
import { EMBEDDING_VECTOR_SIZE } from '../embeddingService';

// Generate deterministic point ID
export const composePointId = (collectionName: CollectionKey, entityId: string | number): string => {
  return uuidv5(`${collectionName}:${entityId}`, UUID_NAMESPACE);
};

// Build placeholder vector (for collections that don't need semantic search)
export const buildPlaceholderVector = (seed: string | number): number[] => {
  const safeSeed = String(seed || 'default');
  const vector = new Array(EMBEDDING_VECTOR_SIZE).fill(0);
  // Simple hash to make placeholder vectors somewhat unique based on seed
  for (let i = 0; i < EMBEDDING_VECTOR_SIZE; i++) {
    vector[i] = ((safeSeed.charCodeAt(i % safeSeed.length) || 0) % 100) / 1000; // Small values
  }
  return vector;
};

// Validate and resolve vector (with fallback to placeholder)
export const resolveVector = (
  candidate: number[] | null | undefined,
  fallbackSeed: string | number,
  context: string
): number[] => {
  const buildFallback = () => buildPlaceholderVector(fallbackSeed);
  
  if (!Array.isArray(candidate)) {
    return buildFallback();
  }
  
  if (candidate.length !== EMBEDDING_VECTOR_SIZE) {
    console.warn(`[Qdrant] ${context}: Vector length ${candidate.length} != ${EMBEDDING_VECTOR_SIZE}. Using placeholder.`);
    return buildFallback();
  }
  
  for (let i = 0; i < candidate.length; i++) {
    const value = candidate[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      console.warn(`[Qdrant] ${context}: Invalid vector value at index ${i}: ${value}. Using placeholder.`);
      return buildFallback();
    }
  }
  
  return candidate;
};

// Compose point vector payload (handles named vs unnamed vectors)
export const composePointVectorPayload = (collection: CollectionKey, vector: number[]) => {
  const config = getCollectionVectorConfig(collection);
  if (config?.named) {
    const vectorName = config.vectorName || 'default';
    return {
      vectors: {
        [vectorName]: vector,
      },
    };
  }
  return { vector };
};

// Compose query vector (for search operations)
export const composeQueryVector = (
  collection: CollectionKey,
  vector: number[]
): number[] | { name: string; vector: number[] } => {
  const config = getCollectionVectorConfig(collection);
  if (config?.named) {
    const vectorName = config.vectorName || 'default';
    return { name: vectorName, vector };
  }
  return vector;
};

