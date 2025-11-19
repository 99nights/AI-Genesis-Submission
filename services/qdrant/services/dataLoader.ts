/**
 * Data Loader Service
 * 
 * Handles loading data from Qdrant into in-memory cache for backward compatibility.
 */

import { activeShopId } from '../core';
import { fetchAllPoints } from '../queries';
import { getCanonicalProductsForShopDirect } from './products';
import { db, clearAllCaches } from './helpers';
import type { Product, Batch, StockItem, SaleTransaction, MarketplaceListing } from '../../../types';

// Load all data from Qdrant into in-memory cache
export const loadDataFromQdrant = async (): Promise<void> => {
  console.log('[DataLoader] loadDataFromQdrant called, activeShopId:', activeShopId);
  
  if (!activeShopId) {
    console.warn('[DataLoader] activeShopId is not set, cannot load data');
    return;
  }

  // Ensure activeShopId is a string (extract id if it's an object)
  const shopIdString = typeof activeShopId === 'string' 
    ? activeShopId 
    : (activeShopId && typeof activeShopId === 'object' && activeShopId !== null && 'id' in activeShopId)
      ? (() => {
          const obj = activeShopId as { id: string };
          console.warn(`[DataLoader] activeShopId is an object instead of string. Extracting id: ${obj.id}`);
          return obj.id;
        })()
      : null;

  if (!shopIdString) {
    console.warn('[DataLoader] Could not extract shopIdString from activeShopId');
    return;
  }

  console.log(`[DataLoader] Loading data for shopId: ${shopIdString}`);

  // Load shop-specific data in parallel for maximum performance
  // Only fetch what we need - avoid loading unnecessary collections like sales/marketplace on initial load
  const [itemPoints, supplierPoints, batchPoints] = await Promise.all([
    fetchAllPoints('items', shopIdString),
    fetchAllPoints('suppliers', shopIdString),
    fetchAllPoints('batches', shopIdString),
  ]);
  
  // Extract unique productIds from items - we only need products that this shop has
  const productIds = new Set<string>();
  for (const point of itemPoints) {
    const payload = point.payload as any;
    const productId = payload?.productId;
    if (productId && typeof productId === 'string') {
      productIds.add(productId);
    }
  }

  // Get only products that this shop has (instead of ALL products)
  // Pass productIds directly to avoid fetching items again in getCanonicalProductsForShop
  const shopProducts = productIds.size > 0 
    ? await getCanonicalProductsForShopDirect(productIds)
    : [];

  console.log(`[DataLoader] Fetched from Qdrant: ${itemPoints.length} items, ${shopProducts.length} products (shop-specific), ${batchPoints.length} batches`);

  // If no items found, check what shopIds actually exist in Qdrant
  if (itemPoints.length === 0) {
    console.warn(`[DataLoader] No items found for shopId: ${shopIdString}. Checking all items in Qdrant...`);
    try {
      const allItems = await fetchAllPoints('items', null);
      const shopIdsInItems = new Set<string>();
      allItems.forEach((point: any) => {
        const itemShopId = point.payload?.shopId;
        // Handle both string and object cases
        const shopIdStr = typeof itemShopId === 'string' 
          ? itemShopId 
          : (itemShopId && typeof itemShopId === 'object' && 'id' in itemShopId)
            ? itemShopId.id
            : null;
        if (shopIdStr) {
          shopIdsInItems.add(shopIdStr);
        }
      });
      console.warn(`[DataLoader] Found ${allItems.length} total items in Qdrant. ShopIds present:`, Array.from(shopIdsInItems));
      if (allItems.length > 0 && !shopIdsInItems.has(shopIdString)) {
        console.error(`[DataLoader] CRITICAL: Items exist but none have shopId "${shopIdString}". Items have shopIds:`, Array.from(shopIdsInItems));
        console.error(`[DataLoader] Expected shopId: ${shopIdString}`);
        console.error(`[DataLoader] Found shopIds:`, Array.from(shopIdsInItems));
      }
    } catch (err) {
      console.error('[DataLoader] Error checking all items:', err);
    }
  }

  clearAllCaches();

  // Load products (only shop-specific products, not all products)
  shopProducts.forEach(product => {
    db.products.set(product.id, {
      id: product.id,
      name: product.name || 'Unnamed Product',
      manufacturer: product.manufacturer || '',
      category: product.category || '',
    });
  });

  // Load batches
  batchPoints.forEach(point => {
    const payload = point.payload as any;
    const batchUuid = payload?.batchId || String(point.id);
    if (!batchUuid) return;
    db.batches.set(String(batchUuid), {
      id: String(batchUuid),
      supplier: payload?.supplierId || 'Unknown Supplier',
      deliveryDate: payload?.deliveryDate || '',
      inventoryDate: payload?.inventoryDate || payload?.deliveryDate || '',
    });
  });

  // Load inventory items
  let itemsLoaded = 0;
  let itemsSkipped = 0;
  const skippedReasons: Record<string, number> = {};

  itemPoints.forEach(point => {
    const payload = point.payload as any;
    const productPayloadId = payload?.productId || payload?.itemId;
    const inventoryUuid = payload?.inventoryUuid || String(point.id);
    
    if (!inventoryUuid || !productPayloadId) {
      itemsSkipped++;
      skippedReasons['missing_uuid_or_productId'] = (skippedReasons['missing_uuid_or_productId'] || 0) + 1;
      return;
    }

    const quantity = payload.quantity || 0;
    const status = payload.status || (quantity > 0 ? 'ACTIVE' : 'EMPTY');

    if (quantity <= 0 || status === 'EMPTY' || status === 'EXPIRED') {
      itemsSkipped++;
      const reason = quantity <= 0 ? 'quantity_zero' : status.toLowerCase();
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      return;
    }

         // Extract shopId from payload (handle both string and object cases)
         const itemShopId = typeof payload.shopId === 'string'
           ? payload.shopId
           : (payload.shopId && typeof payload.shopId === 'object' && 'id' in payload.shopId)
             ? payload.shopId.id
             : null;
         
         // Warn if shopId doesn't match
         if (itemShopId && itemShopId !== shopIdString) {
           console.warn(`[DataLoader] Item ${inventoryUuid} has shopId "${itemShopId}" but expected "${shopIdString}"`);
         }

    const legacyId = payload.inventoryId || Date.now() + Math.random();

    const stock: StockItem = {
      id: legacyId,
      inventoryUuid,
      shopId: itemShopId || shopIdString || '',
      productId: productPayloadId,
      batchId: payload.batchId,
      expirationDate: payload.expiration || payload.expirationDate || '',
      quantity,
      costPerUnit: payload.costPerUnit || payload.buyPrice || 0,
      location: payload.location || undefined,
      supplierId: payload.supplierId || undefined,
      buyPrice: payload.buyPrice ?? payload.costPerUnit,
      sellPrice: payload.sellPrice ?? undefined,
      images: payload.images || [],
      scanMetadata: payload.scanMetadata || null,
      createdByUserId: payload.createdByUserId || undefined,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      qdrantId: inventoryUuid,
      status,
    };
    db.stockItems.set(stock.id, stock);
    itemsLoaded++;
  });

  console.log(`[DataLoader] Loaded ${itemsLoaded} items into cache, skipped ${itemsSkipped} items:`, skippedReasons);

  // Note: Sales and marketplace are NOT loaded during initial load to improve performance
  // They will be loaded on-demand when needed (Dashboard lazy loads sales, etc.)
};

