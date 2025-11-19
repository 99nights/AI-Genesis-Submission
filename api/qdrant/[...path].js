/**
 * Vercel Serverless Function - Qdrant Proxy
 * 
 * This handles all /qdrant/* requests and forwards them to the upstream Qdrant instance.
 * Vercel serverless functions are the only way to handle API routes on Vercel.
 */

export default async function handler(req, res) {
  // CRITICAL: Log immediately to verify function is being called
  console.log('[Qdrant Proxy] ===== FUNCTION CALLED =====');
  console.log('[Qdrant Proxy] Method:', req.method);
  console.log('[Qdrant Proxy] URL:', req.url);
  console.log('[Qdrant Proxy] Query:', JSON.stringify(req.query));
  console.log('[Qdrant Proxy] Query.path:', req.query.path);
  console.log('[Qdrant Proxy] Query.path type:', typeof req.query.path);
  console.log('[Qdrant Proxy] Query.path isArray:', Array.isArray(req.query.path));
  
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, api-key');

  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    console.log('[Qdrant Proxy] OPTIONS request, returning 200');
    return res.status(200).end();
  }

  const upstreamBase = process.env.QDRANT_UPSTREAM_URL;
  const upstreamApiKey = process.env.QDRANT_API_KEY;

  // Enhanced logging to debug issues
  console.log('[Qdrant Proxy] Request received:', {
    method: req.method,
    url: req.url,
    originalUrl: req.url,
    query: req.query,
    queryPath: req.query.path,
    queryPathType: typeof req.query.path,
    queryPathIsArray: Array.isArray(req.query.path),
    pathname: req.url.split('?')[0],
    headers: req.headers,
  });

  if (!upstreamBase || !upstreamApiKey) {
    console.error('[Qdrant Proxy] Missing environment variables:', {
      hasUpstreamBase: !!upstreamBase,
      hasUpstreamApiKey: !!upstreamApiKey,
    });
    return res.status(500).json({ 
      error: 'Proxy configuration error',
      details: 'QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set in Vercel environment variables'
    });
  }

  // Sanitize upstream URL
  const baseUrl = upstreamBase.endsWith('/') ? upstreamBase.slice(0, -1) : upstreamBase;
  
  // Extract the path from the catch-all route
  // In Vercel, for api/qdrant/[...path].js:
  // - /api/qdrant/collections -> req.query.path = ['collections']
  // - /api/qdrant/collections/sales -> req.query.path = ['collections', 'sales']
  // - /api/qdrant/collections/items/points/scroll -> req.query.path = ['collections', 'items', 'points', 'scroll']
  // - /qdrant/collections (rewritten to /api/qdrant/collections) -> req.query.path = ['collections']
  let pathSegments = [];
  
  // ALWAYS extract from URL first - it's more reliable for deeply nested paths
  // Vercel's req.query.path can be inconsistent with deeply nested catch-all routes
  if (req.url) {
    const urlPath = req.url.split('?')[0];
    // Remove /api/qdrant prefix if present, or /qdrant prefix
    const cleanUrl = urlPath.replace(/^\/api\/qdrant\/?/, '').replace(/^\/qdrant\/?/, '');
    if (cleanUrl) {
      pathSegments = cleanUrl.split('/').filter(Boolean);
    }
  }
  
  // Fallback to req.query.path if URL extraction didn't work
  if (pathSegments.length === 0 && req.query.path) {
    if (Array.isArray(req.query.path)) {
      pathSegments = req.query.path;
    } else if (typeof req.query.path === 'string') {
      // Sometimes Vercel might pass it as a single string with slashes
      pathSegments = req.query.path.split('/').filter(Boolean);
    } else {
      pathSegments = [String(req.query.path)];
    }
  }
  
  const upstreamPath = pathSegments.length > 0 ? '/' + pathSegments.join('/') : '/';
  
  // Preserve query string if present
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  // Build the full upstream URL
  const upstreamUrl = `${baseUrl}${upstreamPath}${queryString}`;

  // Log for debugging (always log in production to help debug)
  console.log(`[Qdrant Proxy] ${req.method} ${req.url} -> ${upstreamUrl}`, {
    baseUrl,
    upstreamPath,
    pathSegments,
    queryString,
    fullUpstreamUrl: upstreamUrl,
    originalUrl: req.url,
    query: req.query,
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
    console.error('[Qdrant Proxy] Error forwarding request:', error);

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

