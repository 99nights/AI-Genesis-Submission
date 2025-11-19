// A master record for a unique product.
export interface Product {
  id: string; // can be legacy or uuid
  name: string;
  manufacturer: string;
  category: string;
}

export interface ProductImage {
  url: string;
  type: 'web' | 'ocr' | 'manual';
  source?: string;
  addedAt?: string;
}

// --- DAN / Sharing primitives ---

export type DanShareScope = 'local' | 'marketplace' | 'dan';

export interface DanKeyMaterial {
  publicKey: string;
  fingerprint: string;
  derivedAt: string;
  lastRegisteredAt?: string | null;
}

export interface DanContext {
  enabled: boolean;
  shopId: string | null;
  namespace: string | null;
  publicKey?: string | null;
  fingerprint?: string | null;
  capabilityScope: DanShareScope[];
  lastRegisteredAt?: string | null;
  reason?: 'flag-disabled' | 'no-shop' | 'missing-supabase' | 'ok';
}

export type DanEventType =
  | 'inventory.offer.created'
  | 'inventory.offer.reserved'
  | 'inventory.offer.fulfilled'
  | 'batch.receipt.attested'
  | 'delivery.capacity.updated'
  | 'policy.trigger.executed';

export interface DanActorSignature {
  publicKey: string;
  fingerprint: string;
  signature: string;
}

export interface DanEventRecord {
  eventId: string;
  eventType: DanEventType;
  shopId: string;
  namespace: string | null;
  payload: Record<string, any>;
  shareScope: DanShareScope[];
  vectorContext?: number[] | null;
  proofs?: Record<string, any> | null;
  actor: DanActorSignature;
  createdAt: string;
}

export interface DanEventInput {
  eventType: DanEventType;
  payload: Record<string, any>;
  shareScope?: DanShareScope[];
  vectorContext?: number[] | null;
  proofs?: Record<string, any> | null;
}

export interface DanInventoryOffer {
  inventoryUuid: string;
  shopId: string;
  shopName?: string | null;
  productId: string;
  productName: string;
  quantity: number;
  expirationDate: string;
  locationBucket?: string | null;
  sellPrice?: number | null;
  shareScope: DanShareScope[];
  proofHash?: string;
  updatedAt: string;
}

export type PolicyScope = 'inventory' | 'marketplace' | 'delivery' | 'policy';

export type PolicyConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'includes'
  | 'contains';

export interface PolicyConditionRule {
  field: string; // dot-notation path into event payload
  operator: PolicyConditionOperator;
  value: any;
}

export type PolicyActionType =
  | 'notify'
  | 'create_dan_event'
  | 'tag_inventory'
  | 'call_webhook';

export interface PolicyActionDefinition {
  type: PolicyActionType;
  params?: Record<string, any>;
}

export interface PolicyDescriptor {
  id: string;
  shopId: string;
  name: string;
  description?: string;
  eventType: DanEventType;
  scope: PolicyScope;
  version: string;
  enabled: boolean;
  conditions: PolicyConditionRule[];
  actions: PolicyActionDefinition[];
  author?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRunLog {
  id: string;
  policyId: string;
  shopId: string;
  eventType: DanEventType;
  eventPayload?: Record<string, any>;
  outcome: 'triggered' | 'skipped' | 'error';
  notes?: string;
  createdAt: string;
}

export interface AuditEntry {
  userId: string;
  shopId?: string | null;
  action: string;
  timestamp: string;
}

export interface ProductDefinition {
  id: string; // productId - Qdrant point ID
  name: string;
  manufacturer: string;
  category: string;
  description?: string;
  defaultSupplierId?: string | null;
  images?: ProductImage[];
  audit?: AuditEntry[];
  embeddings?: number[]; // Combined text/image embedding vector
  textEmbedding?: number[]; // Legacy - separate text embedding
  imageEmbedding?: number[]; // Legacy - separate image embedding
}

// Represents a delivery batch.
export interface Batch {
  id: string;
  supplier: string;
  deliveryDate: string;
  inventoryDate: string;
}

// Represents a specific quantity of a product from a specific batch.
// This is the core of inventory tracking (Qdrant items collection).
export interface StockItem {
  id: number; // Legacy numeric ID for backward compatibility
  inventoryUuid: string; // Qdrant point ID (primary identifier)
  shopId: string;
  productId: string;
  batchId: string | number; // Can be string (batchId from BatchRecord) or number (legacy)
  expirationDate: string;
  quantity: number;
  costPerUnit: number;
  location?: string;
  supplierId?: string;
  buyPrice?: number;
  sellPrice?: number;
  images?: ProductImage[];
  scanMetadata?: ScanMetadata | null;
  qdrantId?: string; // Legacy alias for inventoryUuid
  status?: 'ACTIVE' | 'EMPTY' | 'EXPIRED';
  createdByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  shareScope?: DanShareScope[];
  shareProofHash?: string;
}

// A log of a completed customer purchase.
export interface SaleTransaction {
    id: number;
    timestamp: string;
    items: {
        productId: string;
        quantity: number;
        priceAtSale: number; // The price per unit at the time of sale
    }[];
    totalAmount: number;
    source?: {
        type: 'pos' | 'marketplace';
        supplierName?: string;
        listingId?: string;
    };
}

export type ScanFieldSource = 'manual' | 'learned' | 'auto';

export interface ScanFieldCapture {
  field: string;
  captureId: string;
  source: ScanFieldSource;
  capturedAt: string;
  confidence?: number;
}

export interface ScanMetadata {
  ocrText?: string;
  confidence?: number;
  sourcePhotoId?: string;
  fieldCaptures?: ScanFieldCapture[];
}

export interface SupplierProfile {
  id: string; // supplierId - Qdrant point ID
  shopId?: string | null; // Set if local supplier (created by shop)
  linkedUserId?: string | null; // Set if global supplier (registered user with supplier role)
  name: string;
  contact?: string;
  contactEmail?: string; // Alias for contact
  metadata?: Record<string, any>;
}

export interface BatchDocument {
  url: string;
  type: 'invoice' | 'packingSlip' | 'other';
  ocrText?: string;
  checksum?: string;
  batchId?: string;
  uploadedAt?: string;
}

export interface BatchLineItem {
  productId: string;
  productName: string; // The name from the invoice, pre-matching
  quantity: number;
  cost: number;
}

export interface BatchRecord {
  id: string; // batchId - Qdrant point ID
  shopId: string;
  supplierId?: string | null;
  deliveryDate: string;
  inventoryDate?: string; // Optional - when inventory was added
  invoiceNumber?: string;
  documents?: BatchDocument[]; // Array of document URLs with OCR text
  lineItems?: BatchLineItem[]; // Product line items in this batch
  createdAt?: string;
  createdByUserId?: string;
}

// --- Marketplace, Auth, Orders, Drivers ---

export interface User {
  clientId: string;
  companyName: string;
  contactPerson: string;
  address: string;
  email: string;
  role: 'shop' | 'customer' | 'driver' | 'supplier';
  isVerified: boolean;
  isDriverVerified: boolean;
  shopId?: string;
  customerId?: string;
  driverId?: string;
  supplierId?: string;
  roles: {
    shop: boolean;
    customer: boolean;
    driver: boolean;
    supplier: boolean;
  };
}

export interface MarketplaceListing {
  id: number;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface PeerShop {
  id: string;
  name: string;
  listings: PeerListing[];
}

export interface PeerListing {
  listingId: string;
  productName: string;
  manufacturer: string;
  category: string;
  quantity: number;
  quantityType: string;
  price: number;
  seller: {
    id: string;
    name: string;
  }
}

export interface Order {
  id: string;
  requesterShop: { id: string; name: string; address: string };
  productName: string;
  quantity: number;
  status: 'OPEN' | 'PENDING_DELIVERY' | 'COMPLETED';
  createdAt: string;
}

export interface SupplyProposal {
  id: string;
  orderId: string;
  supplierShop: { id: string; name: string; address: string };
  pricePerUnit: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export interface Delivery {
  id: string;
  orderId: string;
  proposalId: string;
  productName: string;
  quantity: number;
  pickup: { name: string; address: string };
  dropoff: { name: string; address: string };
  status: 'AWAITING_DRIVER' | 'IN_TRANSIT' | 'DELIVERED';
  driver?: { id: string; name: string };
  fee: number;
}

// --- Derived/Helper Types for UI ---

export interface NewInventoryItemData {
  productName: string;
  manufacturer: string;
  category: string;
  productDescription?: string;
  productId?: string;
  supplierId?: string;
  expirationDate: string;
  quantity: number;
  quantityType: string;
  costPerUnit: number;
  location?: string;
  buyPrice?: number;
  sellPrice?: number;
  images?: ProductImage[];
  scanMetadata?: ScanMetadata | null;
  shareScope?: DanShareScope[];
}

export interface ProductSummary {
  productId: string;
  productName: string;
  manufacturer: string;
  category: string;
  totalQuantity: number;
  quantityType: string;
  earliestExpiration: string;
  averageCostPerUnit: number;
  averageSellPrice?: number; // Average sell price from actual sellPrice values in inventory items
  supplierIds?: string[]; // Array of supplier IDs that supply this product
  batches: {
    batchId: string;
    quantity: number;
    expirationDate: string;
  }[];
}

// Qdrant collection payload types (internal structure)
export interface QdrantUserPayload {
  userId: string; // Supabase user ID
  displayName: string;
  contactEmail: string;
  email: string;
  shopId: string | null;
  isVerified?: boolean; // Shop verification status
  isDriverVerified?: boolean; // Driver verification status
}

export interface QdrantShopPayload {
  shopId: string; // Qdrant shop ID
  userId: string; // Supabase user ID (owner)
  name: string;
  contact: string;
  contactEmail?: string; // Alias for contact
  qdrantNamespace?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface QdrantSupplierPayload {
  supplierId: string;
  shopId?: string | null; // Local supplier
  linkedUserId?: string | null; // Global supplier (user)
  name: string;
  contact: string;
  contactEmail?: string;
  metadata?: Record<string, any>;
  embeddings?: number[]; // Added for consistency in vector size and potential future use
  [key: string]: any;
}

export interface QdrantProductPayload {
  productId: string;
  name: string;
  manufacturer: string;
  category: string;
  description: string;
  defaultSupplierId?: string | null;
  images: ProductImage[];
  audit: AuditEntry[];
  embeddings?: number[]; // Optional embedding vector
  [key: string]: any;
}

export interface QdrantItemPayload {
  inventoryUuid: string; // Qdrant point ID
  shopId: string;
  productId: string;
  batchId: string | number;
  supplierId?: string | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  quantity: number;
  expiration: string; // expirationDate
  location?: string | null;
  status: 'ACTIVE' | 'EMPTY' | 'EXPIRED';
  images: ProductImage[];
  scanMetadata: ScanMetadata | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  embeddings?: number[]; // Added for RAG
  shareScope?: DanShareScope[];
  shareProofHash?: string;
  [key: string]: any;
}

export interface QdrantBatchPayload {
  batchId: string;
  shopId: string;
  supplierId?: string | null;
  deliveryDate: string;
  inventoryDate?: string;
  invoiceNumber?: string | null;
  documents: BatchDocument[];
  lineItems: BatchLineItem[];
  createdAt: string;
  createdByUserId: string;
  [key: string]: any;
}

export type { InventoryBatch, InventoryItem } from './legacyTypes';
