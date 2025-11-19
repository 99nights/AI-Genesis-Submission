/**
 * Vercel Serverless Function - Qdrant Proxy
 * 
 * This handles all /qdrant/* requests and forwards them to the upstream Qdrant instance.
 * Vercel serverless functions are the only way to handle API routes on Vercel.
 */

export default async function handler(req, res) {
  const upstreamBase = process.env.QDRANT_UPSTREAM_URL;
  const upstreamApiKey = process.env.QDRANT_API_KEY;

  if (!upstreamBase || !upstreamApiKey) {
    console.error('[Qdrant Proxy] QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set');
    return res.status(500).json({ 
      error: 'Proxy configuration error',
      details: 'QDRANT_UPSTREAM_URL and QDRANT_API_KEY must be set in Vercel environment variables'
    });
  }

  // Sanitize upstream URL
  const baseUrl = upstreamBase.endsWith('/') ? upstreamBase.slice(0, -1) : upstreamBase;
  
  // Extract the path from the catch-all route
  // For /api/qdrant/collections, req.query.path will be ['collections']
  // For /api/qdrant/collections/test, req.query.path will be ['collections', 'test']
  // Note: req.query may also contain query params, so we need to extract just the path array
  const pathSegments = Array.isArray(req.query.path) 
    ? req.query.path 
    : (req.query.path ? [req.query.path] : []);
  const upstreamPath = '/' + pathSegments.join('/');
  
  // Remove leading /qdrant if present (shouldn't happen but just in case)
  const cleanPath = upstreamPath.replace(/^\/qdrant/, '') || '/';
  
  // Preserve query string if present (req.url will have it)
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  // Build the full upstream URL
  const upstreamUrl = `${baseUrl}${cleanPath}${queryString}`;

  // Log for debugging (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Qdrant Proxy] ${req.method} ${req.url} -> ${upstreamUrl}`);
  }

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

