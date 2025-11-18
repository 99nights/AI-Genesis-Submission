/**
 * Core Qdrant Configuration and Client
 * 
 * Provides the Qdrant client instance and core configuration constants.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { EMBEDDING_VECTOR_SIZE } from '../embeddingService';

// Collection names
export const BASE_COLLECTIONS = [
  'users',
  'shops',
  'customers',
  'suppliers',
  'products',
  'items',
  'inventory',
  'batches',
  'sales',
  'drivers',
  'visual',
  'marketplace',
  'dan_inventory',
] as const;

export type CollectionKey = typeof BASE_COLLECTIONS[number];

// UUID namespace for deterministic point IDs
export const UUID_NAMESPACE = '58fc3ff2-2f13-11ef-b75e-0242ac110002';

// Vector configuration
export const VECTOR_CONFIG = {
  size: EMBEDDING_VECTOR_SIZE,
  distance: 'Cosine' as const,
} as const;

// Normalize Qdrant URL - convert relative URLs to absolute URLs
const normalizeQdrantUrl = (raw?: string | null): string | null => {
  if (!raw) return null;
  let trimmed = raw.trim();
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  
  // If the URL doesn't start with http:// or https://, it's a relative URL
  // Convert it to an absolute URL using the current origin
  if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // In browser environment, use window.location.origin
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      // Remove leading slash if present to avoid double slashes
      const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      trimmed = `${origin}${path}`;
    } else {
      // In Node.js environment, this shouldn't happen, but fallback to localhost
      console.warn('[Qdrant Core] Relative URL in non-browser environment, using localhost fallback');
      trimmed = `http://localhost:8787${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
    }
  }
  
  return trimmed;
};

// Initialize Qdrant client
const qdrantUrl = normalizeQdrantUrl(
  process.env.QDRANT_URL || 
  process.env.QDRANT_PROXY_URL || 
  'http://localhost:8787/qdrant'
);

// Validate URL format before creating client
let qdrantClient: QdrantClient | null = null;
if (qdrantUrl) {
  try {
    // Validate that the URL has a protocol
    if (!qdrantUrl.startsWith('http://') && !qdrantUrl.startsWith('https://')) {
      console.error('[Qdrant Core] Invalid Qdrant URL - must start with http:// or https://:', qdrantUrl);
    } else {
      // Validate URL format
      new URL(qdrantUrl);
      qdrantClient = new QdrantClient({ url: qdrantUrl });
    }
  } catch (error) {
    console.error('[Qdrant Core] Failed to create Qdrant client - invalid URL:', qdrantUrl, error);
  }
}

export { qdrantClient };

// Active shop context (shared state)
export let activeShopId: string | null = null;
export let activeShopName: string | null = null;
export let activeShopEmail: string | null = null;
export let activeShopLocation: string | null = null;
export let activeNamespace: string | null = null;

export interface ActiveShopContextType {
  id: string;
  name?: string | null;
  contactEmail?: string | null;
  location?: string | null;
  qdrantNamespace?: string | null;
}

export const setActiveShopContext = (shop: ActiveShopContextType | null) => {
  const previousShopId = activeShopId;
  activeShopId = shop?.id || null;
  activeShopName = shop?.name || null;
  activeShopEmail = shop?.contactEmail || null;
  activeShopLocation = shop?.location || null;
  activeNamespace = shop?.qdrantNamespace || null;
  
  if (previousShopId !== activeShopId) {
    console.log(`[Core] setActiveShopContext: ${previousShopId || 'null'} -> ${activeShopId || 'null'}`);
  }
};

