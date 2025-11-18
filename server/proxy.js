import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';

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
const PORT = process.env.QDRANT_PROXY_PORT || 8787;
const upstreamBase = process.env.QDRANT_UPSTREAM_URL;
const upstreamApiKey = process.env.QDRANT_API_KEY;

if (!upstreamBase || !upstreamApiKey) {
  console.error('QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set before starting the proxy.');
  process.exit(1);
}

// Validate that QDRANT_UPSTREAM_URL is not localhost (Railway blocks localhost connections)
const urlLower = upstreamBase.toLowerCase();
if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1') || urlLower.includes(':6333')) {
  console.error('ERROR: QDRANT_UPSTREAM_URL cannot be localhost or use port 6333. Railway blocks localhost connections.');
  console.error('Please use your Qdrant Cloud URL (e.g., https://your-cluster.qdrant.io)');
  console.error('Current QDRANT_UPSTREAM_URL:', upstreamBase);
  process.exit(1);
}

const sanitizeBase = (url) => url.endsWith('/') ? url.slice(0, -1) : url;
const baseUrl = sanitizeBase(upstreamBase);

// Validate URL format
let validatedUrl;
try {
  validatedUrl = new URL(baseUrl);
} catch (error) {
  console.error('ERROR: QDRANT_UPSTREAM_URL is not a valid URL:', baseUrl);
  process.exit(1);
}

// Log the URL being used to ensure transparency
console.log('[Qdrant Proxy] Using QDRANT_UPSTREAM_URL:', baseUrl);
console.log('[Qdrant Proxy] URL Protocol:', validatedUrl.protocol);
console.log('[Qdrant Proxy] URL Host:', validatedUrl.host);

// CRITICAL: Ensure we're using the environment variable URL, never hardcoded localhost
if (validatedUrl.hostname === 'localhost' || validatedUrl.hostname === '127.0.0.1' || validatedUrl.port === '6333') {
  console.error('ERROR: QDRANT_UPSTREAM_URL resolves to localhost or port 6333:', baseUrl);
  console.error('This will not work in production. Please set QDRANT_UPSTREAM_URL to your Qdrant Cloud URL.');
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

const forwardRequest = async (req, res) => {
  try {
    const upstreamPath = getUpstreamPath(req.originalUrl);
    // CRITICAL: Always use baseUrl from QDRANT_UPSTREAM_URL environment variable
    // Never use localhost:6333 or any hardcoded URL
    const upstreamUrl = `${baseUrl}${upstreamPath}`;
    
    // Safety check - ensure we're not accidentally using localhost
    if (upstreamUrl.includes('localhost') || upstreamUrl.includes('127.0.0.1') || upstreamUrl.includes(':6333')) {
      console.error('[Qdrant Proxy] CRITICAL ERROR: Attempted to forward to localhost or port 6333:', upstreamUrl);
      console.error('[Qdrant Proxy] baseUrl should come from QDRANT_UPSTREAM_URL:', baseUrl);
      res.status(500).json({ 
        error: 'Configuration Error', 
        details: 'Server is configured to forward to localhost. Please set QDRANT_UPSTREAM_URL to a valid Qdrant Cloud URL.',
        attemptedUrl: upstreamUrl
      });
      return;
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'api-key': upstreamApiKey,
    };
    
    // Log the target URL for transparency
    if (shouldLogProxy) {
      console.log(`[Qdrant Proxy] Forwarding to: ${upstreamUrl}`);
      console.log(`[Qdrant Proxy] Base URL (from QDRANT_UPSTREAM_URL): ${baseUrl}`);
    }

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

    const response = await fetch(upstreamUrl, init);
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
    console.error('[Qdrant Proxy] Error forwarding request:', error);
    res.status(500).json({ error: 'Proxy request failed', details: error.message });
  }
};

app.use('/qdrant', forwardRequest);

app.use((req, res, next) => {
  if (req.path === '/healthz') return next();
  return forwardRequest(req, res);
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`[Qdrant Proxy] Listening on port ${PORT}, forwarding to ${baseUrl}`);
});
