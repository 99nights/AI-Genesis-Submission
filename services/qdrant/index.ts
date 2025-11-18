/**
 * Qdrant Service - Main Export
 * 
 * Centralized exports for all Qdrant-related services.
 * This maintains backward compatibility while using the new modular structure.
 */

// Core exports
export {
  qdrantClient,
  activeShopId,
  activeShopName,
  activeShopEmail,
  activeShopLocation,
  activeNamespace,
  setActiveShopContext,
  type ActiveShopContextType,
  BASE_COLLECTIONS,
  type CollectionKey,
  UUID_NAMESPACE,
  VECTOR_CONFIG,
} from './core';

// Collection management
export {
  ensureCollection,
  ensureBaseCollections,
  ensureReadyOrWarn,
  isCollectionReady,
  getCollectionVectorConfig,
  getQdrantDiagnostics,
  type QdrantLogEntry,
  type QdrantLogLevel,
  COLLECTION_PAYLOAD_INDEXES,
  type PayloadIndexDefinition,
} from './collections';

// Vector utilities
export {
  composePointId,
  buildPlaceholderVector,
  resolveVector,
  composePointVectorPayload,
  composeQueryVector,
} from './vectors';

// Query utilities
export {
  fetchAllPoints,
  searchWithFilters,
} from './queries';

// Services
export * from './services/products';
export * from './services/inventory';
export * from './services/sales';
export * from './services/batches';
export * from './services/users';
export * from './services/marketplace';
export * from './services/ocr';
export * from './services/helpers';
export * from './services/dataLoader';

// Re-export for backward compatibility
export { getCanonicalProducts as fetchCanonicalProducts } from './services/products';

