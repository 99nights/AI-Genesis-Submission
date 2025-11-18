import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabaseClient';
import {
  ActiveShopContext,
  createShopNamespace,
  setActiveShopContext,
  upsertShopRecord,
  upsertCustomerRecord,
  upsertDriverRecord,
  upsertSupplierProfile,
  upsertUserProfile,
} from './vectorDBService';
import { User } from '../types';
import { registerShopForVerification, registerDriverForVerification, getVerificationStatusForUser } from './backendService';

export type UserRole = 'shop' | 'customer' | 'driver' | 'supplier';

export interface AuthenticatedProfile {
  user: User;
  shopContext?: ActiveShopContext | null;
}

interface RoleFlags {
  shop: boolean;
  customer: boolean;
  driver: boolean;
  supplier: boolean;
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  contact_email?: string | null;
  is_shop: boolean;
  is_customer: boolean;
  is_driver: boolean;
  is_supplier: boolean;
  qdrant_user_id: string | null;
  shop_qdrant_id: string | null;
  qdrant_namespace: string | null;
  customer_qdrant_id: string | null;
  driver_qdrant_id: string | null;
  supplier_qdrant_id: string | null;
  metadata?: any;
}

const ensureSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  return supabase;
};

const derivePrimaryRole = (roles: RoleFlags): UserRole => {
  if (roles.shop) return 'shop';
  if (roles.customer) return 'customer';
  if (roles.driver) return 'driver';
  return 'supplier';
};

const buildProfileFromRow = async (row: UserRow): Promise<AuthenticatedProfile> => {
  const roles: RoleFlags = {
    shop: row.is_shop,
    customer: row.is_customer,
    driver: row.is_driver,
    supplier: row.is_supplier,
  };

  const verification = await getVerificationStatusForUser(row.id, {
    requiresShopVerification: row.is_shop,
    requiresDriverVerification: row.is_driver,
  });

  const user: User = {
    clientId: row.id,
    companyName: row.display_name,
    contactPerson: row.display_name,
    address: '',
    email: row.email,
    role: derivePrimaryRole(roles),
    isVerified: verification.isVerified,
    isDriverVerified: verification.isDriverVerified,
    shopId: row.shop_qdrant_id || undefined,
    customerId: row.customer_qdrant_id || undefined,
    driverId: row.driver_qdrant_id || undefined,
    supplierId: row.supplier_qdrant_id || undefined,
    roles,
  };

  let shopContext: ActiveShopContext | null = null;
  if (row.is_shop && row.shop_qdrant_id) {
    shopContext = {
      id: row.shop_qdrant_id,
      name: row.display_name,
      contactEmail: row.contact_email,
      qdrantNamespace: row.qdrant_namespace || undefined,
    };
  }

  setActiveShopContext(shopContext);
  
  // Ensure user profile exists in Qdrant with matching ID
  // Use Supabase userId (row.id) as Qdrant user point ID for access control
  upsertUserProfile({
    userId: row.id, // Supabase user ID
    qdrantUserId: row.qdrant_user_id || row.id, // Use Supabase userId, fallback to qdrant_user_id if exists
    displayName: row.display_name,
    email: row.contact_email || row.email,
    contactEmail: row.contact_email || row.email,
    shopId: row.shop_qdrant_id || null,
    roles,
  }).catch(err => console.error('[Auth] Failed to sync user to Qdrant:', err));
  
  return { user, shopContext };
};

const insertUserRow = async (payload: Partial<UserRow> & { password_hash: string }) => {
  const client = ensureSupabase();
  const { error } = await client.from('users').insert([payload]);
  if (error) throw error;
};

export const registerUser = async (params: {
  username: string;
  email: string;
  password: string;
  displayName: string;
  roles: RoleFlags;
  licenseId?: string;
  supplierShopId?: string;
}): Promise<AuthenticatedProfile> => {
  const client = ensureSupabase();
  const normalizedRoles = params.roles;
  if (!normalizedRoles.shop && !normalizedRoles.customer && !normalizedRoles.driver && !normalizedRoles.supplier) {
    throw new Error('Please select at least one role.');
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const userId = uuidv4(); // Supabase user ID - also used as Qdrant user point ID for matching
  // Auto-generate shop_qdrant_id if shop role is enabled (even if not explicitly provided)
  const shopQdrantId = normalizedRoles.shop ? uuidv4() : null;
  const customerQdrantId = normalizedRoles.customer ? uuidv4() : null;
  const driverQdrantId = normalizedRoles.driver ? uuidv4() : null;
  const supplierQdrantId = normalizedRoles.supplier ? uuidv4() : null;

  await insertUserRow({
    id: userId,
    username: params.username.trim(),
    email: params.email.trim(),
    contact_email: params.email.trim(),
    display_name: params.displayName.trim(),
    password_hash: passwordHash,
    is_shop: normalizedRoles.shop,
    is_customer: normalizedRoles.customer,
    is_driver: normalizedRoles.driver,
    is_supplier: normalizedRoles.supplier,
    qdrant_user_id: userId, // Use Supabase userId as Qdrant user ID for matching
    shop_qdrant_id: shopQdrantId,
    qdrant_namespace: shopQdrantId ? `shop-${shopQdrantId}` : null,
    customer_qdrant_id: customerQdrantId,
    driver_qdrant_id: driverQdrantId,
    supplier_qdrant_id: supplierQdrantId,
    metadata: normalizedRoles.driver && params.licenseId ? { licenseId: params.licenseId } : {},
  });

  // Use Supabase userId as Qdrant user point ID - they match for access control
  await upsertUserProfile({
    userId,
    qdrantUserId: userId, // Same as Supabase userId
    displayName: params.displayName.trim(),
    email: params.email.trim(),
    contactEmail: params.email.trim(),
    shopId: shopQdrantId,
    roles: normalizedRoles,
  });

  if (normalizedRoles.shop && shopQdrantId) {
    await createShopNamespace();
    // Create shop record in Qdrant with proper structure
    await upsertShopRecord({ 
      id: shopQdrantId, 
      name: params.displayName.trim(), 
      contactEmail: params.email.trim(),
      userId: userId, // Link to Supabase user
      qdrantNamespace: `shop-${shopQdrantId}`,
    });
  }
  if (normalizedRoles.customer && customerQdrantId) {
    await upsertCustomerRecord({ id: customerQdrantId, fullName: params.displayName.trim(), contactEmail: params.email.trim() });
  }
  if (normalizedRoles.driver && driverQdrantId) {
    await upsertDriverRecord({ id: driverQdrantId, fullName: params.displayName.trim(), contactEmail: params.email.trim(), status: 'pending' });
  }
  if (normalizedRoles.supplier && supplierQdrantId) {
    // Create supplier profile in Qdrant
    // If supplierShopId is provided, it's a local supplier; otherwise it's a global supplier linked to user
    await upsertSupplierProfile({
      id: supplierQdrantId,
      name: params.displayName.trim(),
      contactEmail: params.email.trim(),
      shopId: params.supplierShopId || null, // Local supplier if shopId provided
      linkedUserId: params.supplierShopId ? null : userId, // Global supplier linked to user
    });
  }

  const row: UserRow = {
    id: userId,
    username: params.username.trim(),
    email: params.email.trim(),
    password_hash: passwordHash,
    display_name: params.displayName.trim(),
    contact_email: params.email.trim(),
    is_shop: normalizedRoles.shop,
    is_customer: normalizedRoles.customer,
    is_driver: normalizedRoles.driver,
    is_supplier: normalizedRoles.supplier,
    qdrant_user_id: userId, // Same as Supabase userId - used for Qdrant user point ID
    shop_qdrant_id: shopQdrantId,
    qdrant_namespace: shopQdrantId ? `shop-${shopQdrantId}` : null,
    customer_qdrant_id: customerQdrantId,
    driver_qdrant_id: driverQdrantId,
    supplier_qdrant_id: supplierQdrantId,
    metadata: {
      ...(normalizedRoles.driver && params.licenseId ? { licenseId: params.licenseId } : {}),
      ...(normalizedRoles.supplier && params.supplierShopId ? { linkedShop: params.supplierShopId } : {}),
    },
  };

  const pendingUser: User = {
    clientId: userId,
    companyName: params.displayName.trim(),
    contactPerson: params.displayName.trim(),
    address: '',
    email: params.email.trim(),
    role: derivePrimaryRole(normalizedRoles),
    isVerified: !normalizedRoles.shop,
    isDriverVerified: !normalizedRoles.driver,
    shopId: shopQdrantId || undefined,
    customerId: customerQdrantId || undefined,
    driverId: driverQdrantId || undefined,
    supplierId: supplierQdrantId || undefined,
    roles: normalizedRoles,
  };

  if (normalizedRoles.shop) {
    await registerShopForVerification(pendingUser);
  }
  if (normalizedRoles.driver) {
    await registerDriverForVerification(pendingUser);
  }

  return await buildProfileFromRow(row);
};

export const loginUser = async (params: { username: string; password: string }): Promise<AuthenticatedProfile> => {
  const client = ensureSupabase();
  const { data: row, error } = await client
    .from('users')
    .select('*')
    .eq('username', params.username.trim())
    .single();

  if (error || !row) {
    throw new Error('Invalid username or password.');
  }

  const isValid = await bcrypt.compare(params.password, row.password_hash ?? '');
  if (!isValid) {
    throw new Error('Invalid username or password.');
  }

  return await buildProfileFromRow(row as UserRow);
};
