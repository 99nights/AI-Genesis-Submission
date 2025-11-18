#!/usr/bin/env node
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL =
  process.env.QDRANT_URL ||
  process.env.QDRANT_PROXY_URL ||
  'http://localhost:8787/qdrant';
const COLLECTION_NAMES = (
  process.env.COLLECTION_NAME ||
  process.env.COLLECTION_NAMES ||
  process.argv.slice(2).join(',') ||
  'items'
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT || 256);

const client = new QdrantClient({ url: QDRANT_URL });

const inferSchema = (value) => {
  if (typeof value === 'boolean') return 'bool';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'string') return 'keyword';
  return null;
};

const fetchExistingSchemas = async (collectionName) => {
  const info = await client.getCollection(collectionName);
  const schema = info?.payload_schema || {};
  return Object.keys(schema).reduce((acc, field) => {
    acc[field] = schema[field].data_type;
    return acc;
  }, {});
};

const ensureIndex = async (collectionName, fieldName, schema, existing) => {
  if (existing[fieldName]) {
    console.log(`[skip] ${fieldName} already indexed as ${existing[fieldName]}`);
    return;
  }
  console.log(`[index] ${collectionName}.${fieldName} -> ${schema}`);
  await client.createPayloadIndex(collectionName, {
    field_name: fieldName,
    field_schema: schema,
  });
};

const main = async () => {
  console.log(`[auto-index] Target collections: ${COLLECTION_NAMES.join(', ')}`);
  for (const collectionName of COLLECTION_NAMES) {
    console.log(
      `[auto-index] Inspecting collection '${collectionName}' via ${QDRANT_URL}`
    );
    const existing = await fetchExistingSchemas(collectionName);
    const inferred = new Map();
    let offset = undefined;

  while (true) {
    const { points, next_page_offset } = await client.scroll(collectionName, {
      limit: 64,
      offset,
      with_payload: true,
    });

    for (const point of points) {
      const payload = point.payload || {};
      for (const [key, value] of Object.entries(payload)) {
        if (!inferred.has(key)) {
          const schema = inferSchema(value);
          if (schema) inferred.set(key, schema);
        }
      }
    }

    offset = next_page_offset;
    if (!offset || inferred.size >= SAMPLE_LIMIT) break;
  }

    if (!inferred.size) {
      console.log('[auto-index] No payload fields detected for this collection.');
      continue;
    }

    for (const [field, schema] of inferred.entries()) {
      await ensureIndex(collectionName, field, schema, existing);
    }
  }

  console.log('[auto-index] Done.');
};

main().catch((err) => {
  console.error('[auto-index] Failed:', err);
  process.exit(1);
});
