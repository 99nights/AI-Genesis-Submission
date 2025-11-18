/**
 * Data Loader Service
 * 
 * Handles loading data from Qdrant into in-memory cache for backward compatibility.
 */

import { activeShopId } from '../core';
import { fetchAllPoints } from '../queries';
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

  const [supplierPoints, productPoints, batchPoints, itemPoints, salePoints, marketplacePoints] = await Promise.all([
    fetchAllPoints('suppliers', shopIdString),
    fetchAllPoints('products', null),
    fetchAllPoints('batches', shopIdString),
    fetchAllPoints('items', shopIdString),
    fetchAllPoints('sales', shopIdString),
    fetchAllPoints('marketplace', shopIdString),
  ]);

  console.log(`[DataLoader] Fetched from Qdrant: ${itemPoints.length} items, ${productPoints.length} products, ${batchPoints.length} batches`);

  // Removed expensive fallback that loads ALL items just to check shopIds
  // This was causing severe performance issues - loading all items from the entire collection
  // If no items are found, it's likely the shopId is correct but there's simply no data
  // Users can check the logs if they suspect a data issue
  if (itemPoints.length === 0) {
    console.warn(`[DataLoader] No items found for shopId: ${shopIdString}. This may be normal if the shop has no inventory yet.`);
  }

  clearAllCaches();

  // Load products
  productPoints.forEach(point => {
    const payload = point.payload as any;
    const productId = payload?.productId || String(point.id);
    if (!productId) return;
    db.products.set(productId, {
      id: productId,
      name: payload?.name || 'Unnamed Product',
      manufacturer: payload?.manufacturer || '',
      category: payload?.category || '',
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

  // Load sales
  salePoints.forEach(point => {
    const payload = point.payload as any;
    if (!payload?.saleId) return;
    db.salesTransactions.set(payload.saleId, {
      id: payload.saleId,
      timestamp: payload.timestamp,
      items: payload.lineItems || [],
      totalAmount: payload.totalAmount || 0,
    });
  });

  // Load marketplace listings
  marketplacePoints.forEach(point => {
    const payload = point.payload as any;
    if (!payload?.listingId) return;
    db.marketplaceListings.set(payload.listingId, {
      id: payload.listingId,
      productId: payload.productId,
      productName: payload.productName,
      quantity: payload.quantity,
      price: payload.price,
    });
  });
};

