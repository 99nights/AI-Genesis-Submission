/**
 * Sales Service
 * 
 * Handles sales transactions with full integration to inventory.
 * Automatically updates inventory quantities when sales are recorded.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import { persistInventoryEntry, getAllStockItems, deleteInventoryEntry } from './inventory';
import type {
  SaleTransaction,
  StockItem,
} from '../../../types';

// Persist sale transaction
export const persistSale = async (sale: SaleTransaction): Promise<void> => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('sales'))) return;

  const vector = resolveVector(buildPlaceholderVector(sale.id), sale.id, `sales:${sale.id}`);
  const pointId = composePointId('sales', sale.id);

  const pointPayload = composePointVectorPayload('sales', vector);
  await qdrantClient.upsert('sales', {
    wait: true,
    points: [{
      id: pointId,
      ...pointPayload,
      payload: {
        saleId: sale.id,
        shopId: activeShopId,
        timestamp: sale.timestamp,
        lineItems: sale.items,
        totalAmount: sale.totalAmount,
      },
    } as any], // Type assertion needed due to named vs unnamed vector types
  });
};

// Record sale and update inventory (FEFO - First Expired First Out)
export const recordSale = async (
  cart: { productName: string; quantity: number }[],
  productMap: Map<string, { id: string; name: string }>
): Promise<SaleTransaction> => {
  if (!activeShopId) throw new Error('No shop selected.');

  const transactionItems: SaleTransaction['items'] = [];
  let totalAmount = 0;
  const RETAIL_MARKUP = 1.4; // Fallback only - should use actual sellPrice from DB
  const touchedItems: StockItem[] = [];
  const removedItems: StockItem[] = [];

  // Get all stock items for the shop
  const allStockItems = await getAllStockItems(activeShopId);

  for (const cartItem of cart) {
    let quantityToDeduct = cartItem.quantity;
    const product = productMap.get(cartItem.productName);
    if (!product) continue;

    // Filter and sort by expiration (FEFO)
    const productStock = allStockItems
      .filter(item => item.productId === product.id && item.quantity > 0)
      .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

    for (const stockItem of productStock) {
      if (quantityToDeduct <= 0) break;

      const deduction = Math.min(stockItem.quantity, quantityToDeduct);
      stockItem.quantity -= deduction;
      quantityToDeduct -= deduction;

      // Use actual sellPrice from DB if available, otherwise fallback to calculated markup
      const priceAtSale = stockItem.sellPrice ?? (stockItem.costPerUnit * RETAIL_MARKUP);
      transactionItems.push({
        productId: product.id,
        quantity: deduction,
        priceAtSale,
      });
      totalAmount += deduction * priceAtSale;

      if (stockItem.quantity === 0) {
        removedItems.push(stockItem);
      } else {
        touchedItems.push(stockItem);
      }
    }
  }

  // Create sale transaction
  const newTransaction: SaleTransaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    items: transactionItems,
    totalAmount,
  };

  // Update inventory for touched items
  for (const stock of touchedItems) {
    await persistInventoryEntry(stock);
  }

  // Delete empty items
  await Promise.all(removedItems.map(deleteInventoryEntry));

  // Persist sale
  await persistSale(newTransaction);

  console.log(`[Sales] Recorded sale ${newTransaction.id} with total $${totalAmount.toFixed(2)}.`);
  return newTransaction;
};

// Deduct stock for order (marketplace orders)
export const deductStockForOrder = async (
  productId: string,
  quantity: number
): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');

  const allStockItems = await getAllStockItems(activeShopId);
  const productStock = allStockItems
    .filter(item => item.productId === productId && item.quantity > 0)
    .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

  let quantityToDeduct = quantity;
  const touchedItems: StockItem[] = [];
  const removedItems: StockItem[] = [];

  for (const stockItem of productStock) {
    if (quantityToDeduct <= 0) break;

    const deduction = Math.min(stockItem.quantity, quantityToDeduct);
    stockItem.quantity -= deduction;
    quantityToDeduct -= deduction;

    if (stockItem.quantity === 0) {
      removedItems.push(stockItem);
    } else {
      touchedItems.push(stockItem);
    }
  }

  // Update inventory
  for (const stock of touchedItems) {
    await persistInventoryEntry(stock);
  }

  await Promise.all(removedItems.map(deleteInventoryEntry));

  console.info(`[Sales] Deducted ${quantity} units of product ${productId} for order fulfillment.`);
};

// Get all sales for a shop
export const getAllSales = async (shopId: string): Promise<SaleTransaction[]> => {
  const points = await fetchAllPoints('sales', shopId);
  return points.map(point => {
    const payload = point.payload as any;
    return {
      id: payload.saleId,
      timestamp: payload.timestamp,
      items: payload.lineItems || [],
      totalAmount: payload.totalAmount || 0,
    } as SaleTransaction;
  });
};

