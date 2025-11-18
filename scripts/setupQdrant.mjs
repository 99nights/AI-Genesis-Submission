#!/usr/bin/env node
/**
 * Qdrant Setup Script
 * 
 * This script initializes all Qdrant collections and payload indexes
 * according to the architecture defined in docs/qdrant-architecture-guide.md
 * 
 * Usage:
 *   node scripts/setupQdrant.mjs                    # Setup all collections
 *   node scripts/setupQdrant.mjs --recreate        # Delete and recreate collections
 *   node scripts/setupQdrant.mjs --collections=items,products  # Setup specific collections
 */

import { QdrantClient } from '@qdrant/js-client-rest';

// Configuration
const QDRANT_URL =
  process.env.QDRANT_URL ||
  process.env.QDRANT_PROXY_URL ||
  'http://localhost:8787/qdrant';

const EMBEDDING_VECTOR_SIZE = 768;
const EXPECTED_DISTANCE = 'Cosine';

// Base collections from vectorDBService.ts
const BASE_COLLECTIONS = [
  'users',
  'shops',
  'customers',
  'suppliers',
  'products',
  'items',
  'inventory', // Legacy/alias
  'batches',
  'sales',
  'drivers',
  'visual',
  'marketplace',
  'dan_inventory',
];

// Payload index definitions based on architecture guide
const COLLECTION_PAYLOAD_INDEXES = {
  users: {
    userId: { type: 'keyword' },
    displayName: { type: 'keyword' },
    contactEmail: { type: 'keyword' },
    email: { type: 'keyword' },
    shopId: { type: 'keyword' },
    isVerified: { type: 'bool' },
    isDriverVerified: { type: 'bool' },
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
    name: { type: 'keyword' },
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
    inventoryDate: { type: 'keyword' },
  },
  sales: {
    saleId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    timestamp: { type: 'keyword' },
  },
  customers: {
    customerId: { type: 'keyword' },
    userId: { type: 'keyword' },
    name: { type: 'keyword' },
  },
  drivers: {
    driverId: { type: 'keyword' },
    userId: { type: 'keyword' },
    status: { type: 'keyword' },
  },
  visual: {
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    fieldName: { type: 'keyword' },
  },
  marketplace: {
    listingId: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
  },
  dan_inventory: {
    inventoryUuid: { type: 'keyword' },
    shopId: { type: 'keyword' },
    productId: { type: 'keyword' },
    productName: { type: 'keyword' },
    locationBucket: { type: 'keyword' },
    shareScope: { type: 'keyword' },
    expirationDate: { type: 'keyword' },
  },
};

// Parse command line arguments
const args = process.argv.slice(2);
const shouldRecreate = args.includes('--recreate');
const collectionsArg = args.find(arg => arg.startsWith('--collections='));
const targetCollections = collectionsArg
  ? collectionsArg.split('=')[1].split(',').map(c => c.trim())
  : BASE_COLLECTIONS;

const client = new QdrantClient({ url: QDRANT_URL });

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[!]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`),
  step: (msg) => console.log(`${colors.blue}[→]${colors.reset} ${msg}`),
};

// Check if collection exists
const collectionExists = async (name) => {
  try {
    await client.getCollection(name);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
};

// Delete collection if it exists
const deleteCollection = async (name) => {
  try {
    await client.deleteCollection(name);
    log.success(`Deleted collection '${name}'`);
    return true;
  } catch (error) {
    if (error.status === 404) {
      log.warn(`Collection '${name}' does not exist, skipping delete`);
      return false;
    }
    throw error;
  }
};

// Create collection with proper vector configuration
const createCollection = async (name) => {
  try {
    await client.createCollection(name, {
      vectors: {
        size: EMBEDDING_VECTOR_SIZE,
        distance: EXPECTED_DISTANCE,
      },
    });
    log.success(`Created collection '${name}' (size=${EMBEDDING_VECTOR_SIZE}, distance=${EXPECTED_DISTANCE})`);
    return true;
  } catch (error) {
    if (error.status === 409) {
      log.warn(`Collection '${name}' already exists`);
      return false;
    }
    throw error;
  }
};

// Verify collection configuration
const verifyCollection = async (name) => {
  try {
    const info = await client.getCollection(name);
    const vectors = info.config?.params?.vectors;
    
    if (typeof vectors?.size === 'number') {
      const size = vectors.size;
      const distance = vectors.distance;
      
      if (size === EMBEDDING_VECTOR_SIZE && distance === EXPECTED_DISTANCE) {
        log.success(`Collection '${name}' verified (size=${size}, distance=${distance})`);
        return true;
      } else {
        log.error(
          `Collection '${name}' has wrong config: size=${size}, distance=${distance} ` +
          `(expected: size=${EMBEDDING_VECTOR_SIZE}, distance=${EXPECTED_DISTANCE})`
        );
        return false;
      }
    } else {
      log.error(`Collection '${name}' has unexpected vector configuration`);
      return false;
    }
  } catch (error) {
    log.error(`Failed to verify collection '${name}': ${error.message}`);
    return false;
  }
};

// Create payload index
const createPayloadIndex = async (collectionName, fieldName, schema) => {
  try {
    await client.createPayloadIndex(collectionName, {
      field_name: fieldName,
      field_schema: schema,
    });
    log.success(`  Created index: ${fieldName} (${schema.type})`);
    return true;
  } catch (error) {
    if (error.status === 400 && error.message?.includes('already exists')) {
      log.warn(`  Index '${fieldName}' already exists, skipping`);
      return false;
    }
    log.error(`  Failed to create index '${fieldName}': ${error.message}`);
    return false;
  }
};

// Delete payload index
const deletePayloadIndex = async (collectionName, fieldName) => {
  try {
    await client.deletePayloadIndex(collectionName, fieldName);
    log.warn(`  Deleted existing index: ${fieldName}`);
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false; // Index doesn't exist, that's fine
    }
    log.warn(`  Could not delete index '${fieldName}': ${error.message}`);
    return false;
  }
};

// Get existing payload schema
const getExistingSchema = async (collectionName) => {
  try {
    const info = await client.getCollection(collectionName);
    return info.payload_schema || {};
  } catch (error) {
    log.error(`Failed to get schema for '${collectionName}': ${error.message}`);
    return {};
  }
};

// Setup indexes for a collection
const setupIndexes = async (collectionName) => {
  const indexDefinitions = COLLECTION_PAYLOAD_INDEXES[collectionName];
  if (!indexDefinitions) {
    log.warn(`No index definitions for collection '${collectionName}'`);
    return { created: 0, skipped: 0, errors: 0 };
  }

  log.step(`Setting up indexes for '${collectionName}'...`);
  const existingSchema = await getExistingSchema(collectionName);
  
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const [fieldName, schema] of Object.entries(indexDefinitions)) {
    const existingField = existingSchema[fieldName];
    const existingType = existingField?.data_type;

    // If index exists with correct type, skip
    if (existingType === schema.type) {
      log.warn(`  Index '${fieldName}' already exists with correct type, skipping`);
      skipped++;
      continue;
    }

    // If index exists with wrong type, delete it first
    if (existingField && existingType !== schema.type) {
      await deletePayloadIndex(collectionName, fieldName);
    }

    // Create the index
    const success = await createPayloadIndex(collectionName, fieldName, schema);
    if (success) {
      created++;
    } else {
      errors++;
    }
  }

  return { created, skipped, errors };
};

// Setup a single collection
const setupCollection = async (collectionName) => {
  log.info(`\n${'='.repeat(60)}`);
  log.info(`Setting up collection: ${collectionName}`);
  log.info(`${'='.repeat(60)}`);

  // Step 1: Delete if recreate flag is set
  if (shouldRecreate) {
    log.step(`Deleting collection '${collectionName}' (--recreate flag)...`);
    await deleteCollection(collectionName);
    // Wait a bit for deletion to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 2: Check if collection exists
  const exists = await collectionExists(collectionName);

  // Step 3: Create collection if needed
  if (!exists) {
    log.step(`Creating collection '${collectionName}'...`);
    const created = await createCollection(collectionName);
    if (!created) {
      log.error(`Failed to create collection '${collectionName}'`);
      return false;
    }
    // Wait for collection to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  } else {
    log.warn(`Collection '${collectionName}' already exists`);
  }

  // Step 4: Verify collection configuration
  log.step(`Verifying collection '${collectionName}' configuration...`);
  const isValid = await verifyCollection(collectionName);
  if (!isValid && !shouldRecreate) {
    log.error(
      `Collection '${collectionName}' has incorrect configuration. ` +
      `Use --recreate flag to delete and recreate it.`
    );
    return false;
  }

  // Step 5: Setup payload indexes
  const indexResults = await setupIndexes(collectionName);
  
  log.info(`\nIndex summary for '${collectionName}':`);
  log.info(`  Created: ${indexResults.created}`);
  log.info(`  Skipped: ${indexResults.skipped}`);
  log.info(`  Errors: ${indexResults.errors}`);

  return true;
};

// Main execution
const main = async () => {
  log.info('Qdrant Setup Script');
  log.info('==================');
  log.info(`Qdrant URL: ${QDRANT_URL}`);
  log.info(`Target collections: ${targetCollections.join(', ')}`);
  log.info(`Recreate mode: ${shouldRecreate ? 'YES' : 'NO'}`);
  log.info('');

  // Validate collections
  const invalidCollections = targetCollections.filter(
    c => !BASE_COLLECTIONS.includes(c)
  );
  if (invalidCollections.length > 0) {
    log.error(`Invalid collection names: ${invalidCollections.join(', ')}`);
    log.info(`Valid collections: ${BASE_COLLECTIONS.join(', ')}`);
    process.exit(1);
  }

  // Test connection
  try {
    log.step('Testing Qdrant connection...');
    await client.getCollections();
    log.success('Connected to Qdrant');
  } catch (error) {
    log.error(`Failed to connect to Qdrant: ${error.message}`);
    log.error(`Make sure Qdrant is running at ${QDRANT_URL}`);
    process.exit(1);
  }

  // Setup each collection
  const results = [];
  for (const collectionName of targetCollections) {
    try {
      const success = await setupCollection(collectionName);
      results.push({ name: collectionName, success });
    } catch (error) {
      log.error(`Failed to setup collection '${collectionName}': ${error.message}`);
      results.push({ name: collectionName, success: false, error: error.message });
    }
  }

  // Summary
  log.info('\n' + '='.repeat(60));
  log.info('Setup Summary');
  log.info('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(({ name, success, error }) => {
    if (success) {
      log.success(`${name}`);
    } else {
      log.error(`${name}${error ? `: ${error}` : ''}`);
    }
  });

  log.info(`\nTotal: ${results.length} | Successful: ${successful} | Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    log.success('\nAll collections setup successfully! 🎉');
  }
};

// Run the script
main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

