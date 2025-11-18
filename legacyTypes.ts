
// These types are kept for compatibility with the geminiService schema.
// The main application now uses the more structured types from types.ts.

export interface InventoryBatch {
  id: string | number;
  supplier: string;
  deliveryDate: string;
  inventoryDate: string;
}

export interface InventoryItem {
  id: number;
  batchId: string | number;
  productId: string;
  inventoryUuid?: string;
  productName: string;
  manufacturer: string;
  category: string;
  expirationDate: string;
  quantity: number;
  quantityType: string;
  costPerUnit: number;
  location?: string;
  createdAt?: string;
  updatedAt?: string;
  supplierId?: string | null;
  buyPrice?: number;
  sellPrice?: number;
}
