/**
 * Vector DB Service - Main Entry Point
 * 
 * This file maintains backward compatibility while using the new modular structure.
 * All functionality is preserved, but the code is now organized into focused modules.
 */

// Import all from new modular structure
import {
  // Core
  qdrantClient,
  activeShopId as _activeShopId,
  activeShopName as _activeShopName,
  activeShopEmail as _activeShopEmail,
  activeShopLocation as _activeShopLocation,
  activeNamespace as _activeNamespace,
  setActiveShopContext as _setActiveShopContext,
  type ActiveShopContextType,
} from './qdrant/core';

import {
  ensureBaseCollections,
  getQdrantDiagnostics,
  type QdrantLogEntry,
} from './qdrant/collections';

import {
  // Services
  getCanonicalProducts,
  getCanonicalProductsForShop,
  searchCanonicalProducts,
  upsertProductDefinition,
  createCanonicalProduct,
  updateCanonicalProduct,
  deleteCanonicalProduct,
} from './qdrant/services/products';

import {
  getBatchRecords,
  fetchBatchRecords,
  upsertBatchRecord,
} from './qdrant/services/batches';

import {
  upsertUserProfile,
  upsertShopRecord,
  createShopNamespace,
  upsertCustomerRecord,
  upsertDriverRecord,
  upsertSupplierProfile,
  fetchSuppliersForActiveShop,
  registerLocalSupplier,
  getAllShops,
  validateShopExists,
} from './qdrant/services/users';

import {
  persistInventoryEntry,
  updateInventoryWithOCR,
  deleteInventoryEntry,
  createInventoryFromBatch,
  searchRelevantInventoryItems,
  getAllStockItems as _getAllStockItems,
} from './qdrant/services/inventory';

import {
  persistSale,
  recordSale as _recordSale,
  deductStockForOrder as _deductStockForOrder,
  getAllSales,
} from './qdrant/services/sales';

import {
  listProductOnMarketplace,
  getMyMarketplaceListings,
  purchaseFromMarketplace as _purchaseFromMarketplace,
} from './qdrant/services/marketplace';

import {
  addImageForField,
  getLocalLearnedFields,
  getLearnedFieldsForProduct,
} from './qdrant/services/ocr';

import {
  upsertDanInventoryOffer,
  removeDanInventoryOffer,
  listDanInventoryOffers,
} from './qdrant/services/danInventory';

import {
  // Helpers
  db,
  initialized as _initialized,
  setInitialized,
  generateProductId,
  generateSupplierId,
  getProductSummaries as _getProductSummaries,
  clearAllCaches,
} from './qdrant/services/helpers';

import {
  loadDataFromQdrant,
} from './qdrant/services/dataLoader';

import { v4 as uuidv4 } from 'uuid';
import { embedText } from './embeddingService';
import type {
  Product,
  Batch,
  StockItem,
  SaleTransaction,
  NewInventoryItemData,
  ProductSummary,
  MarketplaceListing,
  PeerListing,
  ProductDefinition,
  SupplierProfile,
  BatchRecord,
  BatchLineItem,
  ScanMetadata,
  DanShareScope,
} from '../types';

import {
  publishDanEvent,
  getDanContext as _getDanContext,
  resolveShareScope as resolveDanShareScope,
  shareScopeIncludesDan,
  isDanFeatureEnabled,
  hashDanPayload,
} from './danRegistry';

import {
  seedDefaultPolicyForShop,
  evaluatePoliciesForEvent,
} from './policyEngine';

const resolveActiveShopId = (): string | null => _activeShopId || null;

const filterItemsForActiveShop = <T extends { shopId?: string | null }>(items: T[]): T[] => {
  const shopId = resolveActiveShopId();
  if (!shopId) return items;
  return items.filter(item => item.shopId === shopId);
};

const isActiveStockItem = (item: StockItem) => (
  item.quantity > 0 &&
  item.status !== 'EMPTY' &&
  item.status !== 'EXPIRED' &&
  (!item.status || item.status === 'ACTIVE')
);

const getCachedActiveStockItems = (): StockItem[] => {
  const activeItems = Array.from(db.stockItems.values()).filter(isActiveStockItem);
  return filterItemsForActiveShop(activeItems);
};

const normalizeShareScope = (scopes?: DanShareScope[]) =>
  resolveDanShareScope(scopes);

const shouldShareWithDan = (scopes?: DanShareScope[]) =>
  isDanFeatureEnabled() && shareScopeIncludesDan(scopes);

const toDateOnly = (value?: string | null): string => {
  if (!value) return new Date().toISOString().split('T')[0];
  return value.split('T')[0];
};

const toLocationBucket = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const bucket = trimmed.split(/[\s-]/)[0];
  return bucket ? bucket.toUpperCase() : null;
};

const resolveProductName = (productId: string, fallback?: string): string => {
  const product = db.products.get(productId);
  return fallback || product?.name || productId;
};

const resolveStockItemByInventoryUuid = (inventoryUuid: string): StockItem | undefined => {
  for (const item of db.stockItems.values()) {
    if (
      item.inventoryUuid === inventoryUuid ||
      item.qdrantId === inventoryUuid ||
      String(item.id) === inventoryUuid
    ) {
      return item;
    }
  }
  return undefined;
};

const publishInventoryOfferToDan = async (
  stockItem: StockItem,
  itemInput: NewInventoryItemData,
  context: { batchId: string; supplierId?: string | null; supplierName?: string | null },
) => {
  if (!shouldShareWithDan(itemInput.shareScope || stockItem.shareScope)) return;
  try {
    const shareScope = normalizeShareScope(itemInput.shareScope || stockItem.shareScope);
    const payload = {
      inventoryUuid: stockItem.inventoryUuid,
      productId: stockItem.productId,
      productName: resolveProductName(stockItem.productId, itemInput.productName),
      quantity: stockItem.quantity,
      expirationDate: toDateOnly(stockItem.expirationDate),
      locationBucket: toLocationBucket(stockItem.location),
      sellPrice: stockItem.sellPrice ?? itemInput.sellPrice ?? null,
      batchId: context.batchId,
      supplierId: stockItem.supplierId || context.supplierId || null,
      supplierName: context.supplierName || null,
      shopId: stockItem.shopId,
      shareScope,
    };
    const proofHash = await hashDanPayload(payload);
    const vectorContext = await embedText(
      `${payload.productName} ${payload.quantity} ${payload.locationBucket || ''}`,
    );
    await publishDanEvent({
      eventType: 'inventory.offer.created',
      payload: { ...payload, proofHash },
      shareScope,
      vectorContext,
      proofs: {
        hash: proofHash,
        link: `qdrant://items/${stockItem.inventoryUuid}`,
      },
    });
    await evaluatePoliciesForEvent({
      eventType: 'inventory.offer.created',
      payload: { ...payload },
      proofs: { hash: proofHash },
    });
    await upsertDanInventoryOffer({
      inventoryUuid: stockItem.inventoryUuid,
      productId: stockItem.productId,
      productName: payload.productName,
      quantity: stockItem.quantity,
      expirationDate: payload.expirationDate,
      locationBucket: payload.locationBucket,
      sellPrice: payload.sellPrice ?? null,
      shopId: stockItem.shopId,
      shopName: _activeShopName,
      shareScope,
      proofHash,
      vector: vectorContext,
    });
  } catch (err) {
    console.warn('[DAN] Failed to publish inventory.offer.created', err);
  }
};

const publishFulfillmentEventToDan = async (
  stockItem: StockItem,
  productName: string,
  fulfilledQuantity: number,
) => {
  if (!shouldShareWithDan(stockItem.shareScope)) return;
  try {
    const shareScope = normalizeShareScope(stockItem.shareScope);
    const remainingQuantity = Math.max(
      (stockItem.quantity || 0) - fulfilledQuantity,
      0,
    );
    const payload = {
      inventoryUuid: stockItem.inventoryUuid,
      productId: stockItem.productId,
      productName,
      fulfilledQuantity,
      remainingQuantity,
      saleTimestamp: new Date().toISOString(),
      batchId: stockItem.batchId,
       shopId: stockItem.shopId,
      shareScope,
    };
    const proofHash = await hashDanPayload(payload);
    const vectorContext = await embedText(
      `${payload.productName} fulfilled ${fulfilledQuantity}`,
    );
    await publishDanEvent({
      eventType: 'inventory.offer.fulfilled',
      payload: { ...payload, proofHash },
      shareScope,
      vectorContext,
      proofs: {
        hash: proofHash,
        link: `qdrant://items/${stockItem.inventoryUuid}`,
      },
    });
    await evaluatePoliciesForEvent({
      eventType: 'inventory.offer.fulfilled',
      payload,
      proofs: { hash: proofHash },
    });
    if (remainingQuantity <= 0) {
      await removeDanInventoryOffer(stockItem.inventoryUuid);
    } else {
      await upsertDanInventoryOffer({
        inventoryUuid: stockItem.inventoryUuid,
        productId: stockItem.productId,
        productName,
        quantity: remainingQuantity,
        expirationDate: stockItem.expirationDate,
        locationBucket: toLocationBucket(stockItem.location),
        sellPrice: stockItem.sellPrice,
        shopId: stockItem.shopId,
        shopName: _activeShopName,
        shareScope,
        proofHash,
      });
    }
  } catch (err) {
    console.warn('[DAN] Failed to publish inventory.offer.fulfilled', err);
  }
};

const emitSaleFulfillmentEvents = async (
  cart: { productName: string; quantity: number }[],
) => {
  if (!isDanFeatureEnabled()) return;
  const shareableItems = Array.from(db.stockItems.values()).filter(item =>
    shouldShareWithDan(item.shareScope),
  );
  if (!shareableItems.length) return;

  for (const line of cart) {
    const product = Array.from(db.products.values()).find(
      p => p.name.toLowerCase() === line.productName.toLowerCase(),
    );
    if (!product) continue;
    const stockItem = shareableItems.find(item => item.productId === product.id);
    if (!stockItem) continue;
    await publishFulfillmentEventToDan(stockItem, line.productName, line.quantity);
  }
};

// Re-export activeShopId for geminiService compatibility
// Re-export directly from core module (these are the actual exports)
export { 
  activeShopId,
  activeShopName,
  activeShopEmail,
  activeShopLocation,
  activeNamespace,
} from './qdrant/core';

// Re-export types
export type { QdrantLogEntry, ActiveShopContextType };

// Re-export all product functions
export {
  getCanonicalProducts,
  getCanonicalProductsForShop,
  searchCanonicalProducts,
  upsertProductDefinition,
  createCanonicalProduct,
  updateCanonicalProduct,
  deleteCanonicalProduct,
};

// Alias for backward compatibility
export const fetchCanonicalProducts = getCanonicalProducts;
export const fetchCanonicalProductsForShop = getCanonicalProductsForShop;
export const searchCatalogProducts = searchCanonicalProducts;

// Re-export all batch functions
export {
  getBatchRecords,
  fetchBatchRecords,
  upsertBatchRecord,
};

// Re-export all user/shop functions
export {
  upsertUserProfile,
  upsertShopRecord,
  createShopNamespace,
  upsertCustomerRecord,
  upsertDriverRecord,
  upsertSupplierProfile,
  fetchSuppliersForActiveShop,
  registerLocalSupplier,
};

// Re-export all inventory functions
export {
  searchRelevantInventoryItems,
  persistInventoryEntry,
  updateInventoryWithOCR,
  deleteInventoryEntry,
  createInventoryFromBatch,
};

// Re-export all sales functions
export {
  persistSale,
  getAllSales,
};

// Re-export all marketplace functions
export {
  listProductOnMarketplace,
  getMyMarketplaceListings,
};

// Re-export all OCR/visual functions
export {
  addImageForField,
  getLocalLearnedFields,
  getLearnedFieldsForProduct,
};

// Re-export diagnostics
export { getQdrantDiagnostics };

// DAN offer helpers
export const getDanInventoryOffers = () => listDanInventoryOffers();

// DAN context helpers
export const getDanContext = () => _getDanContext();

// Compatibility functions that need the in-memory db
export const setActiveShopContext = (shop: ActiveShopContextType | null) => {
  const previousShopId = _activeShopId;
  // Extract just the ID string, not the whole object
  const shopIdOnly = shop?.id || null;
  if (shopIdOnly) {
    _setActiveShopContext({ ...shop, id: shopIdOnly });
  } else {
    _setActiveShopContext(null);
  }
  
  // If shop changed, clear cache and reset initialized flag so data reloads
  if (previousShopId !== shopIdOnly) {
    clearAllCaches();
    setInitialized(false);
    console.log(`[VectorDB] Shop context changed: ${previousShopId || 'null'} -> ${shopIdOnly || 'null'}, resetting initialization`);
  }
};

export const getActiveShopId = (): string | null => resolveActiveShopId();

export const usesSupabaseStorage = () => true;

export const initializeAndSeedDatabase = async () => {
  console.log(`[VectorDB] initializeAndSeedDatabase called, _activeShopId: ${_activeShopId}, _initialized: ${_initialized}`);
  
  if (!_activeShopId) {
    console.warn('[VectorDB] initializeAndSeedDatabase: _activeShopId is not set, cannot initialize');
    return;
  }
  
  if (_initialized) {
    console.log('[VectorDB] initializeAndSeedDatabase: Already initialized, skipping');
    return;
  }
  
  console.log(`[VectorDB] Initializing database for shopId: ${_activeShopId}`);
  await ensureBaseCollections();
  await loadDataFromQdrant();
  
  console.log(`[VectorDB] After loadDataFromQdrant: ${db.products.size} products, ${db.stockItems.size} stock items`);
  
  if (db.products.size === 0 && db.stockItems.size === 0) {
    console.log('[VectorDB] No data found, seeding local store...');
    await seedLocalStore(_activeShopId);
    await loadDataFromQdrant();
    console.log(`[VectorDB] After seeding: ${db.products.size} products, ${db.stockItems.size} stock items`);
  }
  await seedDefaultPolicyForShop(_activeShopId, _activeShopName);
  setInitialized(true);
  console.log('[VectorDB] Database initialization complete');
};

export const syncBatchesFromQdrant = async () => {
  if (!_activeShopId) return;
  await loadDataFromQdrant();
};

// Seed local store (for initial setup)
const seedLocalStore = async (shopId: string) => {
  const supplier = await registerLocalSupplier({ name: 'Organic Foods Dist.' });
  const supplierId = supplier.id;
  const sampleBatches: Omit<Batch, 'id'>[] = [
    { supplier: 'Organic Foods Dist.', deliveryDate: '2024-06-05', inventoryDate: '2024-06-05' },
  ];
  const sampleItems: (NewInventoryItemData & { batchIndex: number })[] = [
    { 
      batchIndex: 0, 
      productName: 'Organic Oat Milk', 
      manufacturer: 'Oatly', 
      category: 'Beverages', 
      expirationDate: '2024-12-15', 
      quantity: 50, 
      quantityType: 'cartons', 
      costPerUnit: 2.5, 
      location: 'Shelf A' 
    },
  ];

  const addedBatches: Batch[] = [];
  sampleBatches.forEach(batch => {
    const id = uuidv4();
    const newBatch = { ...batch, id };
    db.batches.set(id, newBatch);
    addedBatches.push(newBatch);
  });

  for (const item of sampleItems) {
    const batch = addedBatches[item.batchIndex];
    const productId = generateProductId(item.productName);
    const product: Product = {
      id: productId,
      name: item.productName,
      manufacturer: item.manufacturer,
      category: item.category,
    };
    db.products.set(productId, product);
    
    // Create product in Qdrant
    await createCanonicalProduct({
      name: item.productName,
      manufacturer: item.manufacturer,
      category: item.category,
    });

    const inventoryUuid = uuidv4();
    const stock: StockItem = {
      id: Date.now() + Math.random(),
      inventoryUuid,
      shopId,
      productId,
      batchId: batch.id,
      expirationDate: item.expirationDate,
      quantity: item.quantity,
      costPerUnit: item.costPerUnit,
      location: item.location,
      supplierId: supplierId || undefined,
      buyPrice: item.costPerUnit,
      sellPrice: item.costPerUnit * 1.4,
      images: item.images,
      scanMetadata: item.scanMetadata || null,
      createdByUserId: shopId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      qdrantId: inventoryUuid,
      status: 'ACTIVE',
      shareScope: ['local'],
    };
    db.stockItems.set(stock.id, stock);
    await persistInventoryEntry(stock);
  }

  console.info(`[Data Service] Seeded starter data for shop ${shopId}`);
};

// Add inventory batch (with OCR support)
export const addInventoryBatch = async (
  batchData: Omit<Batch, 'id'>,
  itemsData: NewInventoryItemData[],
): Promise<void> => {
  if (!_activeShopId) throw new Error('No shop selected. Shop role/ID required.');
  await ensureBaseCollections();

  const suppliers = await fetchSuppliersForActiveShop();
  let supplier = suppliers.find(s => s.name.toLowerCase() === batchData.supplier?.toLowerCase());
  if (!supplier && batchData.supplier) {
    supplier = await registerLocalSupplier({ name: batchData.supplier });
  }
  const supplierId = supplier?.id;

  const allProducts = await getCanonicalProducts();
  allProducts.forEach(p => {
    if (!db.products.has(p.id)) {
      db.products.set(p.id, {
        id: p.id,
        name: p.name,
        manufacturer: p.manufacturer,
        category: p.category,
      });
    }
  });

  const productMap = new Map<string, string>();
  for (const item of itemsData) {
    let existingProduct = Array.from(db.products.values()).find(
      p => p.name.toLowerCase() === item.productName.toLowerCase()
    );

    if (existingProduct) {
      productMap.set(item.productName, existingProduct.id);
    } else {
      const newProd = await createCanonicalProduct({
        name: item.productName,
        manufacturer: item.manufacturer,
        category: item.category,
      });
      db.products.set(newProd.id, {
        id: newProd.id,
        name: newProd.name,
        manufacturer: newProd.manufacturer,
        category: newProd.category,
      });
      productMap.set(item.productName, newProd.id);
    }
  }

  const batchUuid = uuidv4();
  const newBatch: Batch = { ...batchData, id: batchUuid };
  db.batches.set(batchUuid, newBatch);

  const now = new Date().toISOString();
  const batchRecord: BatchRecord = {
    id: batchUuid,
    shopId: _activeShopId || '',
    supplierId: supplierId || null,
    deliveryDate: batchData.deliveryDate || now.split('T')[0],
    inventoryDate: batchData.inventoryDate || batchData.deliveryDate || now.split('T')[0],
    invoiceNumber: undefined,
    documents: [],
    lineItems: itemsData.map(item => ({
      productId: productMap.get(item.productName) || generateProductId(item.productName),
      productName: item.productName,
      quantity: item.quantity || 0,
      cost: item.buyPrice ?? item.costPerUnit ?? 0,
    })),
    createdAt: now,
    createdByUserId: _activeShopId || '',
  };

  await upsertBatchRecord(batchRecord);

  // Create inventory items with OCR metadata support
  for (const item of itemsData) {
    const productId = productMap.get(item.productName) || generateProductId(item.productName);
    const inventoryUuid = uuidv4();
    const shareScope = normalizeShareScope(item.shareScope);
    const shareWithDan = shouldShareWithDan(shareScope);
    const stockItem: StockItem = {
      id: Date.now() + Math.random(),
      inventoryUuid,
      shopId: _activeShopId || '',
      productId,
      batchId: batchUuid,
      expirationDate: item.expirationDate,
      quantity: item.quantity,
      costPerUnit: item.costPerUnit,
      location: item.location,
      supplierId: item.supplierId || supplierId || undefined,
      buyPrice: item.buyPrice ?? item.costPerUnit,
      sellPrice: item.sellPrice ?? undefined,
      images: item.images,
      scanMetadata: item.scanMetadata || null, // OCR metadata integrated
      createdByUserId: _activeShopId || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      qdrantId: inventoryUuid,
      status: 'ACTIVE',
      shareScope,
    };
    if (shareWithDan) {
      stockItem.shareProofHash = await hashDanPayload({
        inventoryUuid,
        productId,
        batchId: batchUuid,
        quantity: stockItem.quantity,
      });
    }
    db.stockItems.set(stockItem.id, stockItem);
    await persistInventoryEntry(stockItem, stockItem.scanMetadata || undefined);
    if (shareWithDan) {
      await publishInventoryOfferToDan(stockItem, item, {
        batchId: batchUuid,
        supplierId: stockItem.supplierId,
        supplierName: batchData.supplier,
      });
    }
  }

  console.log(`[Data Service] Added batch ${newBatch.id} with ${itemsData.length} item types.`);
};

type InventoryUpdateInput = {
  quantity?: number;
  expirationDate?: string;
  costPerUnit?: number;
  sellPrice?: number;
  buyPrice?: number;
  location?: string | null;
};

export const updateInventoryItem = async (
  inventoryUuid: string,
  updates: InventoryUpdateInput,
): Promise<StockItem> => {
  if (!_activeShopId) {
    throw new Error('No shop selected. Shop role/ID required.');
  }
  const existing = resolveStockItemByInventoryUuid(inventoryUuid);
  if (!existing) {
    throw new Error(`Inventory item ${inventoryUuid} not found`);
  }

  const quantity = updates.quantity ?? existing.quantity;
  const updated: StockItem = {
    ...existing,
    quantity,
    expirationDate: updates.expirationDate ?? existing.expirationDate,
    costPerUnit: updates.costPerUnit ?? existing.costPerUnit,
    buyPrice: updates.buyPrice ?? updates.costPerUnit ?? existing.buyPrice ?? existing.costPerUnit,
    sellPrice: updates.sellPrice ?? existing.sellPrice,
    location: updates.location ?? existing.location,
    updatedAt: new Date().toISOString(),
    status: quantity > 0 ? 'ACTIVE' : 'EMPTY',
  };

  db.stockItems.set(updated.id, updated);
  await persistInventoryEntry(updated);
  return updated;
};

export const removeInventoryItem = async (inventoryUuid: string): Promise<void> => {
  if (!_activeShopId) {
    throw new Error('No shop selected. Shop role/ID required.');
  }
  const existing = resolveStockItemByInventoryUuid(inventoryUuid);
  if (!existing) {
    throw new Error(`Inventory item ${inventoryUuid} not found`);
  }
  db.stockItems.delete(existing.id);
  await deleteInventoryEntry(existing);
};

// Record sale (with inventory integration)
export const recordSale = async (
  cart: { productName: string; quantity: number }[],
): Promise<void> => {
  if (!_activeShopId) throw new Error('No shop selected.');

  // Build product map
  const productMap = new Map<string, { id: string; name: string }>();
  for (const product of db.products.values()) {
    productMap.set(product.name, { id: product.id, name: product.name });
  }

  // Use the new recordSale function
  await _recordSale(cart, productMap);
  await loadDataFromQdrant();
  await emitSaleFulfillmentEvents(cart);
};

// Deduct stock for order
export const deductStockForOrder = async (productName: string, quantity: number): Promise<void> => {
  if (!_activeShopId) throw new Error('No shop selected.');
  
  const product = Array.from(db.products.values()).find(p => p.name === productName);
  if (!product) return;

  await _deductStockForOrder(product.id, quantity);
  await loadDataFromQdrant();
};

// Get product summaries
export const getProductSummaries = async (): Promise<ProductSummary[]> => {
  return _getProductSummaries(
    () => Promise.resolve(getCachedActiveStockItems()),
    fetchSuppliersForActiveShop
  );
};

// Get all batches (from in-memory cache)
export const getAllBatches = async (): Promise<Batch[]> => {
  return Array.from(db.batches.values());
};

// Get all stock items (from in-memory cache)
export const getAllStockItems = async (): Promise<StockItem[]> => {
  return getCachedActiveStockItems();
};

// Create batch for shop (with inventory creation)
export const createBatchForShop = async (input: {
  supplierId?: string;
  deliveryDate: string;
  inventoryDate?: string;
  invoiceNumber?: string;
  documents?: any[];
  lineItems?: BatchLineItem[];
}): Promise<BatchRecord> => {
  if (!_activeShopId) throw new Error('No shop selected.');

  const now = new Date().toISOString();
  const batch: BatchRecord = {
    id: uuidv4(),
    shopId: _activeShopId,
    supplierId: input.supplierId,
    deliveryDate: input.deliveryDate,
    inventoryDate: input.inventoryDate,
    invoiceNumber: input.invoiceNumber,
    documents: input.documents || [],
    lineItems: input.lineItems || [],
    createdAt: now,
    createdByUserId: _activeShopId,
  };

  await upsertBatchRecord(batch);

  // Create inventory items from line items
  if (input.lineItems && input.lineItems.length > 0) {
    await createInventoryFromBatch(batch, input.lineItems);
  }

  return batch;
};

// Purchase from marketplace
export const purchaseFromMarketplace = async (item: PeerListing, quantity: number): Promise<void> => {
  await _purchaseFromMarketplace(
    item,
    quantity,
    async (batchData: any, itemsData: any[]) => {
      await addInventoryBatch(batchData, itemsData);
    },
    async (sale: any) => {
      await persistSale(sale);
    }
  );
  await loadDataFromQdrant();
};

// Export shop functions for customer interface
export { getAllShops, validateShopExists };
