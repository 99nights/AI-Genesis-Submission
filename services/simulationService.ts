import { v4 as uuidv4 } from 'uuid';
import {
  registerLocalSupplier,
  createCanonicalProduct,
  createBatchForShop,
  addInventoryBatch,
  getProductSummaries,
  recordSale,
} from './vectorDBService';
import * as backendService from './backendService';
import {
  ProductImage,
  BatchLineItem,
  NewInventoryItemData,
  ProductSummary,
  User,
} from '../types';

export interface SyntheticDataOptions {
  supplierCount: number;
  productsPerSupplier: number;
  batchCount: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface WorkflowSimulationOptions {
  kioskSales: number;
  minCartItems: number;
  maxCartItems: number;
  networkOrders: number;
  autoDispatchDeliveries: boolean;
}

export interface SimulationLogEntry {
  id: string;
  scope: 'data' | 'workflow';
  message: string;
  detail?: string;
  timestamp: string;
}

export interface SyntheticDataResult {
  suppliersCreated: number;
  productsCreated: number;
  batchesCreated: number;
  itemsCreated: number;
  logs: SimulationLogEntry[];
}

export interface WorkflowSimulationResult {
  kioskSalesSimulated: number;
  ordersCreated: number;
  proposalsCreated: number;
  deliveriesUpdated: number;
  logs: SimulationLogEntry[];
}

const PRODUCT_LIBRARY = [
  { name: 'Nitro Cold Brew', manufacturer: 'Solar Roasters', category: 'Beverages', description: 'Smooth draft cold brew in 12oz cans.' },
  { name: 'Protein Overnight Oats', manufacturer: 'North Loop Kitchen', category: 'Breakfast', description: 'Vanilla & berry oats with 20g protein.' },
  { name: 'Citrus Hydration Boost', manufacturer: 'Peak Electrolytes', category: 'Beverages', description: 'Zero sugar sparkling hydration.' },
  { name: 'Gluten Free Granola Crunch', manufacturer: 'Harbor Foods', category: 'Snacks', description: 'Baked granola clusters with sea salt caramel.' },
  { name: 'BBQ Jackfruit Bowl', manufacturer: 'Urban Plant Co.', category: 'Prepared Meals', description: 'Ready-to-heat smoky jackfruit with grains.' },
  { name: 'Ube Coconut Mochi Bites', manufacturer: 'Daybreak Treats', category: 'Dessert', description: 'Soft mochi filled with whipped coconut.' },
  { name: 'Lemon Ginger Wellness Shot', manufacturer: 'Bright Labs', category: 'Beverages', description: 'Pressed ginger, turmeric, and citrus.' },
  { name: 'Savory Miso Broth Kit', manufacturer: 'Umami Pantry', category: 'Pantry', description: 'Single-serve miso broth with toppings.' },
  { name: 'Triple Berry Yogurt Parfait', manufacturer: 'Summit Creamery', category: 'Breakfast', description: 'Layers of yogurt, compote, and granola.' },
  { name: 'Roasted Veg Power Wrap', manufacturer: 'Metro Fuel', category: 'Prepared Meals', description: 'Whole grain wrap with roasted vegetables.' },
];

const SUPPLIER_PREFIXES = ['Summit', 'Evergreen', 'Metro', 'Harbor', 'Lumen', 'Atlas', 'Northwind', 'Solar'];
const SUPPLIER_SUFFIXES = ['Provisioning', 'Foods', 'Collective', 'Distributors', 'Trading', 'Partners'];
const STORAGE_LOCATIONS = ['A-1', 'A-2', 'B-1', 'B-3', 'C-1', 'C-2', 'D-4', 'FR-1'];

const imageForCategory = (category: string): string => {
  const normalized = category.toLowerCase();
  if (normalized.includes('beverage')) return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80';
  if (normalized.includes('snack')) return 'https://images.unsplash.com/photo-1481391032119-d89fee407e44?auto=format&fit=crop&w=400&q=80';
  if (normalized.includes('dessert')) return 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=400&q=80';
  if (normalized.includes('meal')) return 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=400&q=80';
  if (normalized.includes('breakfast')) return 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=400&q=80';
  return 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=400&q=80';
};

const randomFrom = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const buildImages = (category: string): ProductImage[] => [{
  url: imageForCategory(category),
  type: 'manual',
  source: 'simulator',
  addedAt: new Date().toISOString(),
}];

const createSupplierName = (index: number) => {
  const prefix = randomFrom(SUPPLIER_PREFIXES);
  const suffix = randomFrom(SUPPLIER_SUFFIXES);
  return `${prefix} ${suffix} ${index + 1}`;
};

export const generateSyntheticInventory = async (options: SyntheticDataOptions): Promise<SyntheticDataResult> => {
  const logs: SimulationLogEntry[] = [];
  const createdSuppliers: { id: string; name: string }[] = [];
  const createdProducts: { id: string; name: string; manufacturer: string; category: string; supplierId?: string }[] = [];
  let batchesCreated = 0;
  let itemsCreated = 0;

  for (let i = 0; i < options.supplierCount; i++) {
    const name = createSupplierName(i);
    const supplier = await registerLocalSupplier({ name, contactEmail: `${name.replace(/\s+/g, '').toLowerCase()}@example.com` });
    createdSuppliers.push({ id: supplier.id, name: supplier.name });
    logs.push({
      id: uuidv4(),
      scope: 'data',
      message: `Supplier added`,
      detail: supplier.name,
      timestamp: new Date().toISOString(),
    });
  }

  const totalProducts = Math.max(options.productsPerSupplier * createdSuppliers.length, options.productsPerSupplier);
  for (let i = 0; i < totalProducts; i++) {
    const template = PRODUCT_LIBRARY[i % PRODUCT_LIBRARY.length];
    const supplier = randomFrom(createdSuppliers);
    const uniqueName = `${template.name} ${i + 1}`;
    const product = await createCanonicalProduct({
      name: uniqueName,
      manufacturer: template.manufacturer,
      category: template.category,
      description: template.description,
      defaultSupplierId: supplier.id,
      images: buildImages(template.category),
    });
    createdProducts.push({
      id: product.id,
      name: product.name,
      manufacturer: product.manufacturer,
      category: product.category,
      supplierId: supplier.id,
    });
    logs.push({
      id: uuidv4(),
      scope: 'data',
      message: `Product created`,
      detail: `${product.name} (${product.category})`,
      timestamp: new Date().toISOString(),
    });
  }

  for (let i = 0; i < options.batchCount; i++) {
    const supplier = randomFrom(createdSuppliers);
    const batchDate = new Date();
    batchDate.setDate(batchDate.getDate() - randomInt(2, 10));
    const batchItems: BatchLineItem[] = [];
    const uniqueProducts = new Set<string>();
    while (batchItems.length < Math.min(4, createdProducts.length) && uniqueProducts.size < createdProducts.length) {
      const product = randomFrom(createdProducts);
      if (uniqueProducts.has(product.id)) continue;
      uniqueProducts.add(product.id);
      batchItems.push({
        productId: product.id,
        quantity: randomInt(options.minQuantity, options.maxQuantity),
        cost: Number((Math.random() * 8 + 2).toFixed(2)),
      });
    }

    const batchRecord = await createBatchForShop({
      supplierId: supplier.id,
      deliveryDate: batchDate.toISOString().split('T')[0],
      invoiceNumber: `SIM-${Date.now()}-${i + 1}`,
      lineItems: batchItems,
    });

    const inventoryItems: NewInventoryItemData[] = batchItems.map((lineItem) => {
      const product = createdProducts.find(p => p.id === lineItem.productId)!;
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + randomInt(15, 60));
      return {
        productId: product.id,
        productName: product.name,
        manufacturer: product.manufacturer,
        category: product.category,
        supplierId: product.supplierId,
        expirationDate: expiration.toISOString().split('T')[0],
        quantity: lineItem.quantity,
        quantityType: 'units',
        costPerUnit: lineItem.cost,
        location: randomFrom(STORAGE_LOCATIONS),
        images: buildImages(product.category),
      };
    });

    await addInventoryBatch(
      {
        supplier: supplier.name,
        deliveryDate: batchRecord.deliveryDate,
        inventoryDate: batchRecord.inventoryDate || batchRecord.deliveryDate,
      },
      inventoryItems,
    );

    batchesCreated += 1;
    itemsCreated += inventoryItems.length;
    logs.push({
      id: uuidv4(),
      scope: 'data',
      message: `Batch logged`,
      detail: `${inventoryItems.length} items added from ${supplier.name}`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    suppliersCreated: createdSuppliers.length,
    productsCreated: createdProducts.length,
    batchesCreated,
    itemsCreated,
    logs,
  };
};

const buildCartForSimulation = (summaries: ProductSummary[], minItems: number, maxItems: number) => {
  const cartSize = randomInt(minItems, Math.max(minItems, maxItems));
  const shuffled = [...summaries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, cartSize).map(summary => ({
    productName: summary.productName,
    quantity: Math.min(summary.totalQuantity, randomInt(1, Math.max(1, Math.min(5, summary.totalQuantity)))),
  }));
};

export const runWorkflowSimulation = async (
  options: WorkflowSimulationOptions,
  user: User,
): Promise<WorkflowSimulationResult> => {
  const logs: SimulationLogEntry[] = [];
  const summaries = await getProductSummaries();
  if (summaries.length === 0) {
    throw new Error('No inventory available. Generate data first.');
  }

  let kioskSalesSimulated = 0;
  for (let i = 0; i < options.kioskSales; i++) {
    const cart = buildCartForSimulation(summaries, options.minCartItems, options.maxCartItems)
      .filter(item => item.quantity > 0);
    if (cart.length === 0) continue;
    await recordSale(cart);
    kioskSalesSimulated += 1;
    logs.push({
      id: uuidv4(),
      scope: 'workflow',
      message: 'Kiosk sale recorded',
      detail: `${cart.length} products sold`,
      timestamp: new Date().toISOString(),
    });
  }

  let ordersCreated = 0;
  let proposalsCreated = 0;
  for (let i = 0; i < options.networkOrders; i++) {
    const product = randomFrom(summaries);
    const newOrder = await backendService.createOrder({
      productName: product.productName,
      quantity: randomInt(5, 60),
    }, user);
    ordersCreated += 1;
    logs.push({
      id: uuidv4(),
      scope: 'workflow',
      message: 'Network order opened',
      detail: `${newOrder.productName} x${newOrder.quantity}`,
      timestamp: new Date().toISOString(),
    });

    const syntheticSupplier: User = {
      clientId: `sim_supplier_${i}`,
      companyName: `Sim Supplier ${i + 1}`,
      contactPerson: 'Automation',
      address: '1 Simulation Way',
      email: `sim-supplier-${i + 1}@example.com`,
      role: 'supplier',
      isVerified: true,
      isDriverVerified: false,
      shopId: user.shopId,
      customerId: undefined,
      driverId: undefined,
      supplierId: undefined,
      roles: { shop: false, customer: false, driver: false, supplier: true },
    };

    const proposal = await backendService.createSupplyProposal({
      orderId: newOrder.id,
      pricePerUnit: Number((product.averageCostPerUnit * 1.2).toFixed(2)),
    }, syntheticSupplier);
    proposalsCreated += 1;
    logs.push({
      id: uuidv4(),
      scope: 'workflow',
      message: 'Supply proposal submitted',
      detail: `Proposal ${proposal.id} for ${newOrder.id}`,
      timestamp: new Date().toISOString(),
    });

    await backendService.acceptProposal(proposal.id);
    logs.push({
      id: uuidv4(),
      scope: 'workflow',
      message: 'Proposal accepted',
      detail: `Delivery scheduled for ${newOrder.productName}`,
      timestamp: new Date().toISOString(),
    });
  }

  let deliveriesUpdated = 0;
  if (options.autoDispatchDeliveries) {
    const deliveries = await backendService.getAvailableDeliveries();
    const driverUser: User = {
      clientId: 'sim_driver',
      companyName: 'Sim Driver Coop',
      contactPerson: 'Automation',
      address: 'Virtual Depot',
      email: 'driver@example.com',
      role: 'driver',
      isVerified: true,
      isDriverVerified: true,
      shopId: user.shopId,
      customerId: undefined,
      driverId: 'driver_sim',
      supplierId: undefined,
      roles: { shop: false, customer: false, driver: true, supplier: false },
    };
    for (const delivery of deliveries) {
      await backendService.acceptDelivery(delivery.id, driverUser);
      deliveriesUpdated += 1;
      logs.push({
        id: uuidv4(),
        scope: 'workflow',
        message: 'Delivery dispatched',
        detail: `${delivery.productName} → ${delivery.dropoff.name}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return {
    kioskSalesSimulated,
    ordersCreated,
    proposalsCreated,
    deliveriesUpdated,
    logs,
  };
};
