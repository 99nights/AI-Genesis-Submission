# Shop Workflow Implementation & Test Plan

This plan translates the flow captured in `shop workflow.drawio.html` into actionable engineering tasks across the UI, services, and the simulated Qdrant/Supabase backend. Each stage lists the intent, the implementation work, and validation steps.

## 1. Identity & Context Setup

**Goal:** ensure every persona (shop, customer, supplier, driver) registers with the proper UUIDs and Qdrant namespaces.

- [ ] **Registration flow audit (`components/RegisterForm.tsx`, `services/shopAuthService.ts`).** Confirm each selected role generates the corresponding `*_qdrant_id` and persists it via `upsert*Record` helpers. Add validation that a shop/supplier always captures a shop context.
- [ ] **Namespace propagation.** Extend `ActiveShopContext` if new metadata is needed and add tests for `setActiveShopContext` so caches reset before OCR capture begins.
- **Test:** Register one user per persona, inspect Supabase `users` table & Qdrant collections (`users`, `shops`, `customers`, `suppliers`, `drivers`) via the proxy to confirm payload parity with `types.ts` interfaces.

## 2. Supplier Decision Node (“Existing supplier?”)

- [x] **UI toggle in `components/InventoryForm.tsx`.** Already added existing/new supplier modes.
- [x] **Backend enforcement.** Update `registerLocalSupplier`/`upsertSupplierProfile` to enforce `(shopId, supplierName)` uniqueness and persist contact/address metadata.
- **Test:** From Inventory tab, create a supplier inline and confirm the ID appears in the dropdown and in the `suppliers` Qdrant collection.

## 3. Product Decision Node (“Existing product?”)

- [x] **UI toggle for manual entry vs catalog.**
- [x] **Auto-registration for new products.** When saving a batch with manual products, call `createCanonicalProduct` and attach OCR-derived attributes (nutrition table, article numbers) to `ProductDefinition.metadata`.
- **Test:** Scan a new SKU, log a batch, then verify the new product appears in Product Catalog and the `products` collection.

## 4. Capture & OCR Branch

- [x] **Gemini service coverage (`services/geminiService.ts`).** Ensure `analyzeImageForInventory` returns all fields referenced in the workflow (invoice #, delivery date, expiry, nutrition info) and add logging for failures.
- [x] **Persist feature crops.** Expand `addImageForField` to tag captures with batch/supplier IDs for traceability.
- **Test:** Use “Live Scan”, upload a label, then inspect the `visual` collection and staged line items to confirm OCR values persist.

### 4.1 2025-11 OCR Enhancements

- **Confidence-aware field locking.** `CameraCapture` now stores a confidence score for every OCR field and only replaces a value when the new reading is higher. Manual focus boxes are tagged as `manual`, learned feature matches as `learned`, and passive OCR as `auto`.
- **Manual focus workflow.** Operators can tap-drag a bounding box to capture stubborn fields; each crop is saved through `addImageForField` with the capture source, batch context, and timestamp so the visual model can re-use it.
- **Catalog-aware matching.** Live scans call into the canonical product summaries. When a product is recognized the static data is injected automatically; otherwise the UI flips to “New Product” mode and prompts the user to confirm the name/manufacturer/category before staging the item.
- **Scan metadata persistence.** Every staged item now carries `scanMetadata.fieldCaptures`, a structured array that links each field to the saved capture ID and confidence. This metadata is written into the `items` collection alongside the traditional inventory payload so downstream analysis can trace exactly where a value came from.
- **Shop-scoped inventory vs global products.** Items inventorized through the new flow only appear in the active shop’s Inventory page, while the Product Catalog continues to surface all registered SKUs across shops so the scanner can search the entire catalog on future passes.

## 5. Batch + Item Creation

- [x] **Typed payloads for `upsertBatchRecord` & `persistInventoryEntry`.**
- [x] **Document ingestion improvements.** Associate uploaded documents with batch IDs immediately, store a checksum, and add a “Sync batches” action that reloads `db.batches` from Qdrant on demand.
- **Test:** Log a delivery with multiple items and one invoice; verify entries exist in `batches`, `items`, and that Inventory grid reflects the new quantities after `refreshInventoryFromQdrant()`.

## 6. Inventory Summary & Filtering

- [x] **Supplier + inventory filters (expiring soon / low stock) in `InventoryGrid.tsx`.**
- [x] **Add location & document links to cards.** Show storage location, last OCR timestamp, and a CTA to view associated batch documents.
- **Test:** Seed data with mixed expirations, toggle filters, and confirm results match Qdrant `items` expiration dates.

## 7. Marketplace / Peer Network

- [x] **Verification gating.** Replace the removed verification helpers with a single source of truth (Supabase or an admin toggle) so Marketplace availability matches the workflow.
- [x] **Inventory deduction hooks.** Ensure `purchaseFromMarketplace` deducts stock and persists a `sales` entry referencing the supplier.
- **Test:** Verify a user via Backend tab, list an item, purchase it from another account, and confirm both inventories adjust accordingly.

## 8. QA & Observability

- [ ] **Automated regression script.** Add a Playwright/Cypress flow that walks through the entire workflow end-to-end.
- [ ] **Qdrant health check.** Extend `server/proxy.js` health endpoint to verify connectivity to every collection used above.

## 9. Customer Discovery & Catalog Access

- [x] **Vector-aligned search.** The customer-facing catalog now uses `searchCatalogProducts()` so every query executes against Qdrant’s `products` collection (same embeddings, payloads, and namespace strategy described in the architecture guide).
- [x] **Live scan integration.** `CustomerProductScanner` reuses the Gemini OCR/identification path and feeds the result back into the vector search, giving customers the same “point-and-learn” UX as shop operators.
- **Test:** Log in as a customer-only user, search for "organic", then run a live scan of a label. Both flows should return consistent matches supplied directly by Qdrant.

## 9. Troubleshooting & Data Seeding

- [x] **Inventory seeding script.** Added `scripts/seedInventory.mjs` to inspect Qdrant for a given `shopId` and inject sample products/batches/items when none exist so the workflow can be demoed end-to-end.
- **Test:** Run `QDRANT_PROXY_URL=http://localhost:8787/qdrant node scripts/seedInventory.mjs c6172524-3288-407a-b695-66c1b304b2f0` and confirm the Inventory tab shows the seeded stock.

---

### Execution Checklist

| Stage | Owner | Status |
| --- | --- | --- |
| Identity & namespace audit | Frontend/Auth | ☐ |
| Supplier inline creation (backend) | Backend/Qdrant | ☐ |
| Auto product creation for new captures | Backend/Qdrant | ☐ |
| OCR field coverage & logging | Services | ☐ |
| Batch/doc ingestion sync | Backend/UI | ☐ |
| Inventory card enhancements | UI | ☐ |
| Marketplace verification refactor | Backend | ☐ |
| Troubleshooting & data seeding | Ops | ☑ |
| Automation & observability | QA/Infra | ☐ |
| Customer catalog discovery | Frontend | ☐ |

Use this document as the source of truth; update the checklist as each section ships and capture test evidence (screenshots, Qdrant dump snippets) alongside PRs.
