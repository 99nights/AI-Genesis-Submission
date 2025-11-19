/**
 * Vercel Serverless Function - Qdrant Proxy
 * 
 * This handles all /qdrant/* requests and forwards them to the upstream Qdrant instance.
 * Vercel serverless functions are the only way to handle API routes on Vercel.
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

  // Enhanced logging to debug issues
  console.log('[Qdrant Proxy] Request received:', {
    method: req.method,
    url: req.url,
    query: req.query,
    pathname: req.url.split('?')[0],
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
  // - /qdrant/collections (rewritten to /api/qdrant/collections) -> req.query.path = ['collections']
  let pathSegments = [];
  
  // First, try to get from req.query.path (Vercel's catch-all route parameter)
  if (req.query.path) {
    if (Array.isArray(req.query.path)) {
      pathSegments = req.query.path;
    } else if (typeof req.query.path === 'string') {
      // Sometimes Vercel might pass it as a single string with slashes
      pathSegments = req.query.path.split('/').filter(Boolean);
    } else {
      pathSegments = [String(req.query.path)];
    }
  }
  
  // If pathSegments is still empty, extract from URL (fallback)
  if (pathSegments.length === 0 && req.url) {
    const urlPath = req.url.split('?')[0];
    // Remove /api/qdrant prefix if present, or /qdrant prefix
    const cleanUrl = urlPath.replace(/^\/api\/qdrant\/?/, '').replace(/^\/qdrant\/?/, '');
    if (cleanUrl) {
      pathSegments = cleanUrl.split('/').filter(Boolean);
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
