/**
 * Users, Shops, Customers, Drivers, and Suppliers Service
 * 
 * Handles all user-related entities and shop management.
 */

import { qdrantClient, activeShopId } from '../core';
import { ensureReadyOrWarn } from '../collections';
import { composePointId, composePointVectorPayload, resolveVector, buildPlaceholderVector } from '../vectors';
import { fetchAllPoints } from '../queries';
import { embedText } from '../../embeddingService';
import { v4 as uuidv4 } from 'uuid';
import type {
  QdrantUserPayload,
  QdrantShopPayload,
  QdrantSupplierPayload,
  SupplierProfile,
} from '../../../types';

// ===== USERS =====

export const upsertUserProfile = async (user: {
  userId: string;
  qdrantUserId?: string | null;
  displayName?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  shopId?: string | null;
  isVerified?: boolean;
  isDriverVerified?: boolean;
}): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('users'))) return;

  const qdrantPointId = user.qdrantUserId || user.userId;
  const pointId = composePointId('users', qdrantPointId);
  
  // Fetch existing user to preserve verification status if not provided
  let existingVerified: { isVerified?: boolean; isDriverVerified?: boolean } = {};
  try {
    const existing = await qdrantClient.retrieve('users', {
      ids: [pointId],
      with_payload: true,
    });
    if (existing.points && existing.points.length > 0) {
      const existingPayload = existing.points[0].payload as QdrantUserPayload;
      existingVerified = {
        isVerified: existingPayload.isVerified,
        isDriverVerified: existingPayload.isDriverVerified,
      };
    }
  } catch (err) {
    // User doesn't exist yet, that's fine
  }
  
  const payload: QdrantUserPayload = {
    userId: user.userId,
    displayName: user.displayName || user.email || user.userId,
    contactEmail: user.contactEmail || user.email || '',
    email: user.email || user.contactEmail || '',
    shopId: user.shopId || activeShopId || null,
    isVerified: user.isVerified !== undefined ? user.isVerified : existingVerified.isVerified,
    isDriverVerified: user.isDriverVerified !== undefined ? user.isDriverVerified : existingVerified.isDriverVerified,
  };
  const vector = resolveVector(buildPlaceholderVector(qdrantPointId), qdrantPointId, `users:${qdrantPointId}`);

  await qdrantClient.upsert('users', {
    wait: true,
    points: [{
      id: pointId,
      payload,
      ...composePointVectorPayload('users', vector),
    }],
  });
};

// ===== SHOPS =====

export const createShopNamespace = async (): Promise<void> => {
  // This is now handled by ensureBaseCollections
  // Kept for backward compatibility
};

export const upsertShopRecord = async (shop: {
  id: string;
  name: string;
  contactEmail?: string | null;
  location?: string | null;
  userId?: string;
  qdrantNamespace?: string | null;
}): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('shops'))) return;

  const vector = resolveVector(buildPlaceholderVector(shop.id), shop.id, `shops:${shop.id}`);
  const pointId = composePointId('shops', shop.id);
  const payload: QdrantShopPayload = {
    shopId: shop.id,
    userId: shop.userId || '',
    name: shop.name,
    contact: shop.contactEmail || '',
    contactEmail: shop.contactEmail || '',
    qdrantNamespace: shop.qdrantNamespace || null,
    metadata: shop.location ? { location: shop.location } : {},
  };

  await qdrantClient.upsert('shops', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('shops', vector),
      payload,
    }],
  });
};

// ===== CUSTOMERS =====

export const upsertCustomerRecord = async (customer: {
  id: string;
  fullName: string;
  contactEmail?: string | null;
  userId?: string;
}): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('customers'))) return;

  const vector = resolveVector(buildPlaceholderVector(customer.id), customer.id, `customers:${customer.id}`);
  const pointId = composePointId('customers', customer.id);

  await qdrantClient.upsert('customers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('customers', vector),
      payload: {
        customerId: customer.id,
        userId: customer.userId || null,
        name: customer.fullName,
        contact: customer.contactEmail || '',
      },
    }],
  });
};

// ===== DRIVERS =====

export const upsertDriverRecord = async (driver: {
  id: string;
  fullName: string;
  contactEmail?: string | null;
  status?: string | null;
  userId?: string;
}): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('drivers'))) return;

  const vector = resolveVector(buildPlaceholderVector(driver.id), driver.id, `drivers:${driver.id}`);
  const pointId = composePointId('drivers', driver.id);

  await qdrantClient.upsert('drivers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('drivers', vector),
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

// ===== SUPPLIERS =====

export const upsertSupplierProfile = async (supplier: {
  id: string;
  name: string;
  contactEmail?: string | null;
  shopId?: string | null;
  userId?: string;
  linkedUserId?: string | null;
  metadata?: Record<string, any>;
}): Promise<void> => {
  if (!qdrantClient) return;
  if (!(await ensureReadyOrWarn('suppliers'))) return;

  const rawEmbeddings = supplier.name ? await embedText(supplier.name) : null;
  const vector = resolveVector(rawEmbeddings, supplier.id, `suppliers:${supplier.id}`);
  const pointId = composePointId('suppliers', supplier.id);

  const payload: QdrantSupplierPayload = {
    supplierId: supplier.id,
    name: supplier.name,
    contact: supplier.contactEmail || '',
    contactEmail: supplier.contactEmail || '',
    shopId: supplier.shopId || null,
    linkedUserId: supplier.linkedUserId || supplier.userId || null,
    metadata: supplier.metadata || {},
    embeddings: vector,
  };

  await qdrantClient.upsert('suppliers', {
    wait: true,
    points: [{
      id: pointId,
      ...composePointVectorPayload('suppliers', vector),
      payload,
    }],
  });
};

export const fetchSuppliersForActiveShop = async (): Promise<SupplierProfile[]> => {
  if (!qdrantClient || !activeShopId) return [];

  const points = await fetchAllPoints('suppliers', null);
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
      (supplier.shopId === activeShopId) || (supplier.linkedUserId !== null)
    );
};

export const registerLocalSupplier = async (params: {
  name: string;
  contactEmail?: string;
}): Promise<SupplierProfile> => {
  if (!activeShopId) throw new Error('No shop selected.');

  const supplierId = uuidv4();
  await upsertSupplierProfile({
    id: supplierId,
    name: params.name,
    contactEmail: params.contactEmail,
    shopId: activeShopId,
    linkedUserId: null,
  });

  return {
    id: supplierId,
    shopId: activeShopId,
    linkedUserId: null,
    name: params.name,
    contact: params.contactEmail,
    contactEmail: params.contactEmail,
    metadata: {},
  };
};

// Get all shops (for customer shop selection)
export const getAllShops = async (): Promise<{ id: string; name: string; contactEmail?: string }[]> => {
  if (!qdrantClient) return [];
  if (!(await ensureReadyOrWarn('shops'))) return [];

  const points = await fetchAllPoints('shops', null);
  return points.map(point => {
    const payload = point.payload as QdrantShopPayload;
    return {
      id: payload.shopId,
      name: payload.name,
      contactEmail: payload.contactEmail || payload.contact,
    };
  });
};

// Validate shop exists
export const validateShopExists = async (shopId: string): Promise<{ id: string; name: string; contactEmail?: string } | null> => {
  if (!qdrantClient) return null;
  if (!(await ensureReadyOrWarn('shops'))) return null;

  try {
    const pointId = composePointId('shops', shopId);
    const result = await qdrantClient.retrieve('shops', {
      ids: [pointId],
      with_payload: true,
    });

    if (result.points && result.points.length > 0) {
      const payload = result.points[0].payload as QdrantShopPayload;
      return {
        id: payload.shopId,
        name: payload.name,
        contactEmail: payload.contactEmail || payload.contact,
      };
    }
    return null;
  } catch (err) {
    console.error('[Users] Error validating shop:', err);
    return null;
  }
};

