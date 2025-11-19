/**
 * Vercel Serverless Function - Qdrant Proxy for deeply nested paths
 * 
 * This handles /qdrant/collections/{name}/points/* requests (e.g., /qdrant/collections/items/points/scroll)
 * Vercel's catch-all routes need explicit nested routes for paths with 3+ segments
 */

export default async function handler(req, res) {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, api-key');

  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const upstreamBase = process.env.QDRANT_UPSTREAM_URL;
  const upstreamApiKey = process.env.QDRANT_API_KEY;

  if (!upstreamBase || !upstreamApiKey) {
    console.error('[Qdrant Proxy] Missing environment variables');
    return res.status(500).json({ 
      error: 'Proxy configuration error',
      details: 'QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set in Vercel environment variables'
    });
  }

  // Sanitize upstream URL
  const baseUrl = upstreamBase.endsWith('/') ? upstreamBase.slice(0, -1) : upstreamBase;
  
  // For nested route api/qdrant/collections/items/points/[...rest].js:
  // - /api/qdrant/collections/items/points/scroll -> req.query.rest = ['scroll']
  // Path structure: collections/items/points/scroll
  // Always extract from URL (most reliable for deeply nested paths)
  let pathSegments = [];
  
  if (req.url) {
    const urlPath = req.url.split('?')[0];
    // Remove /api/qdrant prefix if present, or /qdrant prefix
    const cleanUrl = urlPath.replace(/^\/api\/qdrant\/?/, '').replace(/^\/qdrant\/?/, '');
    if (cleanUrl) {
      pathSegments = cleanUrl.split('/').filter(Boolean);
    }
  }
  
  // Fallback to req.query.rest if URL extraction didn't work
  if (pathSegments.length === 0 && req.query.rest) {
    pathSegments = ['collections', 'items', 'points']; // Fixed prefix
    if (Array.isArray(req.query.rest)) {
      pathSegments.push(...req.query.rest);
    } else if (typeof req.query.rest === 'string') {
      pathSegments.push(...req.query.rest.split('/').filter(Boolean));
    } else {
      pathSegments.push(String(req.query.rest));
    }
  }
  
  const upstreamPath = '/' + pathSegments.join('/');
  
  // Preserve query string if present
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  // Build the full upstream URL
  const upstreamUrl = `${baseUrl}${upstreamPath}${queryString}`;

  console.log(`[Qdrant Proxy Points] ${req.method} ${req.url} -> ${upstreamUrl}`, {
    baseUrl,
    upstreamPath,
    pathSegments,
    queryRest: req.query.rest,
  });

  try {
    const headers = {
      'Content-Type': 'application/json',
      'api-key': upstreamApiKey,
    };

    // Copy relevant request headers
    if (req.headers['accept']) {
      headers['Accept'] = req.headers['accept'];
    }
    if (req.headers['accept-language']) {
      headers['Accept-Language'] = req.headers['accept-language'];
    }

    const init = {
      method: req.method,
      headers,
    };

    // Include body for non-GET/HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      init.body = JSON.stringify(req.body);
    }

    // Forward the request with a 30-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(upstreamUrl, {
      ...init,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    const text = await response.text();

    // Forward response headers
    const contentType = response.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);

    // Forward status and body
    res.status(response.status);
    res.send(text);

  } catch (error) {
    console.error('[Qdrant Proxy Collections] Error forwarding request:', error);

    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: 'Gateway Timeout',
        details: 'Request to Qdrant API timed out after 30 seconds',
        upstreamUrl: baseUrl,
      });
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(502).json({ 
        error: 'Bad Gateway',
        details: `Cannot connect to Qdrant API at ${baseUrl}`,
        hint: 'Check QDRANT_UPSTREAM_URL environment variable',
      });
    } else {
      return res.status(500).json({ 
        error: 'Proxy request failed',
        details: error.message,
        upstreamUrl: baseUrl,
      });
    }
  }
}

