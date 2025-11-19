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
  
  // Detect and warn about localhost:6333 (default Qdrant port) - this won't work in production
  if (trimmed.includes(':6333') || trimmed.includes('localhost:6333') || trimmed.includes('127.0.0.1:6333')) {
    console.warn('[Qdrant Core] Detected port 6333 in URL - this is the default Qdrant port and may not work in production:', trimmed);
  }
  
  // If the URL doesn't start with http:// or https://, it's a relative URL
  // Convert it to an absolute URL using the current origin
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

// Lazy initialization - create client only when first accessed
// This ensures window.location is always available when the URL is normalized
let _qdrantClient: QdrantClient | null = null;
let _initializationAttempted = false;

const initializeQdrantClient = (): QdrantClient | null => {
  // If already initialized, return it
  if (_qdrantClient) {
    return _qdrantClient;
  }

  // If we've already tried and failed, don't retry
  if (_initializationAttempted) {
    return null;
  }

  _initializationAttempted = true;

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
    const urlObj = new URL(normalizedUrl);
    console.log('[Qdrant Core] Initializing Qdrant client with URL:', normalizedUrl);
    console.log('[Qdrant Core] URL breakdown - protocol:', urlObj.protocol, 'host:', urlObj.host, 'pathname:', urlObj.pathname);
    
    // Ensure the URL ends with /qdrant for the proxy route
    // The QdrantClient will append paths like /collections, so we need /qdrant as the base
    let finalUrl = normalizedUrl;
    if (!finalUrl.endsWith('/qdrant') && !finalUrl.endsWith('/qdrant/')) {
      // If the path doesn't end with /qdrant, ensure it does
      const url = new URL(normalizedUrl);
      if (url.pathname === '/' || url.pathname === '') {
        url.pathname = '/qdrant';
      } else if (!url.pathname.endsWith('/qdrant')) {
        url.pathname = url.pathname.replace(/\/$/, '') + '/qdrant';
      }
      finalUrl = url.toString();
      console.log('[Qdrant Core] Adjusted URL to ensure /qdrant path:', finalUrl);
    }
    
    // CRITICAL FIX: QdrantClient extracts hostname and port from URL, and defaults to port 6333 if no port is specified
    // For HTTPS URLs without explicit port, we need to explicitly set port 443 OR use the pathname as prefix
    // The best approach is to ensure the pathname is preserved by using it as the prefix parameter
    const parsedFinalUrl = new URL(finalUrl);
    const pathname = parsedFinalUrl.pathname || '';
    
    // If there's a pathname (like /qdrant), use it as prefix to preserve it
    // Otherwise QdrantClient will lose it and default to port 6333
    const clientConfig: { url: string; prefix?: string } = { url: finalUrl };
    
    // IMPORTANT: For Vercel deployment, the URL has no explicit port, so QdrantClient defaults to 6333
    // We need to explicitly construct the URL with the pathname OR use prefix
    // Since QdrantClient doesn't preserve pathname from URL, we must either:
    // 1. Use prefix (but pathname can't be used with prefix - see QdrantClient source)
    // 2. Ensure the URL includes a port (for HTTPS, port 443 is implicit but must be explicit in URL)
    // 
    // Solution: Reconstruct URL with explicit port based on protocol
    if (parsedFinalUrl.port === '' && pathname) {
      // URL has no explicit port - QdrantClient will default to 6333!
      // We need to construct a URL that preserves the pathname
      // Since QdrantClient extracts hostname/port but loses pathname, we need a different approach
      
      // Actually, looking at QdrantClient source more carefully:
      // - It uses pathname for prefix validation, not for constructing the URI
      // - The URI is constructed as: scheme://host:port/prefix
      // - So we need to ensure pathname is empty and use prefix instead
      
      // Extract just the origin (protocol + host)
      const origin = `${parsedFinalUrl.protocol}//${parsedFinalUrl.host}`;
      // Use the pathname as prefix
      const prefixPath = pathname.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
      
      if (prefixPath) {
        // Use host/port from origin and prefix for the path
        // For HTTPS, we need to explicitly not include port (or use 443) to avoid default 6333
        // But actually, the issue is that QdrantClient will parse the URL and extract port=null, then default to 6333
        // So we need to ensure the URL string itself has a port OR we use host/prefix pattern
        
        // Best solution: Use host + port (explicit 443 for HTTPS) + prefix
        const isHttps = parsedFinalUrl.protocol === 'https:';
        const explicitPort = isHttps ? ':443' : '';
        const baseUrl = `${parsedFinalUrl.protocol}//${parsedFinalUrl.hostname}${explicitPort}`;
        
        _qdrantClient = new QdrantClient({ 
          url: baseUrl,
          prefix: prefixPath,
        });
        
        console.log('[Qdrant Core] Using host+prefix pattern to avoid port 6333 default:', { baseUrl, prefix: prefixPath });
      } else {
        // No pathname, just use URL with explicit port
        const isHttps = parsedFinalUrl.protocol === 'https:';
        if (isHttps && !parsedFinalUrl.port) {
          // Explicitly set port 443 for HTTPS to prevent default 6333
          const urlWithPort = new URL(finalUrl);
          urlWithPort.port = '443';
          _qdrantClient = new QdrantClient({ url: urlWithPort.toString() });
          console.log('[Qdrant Core] Added explicit port 443 to prevent default 6333');
        } else {
          _qdrantClient = new QdrantClient(clientConfig);
        }
      }
    } else {
      // URL has explicit port, use as-is
      _qdrantClient = new QdrantClient(clientConfig);
    }
    
    // Verify the client was created successfully and log the actual URL it's using
    // The QdrantClient library stores the URL internally, so we can't directly access it
    // But we can test it by making a simple request
    console.log('[Qdrant Core] QdrantClient created successfully with URL:', finalUrl);
    console.log('[Qdrant Core] Client will make requests to:', finalUrl + '/collections');
    
    return _qdrantClient;
  } catch (error) {
    console.error('[Qdrant Core] Failed to create Qdrant client - invalid URL:', normalizedUrl, error);
    return null;
  }
};

// Export a proxy that lazily initializes the client on first access
// This ensures window.location is available when URL normalization happens
export const qdrantClient = new Proxy({} as QdrantClient | null, {
  get(target, prop) {
    const client = initializeQdrantClient();
    if (!client) {
      return undefined;
    }
    // Forward all property access to the actual client
    const value = (client as any)[prop];
    // If it's a function, bind it to the client
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
  has(target, prop) {
    const client = initializeQdrantClient();
    if (!client) {
      return false;
    }
    return prop in client;
  },
  ownKeys(target) {
    const client = initializeQdrantClient();
    if (!client) {
      return [];
    }
    return Object.keys(client);
  }
}) as QdrantClient | null;

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

