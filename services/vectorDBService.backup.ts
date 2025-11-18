import React from 'react';
import { QdrantClient, models } from '@qdrant/js-client-rest';
import { BACKEND_SERVICE_URL, USE_REMOTE_VECTOR } from '../config';
import { v5 as uuidv5, v4 as uuidv4 } from 'uuid';
import { ScannedItemData } from './geminiService';
import { embedText, EMBEDDING_VECTOR_SIZE } from './embeddingService';
import {
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
  ProductImage,
  ScanMetadata,
  AuditEntry,
  BatchDocument,
  BatchLineItem,
  QdrantUserPayload,
  QdrantShopPayload,
  QdrantSupplierPayload,
  QdrantProductPayload,
  QdrantItemPayload,
  QdrantBatchPayload,
} from '../types';

const normalizeQdrantUrl = (raw?: string | null) => {
  if (!raw) return null;
  let trimmed = raw.trim();
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
};

const qdrantUrl = normalizeQdrantUrl(process.env.QDRANT_URL || process.env.QDRANT_PROXY_URL || 'http://localhost:8787/qdrant');
const qdrantClient = qdrantUrl ? new QdrantClient({ url: qdrantUrl }) : null;

const BASE_COLLECTIONS = ['users', 'shops', 'customers', 'suppliers', 'products', 'items', 'inventory', 'batches', 'sales', 'drivers', 'visual', 'marketplace'] as const;
type CollectionKey = typeof BASE_COLLECTIONS[number];
const UUID_NAMESPACE = '58fc3ff2-2f13-11ef-b75e-0242ac110002';

type UserRoleFlags = {
  shop: boolean;
  customer: boolean;
  driver: boolean;
  supplier: boolean;
};

type PayloadIndexDefinition = Record<string, models.PayloadSchemaParams>;

const COLLECTION_PAYLOAD_INDEXES: Partial<Record<CollectionKey, PayloadIndexDefinition>> = {
  users: {
    userId: { type: 'keyword' },
    displayName: { type: 'keyword' },
    contactEmail: { type: 'keyword' },
    email: { type: 'keyword' },
    shopId: { type: 'keyword' },
  },
};

const normalizeRoleFlags = (roles?: Partial<UserRoleFlags>): UserRoleFlags => ({
  shop: !!roles?.shop,
  customer: !!roles?.customer,
  driver: !!roles?.driver,
  supplier: !!roles?.supplier,
});

// FIX: Define composePointId using uuidv5 for deterministic point IDs.
const composePointId = (collectionName: CollectionKey, entityId: string | number): string => {
  // Create a deterministic UUID for the point using a namespace
  return uuidv5(`${collectionName}:${entityId}`, UUID_NAMESPACE);
};

const db = {
  products: new Map<string, Product>(),
  batches: new Map<string, Batch>(),
  stockItems: new Map<number, StockItem>(),
  salesTransactions: new Map<number, SaleTransaction>(),
  productVisualFeatures: new Map<string, { imageBase64: string; mimeType: string }>(),
  marketplaceListings: new Map<number, MarketplaceListing>(),
};

let initialized = false;
export let activeShopId: string | null = null; // Exported for use in geminiService
let activeShopName: string | null = null;
let activeShopEmail: string | null = null;
let activeShopLocation: string | null = null;
let activeNamespace: string | null = null;

const collectionState = new Map<CollectionKey, { ready: boolean; promise: Promise<boolean> | null }>();
const collectionVectorConfig = new Map<
  CollectionKey,
  { named: boolean; vectorName: string | null }
>();

type QdrantLogLevel = 'info' | 'warn' | 'error';
export type QdrantLogEntry = {
  level: QdrantLogLevel;
  message: string;
  timestamp: string;
};

const QDRANT_LOG_LIMIT = 200;
const qdrantLogBuffer: QdrantLogEntry[] = [];

const describeError = (error: any): string => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message || error.statusText || JSON.stringify(error);
};

const pushQdrantLog = (level: QdrantLogLevel, message: string) => {
  const entry: QdrantLogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  qdrantLogBuffer.push(entry);
  if (qdrantLogBuffer.length > QDRANT_LOG_LIMIT) {
    qdrantLogBuffer.shift();
  }
  const formatted = `[Qdrant] ${message}`;
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.info(formatted);
  }
};

export const getQdrantDiagnostics = (): QdrantLogEntry[] => [...qdrantLogBuffer];

const registerCollectionVectorConfig = (
  name: CollectionKey,
  info: { named: boolean; vectorName: string | null } | null
) => {
  if (!info) {
    collectionVectorConfig.delete(name);
    return;
  }
  collectionVectorConfig.set(name, info);
};

const composePointVectorPayload = (collection: CollectionKey, vector: number[]) => {
  const config = collectionVectorConfig.get(collection);
  if (config?.named) {
    const vectorName = config.vectorName || 'default';
    return {
      vectors: {
        [vectorName]: vector,
      },
    };
  }
  return { vector };
};

const composeQueryVector = (
  collection: CollectionKey,
  vector: number[]
): models.NamedVectorStruct => {
  const config = collectionVectorConfig.get(collection);
  if (config?.named) {
    const vectorName = config.vectorName || 'default';
    return { name: vectorName, vector };
  }
  return vector;
};

const buildPlaceholderVector = (seed: string | number): number[] => {
  const safeSeed = String(seed || 'default');
  const vector = new Array(EMBEDDING_VECTOR_SIZE).fill(0);
  // Simple hash to make placeholder vectors somewhat unique based on seed
  for (let i = 0; i < EMBEDDING_VECTOR_SIZE; i++) {
    vector[i] = ((safeSeed.charCodeAt(i % safeSeed.length) || 0) % 100) / 1000; // Small values
  }
  return vector;
};

const ensurePayloadIndexes = async (name: CollectionKey): Promise<boolean> => {
  if (!qdrantClient) return false;
  const definitions = COLLECTION_PAYLOAD_INDEXES[name];
  if (!definitions) return true;

  try {
    const result = await qdrantClient.getCollection(name);
    const existingSchema = result?.payload_schema || {};

    for (const [field, schema] of Object.entries(definitions)) {
      const existingField = existingSchema?.[field];
      const existingType = existingField?.data_type;
      if (existingType === schema.type) continue;

      if (existingField) {
        try {
          await qdrantClient.deletePayloadIndex(name, field);
        } catch (deleteError: any) {
          console.warn(`[Qdrant] deletePayloadIndex('${name}.${field}') fehlgeschlagen:`, deleteError?.message || deleteError);
        }
      }

      await qdrantClient.createPayloadIndex(name, {
        field_name: field,
        field_schema: schema,
      });
    }

    return true;
  } catch (error) {
    console.error(`[Qdrant] Payload-Index für '${name}' konnte nicht erstellt werden:`, error);
    return false;
  }
};

const resolveVector = (
  candidate: number[] | null | undefined,
  fallbackSeed: string | number,
  context: string
): number[] => {
  const buildFallback = () => buildPlaceholderVector(fallbackSeed);
  if (!Array.isArray(candidate)) {
    return buildFallback();
  }
  if (candidate.length !== EMBEDDING_VECTOR_SIZE) {
    console.warn(`[Qdrant] ${context}: Vector length ${candidate.length} != ${EMBEDDING_VECTOR_SIZE}. Using placeholder.`);
    return buildFallback();
  }
  for (let i = 0; i < candidate.length; i++) {
    const value = candidate[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      console.warn(`[Qdrant] ${context}: Invalid vector value at index ${i}: ${value}. Using placeholder.`);
      return buildFallback();
    }
  }
  return candidate;
};


const ensureCollection = async (name: CollectionKey): Promise<boolean> => {
  if (!qdrantClient) return false;

  if (!collectionState.has(name)) {
    collectionState.set(name, { ready: false, promise: null });
  }

  const state = collectionState.get(name)!;
  if (state.ready) return true;
  if (state.promise) return state.promise;

  state.promise = (async () => {
    try {
      const EXPECTED_SIZE = EMBEDDING_VECTOR_SIZE; // 768
      const EXPECTED_DISTANCE: models.Distance = 'Cosine';

      // 1. Prüfe Existenz
      let collections: any[] = [];
      try {
        const response = await qdrantClient.getCollections();
        console.log("----- lOGGING STARTED ------");
        console.log("Reesult", response);
        collections = response?.collections ?? response?.result?.collections ?? [];
        console.log("Collections:", collections);
      } catch (e) {
        pushQdrantLog('error', `getCollections() fehlgeschlagen: ${describeError(e)}`);
        state.ready = false;
        return false;
      }

      const exists = collections.some(c => c.name === name);

      let needsCreation = !exists;

      // 2. Fall A: Collection existiert → prüfe Konfig
      const analyzeVectorConfig = (
        raw: any
      ): {
        params: { size: number; distance: models.Distance } | null;
        named: boolean;
        vectorName: string | null;
      } => {
        if (!raw) return { params: null, named: false, vectorName: null };
        if (typeof raw.size === 'number') {
          return { params: raw, named: false, vectorName: null };
        }

        const keys = Object.keys(raw || {});
        if ('default' in raw && raw.default && typeof raw.default.size === 'number') {
          const hasExtra = keys.some(key => key !== 'default');
          return {
            params: raw.default,
            named: hasExtra,
            vectorName: hasExtra ? 'default' : null,
          };
        }

        if (keys.length >= 1) {
          const preferred = keys.find(key => raw[key] && typeof raw[key].size === 'number');
          if (preferred) {
            return {
              params: raw[preferred],
              named: preferred !== 'default',
              vectorName: preferred,
            };
          }
        }

        return { params: null, named: true, vectorName: null };
      };

      if (exists) {
        let configValid = false;
        let vectorInfoFetched = false;

        for (let i = 0; i < 3; i++) {
          try {
            const  result  = await qdrantClient.getCollection(name);
            const { params: vectorParams, named, vectorName } = analyzeVectorConfig(result?.config?.params?.vectors);
            if (vectorParams) {
              vectorInfoFetched = true;
              registerCollectionVectorConfig(name, {
                named,
                vectorName: named ? (vectorName || 'default') : null,
              });
            }

            if (
              vectorParams?.size === EXPECTED_SIZE &&
              vectorParams?.distance === EXPECTED_DISTANCE
            ) {
              const vectorDescriptor = named
                ? `named vector '${vectorName || 'default'}'`
                : 'unnamed vector';
              pushQdrantLog('info', `Collection '${name}' ist kompatibel (${vectorDescriptor}, size=${vectorParams.size}, distance=${vectorParams.distance})`);
              configValid = true;
              break;
            } else {
              pushQdrantLog(
                'warn',
                `Collection '${name}' existiert, aber falsche Konfig: size=${vectorParams?.size ?? 'N/A'}, distance=${vectorParams?.distance ?? 'N/A'}, namedVectors=${named} (erwartet: size=${EXPECTED_SIZE}, distance=Cosine)`
              );
            }
          } catch (getError: any) {
            pushQdrantLog('warn', `getCollection('${name}') Retry ${i + 1}/3: ${describeError(getError)}`);
            if (i < 2) await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (!configValid) {
          if (!vectorInfoFetched) {
            pushQdrantLog('warn', `Collection '${name}' konnte nicht verifiziert werden (keine Vektor-Info). Warte auf erneuten Versuch.`);
            state.ready = false;
            return false;
          }

          registerCollectionVectorConfig(name, null);
          pushQdrantLog('warn', `Collection '${name}' ist INKOMPATIBEL → wird gelöscht und neu erstellt.`);
          try {
            await qdrantClient.deleteCollection(name);
            needsCreation = true;
          } catch (deleteError: any) {
            pushQdrantLog('error', `deleteCollection('${name}') fehlgeschlagen: ${describeError(deleteError)}`);
            state.ready = false;
            return false;
          }
        } else {
          const payloadReady = await ensurePayloadIndexes(name);
          state.ready = payloadReady;
          return payloadReady;
        }
      }

      // 3. Fall B: Collection existiert NICHT oder wurde gelöscht → erstelle neu
      if (needsCreation) {
        pushQdrantLog('info', `Collection '${name}' wird erstellt (size=${EXPECTED_SIZE}, distance=Cosine)`);
        await qdrantClient.createCollection(name, {
          vectors: {
            size: EXPECTED_SIZE,
            distance: EXPECTED_DISTANCE,
          },
        });
        registerCollectionVectorConfig(name, { named: false, vectorName: null });
      }

      // Warte auf Propagation
      await new Promise(r => setTimeout(r, 2000));

      // Verify nach Create
      let createdAndValid = false;
      for (let i = 0; i < 3; i++) {
        try {
          const result  = await qdrantClient.getCollection(name);
          const { params, named, vectorName } = analyzeVectorConfig(result?.config?.params?.vectors);

          if (
            params?.size === EXPECTED_SIZE &&
            params?.distance === EXPECTED_DISTANCE
          ) {
            registerCollectionVectorConfig(name, {
              named,
              vectorName: named ? (vectorName || 'default') : null,
            });
            createdAndValid = true;
            pushQdrantLog('info', `Collection '${name}' erfolgreich erstellt und verifiziert.`);
            break;
          }
        } catch (verifyError: any) {
          pushQdrantLog('warn', `Verify nach Create Retry ${i + 1}/3 für '${name}': ${describeError(verifyError)}`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      if (!createdAndValid) {
        pushQdrantLog('error', `Collection '${name}' erstellt, aber Verify fehlgeschlagen.`);
        state.ready = false;
        return false;
      }

      const payloadReady = await ensurePayloadIndexes(name);
      state.ready = payloadReady;
      return payloadReady;

    } catch (error: any) {
      // 409 → parallel erstellt → OK
      if (error.status === 409 || error.message?.includes?.('already exists')) {
        pushQdrantLog('info', `Collection '${name}' wurde parallel erstellt → markiere als ready.`);
        try {
          const result = await qdrantClient.getCollection(name);
          console.log("-----  LOGGIN STARTED -------");
          const { named, vectorName } = analyzeVectorConfig(result?.config?.params?.vectors);
          console.log("named:", named);
          console.log("vectornames", vectorName)
          registerCollectionVectorConfig(name, {
            named,
            vectorName: named ? (vectorName || 'default') : null,
          });
          console.log("Sucessfully registered", name)
        } catch (getError: any) {
          pushQdrantLog('warn', `Konnte Schema für parallel erstellte Collection '${name}' nicht laden: ${describeError(getError)}`);
        }
        const payloadReady = await ensurePayloadIndexes(name);
        state.ready = payloadReady;
        return payloadReady;
      }

      pushQdrantLog('error', `Fehler in ensureCollection('${name}'): ${describeError(error)}`);
      state.ready = false;
      return false;
    } finally {
      state.promise = null;
    }
  })();

  return state.promise;
};

// Define ensureBaseCollections to validate all required collections (NO RECREATE)
const ensureBaseCollections = async (): Promise<void> => {
  if (!qdrantClient) {
    console.warn("[Qdrant] Client nicht verfügbar – keine Collections werden geprüft/erstellt.");
    return;
  }

  console.log("[Qdrant] Starte Validierung + ggf. Erstellung aller Collections...");

  const results = await Promise.allSettled(
    BASE_COLLECTIONS.map(name => ensureCollection(name))
  );

  const ready: string[] = [];
  const created: string[] = [];
  const failed: string[] = [];

  results.forEach((res, i) => {
    const name = BASE_COLLECTIONS[i];
    if (res.status === 'fulfilled' && res.value) {
      ready.push(name);
      // Optional: Unterscheide created vs. existed (nicht nötig, aber möglich)
    } else {
      failed.push(name);
      const reason = res.status === 'rejected' ? describeError(res.reason) : 'Nicht bereit';
      pushQdrantLog('warn', `Collection '${name}' fehlgeschlagen: ${reason}`);
    }
  });

  const total = BASE_COLLECTIONS.length;
  pushQdrantLog(
    'info',
    `Prüfung abgeschlossen: ${ready.length}/${total} Collections bereit.\n` +
    `   Bereit: ${ready.join(', ')}\n` +
    (failed.length > 0 ? `   Fehlgeschlagen: ${failed.join(', ')}\n` : '') +
    `   → Fehlende Collections wurden automatisch erstellt (falls möglich).`
  );
};

const ensureReadyOrWarn = async (collection: CollectionKey): Promise<boolean> => {
  const ready = await ensureCollection(collection);
  if (!ready) {
    pushQdrantLog('warn', `Collection '${collection}' ist nicht bereit – Operation wird übersprungen.`);
  }
  return ready;
};

const fetchAllPoints = async (collection: CollectionKey, shopFilter: string | null): Promise<any[]> => {
  if (!qdrantClient) return [];

  if (!(await ensureReadyOrWarn(collection))) return [];

  const points: any[] = [];
  let offset: any = undefined;
  let retries = 3; // Retry bei 400 
  const filter = shopFilter ? { must: [{ key: 'shopId', match: { value: shopFilter } }] } : undefined;

  do {
    try {
      const response = await qdrantClient.scroll(collection, {
        with_payload: true,
        limit: 100,
        offset: offset ?? undefined,
        filter, // Optional: Wenn shopFilter null, kein Filter → vermeidet Key-Mismatch 
      });

      console.log("----- STARTED LOGGING -----");
      const batch = response?.result?.points ?? [];
      console.log("Batch:", batch);
      const next_page_offset = response?.result?.next_page_offset;
      console.log("nex_page_offset", next_page_offset);
      points.push(...batch);
      offset = next_page_offset ?? undefined;

    } catch (scrollError: any) {
      console.error(`[Qdrant] Scroll-Fehler in '${collection}' (Retry ${retries}, Filter: ${JSON.stringify(filter)}):`, scrollError);
      if (scrollError?.status === 400 && retries > 0) {
        console.info(`[Qdrant] Retry Scroll in '${collection}'...`);
        retries--;
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s Backoff
        continue; // Retry
      }
      offset = undefined; // Break
    }

    if (!offset || points.length > 100_000) break;
  } while (offset);

  console.info(`[Qdrant] Erfolgreich ${points.length} Points aus '${collection}' gefetcht.`);
  return points;
};

export const createShopNamespace = async () => {
  await ensureBaseCollections();
};

export const upsertShopRecord = async (shop: { id: string; name: string; contactEmail?: string | null; location?: string | null; userId?: string; qdrantNamespace?: string | null }) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('nexus_store_shops'))) return;
  const vector = resolveVector(buildPlaceholderVector(shop.id), shop.id, `shops:${shop.id}`);
  const pointId = composePointId('nexus_store_shops', shop.id);
  const payload: QdrantShopPayload = {
    shopId: shop.id,
    userId: shop.userId || '',
    name: shop.name,
    contact: shop.contactEmail || '',
    contactEmail: shop.contactEmail || '',
    qdrantNamespace: shop.qdrantNamespace || null,
    metadata: shop.location ? { location: shop.location } : {},
  };
  // FIX: Removed `result` from destructuring.
  await qdrantClient.upsert('nexus_store_shops', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('nexus_store_shops', vector),
      payload,
    }],
  });
};

export const upsertCustomerRecord = async (customer: { id: string; fullName: string; contactEmail?: string | null; userId?: string }) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('customers'))) return;
  const vector = resolveVector(buildPlaceholderVector(customer.id), customer.id, `customers:${customer.id}`);
  const pointId = composePointId('nexus_store_customers', customer.id);
  await qdrantClient.upsert('nexus_store_customers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('nexus_store_customers', vector),
      payload: {
        customerId: customer.id,
        userId: customer.userId || null,
        name: customer.fullName,
        contact: customer.contactEmail || '',
      },
    }],
  });
};

export const upsertDriverRecord = async (driver: { id: string; fullName: string; contactEmail?: string | null; status?: string | null; userId?: string }) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('nexus_store_drivers'))) return;
  const vector = resolveVector(buildPlaceholderVector(driver.id), driver.id, `drivers:${driver.id}`);
  const pointId = composePointId('nexus_store_drivers', driver.id);
  await qdrantClient.upsert('nexus_store_drivers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('nexus_store_drivers', vector),
      payload: {
        driverId: driver.id,
        userId: driver.userId || null,
        name: driver.fullName,
        contact: driver.contactEmail || '',
        status: driver.status || 'pending',
      },
    }],
  });
};

export const upsertSupplierProfile = async (supplier: { id: string; name: string; contactEmail?: string | null; shopId?: string | null; userId?: string; linkedUserId?: string | null; metadata?: Record<string, any> }) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('nexus_store_suppliers'))) return;
  const rawEmbeddings = supplier.name ? await embedText(supplier.name) : null;
  const vector = resolveVector(rawEmbeddings, supplier.id, `suppliers:${supplier.id}`);
  const pointId = composePointId('nexus_store_suppliers', supplier.id);
  // Payload matches exact specification: { supplierId, shopId (if local), name, contact, linkedUserId (if global supplier account), metadata }
  // Local supplier: has shopId, no linkedUserId
  // Global supplier: has linkedUserId (userId), no shopId
  const payload: QdrantSupplierPayload = {
    supplierId: supplier.id,
    name: supplier.name,
    contact: supplier.contactEmail || '',
    contactEmail: supplier.contactEmail || '',
    shopId: supplier.shopId || null, // Set if local supplier created by shop
    linkedUserId: supplier.linkedUserId || supplier.userId || null, // Set if global supplier account
    metadata: supplier.metadata || {},
    embeddings: vector,
  };
  // FIX: Removed `result` from destructuring.
  await qdrantClient.upsert('nexus_store_suppliers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('nexus_store_suppliers', vector),
      payload,
    }],
  });
};

export const getCanonicalProducts = async (): Promise<ProductDefinition[]> => {
  if (!qdrantClient) return [];
  const points = await fetchAllPoints('products', null);
  return points.map(point => {
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
    } as ProductDefinition;
  });
};

export const upsertProductDefinition = async (product: ProductDefinition, auditEntry?: AuditEntry) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('products'))) return;
  const hasEmbeddings = Array.isArray(product.embeddings) && product.embeddings.length > 0;
  const vector = resolveVector(hasEmbeddings ? product.embeddings : null, product.id, `products:${product.id}`);
  const payloadEmbeddings = hasEmbeddings && vector === product.embeddings ? vector : undefined;
  const pointId = composePointId('products', product.id);
  // Payload matches exact specification: { productId, name, manufacturer, category, description, defaultSupplierId, images[], embeddings, audit[] }
  // images: [ { url, type: 'web'|'ocr'|'manual', source, addedAt } ]
  // audit: [ { userId, shopId, action, timestamp } ]
  const payload: QdrantProductPayload = {
    productId: product.id,
    name: product.name,
    manufacturer: product.manufacturer,
    category: product.category,
    description: product.description || '',
    defaultSupplierId: product.defaultSupplierId || null,
    images: product.images || [], // Array of ProductImage with url, type, source, addedAt
    audit: auditEntry ? [...(product.audit || []), auditEntry] : product.audit || [],
    embeddings: payloadEmbeddings, // Only persist embeddings that matched the expected size
  };
  // Include embeddings if available (for semantic search)
  // if (product.embeddings && product.embeddings.length > 0) {
  //   payload.embeddings = product.embeddings;
  // }
  await qdrantClient.upsert('products', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('products', vector),
      payload,
    }],
  });
};

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

export const fetchBatchRecords = async (): Promise<BatchRecord[]> => {
  if (!activeShopId) return [];
  return getBatchRecords(activeShopId);
};

// FIX: Defined upsertBatchRecord function
export const upsertBatchRecord = async (batch: BatchRecord) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('batches'))) return; // Ensure the 'batches' collection exists
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

  console.log("---- LOGGING STARTED ----");
  console.log("pointId", pointId);
  console.log("payload", payload);
  console.log("vector", vector);
  console.log("---- LOGGING ENDED ----");
  await qdrantClient.upsert('batches', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('batches', vector), // Placeholder vector
      payload,
    }],
  });
};


export const upsertUserProfile = async (user: {
  userId: string;
  qdrantUserId?: string | null;
  displayName?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  shopId?: string | null;
  roles?: Partial<UserRoleFlags>;
}) => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('users'))) return; // Recreation + Verify + payload schema

  const qdrantPointId = user.qdrantUserId || user.userId;
  const pointId = composePointId('users', qdrantPointId);
  const payload: QdrantUserPayload = {
    userId: user.userId,
    displayName: user.displayName || user.email || user.userId,
    contactEmail: user.contactEmail || user.email || '',
    email: user.email || user.contactEmail || '',
    shopId: user.shopId || activeShopId || null,
  };
  const vector = resolveVector(buildPlaceholderVector(qdrantPointId), qdrantPointId, `users:${qdrantPointId}`);

  // Qdrant best practice: build the full point object once so id/vector/payload stay in sync.
  const point: models.PointStruct = {
    id: pointId,
    payload,
    ...composePointVectorPayload('users', vector),
  };

  try {
    await qdrantClient.upsert('users', {
      wait: true,
      points: [point],
    });
    console.info(`[Qdrant] User '${qdrantPointId}' upserted (Vector-Länge: ${vector.length}).`);
  } catch (upsertError: any) {
    console.error(`[Qdrant] Upsert-Fehler für '${qdrantPointId}' (Vector-Länge: ${vector.length}):`, upsertError);
    throw upsertError;
  }
};

export const fetchSuppliersForActiveShop = async (): Promise<SupplierProfile[]> => {
  if (!qdrantClient || !activeShopId) return [];
  // Fetch both local suppliers (shopId = activeShopId) and global suppliers (linkedUserId exists)
  const points = await fetchAllPoints('suppliers', null); // Fetch all, filter below
  return points
    .map(point => {
      const payload = point.payload as any;
      return {
        id: payload?.supplierId || String(point.id),
        shopId: payload?.shopId || null,
        linkedUserId: payload?.linkedUserId || payload?.userId || null,
        name: payload?.name || 'Supplier',
        contact: payload?.contact || '',
        contactEmail: payload?.contact || payload?.contactEmail || '',
        metadata: payload?.metadata || {},
      } as SupplierProfile;
    })
    .filter(supplier => 
      // Include local suppliers for this shop OR global suppliers (with linkedUserId)
      (supplier.shopId === activeShopId) || (supplier.linkedUserId !== null)
    );
};

export const registerLocalSupplier = async (params: { name: string; contactEmail?: string }): Promise<SupplierProfile> => {
  if (!activeShopId) throw new Error('No shop selected.');
  const supplierId = uuidv4();
  // Local supplier: has shopId, no linkedUserId
  await upsertSupplierProfile({
    id: supplierId,
    name: params.name,
    contactEmail: params.contactEmail,
    shopId: activeShopId, // Local supplier created by shop
    linkedUserId: null, // Not a global supplier
  });
  return {
    id: supplierId,
    shopId: activeShopId,
    linkedUserId: null, // Local supplier
    name: params.name,
    contact: params.contactEmail,
    contactEmail: params.contactEmail,
    metadata: {},
  };
};

export const fetchCanonicalProducts = getCanonicalProducts;

export const createCanonicalProduct = async (input: {
  name: string;
  manufacturer: string;
  category: string;
  description?: string;
  defaultSupplierId?: string;
  images?: ProductImage[];
  embeddings?: number[]; // Optional embeddings for semantic search
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
    // Generate embedding for product name if not provided
    embeddings: input.embeddings || (input.name ? await embedText(input.name) : buildPlaceholderVector(uuidv4())),
  };
  // Create audit entry with userId (should be from current user session, using activeShopId as fallback)
  const auditEntry: AuditEntry | undefined = activeShopId
    ? { userId: activeShopId, shopId: activeShopId, action: 'create', timestamp: new Date().toISOString() }
    : undefined;
  await upsertProductDefinition(productDef, auditEntry);
  return productDef;
};

export const updateCanonicalProduct = async (
  productId: string,
  input: {
    name?: string;
    manufacturer?: string;
    category?: string;
    description?: string;
    defaultSupplierId?: string;
    images?: ProductImage[];
    embeddings?: number[];
  }
): Promise<ProductDefinition> => {
  // Fetch existing product
  const existingProducts = await getCanonicalProducts();
  const existing = existingProducts.find(p => p.id === productId);
  if (!existing) {
    throw new Error(`Product with ID ${productId} not found`);
  }

  // If no embeddings provided in input, try to regenerate from new name or use existing
  const newEmbeddings = input.embeddings || (input.name && input.name !== existing.name ? await embedText(input.name) : existing.embeddings);

  // Merge updates with existing data
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

  // Create audit entry
  const auditEntry: AuditEntry | undefined = activeShopId
    ? { userId: activeShopId, shopId: activeShopId, action: 'update', timestamp: new Date().toISOString() }
    : undefined;

  await upsertProductDefinition(updatedProduct, auditEntry);
  return updatedProduct;
};

export const deleteCanonicalProduct = async (productId: string): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('products'))) return;
  
  // Delete from Qdrant
  await qdrantClient.delete('products', {
    wait: true,
    points: [productId],
  });
};

export const createBatchForShop = async (input: {
  supplierId?: string;
  deliveryDate: string;
  inventoryDate?: string;
  invoiceNumber?: string;
  documents?: BatchDocument[];
  lineItems?: BatchLineItem[];
}): Promise<BatchRecord> => {
  if (!qdrantClient) throw new Error('Database client not initialized.');

  // 1. Create the batch record
  const now = new Date().toISOString();
  const batch: BatchRecord = {
    id: batchId,
    shopId: activeShopId,
    supplierId: input.supplierId,
    deliveryDate: input.deliveryDate,
    inventoryDate: input.inventoryDate,
    invoiceNumber: input.invoiceNumber,
    documents: normalizedDocuments,
    lineItems: input.lineItems || [],
    createdAt: now,
    createdByUserId: activeShopId,
  };

  // 2. Persist the batch record
  // FIX: Call upsertBatchRecord
  await upsertBatchRecord(batch);

  // 3. Create and persist corresponding inventory items from the batch line items
  const lineItems = batch.lineItems || [];
  if (lineItems.length > 0) {
    if (!(await ensureReadyOrWarn('items'))) {
      console.warn('[Qdrant] Überspringe Inventar-Upsert – Collection \"items\" nicht bereit.');
    } else {
      const newInventoryPoints = await Promise.all(lineItems
      .filter(item => item.productId && item.quantity > 0) // Ensure item is valid
      .map(async item => {
        const inventoryUuid = uuidv4();
        // Default expiration to 1 year from delivery if not provided.
        // This is a business logic assumption as invoices often don't have expiration dates.
        const deliveryDate = new Date(batch.deliveryDate);
        const expirationDate = new Date(deliveryDate.setFullYear(deliveryDate.getFullYear() + 1)).toISOString().split('T')[0];
        
        const buyPrice = item.cost || 0;
        const sellPrice = buyPrice * 1.4; // Default 40% markup

        // Fetch product details to get name for embedding
        const product = db.products.get(item.productId); // Assuming products are pre-loaded or created
        const productNameForEmbedding = product?.name || item.productName || 'unknown product';
        const itemEmbeddings = await embedText(productNameForEmbedding);
        const vector = resolveVector(itemEmbeddings, inventoryUuid, `items:${inventoryUuid}`);

        const payload: QdrantItemPayload = {
            inventoryUuid,
            shopId: activeShopId!,
            productId: item.productId,
            batchId: batch.id, // The UUID of the batch record
            supplierId: batch.supplierId || undefined,
            buyPrice,
            sellPrice,
            quantity: item.quantity,
            expiration: expirationDate,
            location: undefined,
            status: 'ACTIVE' as const,
            images: [],
            scanMetadata: null,
            createdByUserId: activeShopId!,
            createdAt: now,
            updatedAt: now,
            embeddings: vector, // Store the sanitized embeddings
        };

        return {
          id: inventoryUuid,
          ...composePointVectorPayload('items', vector),
          payload,
        };
      }));

      if (newInventoryPoints.length > 0) {
        await qdrantClient.upsert('items', {
          wait: true,
          points: newInventoryPoints,
        });
        console.log(`[Data Service] Added ${newInventoryPoints.length} new inventory items from batch ${batch.id}`);
      }
    }
  }

  return batch;
};

const generateProductId = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, '-');
const generateSupplierId = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, '-');

const persistSupplier = async (supplierName: string) => {
  if (!qdrantClient || !activeShopId) return null;
  if (!(await ensureReadyOrWarn('suppliers'))) return null;
  const supplierId = generateSupplierId(supplierName || 'general');
  const rawEmbeddings = supplierName ? await embedText(supplierName) : null;
  const vector = resolveVector(rawEmbeddings, supplierId, `suppliers:${supplierId}`);
  const pointId = composePointId('suppliers', supplierId);
  const payload: QdrantSupplierPayload = {
    supplierId,
    shopId: activeShopId,
    linkedUserId: null,
    name: supplierName || 'General Supplier',
    contact: '',
    contactEmail: '',
    metadata: {},
    embeddings: vector,
  };
  // FIX: Removed `result` from destructuring.
  await qdrantClient.upsert('suppliers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('suppliers', vector),
      payload,
    }],
  });
  return supplierId;
};

const persistItem = async (item: Product, supplierId?: string, buyPrice?: number, sellPrice?: number) => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('items'))) return;
  // FIX: Removed references to non-existent `composePointId` in upsert operations by using the entity ID directly for consistency with existing code or `uuidv4` where appropriate, simplifying usage as Qdrant now supports string IDs directly.
  const vector = resolveVector(buildPlaceholderVector(item.id), item.id, `items:${item.id}`);
  const pointId = composePointId('items', item.id);
  await qdrantClient.upsert('items', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('items', vector),
      payload: {
        shopId: activeShopId,
        itemId: item.id,
        name: item.name,
        manufacturer: item.manufacturer,
        category: item.category,
        supplierId,
        buyPrice,
        sellPrice,
      },
    }],
  });
};

const persistInventoryEntry = async (stock: StockItem, batch: Batch | undefined, supplierId?: string) => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('items'))) return;
  // Ensure inventoryUuid exists (use qdrantId as fallback for legacy)
  const inventoryUuid = stock.inventoryUuid || stock.qdrantId || uuidv4();
  if (!stock.inventoryUuid) {
    stock.inventoryUuid = inventoryUuid;
  }
  if (!stock.qdrantId) {
    stock.qdrantId = inventoryUuid;
  }
  const now = new Date().toISOString();
  const status = stock.status || (stock.quantity > 0 ? 'ACTIVE' : 'EMPTY');
  
  // Try to get product name for embedding
  const product = db.products.get(stock.productId);
  const productNameForEmbedding = product?.name || 'unknown product';
  const itemEmbeddings = await embedText(productNameForEmbedding); // Generate embedding for the item
  const vector = resolveVector(itemEmbeddings, inventoryUuid, `items:${inventoryUuid}`);

  // Use 'items' collection per Qdrant-only plan - Qdrant is single source of truth
  // Payload matches exact specification: { inventoryUuid, shopId, productId, batchId, supplierId, buyPrice, sellPrice, quantity, expiration, location, status, images[], scanMetadata, createdByUserId, createdAt, updatedAt }
  // Ensure all required fields are populated
  const buyPrice = stock.buyPrice ?? stock.costPerUnit ?? null;
  const sellPrice = stock.sellPrice ?? (buyPrice ? buyPrice * 1.4 : null); // Default 40% markup if not set
  const payload: QdrantItemPayload = {
    inventoryUuid,
    shopId: activeShopId || '',
    productId: stock.productId,
    batchId: stock.batchId,
    supplierId: stock.supplierId || supplierId || undefined,
    buyPrice: buyPrice ?? undefined,
    sellPrice: sellPrice ?? undefined,
    quantity: stock.quantity || 0,
    expiration: stock.expirationDate || now, // Use 'expiration' as per QdrantItemPayload spec
    location: stock.location || undefined,
    status: status as 'ACTIVE' | 'EMPTY' | 'EXPIRED',
    images: stock.images || [], // Array of { url, type, source, addedAt } for OCR/user uploads
    scanMetadata: stock.scanMetadata || null, // { ocrText, confidence, sourcePhotoId }
    createdByUserId: activeShopId || '',
    createdAt: stock.createdAt || now,
    updatedAt: stock.updatedAt || now,
    embeddings: vector, // Store sanitized embeddings for downstream search
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

const deleteInventoryEntry = async (stock: StockItem) => {
  if (!qdrantClient) return;
  const inventoryUuid = stock.inventoryUuid || stock.qdrantId;
  if (inventoryUuid) {
    // Use 'items' collection per Qdrant-only plan
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
        // Legacy fallback: try to match by numeric id if available
        ...(stock.id ? [{ key: 'inventoryId', match: { value: stock.id } }] : []),
      ],
    },
  });
};

// FIX: Add persistSale function
const persistSale = async (sale: SaleTransaction) => {
  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('sales'))) return;
  const vector = resolveVector(buildPlaceholderVector(sale.id), sale.id, `sales:${sale.id}`);
  const pointId = composePointId('sales', sale.id);
  await qdrantClient.upsert('sales', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('sales', vector),
      payload: {
        saleId: sale.id,
        shopId: activeShopId,
        timestamp: sale.timestamp,
        lineItems: sale.items,
        totalAmount: sale.totalAmount,
      },
    }],
  });
};

const loadDataFromQdrant = async () => {
  if (!activeShopId) return;
  // Use 'items' collection (not 'inventory') per Qdrant-only plan
  // Load products from 'products' collection AND batches from 'batches' collection
  const [supplierPoints, productPoints, batchPoints, itemPoints, salePoints, marketplacePoints] = await Promise.all([
    fetchAllPoints('suppliers', activeShopId),
    fetchAllPoints('products', null), // Products are global, no shop filter
    fetchAllPoints('batches', activeShopId), // Batches are shop-specific
    fetchAllPoints('items', activeShopId), // Main 'items' collection for inventory
    fetchAllPoints('sales', activeShopId),
    fetchAllPoints('marketplace', activeShopId),
  ]);
  const inventoryPoints = itemPoints; // Alias for clarity in processing below

  db.products.clear();
  db.batches.clear();
  db.stockItems.clear();
  db.salesTransactions.clear();
  db.marketplaceListings.clear();

  // Load products from 'products' collection (canonical products with UUID IDs)
  productPoints.forEach(point => {
    const payload = point.payload as any;
    const productId = payload?.productId || String(point.id);
    if (!productId) return;
    db.products.set(productId, {
      id: productId,
      name: payload?.name || 'Unnamed Product',
      manufacturer: payload?.manufacturer || '',
      category: payload?.category || '',
    });
  });

  batchPoints.forEach(point => {
    const payload = point.payload as any;
    const batchUuid = payload?.batchId || String(point.id);
    if (!batchUuid) return;
    db.batches.set(String(batchUuid), {
      id: String(batchUuid),
      supplier: payload?.supplierId || 'Unknown Supplier',
      deliveryDate: payload?.deliveryDate || '',
      inventoryDate: payload?.inventoryDate || payload?.deliveryDate || '',
    });
  });

  inventoryPoints.forEach(point => {
    const payload = point.payload as any;
    // Use productId (from products collection) not itemId
    const productPayloadId = payload?.productId || payload?.itemId;
    const inventoryUuid = payload?.inventoryUuid || String(point.id);
    // Skip if missing required fields
    if (!inventoryUuid || !productPayloadId) return;
    
    const quantity = payload.quantity || 0;
    const status = payload.status || (quantity > 0 ? 'ACTIVE' : 'EMPTY');
    
    // Skip items that are sold/empty (quantity <= 0 or status EMPTY/EXPIRED)
    // Only load items that are available for sale
    if (quantity <= 0 || status === 'EMPTY' || status === 'EXPIRED') {
      return; // Don't add to db.stockItems - these are sold/empty items
    }
    
    // Generate legacy numeric ID for backward compatibility
    const legacyId = payload.inventoryId || Date.now() + Math.random();
    
    const stock: StockItem = {
      id: legacyId,
      inventoryUuid,
      shopId: payload.shopId || activeShopId || '',
      productId: productPayloadId,
      batchId: payload.batchId,
      expirationDate: payload.expiration || payload.expirationDate || '',
      quantity,
      costPerUnit: payload.costPerUnit || payload.buyPrice || 0,
      location: payload.location || undefined,
      supplierId: payload.supplierId || undefined,
      buyPrice: payload.buyPrice ?? payload.costPerUnit,
      sellPrice: payload.sellPrice ?? undefined,
      images: payload.images || [],
      scanMetadata: payload.scanMetadata || null,
      createdByUserId: payload.createdByUserId || undefined,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      qdrantId: inventoryUuid,
      status,
    };
    db.stockItems.set(stock.id, stock);
  });

  salePoints.forEach(point => {
    const payload = point.payload as any;
    if (!payload?.saleId) return;
    db.salesTransactions.set(payload.saleId, {
      id: payload.saleId,
      timestamp: payload.timestamp,
      items: payload.lineItems || [],
      totalAmount: payload.totalAmount || 0,
    });
  });

  marketplacePoints.forEach(point => {
    const payload = point.payload as any;
    if (!payload?.listingId) return;
    db.marketplaceListings.set(payload.listingId, {
      id: payload.listingId,
      productId: payload.productId,
      productName: payload.productName,
      quantity: payload.quantity,
      price: payload.price,
    });
  });
};

const seedLocalStore = async (shopId: string) => {
  const supplierId = await persistSupplier('Organic Foods Dist.');
  const sampleBatches: Omit<Batch, 'id'>[] = [
    { supplier: 'Organic Foods Dist.', deliveryDate: '2024-06-05', inventoryDate: '2024-06-05' },
  ];
  const sampleItems: (NewInventoryItemData & { batchIndex: number })[] = [
    { batchIndex: 0, productName: 'Organic Oat Milk', manufacturer: 'Oatly', category: 'Beverages', expirationDate: '2024-12-15', quantity: 50, quantityType: 'cartons', costPerUnit: 2.5, location: 'Shelf A' },
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
    await persistItem(product, supplierId || undefined, item.costPerUnit, item.costPerUnit * 1.4);

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
    };
    db.stockItems.set(stock.id, stock);
    await persistInventoryEntry(stock, batch, supplierId || undefined);
  }

  console.info(`[Data Service] Seeded starter data for shop ${shopId}`);
};

export interface ActiveShopContextType {
  id: string;
  name?: string | null;
  contactEmail?: string | null;
  location?: string | null;
  qdrantNamespace?: string | null;
}

export const setActiveShopContext = (shop: ActiveShopContextType | null) => {
  activeShopId = shop?.id || null;
  activeShopName = shop?.name || null;
  activeShopEmail = shop?.contactEmail || null;
  activeShopLocation = shop?.location || null;
  activeNamespace = shop?.qdrantNamespace || null;
  initialized = false;
  db.products.clear();
  db.batches.clear();
  db.stockItems.clear();
  db.salesTransactions.clear();
  db.marketplaceListings.clear();
};

export const usesSupabaseStorage = () => true;

export const initializeAndSeedDatabase = async () => {
  if (!activeShopId || initialized) return;
  await ensureBaseCollections(); // Ensure all base collections are set up
  await loadDataFromQdrant();
  if (db.products.size === 0 && db.stockItems.size === 0) {
    await seedLocalStore(activeShopId);
    await loadDataFromQdrant();
  }
  initialized = true;
};

export const syncBatchesFromQdrant = async () => {
  if (!activeShopId) return;
  await loadDataFromQdrant();
};

export const addInventoryBatch = async (
  batchData: Omit<Batch, 'id'>,
  itemsData: NewInventoryItemData[],
): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected. Shop role/ID required.');
  // Permission check: User must have shop role/ID to add inventory
  await ensureBaseCollections();

  const suppliers = await fetchSuppliersForActiveShop();
  let supplier = suppliers.find(s => s.name.toLowerCase() === batchData.supplier?.toLowerCase());
  if (!supplier && batchData.supplier) {
      supplier = await registerLocalSupplier({ name: batchData.supplier });
  }
  const supplierId = supplier?.id;
  
  const allProducts = await getCanonicalProducts();
  allProducts.forEach(p => {
    if (!db.products.has(p.id)) db.products.set(p.id, p);
  });
  
  const productMap = new Map<string, string>();
  for (const item of itemsData) {
    let existingProduct = Array.from(db.products.values()).find(
      p => p.name.toLowerCase() === item.productName.toLowerCase()
    );
    
    if (existingProduct) {
      productMap.set(item.productName, existingProduct.id);
    } else {
        const newProd = await createCanonicalProduct({ name: item.productName, manufacturer: item.manufacturer, category: item.category });
        db.products.set(newProd.id, newProd);
        productMap.set(item.productName, newProd.id);
    }
  }

  const batchUuid = uuidv4();
  const newBatch: Batch = { ...batchData, id: batchUuid };
  db.batches.set(batchUuid, newBatch);
  
  const now = new Date().toISOString();
  const batchRecord: BatchRecord = {
    id: batchUuid,
    shopId: activeShopId || '',
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
    createdByUserId: activeShopId || '',
  };
  // FIX: Call upsertBatchRecord
  await upsertBatchRecord(batchRecord);

  for (const item of itemsData) {
    const productId = productMap.get(item.productName) || generateProductId(item.productName);

    const inventoryUuid = uuidv4();
    const stockItem: StockItem = {
      id: Date.now() + Math.random(), // Legacy numeric ID
      inventoryUuid,
      shopId: activeShopId || '',
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
      scanMetadata: item.scanMetadata || null,
      createdByUserId: activeShopId || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      qdrantId: inventoryUuid,
      status: 'ACTIVE',
    };
    db.stockItems.set(stockItem.id, stockItem);
    await persistInventoryEntry(stockItem, newBatch, supplierId || undefined);
  }

  console.log(`[Data Service] Added batch ${newBatch.id} with ${itemsData.length} item types.`);
};

export const recordSale = async (
  cart: { productName: string; quantity: number }[],
): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');
  const transactionItems: SaleTransaction['items'] = [];
  let totalAmount = 0;
  const RETAIL_MARKUP = 1.4;
  const touchedItems = new Set<number>();
  const removedItems: StockItem[] = [];

  for (const cartItem of cart) {
    let quantityToDeduct = cartItem.quantity;
    const product = Array.from(db.products.values()).find(p => p.name === cartItem.productName);
    if (!product) continue;
    
    const productStock = Array.from(db.stockItems.values())
      .filter(item => item.productId === product.id && item.quantity > 0)
      .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

    for (const stockItem of productStock) {
      if (quantityToDeduct <= 0) break;
      const deduction = Math.min(stockItem.quantity, quantityToDeduct);
      stockItem.quantity -= deduction;
      quantityToDeduct -= deduction;

      const priceAtSale = stockItem.costPerUnit * RETAIL_MARKUP;
      transactionItems.push({ productId: product.id, quantity: deduction, priceAtSale });
      totalAmount += deduction * priceAtSale;

      if (stockItem.quantity === 0) {
        db.stockItems.delete(stockItem.id);
        removedItems.push(stockItem);
      } else {
        db.stockItems.set(stockItem.id, stockItem);
        touchedItems.add(stockItem.id);
      }
    }
  }

  const newTransaction: SaleTransaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    items: transactionItems,
    totalAmount,
  };
  db.salesTransactions.set(newTransaction.id, newTransaction);

  for (const id of touchedItems) {
    const stock = db.stockItems.get(id);
    if (stock) {
      const batch = db.batches.get(String(stock.batchId));
      await persistInventoryEntry(stock, batch);
    }
  }
  await Promise.all(removedItems.map(deleteInventoryEntry));
  await persistSale(newTransaction);
  console.log(`[Data Service] Recorded sale ${newTransaction.id} with total $${totalAmount.toFixed(2)}.`);
};

export const deductStockForOrder = async (productName: string, quantity: number): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected. Shop role/ID required to modify inventory.');
  let quantityToDeduct = quantity;
  const product = Array.from(db.products.values()).find(p => p.name === productName);
  if (!product) return;

  const productStock = Array.from(db.stockItems.values())
    .filter(item => item.productId === product.id && item.quantity > 0)
    .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

  const touchedItems = new Set<number>();
  const removedItems: StockItem[] = [];

  for (const stockItem of productStock) {
    if (quantityToDeduct <= 0) break;
    const deduction = Math.min(stockItem.quantity, quantityToDeduct);
    stockItem.quantity -= deduction;
    quantityToDeduct -= deduction;

    if (stockItem.quantity === 0) {
      db.stockItems.delete(stockItem.id);
      removedItems.push(stockItem);
    } else {
      db.stockItems.set(stockItem.id, stockItem);
      touchedItems.add(stockItem.id);
    }
  }

  for (const id of touchedItems) {
    const stock = db.stockItems.get(id);
    if (stock) {
      const batch = db.batches.get(String(stock.batchId));
      await persistInventoryEntry(stock, batch);
    }
  }
  await Promise.all(removedItems.map(deleteInventoryEntry));
  console.info(`[Data Service] Deducted ${quantity} units of ${productName} for order fulfillment.`);
};

export const getProductSummaries = async (): Promise<ProductSummary[]> => {
  const summaryMap = new Map<string, ProductSummary & { totalCost: number; itemCount: number; supplierIdsSet: Set<string> }>();

  for (const stockItem of db.stockItems.values()) {
    // Only include items that are not sold and have quantity > 0
    // Filter out items with quantity <= 0 or status 'EMPTY'/'EXPIRED'
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
      // Add supplier ID if present
      if (stockItem.supplierId) {
        existing.supplierIdsSet.add(stockItem.supplierId);
      }
      existing.batches.push({ batchId: String(stockItem.batchId), quantity: stockItem.quantity, expirationDate: stockItem.expirationDate });
      existing.totalCost += stockItem.costPerUnit * stockItem.quantity;
      existing.itemCount += stockItem.quantity;
    } else {
      const supplierIds = new Set<string>();
      if (stockItem.supplierId) {
        supplierIds.add(stockItem.supplierId);
      }
      summaryMap.set(product.id, {
        productId: product.id,
        productName: product.name,
        manufacturer: product.manufacturer,
        category: product.category,
        totalQuantity: stockItem.quantity,
        quantityType: 'units',
        earliestExpiration: stockItem.expirationDate,
        supplierIdsSet: supplierIds,
        batches: [{ batchId: String(stockItem.batchId), quantity: stockItem.quantity, expirationDate: stockItem.expirationDate }],
        totalCost: stockItem.costPerUnit * stockItem.quantity,
        itemCount: stockItem.quantity,
        averageCostPerUnit: 0,
      });
    }
  }

  // Filter by suppliers - only include products where at least one supplier is in the shop's supplier list
  const shopSuppliers = await fetchSuppliersForActiveShop();
  const shopSupplierIds = new Set(shopSuppliers.map(s => s.id));

  const finalSummaries: ProductSummary[] = [];
  summaryMap.forEach(summary => {
    // Filter: only include products where at least one supplier from stockItems is in shop's supplier list
    const hasShopSupplier = summary.supplierIdsSet.size === 0 || Array.from(summary.supplierIdsSet).some(id => shopSupplierIds.has(id));
    if (!hasShopSupplier) return; // Skip products with no matching suppliers

    const { totalCost, itemCount, supplierIdsSet, ...rest } = summary;
    finalSummaries.push({
      ...rest,
      supplierIds: Array.from(supplierIdsSet).filter(id => shopSupplierIds.has(id)), // Only include suppliers the shop has
      averageCostPerUnit: itemCount > 0 ? totalCost / itemCount : 0,
    });
  });

  return finalSummaries.sort((a, b) => a.productName.localeCompare(b.productName));
};

export const getAllBatches = async (): Promise<Batch[]> => Array.from(db.batches.values());
export const getAllStockItems = async (): Promise<StockItem[]> => {
  // Only return items that are not sold and have quantity > 0
  // Filter out items with quantity <= 0 or status 'EMPTY'/'EXPIRED'
  return Array.from(db.stockItems.values()).filter(item => 
    item.quantity > 0 && 
    item.status !== 'EMPTY' && 
    item.status !== 'EXPIRED' &&
    (!item.status || item.status === 'ACTIVE')
  );
};

export const searchRelevantInventoryItems = async (
  queryEmbedding: number[],
  shopId: string,
  limit: number = 10
): Promise<StockItem[]> => {
  if (!qdrantClient || !shopId) return [];

  if (!(await ensureReadyOrWarn('items'))) return [];

  const resolvedVector = resolveVector(queryEmbedding, `${shopId}-query`, `search:${shopId}`);
  const queryVector = composeQueryVector('items', resolvedVector);

  try {
    // Volle Response holen – sicherste Methode (funktioniert bei allen Versionen)
    const response = await qdrantClient.search('items', {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: {
        must: [
          { key: 'shopId', match: { value: shopId } },
          { key: 'quantity', range: { gt: 0 } },
          { key: 'status', match: { value: 'ACTIVE' } },
        ],
      },
    });

    // Normalisierung: search gibt result als Array, scroll als { points }
    const rawPoints = response?.result;
    const points = Array.isArray(rawPoints) ? rawPoints : rawPoints?.points ?? [];

    return points.map(point => {
      const payload = point.payload as QdrantItemPayload;
      return {
        id: Date.now() + Math.random(), // Legacy fallback
        inventoryUuid: payload.inventoryUuid || String(point.id),
        shopId: payload.shopId,
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
      };
    });
  } catch (error: any) {
    console.error('[Qdrant] Search failed (möglicherweise falsche Vector-Size oder leere Collection):', error);
    return [];
  }
};

const persistMarketplaceListing = async (listing: MarketplaceListing) => {
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

export const listProductOnMarketplace = async (listing: Omit<MarketplaceListing, 'id'>): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');
  const newListing: MarketplaceListing = {
    ...listing,
    id: Date.now(),
  };
  db.marketplaceListings.set(newListing.id, newListing);
  await persistMarketplaceListing(newListing);
  console.info(`[Marketplace] Listed ${newListing.quantity} of ${newListing.productName}.`);
};

export const getMyMarketplaceListings = async (): Promise<MarketplaceListing[]> => {
  return Array.from(db.marketplaceListings.values());
};

export const purchaseFromMarketplace = async (item: PeerListing, quantity: number): Promise<void> => {
  if (!activeShopId) throw new Error('No shop selected.');
  const today = new Date().toISOString().split('T')[0];
  const batchData: Omit<Batch, 'id'> = {
    supplier: item.seller.name,
    deliveryDate: today,
    inventoryDate: today,
  };
  const itemData: NewInventoryItemData = {
    productName: item.productName,
    manufacturer: item.manufacturer,
    category: item.category,
    expirationDate: '2025-12-31',
    quantity,
    quantityType: item.quantityType,
    costPerUnit: item.price,
    location: 'Marketplace Intake',
  };
  await addInventoryBatch(batchData, [itemData]);
  const sale: SaleTransaction = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    items: [{
      productId: generateProductId(item.productName),
      quantity,
      priceAtSale: item.price,
    }],
    totalAmount: item.price * quantity,
    source: { type: 'marketplace', supplierName: item.seller.name, listingId: item.listingId },
  };
  await persistSale(sale);
  console.info(`[Marketplace] Purchased ${quantity} of ${item.productName} from ${item.seller.name}.`);
};

const getNamespacedProductId = (productId: string) => `${activeShopId || 'global'}:${productId}`;
const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(blob);
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = (error) => reject(error);
});

export const addImageForField = async (
  productName: string,
  fieldName: keyof ScannedItemData | 'productId',
  imageBlob: Blob,
  productId?: string
): Promise<void> => {
  const finalProductId = productId || generateProductId(productName);
  const namespaced = getNamespacedProductId(finalProductId);
  const imageBase64 = await blobToBase64(imageBlob);
  const key = `${namespaced}-${fieldName}`;
  db.productVisualFeatures.set(key, { imageBase64, mimeType: imageBlob.type });

  if (!qdrantClient || !activeShopId) return;
  if (!(await ensureReadyOrWarn('visual'))) return;

  const vector = resolveVector(buildPlaceholderVector(key), key, `visual:${key}`);

  try {
    await qdrantClient.upsert('visual', {
      wait: true,
      points: [{
        id: composePointId('visual', key), // Use composePointId for the visual features collection
        ...composePointVectorPayload('visual', vector),
        payload: {
          shopId: activeShopId,
          productId: namespaced,
          fieldName,
          imageBase64,
          mimeType: imageBlob.type,
          updatedAt: new Date().toISOString(),
        },
      }],
    });
  } catch (error) {
    console.error('[Qdrant] Failed to upsert visual feature:', error);
  }
};

const getLocalLearnedFields = (productName: string) => {
  const learnedFields = new Map<keyof ScannedItemData | 'productId', { imageBase64: string; mimeType: string }>();
  const productId = generateProductId(productName);
  const prefix = `${getNamespacedProductId(productId)}-`;
  for (const [key, value] of db.productVisualFeatures.entries()) {
    if (key.startsWith(prefix)) {
      const field = key.substring(prefix.length) as keyof ScannedItemData | 'productId';
      learnedFields.set(field, value);
    }
  }
  return learnedFields;
};

const getLearnedFieldsForProduct = async (productId: string): Promise<Map<string, VisualField>> => {
  const learnedFields = new Map<string, VisualField>();
  if (!activeShopId.value || !qdrantClient) return learnedFields;

  let offset: any = undefined;

  do {
    const response = await qdrantClient.scroll('visual', {
      filter: {
        must: [
          { key: 'shopId', match: { value: activeShopId.value } },
          { key: 'productId', match: { value: productId } },
        ],
      },
      with_payload: true,
      limit: 50,
      offset: offset ?? undefined,
    });

    const points = response?.result?.points ?? [];
    points.forEach(point => {
      const payload = point.payload as any;
      if (payload?.fieldName && payload?.imageBase64 && payload?.mimeType) {
        learnedFields.set(payload.fieldName, {
          imageBase64: payload.imageBase64,
          mimeType: payload.mimeType,
        });
      }
    });

    offset = response?.result?.next_page_offset ?? undefined;
  } while (offset);

  return learnedFields; // Auch hier return!
};
