#!/usr/bin/env node
import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';

const SHOP_ID = process.argv[2] || 'c6172524-3288-407a-b695-66c1b304b2f0';
const QDRANT_URL = process.env.QDRANT_URL || process.env.QDRANT_PROXY_URL || 'http://localhost:8787/qdrant';

const client = new QdrantClient({ url: QDRANT_URL });
const placeholderVector = Array(8).fill(0.25);

const scrollItemsForShop = async () => {
  try {
    const result = await client.scroll('items', {
      limit: 1,
      with_payload: true,
      filter: { must: [{ key: 'shopId', match: { value: SHOP_ID } }] },
    });
    return result.points;
  } catch (error) {
    if (error?.data?.status?.error?.includes('Index required')) {
      await client.createPayloadIndex('items', {
        field_name: 'shopId',
        field_schema: { type: 'keyword' },
      });
      const retry = await client.scroll('items', {
        limit: 1,
        with_payload: true,
        filter: { must: [{ key: 'shopId', match: { value: SHOP_ID } }] },
      });
      return retry.points;
    }
    throw error;
  }
};

const ensureCollections = async () => {
  const collections = ['products', 'batches', 'items'];
  for (const name of collections) {
    try {
      const { exists } = await client.collectionExists(name);
      if (!exists) {
        await client.createCollection(name, {
          vectors: { size: placeholderVector.length, distance: 'Cosine' },
        });
        console.log(`[seed] Created collection ${name}`);
      }
    } catch (error) {
      console.warn(`[seed] Unable to verify collection ${name}:`, error.message);
    }
  }
};

const upsertProduct = async (productId) => {
  const pointId = uuidv4();
  await client.upsert('products', {
    wait: true,
    points: [{
      id: pointId,
      vector: placeholderVector,
      payload: {
        productId,
        name: 'Test Organic Milk',
        manufacturer: 'Seed Dairy Co.',
        category: 'Dairy',
        description: 'Seeded inventory item for workflow testing',
        defaultSupplierId: null,
        images: [],
        audit: [],
      },
    }],
  });
};

const upsertBatch = async (batchId) => {
  const now = new Date().toISOString();
  const pointId = uuidv4();
  await client.upsert('batches', {
    wait: true,
    points: [{
      id: pointId,
      vector: placeholderVector,
      payload: {
        batchId,
        shopId: SHOP_ID,
        supplierId: null,
        deliveryDate: now.split('T')[0],
        inventoryDate: now.split('T')[0],
        invoiceNumber: `SEED-${Date.now()}`,
        documents: [],
        lineItems: [{
          productId: 'seed-organic-milk',
          quantity: 48,
          cost: 2.5,
        }],
        createdAt: now,
        createdByUserId: SHOP_ID,
      },
    }],
  });
};

const upsertItem = async (batchId, productId) => {
  const now = new Date();
  const expiration = new Date(now);
  expiration.setDate(expiration.getDate() + 45);
  const inventoryUuid = uuidv4();
  await client.upsert('items', {
    wait: true,
    points: [{
      id: inventoryUuid,
      vector: placeholderVector,
      payload: {
        inventoryUuid,
        shopId: SHOP_ID,
        productId,
        batchId,
        supplierId: null,
        buyPrice: 2.5,
        sellPrice: 3.5,
        quantity: 48,
        expiration: expiration.toISOString().split('T')[0],
        location: 'Cold Storage A1',
        status: 'ACTIVE',
        images: [],
        scanMetadata: null,
        createdByUserId: SHOP_ID,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    }],
  });
};

const main = async () => {
  console.log(`[seed] Inspecting inventory for shop ${SHOP_ID}`);
  await ensureCollections();
  const existing = await scrollItemsForShop();
  if (existing.length > 0) {
    console.log(`[seed] Found existing inventory items. No action taken.`);
    return;
  }
  const productId = 'seed-organic-milk';
  const batchId = uuidv4();
  await upsertProduct(productId);
  await upsertBatch(batchId);
  await upsertItem(batchId, productId);
  console.log(`[seed] Seeded inventory for shop ${SHOP_ID}. Refresh the app to see the new stock.`);
};

main().catch(err => {
  console.error('[seed] Failed to seed inventory:', err);
  process.exit(1);
});
