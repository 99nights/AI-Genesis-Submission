/**
 * Inventory Service
 * 
 * Handles inventory items (stock) with full OCR integration.
 * Integrates scanMetadata from OCR operations into inventory records.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints, searchWithFilters } from '../queries';
import { composeQueryVector } from '../vectors';
import { embedText } from '../../embeddingService';
import { v4 as uuidv4 } from 'uuid';
import type {
  StockItem,
  BatchRecord,
  BatchLineItem,
  QdrantItemPayload,
  ScanMetadata,
  ProductImage,
} from '../../../types';

// In-memory cache for products (loaded from Qdrant)
const productCache = new Map<string, { name: string; manufacturer: string; category: string }>();

// Helper to get product name for embeddings
const getProductName = async (productId: string): Promise<string> => {
  if (productCache.has(productId)) {
    return productCache.get(productId)!.name;
  }
  // Try to fetch from Qdrant if not in cache
  const points = await fetchAllPoints('products', null);
  const product = points.find(p => (p.payload as any)?.productId === productId);
  if (product) {
    const payload = product.payload as any;
    productCache.set(productId, {
      name: payload.name || 'unknown product',
      manufacturer: payload.manufacturer || '',
      category: payload.category || '',
    });
    return payload.name || 'unknown product';
  }
  return 'unknown product';
};

// Persist inventory entry with OCR metadata support
export const persistInventoryEntry = async (
  stock: StockItem,
  scanMetadata?: ScanMetadata | null
): Promise<void> => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('items'))) return;

  const inventoryUuid = stock.inventoryUuid || stock.qdrantId || uuidv4();
  if (!stock.inventoryUuid) {
    stock.inventoryUuid = inventoryUuid;
  }
  if (!stock.qdrantId) {
    stock.qdrantId = inventoryUuid;
  }

  const now = new Date().toISOString();
  const status = stock.status || (stock.quantity > 0 ? 'ACTIVE' : 'EMPTY');

  // Get product name for embedding
  const productName = await getProductName(stock.productId);
  const itemEmbeddings = await embedText(productName);
  const vector = resolveVector(itemEmbeddings, inventoryUuid, `items:${inventoryUuid}`);

  // Merge scanMetadata if provided
  const finalScanMetadata: ScanMetadata | null = scanMetadata || stock.scanMetadata || null;

  const buyPrice = stock.buyPrice ?? stock.costPerUnit ?? null;
  const sellPrice = stock.sellPrice ?? (buyPrice ? buyPrice * 1.4 : null);
  const shareScope = stock.shareScope || ['local'];

  const payload: QdrantItemPayload = {
    inventoryUuid,
    shopId: activeShopId,
    productId: stock.productId,
    batchId: stock.batchId || '',
    supplierId: stock.supplierId || undefined,
    buyPrice: buyPrice ?? undefined,
    sellPrice: sellPrice ?? undefined,
    quantity: stock.quantity || 0,
    expiration: stock.expirationDate || now,
    location: stock.location || undefined,
    status: status as 'ACTIVE' | 'EMPTY' | 'EXPIRED',
    images: stock.images || [],
    scanMetadata: finalScanMetadata, // OCR metadata integrated here
    createdByUserId: activeShopId,
    createdAt: stock.createdAt || now,
    updatedAt: stock.updatedAt || now,
    embeddings: vector,
    shareScope,
    shareProofHash: stock.shareProofHash,
  };

  await qdrantClient.upsert('items', {
    wait: true,
    points: [{
      id: inventoryUuid,
      ...composePointVectorPayload('items', vector),
      payload,
    }],
  });
};

// Update inventory entry with OCR data
export const updateInventoryWithOCR = async (
  inventoryUuid: string,
  ocrData: {
    scanMetadata?: ScanMetadata;
    images?: ProductImage[];
    location?: string;
  }
): Promise<void> => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('items'))) return;

  // Fetch existing item
  const points = await fetchAllPoints('items', activeShopId);
  const existingPoint = points.find(p => (p.payload as any)?.inventoryUuid === inventoryUuid);

  if (!existingPoint) {
    throw new Error(`Inventory item ${inventoryUuid} not found`);
  }

  const existingPayload = existingPoint.payload as QdrantItemPayload;

  // Merge OCR data
  const updatedPayload: QdrantItemPayload = {
    ...existingPayload,
    scanMetadata: ocrData.scanMetadata || existingPayload.scanMetadata,
    images: ocrData.images ? [...(existingPayload.images || []), ...ocrData.images] : existingPayload.images,
    location: ocrData.location || existingPayload.location,
    updatedAt: new Date().toISOString(),
  };

  await qdrantClient.upsert('items', {
    wait: true,
    points: [{
      id: inventoryUuid,
      vector: existingPoint.vector as number[],
      payload: updatedPayload,
    }],
  });
};

// Delete inventory entry
export const deleteInventoryEntry = async (stock: StockItem): Promise<void> => {
  if (!qdrantClient) return;
  const inventoryUuid = stock.inventoryUuid || stock.qdrantId;
  if (inventoryUuid) {
    await qdrantClient.delete('items', {
      wait: true,
      points: [inventoryUuid],
    });
    return;
  }
  if (!activeShopId) return;
  await qdrantClient.delete('items', {
    wait: true,
    filter: {
      must: [
        { key: 'shopId', match: { value: activeShopId } },
        { key: 'productId', match: { value: stock.productId } },
      ],
    },
  });
};

// Create inventory items from batch line items (with OCR support)
export const createInventoryFromBatch = async (
  batch: BatchRecord,
  lineItems: BatchLineItem[],
  ocrDataMap?: Map<string, { scanMetadata?: ScanMetadata; images?: ProductImage[] }>
): Promise<void> => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('items'))) return;

  const now = new Date().toISOString();
  const deliveryDate = new Date(batch.deliveryDate);
  const defaultExpiration = new Date(deliveryDate.setFullYear(deliveryDate.getFullYear() + 1))
    .toISOString()
    .split('T')[0];

  const newInventoryPoints = await Promise.all(
    lineItems
      .filter(item => item.productId && item.quantity > 0)
      .map(async item => {
        const inventoryUuid = uuidv4();
        const buyPrice = item.cost || 0;
        const sellPrice = buyPrice * 1.4;

        const productName = await getProductName(item.productId);
        const itemEmbeddings = await embedText(productName);
        const vector = resolveVector(itemEmbeddings, inventoryUuid, `items:${inventoryUuid}`);

        // Get OCR data if available
        const ocrData = ocrDataMap?.get(item.productId);

        const payload: QdrantItemPayload = {
          inventoryUuid,
          shopId: activeShopId,
          productId: item.productId,
          batchId: batch.id,
          supplierId: batch.supplierId || undefined,
          buyPrice,
          sellPrice,
          quantity: item.quantity,
          expiration: defaultExpiration,
          location: undefined,
          status: 'ACTIVE' as const,
          images: ocrData?.images || [],
          scanMetadata: ocrData?.scanMetadata || null,
          createdByUserId: activeShopId,
          createdAt: now,
          updatedAt: now,
          embeddings: vector,
          shareScope: ['local'],
        };

        return {
          id: inventoryUuid,
          ...composePointVectorPayload('items', vector),
          payload,
        };
      })
  );

  if (newInventoryPoints.length > 0) {
    await qdrantClient.upsert('items', {
      wait: true,
      points: newInventoryPoints,
    });
    console.log(`[Inventory] Added ${newInventoryPoints.length} inventory items from batch ${batch.id}`);
  }
};

// Search inventory items (semantic search)
export const searchRelevantInventoryItems = async (
  queryEmbedding: number[],
  shopId: string,
  limit: number = 10
): Promise<StockItem[]> => {
  if (!qdrantClient || !shopId) return [];
  if (!(await ensureReadyOrWarn('items'))) return [];

  const resolvedVector = resolveVector(queryEmbedding, `${shopId}-query`, `search:${shopId}`);
  const queryVector = composeQueryVector('items', resolvedVector);

  const points = await searchWithFilters('items', queryVector, {
    shopId,
    quantityMin: 0,
    status: 'ACTIVE',
  }, limit);

  return points.map(point => {
    const payload = point.payload as any;
    // Extract shopId from payload (handle both string and object cases)
    const payloadShopId = payload?.shopId;
    const itemShopId = typeof payloadShopId === 'string'
      ? payloadShopId
      : (payloadShopId && typeof payloadShopId === 'object' && payloadShopId !== null && 'id' in payloadShopId)
        ? (payloadShopId as { id: string }).id
        : shopId; // Fallback to provided shopId
    
    return {
      id: Date.now() + Math.random(),
      inventoryUuid: payload.inventoryUuid || String(point.id),
      shopId: itemShopId,
      productId: payload.productId,
      batchId: payload.batchId,
      expirationDate: payload.expiration,
      quantity: payload.quantity,
      costPerUnit: payload.buyPrice || 0,
      location: payload.location || undefined,
      supplierId: payload.supplierId || undefined,
      buyPrice: payload.buyPrice,
      sellPrice: payload.sellPrice,
      images: payload.images || [],
      scanMetadata: payload.scanMetadata,
      qdrantId: payload.inventoryUuid || String(point.id),
      status: payload.status,
      createdByUserId: payload.createdByUserId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      shareScope: payload.shareScope || ['local'],
      shareProofHash: payload.shareProofHash,
    };
  });
};

// Get all stock items for a shop
export const getAllStockItems = async (shopId: string): Promise<StockItem[]> => {
  const points = await fetchAllPoints('items', shopId);
  return points
    .map(point => {
      const payload = point.payload as any;
      // Extract shopId from payload (handle both string and object cases)
      const payloadShopId = payload?.shopId;
      const itemShopId = typeof payloadShopId === 'string'
        ? payloadShopId
        : (payloadShopId && typeof payloadShopId === 'object' && payloadShopId !== null && 'id' in payloadShopId)
          ? (payloadShopId as { id: string }).id
          : shopId; // Fallback to provided shopId
      
      return {
        id: Date.now() + Math.random(),
        inventoryUuid: payload.inventoryUuid || String(point.id),
        shopId: itemShopId,
        productId: payload.productId,
        batchId: payload.batchId,
        expirationDate: payload.expiration,
        quantity: payload.quantity,
        costPerUnit: payload.buyPrice || 0,
        location: payload.location || undefined,
        supplierId: payload.supplierId || undefined,
        buyPrice: payload.buyPrice,
        sellPrice: payload.sellPrice,
        images: payload.images || [],
        scanMetadata: payload.scanMetadata,
        qdrantId: payload.inventoryUuid || String(point.id),
        status: payload.status,
        createdByUserId: payload.createdByUserId,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      shareScope: payload.shareScope || ['local'],
      shareProofHash: payload.shareProofHash,
      };
    })
    .filter(item => item.quantity > 0 && item.status !== 'EMPTY' && item.status !== 'EXPIRED');
};

// Update product cache
export const updateProductCache = (productId: string, product: { name: string; manufacturer: string; category: string }) => {
  productCache.set(productId, product);
};

