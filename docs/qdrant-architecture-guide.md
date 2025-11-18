# Qdrant Vector Database Architecture Guide

## Overview
This document outlines the conceptual architecture for organizing points and indexes in your Qdrant vector database for the AI-Genesis inventory management system.

---

## 1. Collection Strategy

### 1.1 Collection Types
Your system uses **12 base collections**, each serving a specific domain:

| Collection | Purpose | Vector Strategy | Filtering Needs |
|------------|---------|----------------|-----------------|
| `users` | User profiles | Placeholder (no semantic search) | High (userId, email, shopId) |
| `shops` | Shop/store records | Placeholder | Medium (shopId, userId) |
| `customers` | Customer profiles | Placeholder | Medium (customerId, userId) |
| `suppliers` | Supplier profiles | **Semantic** (name embeddings) | High (supplierId, shopId, linkedUserId) |
| `products` | Canonical product definitions | **Semantic** (name/description embeddings) | Medium (productId, category, manufacturer) |
| `items` | Inventory stock items | **Semantic** (product name embeddings) | **Very High** (shopId, productId, batchId, status, quantity, expiration) |
| `batches` | Delivery batch records | Placeholder | High (batchId, shopId, supplierId, deliveryDate) |
| `sales` | Sales transactions | Placeholder | Medium (saleId, shopId, timestamp) |
| `drivers` | Driver profiles | Placeholder | Medium (driverId, userId, status) |
| `visual` | Visual learning features | Placeholder | Medium (shopId, productId, fieldName) |
| `marketplace` | Marketplace listings | Placeholder | Medium (shopId, listingId, productId) |
| `inventory` | Legacy/alias for items | (Deprecated) | - |

### 1.2 Collection Configuration
- **Vector Size**: 768 dimensions (from `EMBEDDING_VECTOR_SIZE`)
- **Distance Metric**: Cosine similarity
- **Vector Type**: Unnamed vectors (single vector per point)
- **Point ID Format**: Deterministic UUIDs using `uuidv5(collection:entityId, namespace)`

---

## 2. Point ID Strategy

### 2.1 Deterministic UUIDs
```typescript
// Current implementation
const composePointId = (collectionName: CollectionKey, entityId: string | number): string => {
  return uuidv5(`${collectionName}:${entityId}`, UUID_NAMESPACE);
};
```

**Benefits:**
- **Idempotent**: Same entity always gets same point ID
- **Safe for upserts**: No duplicate points on retry
- **Traceable**: Can reconstruct entity from point ID if needed

**Example:**
- Collection: `products`
- Entity ID: `"organic-oat-milk"`
- Point ID: `uuidv5("products:organic-oat-milk", UUID_NAMESPACE)` → Always same UUID

### 2.2 Point ID Guidelines
1. **Use entity's primary identifier** (not generated UUIDs unless entity has none)
2. **Keep namespace consistent** across deployments
3. **For new entities**: Generate UUID first, then use it for both entity and point ID
4. **For legacy entities**: Use existing ID (numeric or string)

---

## 3. Vector Strategy

### 3.1 Vector Types by Collection

#### **Semantic Search Collections** (Real Embeddings)
- **`suppliers`**: Embed supplier name for similarity search
- **`products`**: Embed product name + description for product discovery
- **`items`**: Embed product name for inventory search

#### **Placeholder Collections** (No Semantic Search)
- All other collections use `buildPlaceholderVector(seed)`
- Placeholder vectors are small, deterministic values
- Used for collections that need vectors but don't require semantic search

### 3.2 Embedding Generation
```typescript
// For semantic collections
const embeddings = await embedText(productName);
const vector = resolveVector(embeddings, fallbackId, context);

// For placeholder collections
const vector = buildPlaceholderVector(entityId);
```

### 3.3 Vector Validation
Always validate vectors before upsert:
- ✅ Length must be exactly 768
- ✅ All values must be finite numbers
- ✅ Fallback to placeholder if invalid

---

## 4. Payload Structure

### 4.1 Payload Design Principles

1. **Include all queryable fields** in payload
2. **Use consistent field names** across collections
3. **Store denormalized data** for fast filtering (e.g., `shopId` in items)
4. **Include timestamps** for audit trails (`createdAt`, `updatedAt`)
5. **Store embeddings in payload** for debugging/regeneration (optional)

### 4.2 Recommended Payload Fields by Collection

#### **`users`** Collection
```typescript
{
  userId: string;           // Primary identifier
  displayName: string;
  contactEmail: string;
  email: string;
  shopId: string | null;    // If user owns a shop
}
```

#### **`shops`** Collection
```typescript
{
  shopId: string;
  userId: string;           // Owner user ID
  name: string;
  contact: string;
  contactEmail?: string;
  qdrantNamespace?: string;
  metadata?: Record<string, any>;
}
```

#### **`suppliers`** Collection
```typescript
{
  supplierId: string;
  shopId?: string | null;   // Local supplier (created by shop)
  linkedUserId?: string | null; // Global supplier (registered user)
  name: string;
  contact: string;
  contactEmail?: string;
  metadata?: Record<string, any>;
  embeddings?: number[];   // Optional: store for regeneration
}
```

#### **`products`** Collection
```typescript
{
  productId: string;
  name: string;
  manufacturer: string;
  category: string;
  description: string;
  defaultSupplierId?: string | null;
  images: ProductImage[];
  audit: AuditEntry[];     // Change history
  embeddings?: number[];   // Optional: store for regeneration
}
```

#### **`items`** Collection (Most Critical)
```typescript
{
  inventoryUuid: string;   // Primary identifier (same as point ID)
  shopId: string;          // CRITICAL for filtering
  productId: string;       // Link to products collection
  batchId: string | number;
  supplierId?: string | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  quantity: number;        // CRITICAL for filtering (must > 0)
  expiration: string;      // ISO date string
  location?: string | null;
  status: 'ACTIVE' | 'EMPTY' | 'EXPIRED'; // CRITICAL for filtering
  images: ProductImage[];
  scanMetadata: ScanMetadata | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  embeddings?: number[];   // Optional: store for regeneration
}
```

#### **`batches`** Collection
```typescript
{
  batchId: string;
  shopId: string;
  supplierId?: string | null;
  deliveryDate: string;    // ISO date string
  inventoryDate?: string | null;
  invoiceNumber?: string | null;
  documents: BatchDocument[];
  lineItems: BatchLineItem[];
  createdAt: string;
  createdByUserId: string;
}
```

---

## 5. Index Strategy

### 5.1 When to Create Indexes

Create payload indexes for fields that are:
1. **Frequently filtered** in queries
2. **Used in range queries** (dates, numbers)
3. **Used for exact matching** (IDs, status values)
4. **Used in compound filters** (shopId + status + quantity)

### 5.2 Index Types

#### **Keyword Index** (`type: 'keyword'`)
- For exact string matching
- Use for: IDs, emails, status enums, categories
- Example: `userId`, `shopId`, `status`, `category`

#### **Integer Index** (`type: 'integer'`)
- For numeric range queries
- Use for: quantities, prices, timestamps (as numbers)
- Example: `quantity`, `buyPrice`, `sellPrice`

#### **Float Index** (`type: 'float'`)
- For decimal range queries
- Use for: prices, confidence scores
- Example: `price`, `confidence`

#### **Text Index** (`type: 'text'`)
- For full-text search (if needed)
- Use for: descriptions, names (if searching within text)
- Example: `description`, `name` (if text search needed)

### 5.3 Recommended Indexes by Collection

#### **`users`** Collection
```typescript
{
  userId: { type: 'keyword' },      // ✅ Already defined
  displayName: { type: 'keyword' },  // ✅ Already defined
  contactEmail: { type: 'keyword' }, // ✅ Already defined
  email: { type: 'keyword' },       // ✅ Already defined
  shopId: { type: 'keyword' },      // ✅ Already defined
}
```

#### **`shops`** Collection
```typescript
{
  shopId: { type: 'keyword' },
  userId: { type: 'keyword' },
  name: { type: 'keyword' },        // For name lookups
}
```

#### **`suppliers`** Collection
```typescript
{
  supplierId: { type: 'keyword' },
  shopId: { type: 'keyword' },      // Filter local suppliers
  linkedUserId: { type: 'keyword' }, // Filter global suppliers
  name: { type: 'keyword' },        // Optional: name lookups
}
```

#### **`products`** Collection
```typescript
{
  productId: { type: 'keyword' },
  category: { type: 'keyword' },    // Filter by category
  manufacturer: { type: 'keyword' }, // Filter by manufacturer
  defaultSupplierId: { type: 'keyword' },
}
```

#### **`items`** Collection (Most Critical)
```typescript
{
  inventoryUuid: { type: 'keyword' },
  shopId: { type: 'keyword' },      // CRITICAL: Always filter by shop
  productId: { type: 'keyword' },   // Link to products
  batchId: { type: 'keyword' },     // Link to batches
  supplierId: { type: 'keyword' },
  status: { type: 'keyword' },     // CRITICAL: Filter ACTIVE/EMPTY/EXPIRED
  quantity: { type: 'integer' },    // CRITICAL: Range queries (gt: 0)
  expiration: { type: 'keyword' },  // Date filtering (or 'integer' if stored as timestamp)
  location: { type: 'keyword' },    // Optional: location filtering
  createdAt: { type: 'keyword' },    // Date filtering
  updatedAt: { type: 'keyword' },   // Date filtering
}
```

#### **`batches`** Collection
```typescript
{
  batchId: { type: 'keyword' },
  shopId: { type: 'keyword' },
  supplierId: { type: 'keyword' },
  deliveryDate: { type: 'keyword' }, // Date filtering
  inventoryDate: { type: 'keyword' },
}
```

#### **`sales`** Collection
```typescript
{
  saleId: { type: 'keyword' },
  shopId: { type: 'keyword' },
  timestamp: { type: 'keyword' },   // Date filtering
}
```

### 5.4 Index Implementation Pattern

```typescript
const COLLECTION_PAYLOAD_INDEXES: Partial<Record<CollectionKey, PayloadIndexDefinition>> = {
  users: {
    userId: { type: 'keyword' },
    displayName: { type: 'keyword' },
    contactEmail: { type: 'keyword' },
    email: { type: 'keyword' },
    shopId: { type: 'keyword' },
  },
  shops: {
    shopId: { type: 'keyword' },
    userId: { type: 'keyword' },
    name: { type: 'keyword' },
  },
  suppliers: {
    supplierId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    linkedUserId: { type: 'keyword' },
  },
  products: {
    productId: { type: 'keyword' },
    category: { type: 'keyword' },
    manufacturer: { type: 'keyword' },
    defaultSupplierId: { type: 'keyword' },
  },
  items: {
    inventoryUuid: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    batchId: { type: 'keyword' },
    supplierId: { type: 'keyword' },
    status: { type: 'keyword' },
    quantity: { type: 'integer' },
    expiration: { type: 'keyword' },
  },
  batches: {
    batchId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    supplierId: { type: 'keyword' },
    deliveryDate: { type: 'keyword' },
  },
  sales: {
    saleId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    timestamp: { type: 'keyword' },
  },
};
```

---

## 6. Query Patterns

### 6.1 Common Query Patterns

#### **Filter by Shop** (Most Common)
```typescript
filter: {
  must: [
    { key: 'shopId', match: { value: activeShopId } }
  ]
}
```

#### **Filter Active Inventory**
```typescript
filter: {
  must: [
    { key: 'shopId', match: { value: shopId } },
    { key: 'quantity', range: { gt: 0 } },
    { key: 'status', match: { value: 'ACTIVE' } }
  ]
}
```

#### **Semantic Search with Filters**
```typescript
await qdrantClient.search('items', {
  vector: queryVector,
  limit: 10,
  filter: {
    must: [
      { key: 'shopId', match: { value: shopId } },
      { key: 'quantity', range: { gt: 0 } },
      { key: 'status', match: { value: 'ACTIVE' } }
    ]
  }
});
```

#### **Filter by Date Range**
```typescript
filter: {
  must: [
    { key: 'deliveryDate', match: { value: '2024-01-01' } }, // Exact match
    // Or use range if stored as integer timestamp
    { key: 'deliveryDate', range: { gte: startDate, lte: endDate } }
  ]
}
```

### 6.2 Scroll vs Search

- **`search()`**: Use for semantic similarity search with filters
- **`scroll()`**: Use for paginated retrieval with filters (no vector needed)

---

## 7. Best Practices

### 7.1 Point Management

1. **Always use `upsert()`** instead of `create()` for idempotency
2. **Set `wait: true`** for critical operations to ensure consistency
3. **Validate vectors** before upserting
4. **Use deterministic point IDs** to prevent duplicates

### 7.2 Index Management

1. **Create indexes during collection initialization** (in `ensurePayloadIndexes`)
2. **Delete old indexes before recreating** if schema changes
3. **Index only frequently-queried fields** (too many indexes slow writes)
4. **Use `keyword` for exact matches**, `integer`/`float` for ranges

### 7.3 Filtering Best Practices

1. **Always filter by `shopId`** for multi-tenant collections (`items`, `batches`, `sales`)
2. **Combine filters with `must`** for AND logic
3. **Use `should`** for OR logic (less common)
4. **Filter before vector search** to reduce search space

### 7.4 Performance Optimization

1. **Index critical filter fields** (`shopId`, `status`, `quantity`)
2. **Use pagination** (`scroll` with `limit` and `offset`) for large result sets
3. **Cache collection configs** (vector size, named vectors) to avoid repeated API calls
4. **Batch upserts** when inserting multiple points

### 7.5 Data Consistency

1. **Store denormalized fields** (e.g., `shopId` in items) for fast filtering
2. **Update related points** when relationships change (e.g., if product name changes, update item embeddings)
3. **Use timestamps** (`createdAt`, `updatedAt`) for audit trails
4. **Validate payload structure** matches TypeScript types

---

## 8. Migration Strategy

### 8.1 Adding New Indexes

1. Add index definition to `COLLECTION_PAYLOAD_INDEXES`
2. Restart application (indexes created on collection initialization)
3. Or manually call `ensurePayloadIndexes(collectionName)`

### 8.2 Changing Index Types

1. Delete old index: `deletePayloadIndex(collection, field)`
2. Create new index: `createPayloadIndex(collection, { field_name, field_schema })`
3. Your code already handles this in `ensurePayloadIndexes`

### 8.3 Adding New Collections

1. Add to `BASE_COLLECTIONS` array
2. Define payload indexes in `COLLECTION_PAYLOAD_INDEXES`
3. Create upsert functions following existing patterns
4. Update `ensureBaseCollections()` if needed

---

## 9. Troubleshooting

### 9.1 Common Issues

**Issue**: "Collection not found"
- **Solution**: Ensure `ensureCollection()` is called before operations

**Issue**: "Vector size mismatch"
- **Solution**: Verify all vectors are exactly 768 dimensions

**Issue**: "Filter not working"
- **Solution**: Ensure field is indexed and filter syntax is correct

**Issue**: "Duplicate points"
- **Solution**: Use deterministic point IDs with `composePointId()`

### 9.2 Debugging Tips

1. **Check collection config**: `await qdrantClient.getCollection(name)`
2. **Verify payload schema**: Check `payload_schema` in collection info
3. **Test filters**: Use `scroll()` with filters to verify indexes work
4. **Log point IDs**: Ensure they're deterministic and consistent

---

## 10. DAN Architecture

The Decentralized Autonomous Network (DAN) reuses the exact Qdrant schema, payloads, and deterministic IDs described above. Instead of inventing a custom ledger, each DAN event is a Qdrant operation that any peer can replay.

### 10.1 Node Roles
- **Shop Nodes**: Run the full stack (React UI, local Qdrant, Supabase auth cache). They own the authoritative collections for their shop IDs and emit WAL streams of every `upsert`/`delete`.
- **Relay Nodes**: Lightweight peers that subscribe to multiple Shop Nodes, rebroadcast events, and optionally keep archival Qdrant snapshots for disaster recovery.
- **Observer Nodes**: Read-only analytics agents. They subscribe to the DAN feed, replay events into a local Qdrant replica, and run aggregate queries (demand forecasting, compliance, etc.).

### 10.2 Event Envelope
All network traffic is a signed JSON envelope that references native Qdrant structures:
```json
{
  "collection": "nexus_store_items",
  "action": "UPSERT", // or DELETE, SCHEMA_UPDATE, DIAGNOSTIC
  "point": { "id": "uuid", "payload": {...}, "vector": [...] },
  "clock": { "shopId": "shop-123", "seq": 42, "timestamp": "2025-01-10T12:00:00Z" },
  "schema": null,
  "signature": "ed25519:..."
}
```
- `point` mirrors the payload/vector format produced by the existing services (`services/vectorDBService.ts`).
- `schema` carries optional updates (e.g., new payload indexes). Peers simply call `ensureCollection` with the provided config.

### 10.3 Replication Flow
1. Shop Node appends a Qdrant operation to its local WAL (already enforced by `ensureCollection`, `ensurePayloadIndexes`, and deterministic IDs).
2. The DAN agent signs the envelope and gossips it via libp2p/WebRTC or any pub/sub transport.
3. Peers verify the signature, check the logical clock, then replay the event by calling `qdrantClient.upsert/delete`.
4. Because payload indexes and strict mode are identical across nodes, replicated points are query-ready instantly.

### 10.4 Governance and Resilience
- **Identity**: Deterministic point IDs + Supabase-issued credentials map directly to DAN identities (DIDs). A Shop Node’s DID is derived from `composePointId('nexus_store_shops', shopId)`.
- **Staking/Slashing**: Economic incentives can be layered on top by requiring each envelope to reference a stake channel; misbehavior (invalid payloads, spam) leads to slashing.
- **Diagnostics**: `getQdrantDiagnostics()` logs become `DIAGNOSTIC` envelopes, enabling observers to evaluate node health without SSH access.
- **Recovery**: If a Shop Node goes offline, the relays/observers retain its latest state as Qdrant snapshots. Rejoining simply requires replaying outstanding envelopes.

This approach keeps DAN logic thin: Qdrant is both the local datastore and the replication format, giving us consistency, schema enforcement, and vector search without custom CRDTs.

---

## 11. Summary Checklist

When setting up a new collection or point:

- [ ] Collection name added to `BASE_COLLECTIONS`
- [ ] Point ID strategy defined (deterministic UUID)
- [ ] Vector strategy chosen (semantic vs placeholder)
- [ ] Payload structure matches TypeScript types
- [ ] Indexes defined for frequently-queried fields
- [ ] Upsert function created with validation
- [ ] Filter patterns documented
- [ ] Test queries written

---

## Appendix: Current Implementation Status

### ✅ Implemented
- Collection initialization (`ensureCollection`)
- Payload index management (`ensurePayloadIndexes`)
- Deterministic point IDs (`composePointId`)
- Vector validation (`resolveVector`)
- Placeholder vectors for non-semantic collections

### ⚠️ Partially Implemented
- Payload indexes (only `users` collection has indexes)
- Semantic embeddings (only `suppliers`, `products`, `items` use real embeddings)

### 📋 Recommended Next Steps
1. Add payload indexes for all collections (especially `items`, `batches`, `products`)
2. Consider adding text indexes for full-text search if needed
3. Add date range indexes if doing time-based queries
4. Document query patterns for each collection
5. Add monitoring/logging for index performance
