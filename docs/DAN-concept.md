# Decentralized Autonomous Network (DAN) Concept

_Last updated: 2025-11-17_

> A strategic blueprint for extending our inventory platform into a decentralized autonomous network that securely shares product, inventory, and fulfillment intelligence across shops, suppliers, drivers, and customers while preserving local control.

---

## 1. Vision & Objectives

| Goal | Description | Success Indicator |
| --- | --- | --- |
| **Federated Collaboration** | Allow independent shops/suppliers to share structured signals (stock, expirations, fulfillment capacity) without central ownership. | % of marketplace transactions powered by DAN data. |
| **Trust + Traceability** | Capture immutable provenance for every shared datum (who produced it, when, with which proofs). | Verifiable audit log entries mapped to Qdrant IDs. |
| **Autonomous Workflows** | Trigger cross-organization automations (restock alerts, driver assignments) via DAN smart policies instead of manual ops. | Reduction in manual escalations per batch/delivery. |
| **Composable Intelligence** | Reuse existing RAG/Gemini capabilities to reason over shared data while respecting tenant boundaries. | Latency of DAN insights comparable to local analytics. |

---

## 2. Design Principles

1. **Local-first with opt-in sharing** – every participant keeps an authoritative Qdrant namespace; DAN exposes only the fields explicitly marked as shareable.
2. **Cryptographic envelopes** – every shared artifact is signed by the originating shop key (Supabase auth + deterministic keypair) so other nodes can validate authenticity.
3. **Event sourcing over RPC** – we propagate changes as append-only events (Kafka-lite built on Supabase `realtime` channels to start) that downstream nodes replay into their own caches.
4. **Deterministic AI helpers** – when DAN triggers Gemini/GPT flows (e.g., anomaly detection), we record prompts + hashes so other nodes can reproduce the inference path.
5. **Progressive decentralization** – phase 1 leverages our existing backend (Supabase + Qdrant) as coordination fabric; later phases can migrate to community-hosted gateways or L2 rollups if needed.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     DAN Control Plane (Supabase + Qdrant)                │
│  - Identity & key registry                                               │
│  - Event & policy bus (Channels / Edge Functions)                        │
│  - Audit ledger (append-only table -> Qdrant "dan_audit" collection)     │
└──────────────────────────────────────────────────────────────────────────┘
          ▲                         ▲                          ▲
          │                         │                          │
┌─────────┴─────────┐   ┌───────────┴─────────┐    ┌───────────┴─────────┐
│ Shop Node (UI +   │   │ Supplier Node       │    │ Driver / Courier    │
│ vectorDBService)  │   │ (Batch + inventory) │    │ Node (deliveries)   │
│ - Local Qdrant ns │   │ - Local Qdrant ns   │    │ - Task queue        │
│ - Gemini services │   │ - Gemini adapters   │    │ - Telemetry agent   │
└───────────────────┘   └────────────────────┘    └──────────────────────┘
```

**Key Components**

| Component | Responsibilities | Existing Assets |
| --- | --- | --- |
| **DAN Registry Service** | Maps Supabase user/shop IDs → DAN keypairs, publishes capability tokens. | `services/vectorDBService.ts` (active shop context), Supabase auth. |
| **DAN Event Bus** | Broadcasts normalized events (inventory.offer, fulfillment.need, delivery.status). Backed initially by Supabase Realtime; mirrored into Qdrant `dan_events`. | `backendService`, `vectorDBService` helpers. |
| **DAN Policy Engine** | Evaluates declarative rules (YAML/JSON) describing when to auto-share data or trigger automations. Runs as Edge Function hitting Qdrant vectors + metadata. | `services/geminiService.ts` for AI enrichment, `scripts/seedInventory.mjs` for data molding. |
| **Local Node Adapter** | New module inside `vectorDBService` that converts local mutations (batches, sales, marketplace actions) into DAN events & verifies inbound ones. | Qdrant persistence helpers already abstracted. |

---

## 4. Data & Protocol Layers

### 4.1 Data Schemas

| Artifact | Source Collection | Shared Fields | Notes |
| --- | --- | --- | --- |
| `InventorySignal` | `items` | productId, quantity, expirationDate (rounded), location bucket, sellPrice, proof hash | Location bucket obfuscates precise slot (Aisle only). |
| `BatchProof` | `batches` + `documents` | invoice hash, supplierId, deliveryDate, ocrChecksum | Links to OCR artifacts already captured by Gemini. |
| `DeliveryOffer` | `drivers` / `deliveries` | driverId, capacity, geoHash, specialties | Derived from Drivers tab data. |
| `PolicyDescriptor` | new `dan_policies` table | version, condition DSL, actions, signatures | Controls automation triggers. |

### 4.2 Event Types (initial set)

- `inventory.offer.created`
- `inventory.offer.reserved`
- `inventory.offer.fulfilled`
- `batch.receipt.attested`
- `delivery.capacity.updated`
- `policy.trigger.executed`

Each event includes:

```
{
  eventId,
  actor: { shopId, signature },
  payload,
  vectorContext?: embedding[],   // optional for semantic search
  proofs: { hash, link }
}
```

---

## 5. Integration Plan with Existing Stack

| Phase | Scope | Required Work | Dependencies |
| --- | --- | --- | --- |
| **Phase 0 – Concept Drop** | Publish this document, align stakeholders. | ✅ (this file) | — |
| **Phase 1 – Registry & Event Skeleton** | Key derivation per shop, append-only `dan_events` table, simple pub/sub over Supabase Realtime. | - Extend `vectorDBService` with `getDanContext()` <br> - Add `services/danRegistry.ts` client <br> - Scaffold Edge Function for verifying signatures | Supabase project keys |
| **Phase 2 – Inventory Offers** | Allow shops to broadcast surplus stock to DAN; marketplace consumes via search. | - Hook `addInventoryBatch` & `recordSale` to emit events <br> - Index shareable items in Qdrant `dan_inventory` collection <br> - Update Marketplace page to toggle “DAN offers only” | Qdrant multi-namespace support |
| **Phase 3 – Autonomous Policies** | Policy DSL + executor to auto-trigger restock or delivery assignments. | - Define JSON/YAML schema <br> - Build `policyEngine` Edge Function calling `vectorDBService.searchRelevantInventoryItems` <br> - Store policy run logs in `dan_audit` | Gemini service (optional) |
| **Phase 4 – Full Node Packaging** | Provide CLI/docker recipe so partners can run their own DAN node that syncs with our control plane. | - Publish node adapter package (TypeScript) <br> - Document handshake & health checks <br> - Optional: integrate with `scripts/setupQdrant.mjs` | Observability stack |

---

## 6. Security & Compliance Notes

1. **Key Management** – derive per-shop Ed25519 keys using Supabase user UUID + salt; store encrypted in Supabase (or local secure storage) until hardware wallet escalation is ready.
2. **Selective Disclosure** – add `shareScope` metadata to products/batches; only records with scope `["dan","marketplace"]` leave the shop.
3. **Auditability** – any DAN consumer must store event references (eventId + hash) with downstream transactions (orders, deliveries) to ensure we can reconstruct the provenance chain.
4. **Rate Limiting & Abuse Prevention** – control plane enforces quotas per shop; suspicious activity auto-notifies backend admins via existing Toast/notification bus.

---

## 7. Next Steps & Open Questions

- [ ] Finalize `PolicyDescriptor` DSL (YAML vs JSON, condition syntax).
- [ ] Decide whether DAN audit data lives inside Qdrant or external immutable log (e.g., Litestream + S3).
- [ ] Prototype signature verification Edge Function + client hooks.
- [ ] Align UI copy (Inventory, Marketplace, Drivers) with DAN terminology to avoid user confusion.
- [ ] Explore incentive mechanism (credits, loyalty) for nodes contributing high-quality data.

---

## 8. References

- Existing docs: `docs/qdrant-architecture-guide.md`, `docs/shop-workflow-plan.md`
- Core services: `services/vectorDBService.ts`, `services/geminiService.ts`, `components/MarketplacePage.tsx`
- Scripts/utilities: `scripts/seedInventory.mjs`, `scripts/setupQdrant.mjs`

---

_Prepared for the Inventory AI team to guide the first implementation sprint toward a decentralized autonomous network layer._

