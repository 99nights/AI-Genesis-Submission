import { User, PeerShop, Order, SupplyProposal, Delivery, PeerListing } from '../types';
import { IS_SIMULATED_BACKEND } from '../config';
import * as dataService from './vectorDBService'; // For stock deduction simulation
import { qdrantClient } from './qdrant/core';
import { ensureReadyOrWarn } from './qdrant/collections';
import { composePointId } from './qdrant/vectors';
import { fetchAllPoints } from './qdrant/queries';
import { upsertUserProfile, upsertDriverRecord } from './qdrant/services/users';
import type { QdrantUserPayload } from '../types';

// ===================================================================
//
//              VERIFICATION MANAGEMENT (Qdrant-based)
//
// ===================================================================

/**
 * Register a shop user for verification
 * Stores verification status in Qdrant users collection
 */
export const registerShopForVerification = async (user: User): Promise<void> => {
  if (!user.roles?.shop) return;
  
  // Update user profile in Qdrant with pending verification
  await upsertUserProfile({
    userId: user.clientId,
    displayName: user.companyName,
    email: user.email,
    contactEmail: user.email,
    shopId: user.shopId || null,
    isVerified: false, // Pending verification
  });
};

/**
 * Register a driver for verification
 * Stores verification status in Qdrant users and drivers collections
 */
export const registerDriverForVerification = async (user: User): Promise<void> => {
  if (!user.roles?.driver) return;
  
  // Update user profile in Qdrant with pending driver verification
  await upsertUserProfile({
    userId: user.clientId,
    displayName: user.companyName,
    email: user.email,
    contactEmail: user.email,
    isDriverVerified: false, // Pending verification
  });
  
  // Also update driver record
  if (user.driverId) {
    await upsertDriverRecord({
      id: user.driverId,
      fullName: user.companyName,
      contactEmail: user.email,
      status: 'pending',
      userId: user.clientId,
    });
  }
};

/**
 * Get verification status for a user from Qdrant
 */
export const getVerificationStatusForUser = async (
  clientId: string,
  options?: { requiresShopVerification?: boolean; requiresDriverVerification?: boolean }
): Promise<{ isVerified: boolean; isDriverVerified: boolean }> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('users'))) {
    // Fallback: assume verified if Qdrant is not available
    return { isVerified: true, isDriverVerified: true };
  }

  try {
    const pointId = composePointId('users', clientId);
    const result = await qdrantClient.retrieve('users', {
      ids: [pointId],
      with_payload: true,
    });

    if (result.points && result.points.length > 0) {
      const payload = result.points[0].payload as QdrantUserPayload;
      return {
        isVerified: options?.requiresShopVerification 
          ? (payload.isVerified ?? false)
          : true,
        isDriverVerified: options?.requiresDriverVerification
          ? (payload.isDriverVerified ?? false)
          : true,
      };
    }
  } catch (err) {
    console.error('[Backend] Error fetching verification status:', err);
  }

  // Default: not verified if user not found
  return {
    isVerified: !options?.requiresShopVerification,
    isDriverVerified: !options?.requiresDriverVerification,
  };
};

/**
 * Get all pending shop clients from Qdrant
 */
export const getPendingClients = async (): Promise<User[]> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('users'))) {
    return [];
  }

  try {
    const points = await fetchAllPoints('users', null);
    return points
      .map(point => {
        const payload = point.payload as QdrantUserPayload;
        // Check if user has shopId (indicates shop role) and is not verified
        // isVerified can be false or undefined (not set yet)
        if (payload.shopId && (payload.isVerified === false || payload.isVerified === undefined)) {
          return {
            clientId: payload.userId,
            companyName: payload.displayName,
            contactPerson: payload.displayName,
            address: '',
            email: payload.email,
            role: 'shop' as const,
            isVerified: false,
            isDriverVerified: payload.isDriverVerified ?? false,
            shopId: payload.shopId,
            roles: {
              shop: true,
              customer: false,
              driver: false,
              supplier: false,
            },
          } as User;
        }
        return null;
      })
      .filter((user): user is User => user !== null);
  } catch (err) {
    console.error('[Backend] Error fetching pending clients:', err);
    return [];
  }
};

/**
 * Get all verified shop clients from Qdrant
 */
export const getVerifiedClients = async (): Promise<User[]> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('users'))) {
    return [];
  }

  try {
    const points = await fetchAllPoints('users', null);
    return points
      .map(point => {
        const payload = point.payload as QdrantUserPayload;
        // Check if user has shop role and is verified
        if (payload.shopId && payload.isVerified === true) {
          return {
            clientId: payload.userId,
            companyName: payload.displayName,
            contactPerson: payload.displayName,
            address: '',
            email: payload.email,
            role: 'shop' as const,
            isVerified: true,
            isDriverVerified: payload.isDriverVerified ?? false,
            shopId: payload.shopId,
            roles: {
              shop: true,
              customer: false,
              driver: false,
              supplier: false,
            },
          } as User;
        }
        return null;
      })
      .filter((user): user is User => user !== null);
  } catch (err) {
    console.error('[Backend] Error fetching verified clients:', err);
    return [];
  }
};

/**
 * Get all pending drivers from Qdrant
 */
export const getPendingDrivers = async (): Promise<User[]> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('drivers'))) {
    return [];
  }

  try {
    const points = await fetchAllPoints('drivers', null);
    return points
      .map(point => {
        const payload = point.payload as any;
        if (payload.status === 'pending' && payload.userId) {
          // Fetch user details from users collection
          return {
            clientId: payload.userId,
            companyName: payload.name || 'Driver',
            contactPerson: payload.name || 'Driver',
            address: '',
            email: payload.contact || payload.contactEmail || '',
            role: 'driver' as const,
            isVerified: true, // Drivers don't need shop verification
            isDriverVerified: false,
            driverId: payload.driverId,
            roles: {
              shop: false,
              customer: false,
              driver: true,
              supplier: false,
            },
          } as User;
        }
        return null;
      })
      .filter((user): user is User => user !== null);
  } catch (err) {
    console.error('[Backend] Error fetching pending drivers:', err);
    return [];
  }
};

/**
 * Get all verified drivers from Qdrant
 */
export const getVerifiedDrivers = async (): Promise<User[]> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('drivers'))) {
    return [];
  }

  try {
    const points = await fetchAllPoints('drivers', null);
    return points
      .map(point => {
        const payload = point.payload as any;
        if (payload.status === 'verified' && payload.userId) {
          return {
            clientId: payload.userId,
            companyName: payload.name || 'Driver',
            contactPerson: payload.name || 'Driver',
            address: '',
            email: payload.contact || payload.contactEmail || '',
            role: 'driver' as const,
            isVerified: true,
            isDriverVerified: true,
            driverId: payload.driverId,
            roles: {
              shop: false,
              customer: false,
              driver: true,
              supplier: false,
            },
          } as User;
        }
        return null;
      })
      .filter((user): user is User => user !== null);
  } catch (err) {
    console.error('[Backend] Error fetching verified drivers:', err);
    return [];
  }
};

/**
 * Verify a shop client - updates Qdrant user profile
 */
export const verifyClient = async (clientId: string): Promise<void> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('users'))) {
    console.warn('[Backend] Qdrant not available for verification');
    return;
  }

  try {
    const pointId = composePointId('users', clientId);
    const result = await qdrantClient.retrieve('users', {
      ids: [pointId],
      with_payload: true,
    });

    if (result.points && result.points.length > 0) {
      const payload = result.points[0].payload as QdrantUserPayload;
      
      // Update user profile with verified status
      await upsertUserProfile({
        userId: clientId,
        displayName: payload.displayName,
        email: payload.email,
        contactEmail: payload.contactEmail,
        shopId: payload.shopId,
        isVerified: true,
        isDriverVerified: payload.isDriverVerified,
      });
      
      console.log(`[Backend] Verified shop client: ${payload.displayName}`);
    } else {
      console.warn(`[Backend] User not found for verification: ${clientId}`);
    }
  } catch (err) {
    console.error('[Backend] Error verifying client:', err);
  }
};

/**
 * Verify a driver - updates Qdrant user and driver records
 */
export const verifyDriver = async (clientId: string): Promise<void> => {
  if (!qdrantClient || !(await ensureReadyOrWarn('users'))) {
    console.warn('[Backend] Qdrant not available for driver verification');
    return;
  }

  try {
    const pointId = composePointId('users', clientId);
    const result = await qdrantClient.retrieve('users', {
      ids: [pointId],
      with_payload: true,
    });

    if (result.points && result.points.length > 0) {
      const payload = result.points[0].payload as QdrantUserPayload;
      
      // Update user profile with verified driver status
      await upsertUserProfile({
        userId: clientId,
        displayName: payload.displayName,
        email: payload.email,
        contactEmail: payload.contactEmail,
        shopId: payload.shopId,
        isVerified: payload.isVerified,
        isDriverVerified: true,
      });
      
      // Find and update driver record
      const driverPoints = await fetchAllPoints('drivers', null);
      const driverPoint = driverPoints.find(p => {
        const pPayload = p.payload as any;
        return pPayload.userId === clientId;
      });
      
      if (driverPoint) {
        const driverPayload = driverPoint.payload as any;
        await upsertDriverRecord({
          id: driverPayload.driverId,
          fullName: driverPayload.name || payload.displayName,
          contactEmail: driverPayload.contact || driverPayload.contactEmail || payload.email,
          status: 'verified',
          userId: clientId,
        });
      }
      
      console.log(`[Backend] Verified driver: ${payload.displayName}`);
    } else {
      console.warn(`[Backend] User not found for driver verification: ${clientId}`);
    }
  } catch (err) {
    console.error('[Backend] Error verifying driver:', err);
  }
};

// ===================================================================
//
//              MARKETPLACE & ORDER MANAGEMENT
//
// ===================================================================

// Mock data for marketplace (in production, this would come from Qdrant marketplace collection)
const mockPeerShops: PeerShop[] = [
  {
    id: 'peer_1',
    name: 'Gourmet Goods',
    listings: [
      { listingId: 'gg_1', productName: 'Artisanal Cheese', manufacturer: 'Cheese Masters', category: 'Dairy', quantity: 20, quantityType: 'kg', price: 25.50, seller: { id: 'peer_1', name: 'Gourmet Goods' } },
      { listingId: 'gg_2', productName: 'Truffle Oil', manufacturer: 'Italian Imports', category: 'Pantry', quantity: 50, quantityType: 'bottles', price: 15.00, seller: { id: 'peer_1', name: 'Gourmet Goods' } }
    ]
  },
  {
    id: 'peer_2',
    name: 'The Fresh Market',
    listings: [
      { listingId: 'tfm_1', productName: 'Organic Avocados', manufacturer: 'Fresh Farms', category: 'Produce', quantity: 100, quantityType: 'units', price: 1.50, seller: { id: 'peer_2', name: 'The Fresh Market' } },
    ]
  }
];

export const getPeerMarketplaceData = async (user: User): Promise<PeerShop[]> => {
  if (!user.isVerified) throw new Error("User is not verified.");
  // In a real app, this would query Qdrant marketplace collection
  // For now, return mock data excluding the current user
  return Promise.resolve(mockPeerShops.filter(p => p.id !== user.clientId));
};

export const consumePeerListing = async (listingId: string, quantity: number): Promise<void> => {
  // In production, this would update Qdrant marketplace collection
  // For now, this is a no-op as we're using mock data
  console.log(`[Backend] Consuming listing ${listingId}, quantity: ${quantity}`);
};

export const createOrder = async (orderData: Omit<Order, 'id' | 'createdAt' | 'status'>, user: User): Promise<Order> => {
  // In production, this would create an order in Qdrant
  throw new Error("Order creation not yet implemented in Qdrant");
};

export const getNetworkOrders = async (): Promise<Order[]> => {
  // In production, this would query Qdrant orders collection
  return Promise.resolve([]);
};

export const createSupplyProposal = async (proposalData: Omit<SupplyProposal, 'id'| 'status'>, user:User): Promise<SupplyProposal> => {
  // In production, this would create a proposal in Qdrant
  throw new Error("Supply proposal creation not yet implemented in Qdrant");
};

export const getProposalsForOrder = async (orderId: string): Promise<SupplyProposal[]> => {
  // In production, this would query Qdrant proposals collection
  return Promise.resolve([]);
};

export const acceptProposal = async (proposalId: string): Promise<void> => {
  // In production, this would update Qdrant proposals and orders collections
  throw new Error("Proposal acceptance not yet implemented in Qdrant");
};

// ===================================================================
//
//              DRIVER & DELIVERY MANAGEMENT
//
// ===================================================================

export const getAvailableDeliveries = async (): Promise<Delivery[]> => {
  // In production, this would query Qdrant deliveries collection
  return Promise.resolve([]);
};

export const acceptDelivery = async (deliveryId: string, driver: User): Promise<void> => {
  // In production, this would update Qdrant deliveries collection
  console.log(`[Backend] Driver ${driver.clientId} accepted delivery ${deliveryId}`);
};

export const getMyDeliveries = async (driver: User): Promise<Delivery[]> => {
  // In production, this would query Qdrant deliveries collection filtered by driver
  return Promise.resolve([]);
};
