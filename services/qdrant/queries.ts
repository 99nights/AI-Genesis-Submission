/**
 * Query Utilities
 * 
 * Common query patterns and data fetching utilities.
 */

import { qdrantClient, CollectionKey, activeShopId } from './core';
import { ensureReadyOrWarn, isCollectionReady } from './collections';

const buildShopFilterCondition = (
  collection: CollectionKey,
  shopIdString: string | null,
) => {
  if (!shopIdString) return null;
  // Try native Qdrant filtering for all collections including 'items'
  // This is much more efficient than JavaScript filtering
  return { key: 'shopId', match: { value: shopIdString } };
};

// Fetch all points from a collection (with optional shop filter)
export const fetchAllPoints = async (
  collection: CollectionKey,
  shopFilter: string | null | { id?: string } | undefined
): Promise<any[]> => {
  if (!qdrantClient) return [];

  // Use synchronous check first - avoid async overhead if collection is already ready
  // Only call ensureReadyOrWarn if collection state is unknown
  if (!isCollectionReady(collection)) {
    if (!(await ensureReadyOrWarn(collection))) return [];
  }

  const points: any[] = [];
  let offset: any = undefined;
  let retries = 3;
  
  // Extract shopId string from shopFilter (handle both string and object cases)
  let shopIdString: string | null = null;
  if (shopFilter) {
    if (typeof shopFilter === 'string') {
      shopIdString = shopFilter;
    } else if (typeof shopFilter === 'object' && shopFilter !== null && 'id' in shopFilter) {
      const obj = shopFilter as { id: string };
      shopIdString = obj.id || null;
      console.warn(`[Qdrant] fetchAllPoints received shopFilter as object instead of string. Extracted id: ${shopIdString}`);
    } else {
      console.warn(`[Qdrant] fetchAllPoints received invalid shopFilter type: ${typeof shopFilter}`);
    }
  }
  
  // Use Qdrant native filtering for all collections (including 'items')
  // This is MUCH more efficient than fetching all data and filtering in JavaScript
  const shopCondition = buildShopFilterCondition(collection, shopIdString);
  const filter = shopCondition ? { must: [shopCondition] } : undefined;

  // Use larger batch size to reduce number of API requests (critical for performance)
  const SCROLL_LIMIT = 1000; // Increased from 100 to reduce API calls

  do {
    try {
      const response = await qdrantClient.scroll(collection, {
        with_payload: true,
        limit: SCROLL_LIMIT,
        offset: offset ?? undefined,
        filter,
      });

      const batch = response?.points ?? [];
      points.push(...batch);
      offset = response?.next_page_offset ?? undefined;
    } catch (scrollError: any) {
      // If filter fails with 400 error and we have a shopId filter, 
      // it might be a filter syntax issue - log and try without filter as last resort
      if (scrollError?.status === 400 && shopIdString && collection === 'items' && retries > 0) {
        console.warn(
          `[Qdrant] Filter failed for 'items' collection with shopId filter. ` +
          `This may indicate a data structure issue. Error: ${scrollError.message}`
        );
        
        // As a last resort, try JavaScript filtering only if native filter completely fails
        // This should rarely happen if the collection is properly indexed
        console.warn(`[Qdrant] Falling back to JavaScript filtering for 'items' collection (inefficient)`);
        
        const allPoints: any[] = [];
        let allOffset: any = undefined;
        do {
          try {
            const allResponse = await qdrantClient.scroll(collection, {
              with_payload: true,
              limit: SCROLL_LIMIT,
              offset: allOffset ?? undefined,
            });
            allPoints.push(...(allResponse?.points ?? []));
            allOffset = allResponse?.next_page_offset ?? undefined;
          } catch (err) {
            console.error('[Qdrant] Error in JavaScript filter fallback:', err);
            break;
          }
        } while (allOffset);
        
        // Filter in JavaScript as last resort
        const filtered = allPoints.filter((point: any) => {
          const itemShopId = point.payload?.shopId;
          if (typeof itemShopId === 'string') {
            return itemShopId === shopIdString;
          } else if (itemShopId && typeof itemShopId === 'object' && 'id' in itemShopId) {
            return itemShopId.id === shopIdString;
          }
          return false;
        });
        
        return filtered;
      }
      
      console.error(
        `[Qdrant] Scroll error in '${collection}' (Retry ${retries}, Filter: ${JSON.stringify(filter)}):`,
        scrollError
      );
      
      if (scrollError?.status === 400 && retries > 0) {
        console.info(`[Qdrant] Retrying scroll in '${collection}'...`);
        retries--;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      offset = undefined; // Break
    }

    if (!offset || points.length > 100_000) break;
  } while (offset);

  return points;
};

// Search with filters (for semantic search)
export const searchWithFilters = async (
  collection: CollectionKey,
  vector: number[] | { name: string; vector: number[] },
  filters: {
    shopId?: string;
    status?: string;
    quantityMin?: number;
    [key: string]: any;
  },
  limit: number = 10
): Promise<any[]> => {
  if (!qdrantClient) return [];
  // Use synchronous check first - avoid async overhead if collection is already ready
  if (!isCollectionReady(collection)) {
    if (!(await ensureReadyOrWarn(collection))) return [];
  }

  const mustFilters: any[] = [];

  if (filters.shopId) {
    // Extract shopId string (handle both string and object cases)
    const shopIdString = typeof filters.shopId === 'string' 
      ? filters.shopId 
      : (filters.shopId && typeof filters.shopId === 'object' && filters.shopId !== null && 'id' in filters.shopId)
        ? (filters.shopId as { id: string }).id
        : null;
    
    if (shopIdString) {
      const shopCondition = buildShopFilterCondition(collection, shopIdString);
      if (shopCondition) {
        mustFilters.push(shopCondition);
      }
    }
  }

  if (filters.status) {
    mustFilters.push({ key: 'status', match: { value: filters.status } });
  }

  if (filters.quantityMin !== undefined) {
    mustFilters.push({ key: 'quantity', range: { gt: filters.quantityMin } });
  }

  // Add any additional filters
  Object.entries(filters).forEach(([key, value]) => {
    if (!['shopId', 'status', 'quantityMin'].includes(key) && value !== undefined) {
      mustFilters.push({ key, match: { value } });
    }
  });

  try {
    const response = await qdrantClient.search(collection, {
      vector,
      limit,
      with_payload: true,
      filter: mustFilters.length > 0 ? { must: mustFilters } : undefined,
    });

    const points = Array.isArray(response) ? response : (response as any)?.points ?? [];
    return points;
  } catch (error: any) {
    console.error(`[Qdrant] Search failed in '${collection}':`, error);
    return [];
  }
};

