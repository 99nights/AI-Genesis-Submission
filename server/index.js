import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { QdrantClient } from '@qdrant/js-client-rest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = process.env.QDRANT_PROXY_ENV;
if (envPath) {
  config({ path: envPath });
} else {
  const result = config({ path: '.env.proxy' });
  if (result.error) {
    config();
  }
}

const app = express();
const PORT = process.env.PORT || 8787;
const NODE_ENV = process.env.NODE_ENV || 'development';

const upstreamBase = process.env.QDRANT_UPSTREAM_URL;
const upstreamApiKey = process.env.QDRANT_API_KEY;

if (!upstreamBase || !upstreamApiKey) {
  console.error('QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set before starting the server.');
  process.exit(1);
}

// Validate that QDRANT_UPSTREAM_URL is not localhost (Railway blocks localhost connections)
const urlLower = upstreamBase.toLowerCase();
if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1') || urlLower.startsWith('http://localhost') || urlLower.startsWith('http://127.0.0.1')) {
  console.error('ERROR: QDRANT_UPSTREAM_URL cannot be localhost. Railway blocks localhost connections.');
  console.error('Please use your Qdrant Cloud URL (e.g., https://your-cluster.qdrant.io)');
  process.exit(1);
}

const sanitizeBase = (url) => url.endsWith('/') ? url.slice(0, -1) : url;
const baseUrl = sanitizeBase(upstreamBase);

// Validate URL format
try {
  new URL(baseUrl);
} catch (error) {
  console.error('ERROR: QDRANT_UPSTREAM_URL is not a valid URL:', baseUrl);
  process.exit(1);
}
const qdrantClient = new QdrantClient({
  url: baseUrl,
  apiKey: upstreamApiKey,
});
const PRODUCT_COLLECTION = process.env.QDRANT_PRODUCTS_COLLECTION || 'products';
const VECTOR_NAME = process.env.QDRANT_VECTOR_NAME || 'embedding';
const VECTOR_KEY = VECTOR_NAME || 'embedding';
const VECTOR_SIZE = Number(process.env.QDRANT_VECTOR_SIZE || '768');

const proxyLogMode = process.env.QDRANT_PROXY_LOG || 'summary';
const shouldLogProxy = proxyLogMode !== 'none';
const verboseProxyLogging = proxyLogMode === 'verbose';

const summarizePointsPayload = (body) => {
  if (!body || typeof body !== 'object') return '';
  const points = Array.isArray(body.points) ? body.points : null;
  if (!points || points.length === 0) return '';
  const first = points[0] || {};
  let vectorInfo = '';
  if (Array.isArray(first.vector)) {
    vectorInfo = ` vectorLen=${first.vector.length}`;
  } else if (first.vectors && typeof first.vectors === 'object') {
    const named = Object.entries(first.vectors).map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:${value.length}`;
      if (value && Array.isArray(value.values)) return `${key}:${value.values.length}`;
      return `${key}:n/a`;
    }).join(',');
    vectorInfo = ` vectors={${named}}`;
  }
  return ` points=${points.length}${vectorInfo}`;
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const withVectorStruct = (embedding) => {
  return { vectors: { [VECTOR_KEY]: embedding } };
};

const ensureProductsCollection = async () => {
  try {
    await qdrantClient.getCollection(PRODUCT_COLLECTION);
  } catch (error) {
    console.log(`[Qdrant Proxy] Creating collection '${PRODUCT_COLLECTION}'`);
    await qdrantClient.createCollection(PRODUCT_COLLECTION, {
      vectors: {
        [VECTOR_KEY]: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
      },
    });
  }

  const ensureIndex = async (field_name, field_schema) => {
    try {
      await qdrantClient.createPayloadIndex(PRODUCT_COLLECTION, {
        field_name,
        field_schema,
      });
    } catch (error) {
      if (error?.status !== 409) {
        console.warn(`[Qdrant Proxy] Failed to create payload index for ${field_name}:`, error?.message || error);
      }
    }
  };

  await ensureIndex('shop_id', { type: 'keyword' });
  await ensureIndex('category', { type: 'keyword' });
  await ensureIndex('brand', { type: 'keyword' });
  await ensureIndex('expiry_date', { type: 'integer' });
  await ensureIndex('price', { type: 'float' });
  await ensureIndex('sale_start_date', { type: 'integer' });
  await ensureIndex('sale_end_date', { type: 'integer' });
};

ensureProductsCollection().catch((error) => {
  console.error('[Qdrant Proxy] Failed to ensure products collection:', error);
});

const buildSearchFilter = (shopId, filters = {}) => {
  const must = [{ key: 'shop_id', match: { value: shopId } }];
  if (filters.category) {
    must.push({ key: 'category', match: { value: filters.category } });
  }
  if (filters.brand) {
    must.push({ key: 'brand', match: { value: filters.brand } });
  }
  if (filters.expiryBefore || filters.expiryAfter) {
    const range = {};
    if (filters.expiryBefore) range.lte = filters.expiryBefore;
    if (filters.expiryAfter) range.gte = filters.expiryAfter;
    must.push({ key: 'expiry_date', range });
  }
  if (filters.onSale) {
    const now = Date.now();
    must.push({
      key: 'sale_start_date',
      range: { lte: now },
    });
    must.push({
      key: 'sale_end_date',
      range: { gte: now },
    });
  }
  return { must };
};

const validateEmbedding = (embedding) => {
  if (!Array.isArray(embedding) || embedding.length !== VECTOR_SIZE) return false;
  return embedding.every((value) => typeof value === 'number' && Number.isFinite(value));
};

// API Routes
app.post('/api/vector/products/upsert', async (req, res) => {
  const { shopId, items } = req.body || {};
  if (!shopId || typeof shopId !== 'string') {
    return res.status(400).json({ error: 'shopId is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  try {
    const points = items.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Invalid item at index ${idx}`);
      }
      const { id, embedding, payload } = item;
      if (id === undefined || id === null) {
        throw new Error(`Missing id for item at index ${idx}`);
      }
      if (!validateEmbedding(embedding)) {
        throw new Error(`Invalid embedding for item at index ${idx}`);
      }
      if (!payload || typeof payload !== 'object') {
        throw new Error(`Missing payload for item at index ${idx}`);
      }

      return {
        id,
        ...withVectorStruct(embedding),
        payload: { ...payload, shop_id: shopId },
      };
    });

    await qdrantClient.upsert(PRODUCT_COLLECTION, { wait: true, points });
    console.log(`[Qdrant Proxy] Upserted ${points.length} product vectors for shop ${shopId}`);
    res.json({ ok: true, upserted: points.length });
  } catch (error) {
    console.error('[Qdrant Proxy] Product upsert failed:', error);
    res.status(500).json({ error: 'Qdrant upsert failed', details: error.message });
  }
});

app.post('/api/vector/products/search', async (req, res) => {
  const { shopId, embedding, limit = 10, filters } = req.body || {};
  if (!shopId || typeof shopId !== 'string') {
    return res.status(400).json({ error: 'shopId is required' });
  }
  if (!validateEmbedding(embedding)) {
    return res.status(400).json({ error: `embedding must be an array of length ${VECTOR_SIZE}` });
  }

  try {
    const response = await qdrantClient.search(PRODUCT_COLLECTION, {
      vector: { name: VECTOR_KEY, vector: embedding },
      limit,
      with_payload: true,
      filter: buildSearchFilter(shopId, filters),
    });
    res.json({ results: response });
  } catch (error) {
    console.error('[Qdrant Proxy] Product search failed:', error);
    res.status(500).json({ error: 'Qdrant search failed', details: error.message });
  }
});

const getUpstreamPath = (url) => {
  if (!url || url === '/') return '/';
  if (url.startsWith('/qdrant')) {
    const stripped = url.replace(/^\/qdrant/, '');
    return stripped || '/';
  }
  return url;
};

// Create AbortController for timeout handling
const createFetchWithTimeout = (url, options, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
};

const forwardRequest = async (req, res) => {
  try {
    const upstreamPath = getUpstreamPath(req.originalUrl);
    const upstreamUrl = `${baseUrl}${upstreamPath}`;
    const headers = {
      'Content-Type': 'application/json',
      'api-key': upstreamApiKey,
      'User-Agent': 'Qdrant-Proxy/1.0',
    };

    const init = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      init.body = JSON.stringify(req.body);
    }

    if (shouldLogProxy) {
      const summary = summarizePointsPayload(req.body);
      console.log(`[Qdrant Proxy] → ${req.method} ${upstreamPath}${summary}`);
      if (verboseProxyLogging && req.body && Object.keys(req.body).length > 0) {
        console.dir(req.body, { depth: 4 });
      }
    }

    // Use timeout wrapper for Railway networking
    const response = await createFetchWithTimeout(upstreamUrl, init, 30000);
    const text = await response.text();

    if (shouldLogProxy) {
      if (response.ok && !verboseProxyLogging) {
        console.log(`[Qdrant Proxy] ← ${response.status}`);
      } else {
        const preview = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
        console.log(`[Qdrant Proxy] ← ${response.status} ${response.statusText || ''} | ${preview}`);
      }
    }

    res.status(response.status);
    res.set('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    // Enhanced error logging for Railway debugging
    const errorDetails = {
      message: error.message,
      name: error.name,
      code: error.code,
      upstreamUrl: baseUrl,
    };
    
    if (error.name === 'AbortError') {
      console.error('[Qdrant Proxy] Request timeout (30s) to Qdrant:', upstreamUrl);
      res.status(504).json({ 
        error: 'Gateway Timeout', 
        details: 'Request to Qdrant API timed out after 30 seconds',
        upstreamUrl: baseUrl,
      });
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('[Qdrant Proxy] Connection failed to Qdrant:', errorDetails);
      res.status(502).json({ 
        error: 'Bad Gateway', 
        details: `Cannot connect to Qdrant API at ${baseUrl}. Check QDRANT_UPSTREAM_URL environment variable.`,
        hint: 'Ensure QDRANT_UPSTREAM_URL points to a valid Qdrant Cloud URL (not localhost)',
      });
    } else {
      console.error('[Qdrant Proxy] Error forwarding request:', errorDetails);
      res.status(500).json({ 
        error: 'Proxy request failed', 
        details: error.message,
        upstreamUrl: baseUrl,
      });
    }
  }
};

// Qdrant proxy routes
app.use('/qdrant', forwardRequest);

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files in production
if (NODE_ENV === 'production') {
  const distPath = join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  
  // Handle SPA routing - serve index.html for all non-API routes
  app.use((req, res, next) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/qdrant') || req.path === '/healthz') {
      return next();
    }
    // Only handle GET requests for SPA routing
    if (req.method === 'GET') {
      res.sendFile(join(distPath, 'index.html'));
    } else {
      next();
    }
  });
}

// Test Qdrant connectivity on startup
const testQdrantConnection = async () => {
  try {
    console.log(`[Qdrant Proxy] Testing connection to ${baseUrl}...`);
    const testUrl = `${baseUrl}/collections`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'api-key': upstreamApiKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    
    if (response.ok || response.status === 401) {
      // 401 is OK - it means we can reach the server, just auth might be wrong
      console.log(`[Qdrant Proxy] ✓ Successfully connected to Qdrant at ${baseUrl}`);
    } else {
      console.warn(`[Qdrant Proxy] ⚠ Connection test returned status ${response.status}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[Qdrant Proxy] ✗ Connection timeout to ${baseUrl}`);
      console.error('[Qdrant Proxy] This may indicate a network issue or incorrect QDRANT_UPSTREAM_URL');
    } else {
      console.error(`[Qdrant Proxy] ✗ Failed to connect to ${baseUrl}:`, error.message);
      console.error('[Qdrant Proxy] Please verify QDRANT_UPSTREAM_URL is correct and accessible from Railway');
    }
    // Don't exit - let the server start and log errors on actual requests
  }
};

app.listen(PORT, async () => {
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Environment: ${NODE_ENV}`);
  if (NODE_ENV === 'production') {
    console.log(`[Server] Serving static files from dist/`);
  }
  console.log(`[Qdrant Proxy] Forwarding to ${baseUrl}`);
  
  // Test connection in background (don't block startup)
  testQdrantConnection().catch(() => {
    // Errors already logged in testQdrantConnection
  });
});

