/**
 * Test Data Script for AI-Genesis Inventory App
 * 
 * This script creates sample products, suppliers, batches, and inventory items
 * in Qdrant for testing purposes.
 * 
 * Usage: Run this from the browser console or integrate into your test setup
 */

import {
  createCanonicalProduct,
  registerLocalSupplier,
  createBatchForShop,
  addInventoryBatch,
  fetchCanonicalProducts,
  fetchSuppliersForActiveShop,
} from '../services/vectorDBService';
import { ProductImage, BatchDocument, BatchLineItem } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Sample test data
const SAMPLE_PRODUCTS = [
  {
    name: 'Organic Milk - Whole',
    manufacturer: 'Fresh Dairy Co.',
    category: 'Dairy',
    description: 'Fresh organic whole milk, 1 gallon',
    imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200',
  },
  {
    name: 'Whole Wheat Bread',
    manufacturer: 'Baker\'s Delight',
    category: 'Bakery',
    description: 'Fresh baked whole wheat bread, 1 loaf',
    imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200',
  },
  {
    name: 'Bananas - Organic',
    manufacturer: 'Tropical Farms',
    category: 'Produce',
    description: 'Organic bananas, 1 bunch (~2 lbs)',
    imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200',
  },
  {
    name: 'Chicken Breast - Free Range',
    manufacturer: 'Farm Fresh Poultry',
    category: 'Meat',
    description: 'Free range chicken breast, 1 lb',
    imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=200',
  },
  {
    name: 'Organic Eggs - Large',
    manufacturer: 'Happy Hens Farm',
    category: 'Dairy',
    description: 'Organic large eggs, 12 count',
    imageUrl: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200',
  },
  {
    name: 'Tomatoes - Roma',
    manufacturer: 'Garden Fresh',
    category: 'Produce',
    description: 'Fresh Roma tomatoes, 1 lb',
    imageUrl: 'https://images.unsplash.com/photo-1546470427-e26264be0b01?w=200',
  },
];

const SAMPLE_SUPPLIERS = [
  { name: 'Fresh Dairy Co.', contactEmail: 'orders@fresherdairy.com' },
  { name: 'Baker\'s Delight', contactEmail: 'supply@bakersdelight.com' },
  { name: 'Tropical Farms', contactEmail: 'sales@tropicalfarms.com' },
  { name: 'Farm Fresh Poultry', contactEmail: 'info@farmfreshpoultry.com' },
  { name: 'Happy Hens Farm', contactEmail: 'orders@happyhens.com' },
  { name: 'Garden Fresh', contactEmail: 'wholesale@gardenfresh.com' },
];

// Helper function to add days to a date
const addDays = (date: Date, days: number): string => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().split('T')[0];
};

export const createTestData = async () => {
  console.log('🚀 Starting test data creation...');

  try {
    // Step 1: Create Suppliers
    console.log('📦 Creating suppliers...');
    const createdSuppliers: { id: string; name: string }[] = [];
    
    for (const supplier of SAMPLE_SUPPLIERS) {
      try {
        const supplierProfile = await registerLocalSupplier({
          name: supplier.name,
          contactEmail: supplier.contactEmail,
        });
        createdSuppliers.push({ id: supplierProfile.id, name: supplier.name });
        console.log(`  ✓ Created supplier: ${supplier.name}`);
      } catch (err) {
        console.warn(`  ⚠ Failed to create supplier ${supplier.name}:`, err);
      }
    }

    // Step 2: Create Products
    console.log('📚 Creating products...');
    const createdProducts: { id: string; name: string; supplierId?: string }[] = [];
    
    for (let i = 0; i < SAMPLE_PRODUCTS.length; i++) {
      const product = SAMPLE_PRODUCTS[i];
      const supplier = createdSuppliers[i] || createdSuppliers[0]; // Match suppliers to products
      
      try {
        const images: ProductImage[] = product.imageUrl
          ? [{ 
              url: product.imageUrl, 
              type: 'manual', 
              source: 'user', 
              addedAt: new Date().toISOString() 
            }]
          : [];

        const productDef = await createCanonicalProduct({
          name: product.name,
          manufacturer: product.manufacturer,
          category: product.category,
          description: product.description,
          defaultSupplierId: supplier.id,
          images,
        });
        
        createdProducts.push({ 
          id: productDef.id, 
          name: product.name,
          supplierId: supplier.id,
        });
        console.log(`  ✓ Created product: ${product.name}`);
      } catch (err) {
        console.warn(`  ⚠ Failed to create product ${product.name}:`, err);
      }
    }

    // Step 3: Create a Batch with Line Items
    console.log('📦 Creating batch...');
    const today = new Date();
    const batchDeliveryDate = addDays(today, -7); // Delivered 7 days ago
    
    const batchLineItems: BatchLineItem[] = createdProducts.slice(0, 4).map(product => ({
      productId: product.id,
      quantity: Math.floor(Math.random() * 100) + 20, // 20-120 units
      cost: Math.random() * 10 + 2, // $2-$12 per unit
    }));

    const batchDocuments: BatchDocument[] = [
      {
        url: 'https://example.com/invoice.pdf',
        type: 'invoice',
        ocrText: `Invoice #INV-${Date.now()}\nDelivery Date: ${batchDeliveryDate}\nSupplier: ${createdSuppliers[0]?.name || 'Test Supplier'}`,
      },
    ];

    let batchId: string;
    try {
      const batch = await createBatchForShop({
        supplierId: createdSuppliers[0]?.id,
        deliveryDate: batchDeliveryDate,
        invoiceNumber: `INV-${Date.now()}`,
        documents: batchDocuments,
        lineItems: batchLineItems,
      });
      batchId = batch.id;
      console.log(`  ✓ Created batch: ${batch.id}`);
    } catch (err) {
      console.error('  ✗ Failed to create batch:', err);
      throw err;
    }

    // Step 4: Create Inventory Items from Batch
    console.log('📦 Creating inventory items...');
    const inventoryItems = batchLineItems.map((lineItem, index) => {
      const product = createdProducts[index];
      const expirationDays = [7, 14, 21, 30, 45, 60][Math.floor(Math.random() * 6)];
      const expirationDate = addDays(today, expirationDays);
      
      const matchingProduct = SAMPLE_PRODUCTS.find(p => {
        const productDef = createdProducts.find(cp => cp.id === lineItem.productId);
        return productDef && productDef.name === p.name;
      });
      
      return {
        productName: matchingProduct?.name || product.name || 'Unknown Product',
        manufacturer: matchingProduct?.manufacturer || 'Unknown Manufacturer',
        category: matchingProduct?.category || 'Unknown',
        quantity: lineItem.quantity,
        costPerUnit: lineItem.cost,
        expirationDate: expirationDate,
        location: ['A-1', 'B-2', 'C-3', 'D-4'][Math.floor(Math.random() * 4)],
        images: matchingProduct?.imageUrl ? [{
          url: matchingProduct.imageUrl,
          type: 'manual' as const,
          source: 'user',
          addedAt: new Date().toISOString(),
        }] : [],
      };
    });

    try {
      await addInventoryBatch(
        {
          supplier: createdSuppliers[0]?.name || 'Test Supplier',
          deliveryDate: batchDeliveryDate,
          inventoryDate: today.toISOString().split('T')[0],
        },
        inventoryItems
      );
      console.log(`  ✓ Created ${inventoryItems.length} inventory items`);
    } catch (err) {
      console.error('  ✗ Failed to create inventory items:', err);
      throw err;
    }

    console.log('✅ Test data creation complete!');
    console.log(`   - ${createdSuppliers.length} suppliers created`);
    console.log(`   - ${createdProducts.length} products created`);
    console.log(`   - 1 batch created`);
    console.log(`   - ${inventoryItems.length} inventory items created`);
    
    return {
      suppliers: createdSuppliers,
      products: createdProducts,
      batchId,
      inventoryItems,
    };
  } catch (err) {
    console.error('❌ Error creating test data:', err);
    throw err;
  }
};

// Export for use in browser console or test files
if (typeof window !== 'undefined') {
  (window as any).createTestData = createTestData;
}

export default createTestData;

