/**
 * Helper Functions
 * 
 * Utility functions used across services.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Product, Batch, StockItem, SaleTransaction, MarketplaceListing, ProductSummary } from '../../../types';

// In-memory cache for backward compatibility
export const db = {
  products: new Map<string, Product>(),
  batches: new Map<string, Batch>(),
  stockItems: new Map<number, StockItem>(),
  salesTransactions: new Map<number, SaleTransaction>(),
  productVisualFeatures: new Map<string, { imageBase64: string; mimeType: string }>(),
  marketplaceListings: new Map<number, MarketplaceListing>(),
};

export let initialized = false;

export const setInitialized = (value: boolean) => {
  initialized = value;
};

// Generate product ID from name
export const generateProductId = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
};

// Generate supplier ID from name
export const generateSupplierId = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
};

// Get product summaries (aggregates inventory data)
export const getProductSummaries = async (
  getAllStockItemsFn: () => Promise<StockItem[]>,
  fetchSuppliersFn: () => Promise<any[]>
): Promise<ProductSummary[]> => {
  const summaryMap = new Map<string, ProductSummary & { 
    totalCost: number; 
    totalSellPrice: number; // Total sell price (sellPrice * quantity)
    itemsWithSellPrice: number; // Count of items that have sellPrice set
    itemCount: number; 
    supplierIdsSet: Set<string> 
  }>();

  const stockItems = await getAllStockItemsFn();

  for (const stockItem of stockItems) {
    if (stockItem.quantity <= 0 || 
        stockItem.status === 'EMPTY' || 
        stockItem.status === 'EXPIRED' ||
        (stockItem.status && stockItem.status !== 'ACTIVE')) {
      continue;
    }

    const product = db.products.get(stockItem.productId);
    if (!product) continue;

    const existing = summaryMap.get(product.id);
    if (existing) {
      existing.totalQuantity += stockItem.quantity;
      if (stockItem.expirationDate < existing.earliestExpiration) {
        existing.earliestExpiration = stockItem.expirationDate;
      }
      if (stockItem.supplierId) {
        existing.supplierIdsSet.add(stockItem.supplierId);
      }
      existing.batches.push({ 
        batchId: String(stockItem.batchId), 
        quantity: stockItem.quantity, 
        expirationDate: stockItem.expirationDate 
      });
      existing.totalCost += stockItem.costPerUnit * stockItem.quantity;
      
      // Calculate sell price total - use sellPrice if available, otherwise fallback to calculated from costPerUnit
      const sellPrice = stockItem.sellPrice ?? (stockItem.costPerUnit * 1.4); // Default 40% markup if sellPrice not set
      existing.totalSellPrice += sellPrice * stockItem.quantity;
      if (stockItem.sellPrice !== undefined && stockItem.sellPrice !== null) {
        existing.itemsWithSellPrice += stockItem.quantity;
      }
      
      existing.itemCount += stockItem.quantity;
    } else {
      const supplierIds = new Set<string>();
      if (stockItem.supplierId) {
        supplierIds.add(stockItem.supplierId);
      }
      
      // Calculate sell price total - use sellPrice if available, otherwise fallback to calculated from costPerUnit
      const sellPrice = stockItem.sellPrice ?? (stockItem.costPerUnit * 1.4); // Default 40% markup if sellPrice not set
      const itemsWithSellPrice = (stockItem.sellPrice !== undefined && stockItem.sellPrice !== null) ? stockItem.quantity : 0;
      
      summaryMap.set(product.id, {
        productId: product.id,
        productName: product.name,
        manufacturer: product.manufacturer,
        category: product.category,
        totalQuantity: stockItem.quantity,
        quantityType: 'units',
        earliestExpiration: stockItem.expirationDate,
        supplierIdsSet: supplierIds,
        batches: [{ 
          batchId: String(stockItem.batchId), 
          quantity: stockItem.quantity, 
          expirationDate: stockItem.expirationDate 
        }],
        totalCost: stockItem.costPerUnit * stockItem.quantity,
        totalSellPrice: sellPrice * stockItem.quantity,
        itemsWithSellPrice,
        itemCount: stockItem.quantity,
        averageCostPerUnit: 0,
      });
    }
  }

  // Filter by suppliers
  const shopSuppliers = await fetchSuppliersFn();
  const shopSupplierIds = new Set(shopSuppliers.map(s => s.id));

  const finalSummaries: ProductSummary[] = [];
  summaryMap.forEach(summary => {
    const hasShopSupplier = summary.supplierIdsSet.size === 0 || 
      Array.from(summary.supplierIdsSet).some(id => shopSupplierIds.has(id));
    if (!hasShopSupplier) return;

    const { totalCost, totalSellPrice, itemsWithSellPrice, itemCount, supplierIdsSet, ...rest } = summary;
    finalSummaries.push({
      ...rest,
      supplierIds: Array.from(supplierIdsSet).filter(id => shopSupplierIds.has(id)),
      averageCostPerUnit: itemCount > 0 ? totalCost / itemCount : 0,
      // Calculate average sell price from actual sellPrice values, or fallback to calculated from cost if no sellPrice set
      averageSellPrice: itemCount > 0 ? totalSellPrice / itemCount : undefined,
    });
  });

  return finalSummaries.sort((a, b) => a.productName.localeCompare(b.productName));
};

// Clear all in-memory caches
export const clearAllCaches = () => {
  db.products.clear();
  db.batches.clear();
  db.stockItems.clear();
  db.salesTransactions.clear();
  db.marketplaceListings.clear();
  db.productVisualFeatures.clear();
};

