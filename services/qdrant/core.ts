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
  
  // If URL doesn't have a protocol, it's relative - convert to absolute
  // This happens in production when vite.config.ts sets QDRANT_URL to '/qdrant'
  if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // In browser, use window.location.origin to get the full URL
    if (typeof window !== 'undefined' && window.location) {
      const origin = window.location.origin;
      const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      trimmed = `${origin}${path}`;
      console.log('[Qdrant Core] Converted relative URL to absolute:', raw, '->', trimmed);
    } else {
      // In Node.js environment or if window is not available yet, this shouldn't happen in production
      // But we'll log a warning and try to use a fallback
      console.warn('[Qdrant Core] Relative URL detected but window.location not available. Raw URL:', raw);
      // For production builds, we should never hit this, but if we do, use the current host
      if (typeof window !== 'undefined') {
        // Try to get origin from window if available
        try {
          const origin = window.location?.origin || (window.location?.protocol && window.location?.host 
            ? `${window.location.protocol}//${window.location.host}` 
            : 'https://localhost');
          const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
          trimmed = `${origin}${path}`;
          console.log('[Qdrant Core] Fallback URL conversion:', raw, '->', trimmed);
        } catch (e) {
          console.error('[Qdrant Core] Failed to convert relative URL, using localhost fallback:', e);
          trimmed = `http://localhost:8787${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
        }
      } else {
        // Node.js environment fallback
        trimmed = `http://localhost:8787${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
      }
    }
  }
  
  return trimmed;
};

// Get the raw URL from environment
const getRawQdrantUrl = (): string | null => {
  return process.env.QDRANT_URL || 
         process.env.QDRANT_PROXY_URL || 
         'http://localhost:8787/qdrant';
};

// Initialize Qdrant client with proper URL resolution
// Use a function to ensure window.location is available when called
const initializeQdrantClient = (): QdrantClient | null => {
  const rawUrl = getRawQdrantUrl();
  const normalizedUrl = normalizeQdrantUrl(rawUrl);
  
  if (!normalizedUrl) {
    console.error('[Qdrant Core] No Qdrant URL provided');
    return null;
  }

  // Validate that the URL has a protocol
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    console.error('[Qdrant Core] Invalid Qdrant URL - must start with http:// or https://:', normalizedUrl);
    return null;
  }

  try {
    // Validate URL format
    new URL(normalizedUrl);
    console.log('[Qdrant Core] Initializing Qdrant client with URL:', normalizedUrl);
    return new QdrantClient({ url: normalizedUrl });
  } catch (error) {
    console.error('[Qdrant Core] Failed to create Qdrant client - invalid URL:', normalizedUrl, error);
    return null;
  }
};

// Initialize the client - this will be called when the module loads
// In browser, window.location should be available by the time this module is imported
export const qdrantClient = initializeQdrantClient();

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

