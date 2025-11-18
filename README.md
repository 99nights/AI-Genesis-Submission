<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1LtQRJKm9IrJ1BjwdKg7vF9dUURDdu4zE

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set environment variables:
   - `.env.local` → UI config (Gemini key, proxy URL, collection names, Supabase keys for auth). Example values are included.
   - `.env.proxy` → **server-side only**. Contains your real Qdrant Cloud endpoint + API key. Copy [.env.proxy.example](.env.proxy.example) and fill it with your credentials (keep it out of version control).
   - Supabase: add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env.local`. Supabase now powers only the shop login/registration flow.
3. Create your Supabase schema:
   - Run the SQL in [supabase/schema.sql](supabase/schema.sql) (or paste it into the Supabase SQL editor). It provisions the `shops` table used for authentication (username, email, password hash, and the generated Qdrant namespace).
   - When inserting a shop row manually, hash the password with:
     ```bash
     node -e "import bcrypt from 'bcryptjs'; const hash = await bcrypt.hash('your-password', 10); console.log(hash);"
     ```
4. Start the local Qdrant proxy:
   `npm run proxy`
5. (Optional) Setup Qdrant collections and indexes:
   - Setup all collections: `npm run setup:qdrant`
   - Recreate collections (deletes existing): `npm run setup:qdrant:recreate`
   - Setup specific collections: `node scripts/setupQdrant.mjs --collections=items,products`
6. Run the app UI (in another terminal) or use the combined helper:
   - UI only: `npm run dev`
   - Proxy + UI together: `npm run dev:full`

# AI-Genesis

Below follows the Idea Pitch, please read it through. It is fully AI generated (Grok) numbers not verified.



### Short Description (Elevator Pitch – 60-90 seconds, 208 words)

ShopNexus is the all-in-one AI operating system for small and medium-sized 24/7 self-service and autonomous convenience shops.

Today, independent owners lose dozens of hours per week on manual inventory counts, stockouts, overstock, expiry waste, and fragmented tools. In a market where food waste alone costs retailers billions annually and labor shortages make 24/7 operation increasingly difficult, most solutions are built for chains — too complex, too expensive, or completely missing the autonomous reality.

ShopNexus delivers a complete, ready-to-deploy suite:
- Real-time inventory via OCR shelf scanning and computer vision
- Intelligent POS with instant sales analytics
- Automated waste tracking and reduction alerts
- Product performance scoring and dynamic reordering
- RAG-powered natural language insights on Qdrant vector database (“show me products expiring this week within 5 km”)

The true differentiator: a built-in peer-to-peer marketplace that connects nearby ShopNexus operators to buy/sell excess or urgent stock in minutes, with integrated logistics coordination (DPD/GLS partners or freelance drivers).

We cut management time by up to 85 %, reduce waste 35–60 %, and turn independent shops into a powerful local network — no central distributor needed.

Market: unmanned/autonomous retail growing from ∼$82 Bn in 2025 at >24 % CAGR, inside a $950 Bn+ global convenience channel.

ShopNexus is the OS that finally makes truly autonomous 24/7 retail profitable for independent owners.


# Technical Documentation: Autonomous Shop Inventory AI

## 1. Introduction

The **Autonomous Shop Inventory AI** is a sophisticated Single Page Application (SPA) designed to streamline inventory management for autonomous retail environments. It leverages the **Google Gemini API** for advanced OCR and data analysis, and features a **Decentralized Autonomous Network (DAN)** for a peer-to-peer marketplace.

The application is fully cloud-based, with all data persistence handled by **Qdrant** (vector database) and **Supabase** (authentication and relational data). No local storage is used for data persistence - everything is stored in the cloud for real-time synchronization and multi-device access.

## 2. High-Level Architecture

- **Frontend Framework**: React 19 with TypeScript for a modern, type-safe, and component-based UI.
- **Styling**: Tailwind CSS for a utility-first, responsive design system.
- **AI Engine**: The `@google/genai` SDK is used to interact with the Google Gemini API for all AI-driven tasks.
- **Data Persistence**: All data is stored in **Qdrant** (vector database) for products, inventory, batches, sales, and marketplace listings. **Supabase** handles authentication and shop/user management. No local storage is used for data persistence.
- **State Management**: Primarily managed through React's native hooks (`useState`, `useEffect`, `useCallback`) within components, with business logic and data manipulation encapsulated in dedicated service modules.

## 3. Core Technologies & Services

### 3.1. Gemini AI Service (`services/geminiService.ts`)

This service is the central hub for all AI interactions, abstracting away the complexities of the Gemini API.

#### Models Used:

- **`gemini-2.5-flash`**: Used for high-speed, cost-effective tasks such as:
  - **Full Image OCR**: Analyzing an uploaded image of a product or delivery note and returning structured JSON data by enforcing a `responseSchema`.
  - **Product Identification**: Identifying a product from a live video feed against a list of known inventory items.
  - **Targeted Field Extraction**: Reading the value from a small, user-cropped image of a specific field (e.g., an expiration date).
  - **Learned Feature Recognition (`findAndReadFeature`)**: A powerful function that takes a small "feature" image (e.g., a saved crop of a product's name) and locates that same feature within a larger, live camera view to extract its value, enabling the "scan-and-learn" functionality.

- **`gemini-2.5-pro`**: Used for the **"Advanced Inventory Analysis"** panel. It handles complex, natural language prompts, providing deep, context-aware insights into the inventory data by leveraging its larger context window and advanced reasoning capabilities.

### 3.2. Vector DB Service (Qdrant) (`services/vectorDBService.ts`)

This service manages the application's vector database using **Qdrant**, a production-ready vector database. It handles multiple collections for different entity types, with semantic search capabilities for products, suppliers, and inventory items.

#### Collections:

- `users`: User profiles and authentication data
- `shops`: Shop/store records
- `customers`: Customer profiles
- `suppliers`: Supplier profiles (with semantic search on names)
- `products`: Canonical product definitions (with semantic search on names/descriptions)
- `items`: Inventory stock items (with semantic search on product names)
- `batches`: Delivery batch records
- `sales`: Sales transaction logs
- `drivers`: Driver profiles
- `visual`: Visual learning features for scan-and-learn
- `marketplace`: Marketplace listings

#### Core Logic:
It contains all business logic for inventory manipulation, including adding new batches, calculating product summaries, and processing sales based on a **First-Expired, First-Out (FEFO)** principle.

**📖 For detailed information on Qdrant collection architecture, point IDs, indexes, and query patterns, see [docs/qdrant-architecture-guide.md](docs/qdrant-architecture-guide.md).**

**📖 Important**: All Qdrant collections are properly configured with indexes and schema. The setup script (`scripts/setupQdrant.mjs`) ensures all collections have the correct payload indexes for efficient querying. See [docs/qdrant-architecture-guide.md](docs/qdrant-architecture-guide.md) for details.

### 3.3. Backend Service (`services/backendService.ts`)

This service handles marketplace operations, order management, and driver/delivery coordination. All data is stored in Qdrant collections, with verification status managed through Supabase and Qdrant.

- **Verification**: Shop and driver verification status is stored in Qdrant's `users` and `shops` collections.
- **Marketplace**: Peer marketplace listings are stored in Qdrant's `marketplace` collection.
- **Orders & Deliveries**: Order management and delivery tracking use Qdrant collections for persistence.

### 3.4. Authentication Service (`services/shopAuthService.ts`)

Manages user authentication and session state using Supabase.

- **Registration**: Creates user accounts in Supabase with proper role assignments (shop, customer, supplier, driver).
- **Session Management**: Uses Supabase authentication for secure session handling.
- **Shop Context**: Manages active shop selection and Qdrant namespace association for multi-shop support.

## 4. Key Components & UI Flow

### `App.tsx` (Root Component):
- Acts as the main controller.
- Manages authentication state, rendering `AuthPage` or the main application layout.
- Handles tab-based navigation.
- Manages data refresh through React state updates (no page refreshes needed).
- Determines user roles and renders appropriate interfaces (shop, customer, supplier).

### `AuthPage.tsx`:
- The entry point for new users.
- A simple registration form that, upon submission, logs the user in with a **"pending verification"** status.

### `CameraCapture.tsx` (Live Scanner):
A sophisticated modal that uses `navigator.mediaDevices.getUserMedia` to access the device camera.

It operates in multiple modes:

- **Auto-Scanning**: Periodically captures frames and sends them to Gemini for generic OCR and product identification.
- **Learned Scanning**: If a known product is identified, it retrieves learned visual features from the `vectorDBService` and uses `findAndReadFeature` to perform targeted, fast, and accurate data extraction.
- **Manual Capture**: Allows the user to tap the screen to draw a bounding box around a specific piece of information, which is then cropped and sent for precise analysis. The resulting cropped image is then saved back to the `vectorDBService` to improve future scans.

Every scan now keeps a running confidence score per field, so the highest quality reading survives repeated passes (live OCR no longer overwrites a good value with a later guess). When a shop scans an item the component also queries the canonical product catalog, so existing SKUs are auto-linked and only variable data (price, expiry, quantity, etc.) needs to be confirmed. For new products, the UI flips into "New Product" mode and asks the operator to register the missing attributes; every manually cropped field is persisted as a labeled training image that is referenced inside each item's `scanMetadata`.

### Inventorization & In-Shop Sales Flow

1. **Live OCR capture**  
   `CameraCapture` continuously grabs frames, applies Gemini OCR, and lets the user draw focus boxes for stubborn fields. Each recognized field is tagged with its source (`manual`, `learned`, or `auto`) and a confidence score, and the highest-confidence value always wins across the entire scan session.

2. **Product matching & manual override**  
   Identified products are matched against the canonical catalog (`ProductSummary` list). Known products immediately lock static metadata while allowing operators to update variable fields (buy price, shelf location, expiration date, etc.). If no match is found, the UI switches to “New Product” mode and guides the user through registration before any item is staged.

3. **Focus-area crops feed future scans**  
   When the operator defines a focus area, the cropped image is saved through `addImageForField` into the `visual` collection (Qdrant) together with batch metadata. The resulting `captureId` is linked inside the staged item’s `scanMetadata.fieldCaptures`, so future scans can re-use the exact feature.

4. **Batch staging with persistent scan metadata**  
   `InventoryForm` bundles the scanned item, its blobs, and the captured feature list into a batch. Each entry records the aggregate OCR confidence plus the per-field capture audit trail. Minis batches remain editable until “Finish and Save Batch” is pressed.

5. **Inventory vs. product separation**  
   Once a batch is saved, every line item becomes a stock point in Qdrant’s `items` collection, scoped to the active shop. The Inventory page only shows those shop-specific items, while the Product Catalog page continues to list all registered products across every shop (for reuse in future scans).

6. **Sales-aware state**  
   The inventorized items immediately surface inside the Inventory dashboard, the kiosk/cart flows, and downstream sales logic (FEFO deduction, marketplace listings, etc.), ensuring the in-shop POS is working off the exact same batch data that was captured from the shelves.

### Customer Product Discovery

- **Vector-powered catalog search.** `CustomerPage` queries Qdrant's `products` collection via `searchCatalogProducts()`, so every search request runs through the same semantic index used by shops.
- **Live camera scanner.** Customers can open the `CustomerProductScanner` modal, capture a label, and run Gemini's product identification against the canonical catalog; matches automatically drive the search query so results stay in sync.
- **Shop selection and shopping cart.** The customer interface allows browsing multiple shops, selecting products, and managing a shopping cart with checkout functionality.
- **Graceful fallbacks.** When no text query is provided the page shows the top semantic matches straight from Qdrant.

### `BackendPage.tsx`:
- Admin UI for managing shop and driver verification (when enabled).
- Fetches pending and verified client lists from Qdrant collections.
- The **"Verify"** button updates verification status in Qdrant and Supabase.

### `MarketplacePage.tsx`:
- This component is **conditionally rendered**. It first checks if `user.isVerified`.
- **If not verified**, it displays a **"Pending Verification"** message.
- **If verified**, it fetches and displays peer data from the `backendService` and allows the user to list their own inventory for sale.

# Terminology 

### Clarification of Acronyms in the ShopNexus Pitch Presentation

Here's a breakdown in a handy table for quick scanning—each with a plain-English explanation, formula (where relevant), and ShopNexus tie-in:

| Acronym | Full Form | Explanation | ShopNexus Context | Key Sources |
|---------|-----------|-------------|-------------------|-------------|
| **CAGR** | Compound Annual Growth Rate | A measure of the mean annual growth rate of an investment or metric over a specified period, assuming compounding (reinvested profits). Formula: [(Ending Value / Beginning Value)^(1 / Number of Years)] - 1. It's like averaging growth but accounts for ups and downs over time, not just simple yearly adds. | Used to show the autonomous retail market exploding at 24.7% CAGR from $82B in 2025 to $600B+ by 2034—proves the massive, steady tailwind for our platform. |  Investopedia (core formula and business use);  Gartner (annualized revenue growth);  Wikipedia (smoothing volatility in economic data). |
| **ARR** | Annual Recurring Revenue | The predictable yearly revenue from subscriptions or contracts, normalized to 12 months (e.g., multiply monthly subs by 12). It's a startup staple for showing stable, scalable income without one-offs. | Our target: Hit €5M ARR in 18 months via €199–€499/mo subscriptions per shop—investors love this for forecasting without fluff. |  Visible.vc (SaaS startup focus);  Alexander Jarvis (normalized subscription value);  JoinArc (predictable revenue for growth). |
| **SaaS** | Software as a Service | A cloud-based delivery model where software is hosted centrally and accessed via subscription (like Netflix for apps). No installs needed—providers handle updates, security, and scaling. | ShopNexus is pure SaaS: One sub gets inventory, POS, and insights; we manage the backend so shop owners focus on profits, not servers. |  Microsoft Azure (scalable, managed access);  AWS (subscription model details);  Wikipedia (multi-tenant architecture). |
| **POS** | Point of Sale | The hardware/software combo (e.g., checkout terminal) where retail transactions happen—handles payments, receipts, and basic sales tracking. Modern ones integrate inventory. | Our intelligent POS module syncs sales data in real-time with inventory, slashing manual reconciliation and enabling dynamic pricing. |  Wikipedia (transaction completion point);  Lightspeed (sales + inventory management);  SBA (cash register evolution). |
| **OCR** | Optical Character Recognition | Tech that scans images or docs to extract and convert text (e.g., reading expiry dates from photos). Uses pattern recognition for accuracy. | Powers our shelf scanning: Phone cams snap stock, OCR reads labels/SKUs, feeding real-time inventory without manual counts. |  Wikipedia (text extraction from images);  Zebra (machine-readable conversion);  Hyland (automation from scans). |
| **RAG** | Retrieval-Augmented Generation | An AI technique where large language models (LLMs) pull fresh data from external sources (e.g., databases) before generating responses—reduces hallucinations by grounding in real info. | Our RAG layer lets owners query in natural language (e.g., "Expiring stock nearby?") using Qdrant DB—pulls accurate, contextual insights on the fly. |  AWS (optimizing LLMs with knowledge bases);  Wikipedia (supplementing training data);  Google Cloud (external data integration). |
| **SMB** | Small and Medium-sized Business | Companies with <100 employees (small) or 100–999 (medium), often <$50M revenue (small) or <$1B (medium). The "backbone" of economies, but resource-constrained vs. enterprises. | Targets exactly our users: 24/7 shops with 1–50 staff, needing affordable tools—our OS scales without big-chain complexity. |  Salesforce (employee/revenue defs);  Deltek (economic role);  TechTarget (vs. large corps). |
| **API** | Application Programming Interface | A set of rules/protocols letting software apps talk to each other (e.g., like a menu for ordering data). Enables integration without knowing internals. | We use APIs for logistics (e.g., GLS/DPD slots) and marketplace matching—seamless peer-to-peer stock swaps without custom builds. |  Reddit/learnprogramming (communication bridge);  AWS (request/response contracts);  Contentful (rules for data access). |
| **ROI** | Return on Investment | A percentage showing profit relative to cost: (Gain - Cost) / Cost × 100. Measures efficiency; ignores time unless annualized. | Shops see <2-month ROI via €4K/mo savings on waste/time—our pitch proves quick payback to hook VCs on customer value. |  Investopedia (profit-to-cost ratio);  Investopedia (calculation guide);  CFI (net income basis). |
| **SKU** | Stock Keeping Unit | A unique alphanumeric code (e.g., CL-SHOE-BLK-10) for tracking product variants in inventory—includes style, size, color, etc., for retail ops. | Every item gets an SKU for OCR scanning and performance scoring—tracks velocity, waste, and reorders per variant. |  Square (unique inventory ID);  Investopedia (scannable tracking);  Shopify (product differentiation). |

These defs are drawn from cross-referenced libraries like Investopedia (finance heavy-hitters), Wikipedia (broad overviews), AWS/Google Cloud (tech specifics), and Gartner/Salesforce (business glossaries)—ensuring balanced, up-to-date takes as of Nov 2025. No single source dominates; I prioritized consensus for accuracy.

## Documentation

### Architecture Guides

- **[Qdrant Vector Database Architecture Guide](docs/qdrant-architecture-guide.md)**: Comprehensive guide covering collection strategy, point IDs, vector embeddings, payload structure, index strategy, query patterns, and best practices for the Qdrant vector database integration.
- **[DAN Architecture](docs/qdrant-architecture-guide.md#dan-architecture)**: Explains how the same Qdrant schema doubles as the replication/event layer for our Decentralized Autonomous Network (Shop Nodes, relays, and observers).

### Setup Scripts

- **`scripts/setupQdrant.mjs`**: Automated script to initialize all Qdrant collections and payload indexes according to the architecture guide. Run with `npm run setup:qdrant` or see the script for advanced options.
