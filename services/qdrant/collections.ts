/**
 * Collection Management
 * 
 * Handles collection initialization, verification, and payload index management.
 * Does NOT recreate collections - assumes they exist or are created via setup script.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { qdrantClient, CollectionKey, BASE_COLLECTIONS, VECTOR_CONFIG } from './core';
import type { PayloadSchemaParams } from '@qdrant/js-client-rest';

export type PayloadIndexDefinition = Record<string, PayloadSchemaParams>;

// Payload index definitions for all collections
export const COLLECTION_PAYLOAD_INDEXES: Partial<Record<CollectionKey, PayloadIndexDefinition>> = {
  users: {
    userId: { type: 'keyword' },
    displayName: { type: 'keyword' },
    contactEmail: { type: 'keyword' },
    email: { type: 'keyword' },
    shopId: { type: 'keyword' },
    isVerified: { type: 'bool' },
    isDriverVerified: { type: 'bool' },
  },
  shops: {
    shopId: { type: 'keyword' },
    userId: { type: 'keyword' },
    name: { type: 'keyword' },
  },
  suppliers: {
    supplierId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    linkedUserId: { type: 'keyword' },
    name: { type: 'keyword' },
  },
  products: {
    productId: { type: 'keyword' },
    category: { type: 'keyword' },
    manufacturer: { type: 'keyword' },
    defaultSupplierId: { type: 'keyword' },
  },
  items: {
    inventoryUuid: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    batchId: { type: 'keyword' },
    supplierId: { type: 'keyword' },
    status: { type: 'keyword' },
    quantity: { type: 'integer' },
    expiration: { type: 'keyword' },
  },
  batches: {
    batchId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    supplierId: { type: 'keyword' },
    deliveryDate: { type: 'keyword' },
    inventoryDate: { type: 'keyword' },
  },
  sales: {
    saleId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    timestamp: { type: 'keyword' },
  },
  customers: {
    customerId: { type: 'keyword' },
    userId: { type: 'keyword' },
    name: { type: 'keyword' },
  },
  drivers: {
    driverId: { type: 'keyword' },
    userId: { type: 'keyword' },
    status: { type: 'keyword' },
  },
  visual: {
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    fieldName: { type: 'keyword' },
  },
  marketplace: {
    listingId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
  },
  dan_inventory: {
    inventoryUuid: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    productName: { type: 'keyword' },
    locationBucket: { type: 'keyword' },
    shareScope: { type: 'keyword' },
    expirationDate: { type: 'keyword' },
  },
};

// Collection state tracking
const collectionState = new Map<CollectionKey, { 
  ready: boolean; 
  promise: Promise<boolean> | null;
  vectorConfig: { named: boolean; vectorName: string | null } | null;
}>();

// Logging
export type QdrantLogLevel = 'info' | 'warn' | 'error';
export type QdrantLogEntry = {
  level: QdrantLogLevel;
  message: string;
  timestamp: string;
};

const QDRANT_LOG_LIMIT = 200;
const qdrantLogBuffer: QdrantLogEntry[] = [];

const describeError = (error: any): string => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message || error.statusText || JSON.stringify(error);
};

const pushQdrantLog = (level: QdrantLogLevel, message: string) => {
  const entry: QdrantLogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  qdrantLogBuffer.push(entry);
  if (qdrantLogBuffer.length > QDRANT_LOG_LIMIT) {
    qdrantLogBuffer.shift();
  }
  const formatted = `[Qdrant] ${message}`;
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.info(formatted);
  }
};

export const getQdrantDiagnostics = (): QdrantLogEntry[] => [...qdrantLogBuffer];

// Analyze vector configuration from collection info
const analyzeVectorConfig = (raw: any): {
  params: { size: number; distance: string } | null;
  named: boolean;
  vectorName: string | null;
} => {
  if (!raw) return { params: null, named: false, vectorName: null };
  if (typeof raw.size === 'number') {
    return { params: raw, named: false, vectorName: null };
  }

  const keys = Object.keys(raw || {});
  if ('default' in raw && raw.default && typeof raw.default.size === 'number') {
    const hasExtra = keys.some(key => key !== 'default');
    return {
      params: raw.default,
      named: hasExtra,
      vectorName: hasExtra ? 'default' : null,
    };
  }

  if (keys.length >= 1) {
    const preferred = keys.find(key => raw[key] && typeof raw[key].size === 'number');
    if (preferred) {
      return {
        params: raw[preferred],
        named: preferred !== 'default',
        vectorName: preferred,
      };
    }
  }

  return { params: null, named: true, vectorName: null };
};

// Ensure payload indexes exist
const ensurePayloadIndexes = async (name: CollectionKey): Promise<boolean> => {
  if (!qdrantClient) return false;
  const definitions = COLLECTION_PAYLOAD_INDEXES[name];
  if (!definitions) return true;

  try {
    const result = await qdrantClient.getCollection(name);
    const existingSchema = result?.payload_schema || {};

    for (const [field, schema] of Object.entries(definitions)) {
      const existingField = existingSchema?.[field];
      const existingType = existingField?.data_type;
      
      // Skip if index already exists with correct type
      if (existingType === schema.type) continue;

      // Delete existing index if type is wrong
      if (existingField && existingType !== schema.type) {
        try {
          await qdrantClient.deletePayloadIndex(name, field);
          pushQdrantLog('info', `Deleted existing index '${name}.${field}' (wrong type)`);
        } catch (deleteError: any) {
          pushQdrantLog('warn', `Failed to delete index '${name}.${field}': ${describeError(deleteError)}`);
        }
      }

      // Create new index
      try {
        await qdrantClient.createPayloadIndex(name, {
          field_name: field,
          field_schema: schema,
        });
        pushQdrantLog('info', `Created index '${name}.${field}' (${schema.type})`);
      } catch (createError: any) {
        pushQdrantLog('error', `Failed to create index '${name}.${field}': ${describeError(createError)}`);
      }
    }

    return true;
  } catch (error) {
    pushQdrantLog('error', `Failed to ensure indexes for '${name}': ${describeError(error)}`);
    return false;
  }
};

// Verify collection exists and has correct configuration
const verifyCollection = async (name: CollectionKey): Promise<{
  exists: boolean;
  valid: boolean;
  vectorConfig: { named: boolean; vectorName: string | null } | null;
}> => {
  if (!qdrantClient) {
    return { exists: false, valid: false, vectorConfig: null };
  }

  try {
    const result = await qdrantClient.getCollection(name);
    const { params, named, vectorName } = analyzeVectorConfig(result?.config?.params?.vectors);
    
    const valid = params?.size === VECTOR_CONFIG.size && 
                  params?.distance === VECTOR_CONFIG.distance;

    const vectorConfig = valid ? { named, vectorName: named ? (vectorName || 'default') : null } : null;

    return {
      exists: true,
      valid,
      vectorConfig,
    };
  } catch (error: any) {
    if (error.status === 404) {
      return { exists: false, valid: false, vectorConfig: null };
    }
    pushQdrantLog('error', `Error verifying collection '${name}': ${describeError(error)}`);
    return { exists: false, valid: false, vectorConfig: null };
  }
};

// Ensure collection is ready (exists and configured correctly)
export const ensureCollection = async (name: CollectionKey): Promise<boolean> => {
  if (!qdrantClient) return false;

  // Check if already ready
  const state = collectionState.get(name);
  if (state?.ready) return true;
  if (state?.promise) return state.promise;

  // Initialize state
  if (!state) {
    collectionState.set(name, { ready: false, promise: null, vectorConfig: null });
  }

  const promise = (async () => {
    try {
      // Verify collection exists and is valid
      const { exists, valid, vectorConfig } = await verifyCollection(name);

      if (!exists) {
        pushQdrantLog('error', `Collection '${name}' does not exist. Please run setup script first.`);
        collectionState.set(name, { ready: false, promise: null, vectorConfig: null });
        return false;
      }

      if (!valid) {
        pushQdrantLog('error', 
          `Collection '${name}' has invalid configuration. ` +
          `Expected: size=${VECTOR_CONFIG.size}, distance=${VECTOR_CONFIG.distance}`
        );
        collectionState.set(name, { ready: false, promise: null, vectorConfig: null });
        return false;
      }

      // Store vector config
      collectionState.set(name, { ready: false, promise: null, vectorConfig });

      // Ensure indexes
      const indexesReady = await ensurePayloadIndexes(name);
      
      if (indexesReady) {
        collectionState.set(name, { ready: true, promise: null, vectorConfig });
        pushQdrantLog('info', `Collection '${name}' is ready`);
        return true;
      } else {
        collectionState.set(name, { ready: false, promise: null, vectorConfig });
        return false;
      }
    } catch (error: any) {
      pushQdrantLog('error', `Failed to ensure collection '${name}': ${describeError(error)}`);
      collectionState.set(name, { ready: false, promise: null, vectorConfig: null });
      return false;
    } finally {
      // Clear promise
      const currentState = collectionState.get(name);
      if (currentState) {
        currentState.promise = null;
      }
    }
  })();

  collectionState.set(name, { ready: false, promise, vectorConfig: null });
  return promise;
};

// Ensure all base collections are ready
export const ensureBaseCollections = async (): Promise<void> => {
  if (!qdrantClient) {
    pushQdrantLog('warn', 'Qdrant client not available');
    return;
  }

  pushQdrantLog('info', 'Ensuring all base collections are ready...');

  const results = await Promise.allSettled(
    BASE_COLLECTIONS.map(name => ensureCollection(name))
  );

  const ready: string[] = [];
  const failed: string[] = [];

  results.forEach((res, i) => {
    const name = BASE_COLLECTIONS[i];
    if (res.status === 'fulfilled' && res.value) {
      ready.push(name);
    } else {
      failed.push(name);
      const reason = res.status === 'rejected' ? describeError(res.reason) : 'Not ready';
      pushQdrantLog('warn', `Collection '${name}' failed: ${reason}`);
    }
  });

  pushQdrantLog(
    'info',
    `Collections ready: ${ready.length}/${BASE_COLLECTIONS.length}. ` +
    `Ready: ${ready.join(', ')}${failed.length > 0 ? ` | Failed: ${failed.join(', ')}` : ''}`
  );
};

// Get collection vector config
export const getCollectionVectorConfig = (name: CollectionKey): { named: boolean; vectorName: string | null } | null => {
  return collectionState.get(name)?.vectorConfig || null;
};

// Check if collection is ready (lightweight check)
export const isCollectionReady = (name: CollectionKey): boolean => {
  return collectionState.get(name)?.ready || false;
};

// Ensure collection is ready or warn
export const ensureReadyOrWarn = async (collection: CollectionKey): Promise<boolean> => {
  const ready = await ensureCollection(collection);
  if (!ready) {
    pushQdrantLog('warn', `Collection '${collection}' is not ready – operation will be skipped`);
  }
  return ready;
};

