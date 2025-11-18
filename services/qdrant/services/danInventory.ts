import { qdrantClient } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { fetchAllPoints } from '../queries';
import { composePointVectorPayload, resolveVector } from '../vectors';
import { embedText } from '../../embeddingService';
import type { DanInventoryOffer, DanShareScope } from '../../../types';

interface UpsertDanInventoryOfferInput {
  inventoryUuid: string;
  productId: string;
  productName: string;
  quantity: number;
  expirationDate: string;
  locationBucket?: string | null;
  sellPrice?: number | null;
  shopId: string;
  shopName?: string | null;
  shareScope: DanShareScope[];
  proofHash?: string;
  vector?: number[];
  updatedAt?: string;
}

const COLLECTION_NAME = 'dan_inventory' as const;

export const upsertDanInventoryOffer = async (
  input: UpsertDanInventoryOfferInput,
): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn(COLLECTION_NAME))) return;

  const vectorCandidate =
    input.vector ||
    (await embedText(
      `${input.productName} ${input.locationBucket || ''} ${input.quantity}`,
    ));

  const vector = resolveVector(
    vectorCandidate,
    input.inventoryUuid,
    `${COLLECTION_NAME}:${input.inventoryUuid}`,
  );

  const payload = {
    inventoryUuid: input.inventoryUuid,
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    expirationDate: input.expirationDate,
    locationBucket: input.locationBucket || null,
    sellPrice: input.sellPrice ?? null,
    shopId: input.shopId,
    shopName: input.shopName || null,
    shareScope: input.shareScope,
    proofHash: input.proofHash,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };

  await qdrantClient.upsert(COLLECTION_NAME, {
    wait: true,
    points: [
      {
        id: input.inventoryUuid,
        ...composePointVectorPayload(COLLECTION_NAME, vector),
        payload,
      },
    ],
  });
};

export const removeDanInventoryOffer = async (
  inventoryUuid: string,
): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn(COLLECTION_NAME))) return;
  await qdrantClient.delete(COLLECTION_NAME, {
    wait: true,
    points: [inventoryUuid],
  });
};

export const listDanInventoryOffers = async (): Promise<DanInventoryOffer[]> => {
  const points = await fetchAllPoints(COLLECTION_NAME, null);
  return points
    .map(point => {
      const payload = point.payload as any;
      return {
        inventoryUuid: payload?.inventoryUuid || String(point.id),
        shopId: payload?.shopId || '',
        shopName: payload?.shopName || null,
        productId: payload?.productId || '',
        productName: payload?.productName || '',
        quantity: payload?.quantity || 0,
        expirationDate: payload?.expirationDate || '',
        locationBucket: payload?.locationBucket || null,
        sellPrice: payload?.sellPrice ?? null,
        shareScope: payload?.shareScope || ['local'],
        proofHash: payload?.proofHash,
        updatedAt: payload?.updatedAt || point.payload?.updatedAt || '',
      } as DanInventoryOffer;
    })
    .filter(offer => offer.quantity > 0)
    .sort((a, b) => {
      const aDate = new Date(a.expirationDate).getTime();
      const bDate = new Date(b.expirationDate).getTime();
      return aDate - bDate;
    });
};


