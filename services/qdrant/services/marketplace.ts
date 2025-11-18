/**
 * Marketplace Service
 * 
 * Handles marketplace listings and peer-to-peer transactions.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import type {
  MarketplaceListing,
  PeerListing,
} from '../../../types';

// In-memory cache for marketplace listings
const marketplaceListingsCache = new Map<number, MarketplaceListing>();

// Persist marketplace listing
const persistMarketplaceListing = async (listing: MarketplaceListing): Promise<void> => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('marketplace'))) return;

  const vector = resolveVector(buildPlaceholderVector(listing.id), listing.id, `marketplace:${listing.id}`);
  const pointId = composePointId('marketplace', listing.id);

  await qdrantClient.upsert('marketplace', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('marketplace', vector),
      payload: {
        shopId: activeShopId,
        listingId: listing.id,
        productId: listing.productId,
        productName: listing.productName,
        quantity: listing.quantity,
        price: listing.price,
      },
    }],
  });
};

// List product on marketplace
export const listProductOnMarketplace = async (
  listing: Omit<MarketplaceListing, 'id'>
): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');

  const newListing: MarketplaceListing = {
    ...listing,
    id: Date.now(),
  };

  marketplaceListingsCache.set(newListing.id, newListing);
  await persistMarketplaceListing(newListing);
  console.info(`[Marketplace] Listed ${newListing.quantity} of ${newListing.productName}.`);
};

// Get marketplace listings for active shop
export const getMyMarketplaceListings = async (): Promise<MarketplaceListing[]> => {
  // Return from cache if available, otherwise fetch from Qdrant
  if (marketplaceListingsCache.size > 0) {
    return Array.from(marketplaceListingsCache.values());
  }

  if (!activeShopId) return [];

  const points = await fetchAllPoints('marketplace', activeShopId);
  return points.map(point => {
    const payload = point.payload as any;
    return {
      id: payload.listingId || Date.now(),
      productId: payload.productId,
      productName: payload.productName,
      quantity: payload.quantity,
      price: payload.price,
    } as MarketplaceListing;
  });
};

// Purchase from marketplace (creates batch and sale)
export const purchaseFromMarketplace = async (
  item: PeerListing,
  quantity: number,
  createBatchFn: (batchData: any, itemsData: any[]) => Promise<void>,
  recordSaleFn: (sale: any) => Promise<void>
): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');

  const today = new Date().toISOString().split('T')[0];
  const batchData = {
    supplier: item.seller.name,
    deliveryDate: today,
    inventoryDate: today,
  };

  const itemData = {
    productName: item.productName,
    manufacturer: item.manufacturer,
    category: item.category,
    expirationDate: '2025-12-31',
    quantity,
    quantityType: item.quantityType,
    costPerUnit: item.price,
    location: 'Marketplace Intake',
  };

  await createBatchFn(batchData, [itemData]);

  const sale = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    items: [{
      productId: item.productName.toLowerCase().trim().replace(/\s+/g, '-'),
      quantity,
      priceAtSale: item.price,
    }],
    totalAmount: item.price * quantity,
    source: { type: 'marketplace' as const, supplierName: item.seller.name, listingId: item.listingId },
  };

  await recordSaleFn(sale);
  console.info(`[Marketplace] Purchased ${quantity} of ${item.productName} from ${item.seller.name}.`);
};

