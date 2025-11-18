/**
 * Batches Service
 * 
 * Handles delivery batch records with document management.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import type {
  BatchRecord,
  QdrantBatchPayload,
} from '../../../types';

// Get batch records for a shop
export const getBatchRecords = async (shopId: string): Promise<BatchRecord[]> => {
  if (!qdrantClient) return [];
  const points = await fetchAllPoints('batches', shopId);
  return points.map(point => {
    const payload = point.payload as any;
    return {
      id: payload?.batchId || String(point.id),
      shopId: payload?.shopId,
      supplierId: payload?.supplierId,
      deliveryDate: payload?.deliveryDate,
      inventoryDate: payload?.inventoryDate,
      invoiceNumber: payload?.invoiceNumber,
      documents: payload?.documents || [],
      lineItems: payload?.lineItems || [],
      createdAt: payload?.createdAt,
      createdByUserId: payload?.createdByUserId,
    } as BatchRecord;
  });
};

// Fetch batch records for active shop
export const fetchBatchRecords = async (): Promise<BatchRecord[]> => {
  if (!activeShopId) return [];
  return getBatchRecords(activeShopId);
};

// Upsert batch record
export const upsertBatchRecord = async (batch: BatchRecord): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('batches'))) return;

  const vector = resolveVector(buildPlaceholderVector(batch.id), batch.id, `batches:${batch.id}`);
  const pointId = composePointId('batches', batch.id);

  const payload: QdrantBatchPayload = {
    batchId: batch.id,
    shopId: batch.shopId,
    supplierId: batch.supplierId || null,
    deliveryDate: batch.deliveryDate,
    inventoryDate: batch.inventoryDate || null,
    invoiceNumber: batch.invoiceNumber || null,
    documents: batch.documents || [],
    lineItems: batch.lineItems || [],
    createdAt: batch.createdAt,
    createdByUserId: batch.createdByUserId,
  };

  await qdrantClient.upsert('batches', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('batches', vector),
      payload,
    }],
  });
};

