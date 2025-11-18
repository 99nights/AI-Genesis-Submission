/**
 * Products Service
 * 
 * Handles canonical product definitions with semantic search.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import { embedText } from '../../embeddingService';
import { v4 as uuidv4 } from 'uuid';
import type {
  ProductDefinition,
  AuditEntry,
  QdrantProductPayload,
} from '../../../types';

const mapPointToProductDefinition = (point: { id: number | string; payload?: any }): ProductDefinition => {
  const payload = point.payload as any;
  return {
    id: payload?.productId || String(point.id),
    name: payload?.name || 'Unnamed Product',
    manufacturer: payload?.manufacturer || '',
    category: payload?.category || '',
    description: payload?.description || '',
    defaultSupplierId: payload?.defaultSupplierId || null,
    images: payload?.images || [],
    audit: payload?.audit || [],
    embeddings: payload?.embeddings || undefined,
  };
};

// Get all canonical products
export const getCanonicalProducts = async (): Promise<ProductDefinition[]> => {
  if (!qdrantClient) return [];
  const points = await fetchAllPoints('products', null);
  return points.map(mapPointToProductDefinition);
};

// Upsert product definition
export const upsertProductDefinition = async (
  product: ProductDefinition,
  auditEntry?: AuditEntry
): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('products'))) return;

  const hasEmbeddings = Array.isArray(product.embeddings) && product.embeddings.length > 0;
  const vector = resolveVector(
    hasEmbeddings ? product.embeddings : null,
    product.id,
    `products:${product.id}`
  );
  const payloadEmbeddings = hasEmbeddings && vector === product.embeddings ? vector : undefined;
  const pointId = composePointId('products', product.id);

  const payload: QdrantProductPayload = {
    productId: product.id,
    name: product.name,
    manufacturer: product.manufacturer,
    category: product.category,
    description: product.description || '',
    defaultSupplierId: product.defaultSupplierId || null,
    images: product.images || [],
    audit: auditEntry ? [...(product.audit || []), auditEntry] : product.audit || [],
    embeddings: payloadEmbeddings,
  };

  await qdrantClient.upsert('products', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('products', vector),
      payload,
    }],
  });
};

// Create new canonical product
export const createCanonicalProduct = async (input: {
  name: string;
  manufacturer: string;
  category: string;
  description?: string;
  defaultSupplierId?: string;
  images?: any[];
  embeddings?: number[];
}): Promise<ProductDefinition> => {
  const productDef: ProductDefinition = {
    id: uuidv4(),
    name: input.name.trim(),
    manufacturer: input.manufacturer.trim(),
    category: input.category.trim(),
    description: input.description?.trim() || '',
    defaultSupplierId: input.defaultSupplierId || null,
    images: input.images || [],
    audit: [],
    embeddings: input.embeddings || (input.name ? await embedText(input.name) : buildPlaceholderVector(uuidv4())),
  };

  const auditEntry: AuditEntry | undefined = activeShopId
    ? { userId: activeShopId, shopId: activeShopId, action: 'create', timestamp: new Date().toISOString() }
    : undefined;

  await upsertProductDefinition(productDef, auditEntry);
  return productDef;
};

// Update canonical product
export const updateCanonicalProduct = async (
  productId: string,
  input: {
    name?: string;
    manufacturer?: string;
    category?: string;
    description?: string;
    defaultSupplierId?: string;
    images?: any[];
    embeddings?: number[];
  }
): Promise<ProductDefinition> => {
  const existingProducts = await getCanonicalProducts();
  const existing = existingProducts.find(p => p.id === productId);
  if (!existing) {
    throw new Error(`Product with ID ${productId} not found`);
  }

  const newEmbeddings = input.embeddings || 
    (input.name && input.name !== existing.name ? await embedText(input.name) : existing.embeddings);

  const updatedProduct: ProductDefinition = {
    ...existing,
    name: input.name?.trim() || existing.name,
    manufacturer: input.manufacturer?.trim() || existing.manufacturer,
    category: input.category?.trim() || existing.category,
    description: input.description !== undefined ? input.description.trim() : existing.description,
    defaultSupplierId: input.defaultSupplierId !== undefined ? input.defaultSupplierId : existing.defaultSupplierId,
    images: input.images !== undefined ? input.images : existing.images,
    embeddings: newEmbeddings,
  };

  const auditEntry: AuditEntry | undefined = activeShopId
    ? { userId: activeShopId, shopId: activeShopId, action: 'update', timestamp: new Date().toISOString() }
    : undefined;

  await upsertProductDefinition(updatedProduct, auditEntry);
  return updatedProduct;
};

// Delete canonical product
export const deleteCanonicalProduct = async (productId: string): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('products'))) return;

  await qdrantClient.delete('products', {
    wait: true,
    points: [composePointId('products', productId)],
  });
};

export const searchCanonicalProducts = async (query: string, limit = 24): Promise<ProductDefinition[]> => {
  if (!qdrantClient) return [];
  const trimmed = query.trim();

  if (!trimmed) {
    const products = await getCanonicalProducts();
    return products.slice(0, limit);
  }

  if (!(await ensureReadyOrWarn('products'))) return [];

  const queryEmbedding = await embedText(trimmed);
  const resolvedVector = resolveVector(queryEmbedding, `products:search:${trimmed}`, `products-search:${Date.now()}`);

  const results = await qdrantClient.search('products', {
    vector: resolvedVector,
    limit,
    with_payload: true,
  });

  return results
    .map(mapPointToProductDefinition)
    .filter(product => !!product.name);
};

