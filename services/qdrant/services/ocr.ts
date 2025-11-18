/**
 * OCR/Visual Service
 * 
 * Handles visual learning features for scan-and-learn functionality.
 * Stores cropped images of product fields for OCR recognition.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import type { ScannedItemData } from '../../geminiService';
import type { ScanFieldSource } from '../../../types';

// In-memory cache for visual features
const productVisualFeaturesCache = new Map<string, { imageBase64: string; mimeType: string }>();

// Helper to generate product ID
const generateProductId = (name: string): string => {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
};

// Helper to get namespaced product ID
const getNamespacedProductId = (productId: string): string => {
  return `${activeShopId || 'global'}:${productId}`;
};

// Convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

interface FieldCaptureOptions {
  productId?: string;
  source?: ScanFieldSource;
  batchId?: string;
  metadata?: Record<string, any>;
}

const normalizeCapturedProductId = (inputProductId?: string, fallbackName?: string): string => {
  if (inputProductId && inputProductId.trim().length > 0) {
    return inputProductId.trim();
  }
  if (!fallbackName) return 'unlabeled-product';
  return generateProductId(fallbackName);
};

// Add image for a specific field (for learning)
export const addImageForField = async (
  productName: string,
  fieldName: keyof ScannedItemData | 'productId',
  imageBlob: Blob,
  options?: FieldCaptureOptions
): Promise<string> => {
  const finalProductId = normalizeCapturedProductId(options?.productId, productName);
  const namespaced = getNamespacedProductId(finalProductId);
  const imageBase64 = await blobToBase64(imageBlob);
  const captureId = `${namespaced}-${fieldName}`;

  // Store in cache
  productVisualFeaturesCache.set(captureId, { imageBase64, mimeType: imageBlob.type });

  if (!qdrantClient || !activeShopId) return captureId;
  if (!(await ensureReadyOrWarn('visual'))) return captureId;

  const vector = resolveVector(buildPlaceholderVector(captureId), captureId, `visual:${captureId}`);

  try {
    await qdrantClient.upsert('visual', {
      wait: true,
      points: [{
        id: composePointId('visual', captureId),
        ...composePointVectorPayload('visual', vector),
        payload: {
          shopId: activeShopId,
          productId: namespaced,
          fieldName,
          imageBase64,
          mimeType: imageBlob.type,
          source: options?.source || 'manual',
          batchId: options?.batchId || null,
          metadata: options?.metadata || null,
          capturedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }],
    });
  } catch (error) {
    console.error('[Qdrant] Failed to upsert visual feature:', error);
  }

  return captureId;
};

// Get learned fields for a product (from cache)
export const getLocalLearnedFields = (
  productName: string
): Map<keyof ScannedItemData | 'productId', { imageBase64: string; mimeType: string }> => {
  const learnedFields = new Map<keyof ScannedItemData | 'productId', { imageBase64: string; mimeType: string }>();
  const productId = generateProductId(productName);
  const prefix = `${getNamespacedProductId(productId)}-`;

  for (const [key, value] of productVisualFeaturesCache.entries()) {
    if (key.startsWith(prefix)) {
      const field = key.substring(prefix.length) as keyof ScannedItemData | 'productId';
      learnedFields.set(field, value);
    }
  }

  return learnedFields;
};

const resolveNamespacedProductId = (candidate: string): string => {
  const namespace = activeShopId || 'global';
  if (candidate.startsWith(`${namespace}:`)) {
    return candidate;
  }
  return `${namespace}:${candidate}`;
};

// Get learned fields for a product (from Qdrant)
export const getLearnedFieldsForProduct = async (
  productId: string
): Promise<Map<string, { imageBase64: string; mimeType: string }>> => {
  const learnedFields = new Map<string, { imageBase64: string; mimeType: string }>();
  if (!activeShopId || !qdrantClient) return learnedFields;

  const candidateIds = new Set<string>();
  if (productId.includes(':')) {
    candidateIds.add(productId);
  } else {
    candidateIds.add(resolveNamespacedProductId(productId));
    candidateIds.add(resolveNamespacedProductId(generateProductId(productId)));
  }

  const fetchForId = async (targetId: string) => {
    let offset: any = undefined;
    do {
      const response = await qdrantClient.scroll('visual', {
        filter: {
          must: [
            { key: 'shopId', match: { value: activeShopId } },
            { key: 'productId', match: { value: targetId } },
          ],
        },
        with_payload: true,
        limit: 50,
        offset: offset ?? undefined,
      });

      const points = response?.points ?? [];
      points.forEach(point => {
        const payload = point.payload as any;
        if (payload?.fieldName && payload?.imageBase64 && payload?.mimeType) {
          learnedFields.set(payload.fieldName, {
            imageBase64: payload.imageBase64,
            mimeType: payload.mimeType,
          });
        }
      });

      offset = response?.next_page_offset ?? undefined;
    } while (offset);
  };

  for (const id of candidateIds) {
    await fetchForId(id);
    if (learnedFields.size > 0) break;
  }

  return learnedFields;
};

