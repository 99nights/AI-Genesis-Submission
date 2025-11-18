<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ShopNexus - Autonomous Shop Inventory AI

**The all-in-one AI operating system for small and medium-sized 24/7 self-service and autonomous convenience shops.**

View your app in AI Studio: https://ai.studio/apps/drive/1LtQRJKm9IrJ1BjwdKg7vF9dUURDdu4zE

---

## 📋 Table of Contents

- [Setup Instructions](#-setup-instructions)
- [The Idea](#-the-idea)
- [Technology Stack](#-technology-stack)
- [Architecture](#-architecture)
- [Implementation Details](#-implementation-details)
- [Future Outlook & Vision](#-future-outlook--vision)
- [Documentation](#-documentation)

---

## 🚀 Setup Instructions

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** or **yarn**
- Accounts for:
  - [Supabase](https://supabase.com) (free tier available)
  - [Qdrant Cloud](https://cloud.qdrant.io) (free tier available)
  - [Google AI Studio](https://aistudio.google.com) (for Gemini API key)

### Step 1: Get API Keys

#### 1.1 Get Supabase API Keys

1. Go to [Supabase](https://supabase.com) and create a free account
2. Create a new project
3. Navigate to **Settings** → **API**
4. Copy your:
   - **Project URL** (`SUPABASE_URL`)
   - **anon/public key** (`SUPABASE_ANON_KEY`)

#### 1.2 Get Qdrant Cloud Keys

1. Go to [Qdrant Cloud](https://cloud.qdrant.io) and sign up
2. Create a new cluster (free tier: 1GB storage)
3. Once created, copy:
   - **Cluster URL** (e.g., `https://xxxxx-xxxxx.qdrant.io`) → This is your `QDRANT_UPSTREAM_URL`
   - **API Key** → This is your `QDRANT_API_KEY`

⚠️ **Important**: The cluster URL must be your Qdrant Cloud URL (NOT localhost). Railway and Vercel block localhost connections.

#### 1.3 Get Google Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API Key** and create a new API key
4. Copy the API key → This is your `GEMINI_API_KEY`

### Step 2: Configure Environment Variables

1. **Create `.env.local` file** in the project root:
   ```bash
   # Google Gemini API
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Supabase Configuration
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   
   # Qdrant Configuration (for frontend)
   QDRANT_URL=/qdrant
   QDRANT_PROXY_URL=http://localhost:8787/qdrant
   QDRANT_COLLECTION=product_visual_features
   QDRANT_PRODUCTS_COLLECTION=products
   QDRANT_BATCHES_COLLECTION=batches
   QDRANT_STOCK_ITEMS_COLLECTION=stock_items
   QDRANT_SALES_COLLECTION=sales_transactions
   ```

2. **Create `.env.proxy` file** in the project root:
   ```bash
   # Qdrant Cloud Configuration (for backend proxy)
   QDRANT_UPSTREAM_URL=https://xxxxx-xxxxx.qdrant.io
   QDRANT_API_KEY=your_qdrant_api_key_here
   QDRANT_PRODUCTS_COLLECTION=products
   QDRANT_VECTOR_NAME=embedding
   QDRANT_VECTOR_SIZE=768
   QDRANT_PROXY_LOG=summary
   ```

### Step 3: Set Up Database Schemas

#### 3.1 Set Up Supabase Schema

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
4. Click **Run** to execute the SQL script

This creates:
- `users` table for authentication
- `products`, `batches`, `stock_items`, `sales` tables (for legacy compatibility)
- `dan_keys`, `dan_events`, `dan_audit`, `dan_policies` tables for DAN functionality
- Row Level Security (RLS) policies

#### 3.2 Set Up Qdrant Collections

Run the Qdrant setup script to create all collections and indexes:

```bash
# Setup all collections (recommended for first-time setup)
npm run setup:qdrant

# Or recreate all collections (WARNING: deletes existing data)
npm run setup:qdrant:recreate

# Or setup specific collections
node scripts/setupQdrant.mjs --collections=items,products,batches
```

This script will:
- Create all required collections (`users`, `shops`, `products`, `items`, `batches`, `sales`, `visual`, `marketplace`, `dan_inventory`, etc.)
- Set up proper vector configurations (768-dimensional embeddings with Cosine distance)
- Create payload indexes for efficient querying (`shopId`, `category`, `expiry_date`, etc.)

📖 **For detailed information on Qdrant collection architecture, see [docs/qdrant-architecture-guide.md](docs/qdrant-architecture-guide.md)**

### Step 4: Install Dependencies

```bash
npm install
```

### Step 5: Run the Application

#### Option 1: Run Everything Together (Recommended)

```bash
npm run dev:full
```

This starts both:
- Qdrant proxy server (port 8787)
- Vite development server (port 3000)

#### Option 2: Run Separately

Terminal 1 - Start Qdrant proxy:
```bash
npm run proxy
```

Terminal 2 - Start development server:
     ```bash
npm run dev
```

### Step 6: Access the Application

- **Frontend**: http://localhost:3000
- **Qdrant Proxy**: http://localhost:8787
- **Health Check**: http://localhost:8787/healthz

### Troubleshooting

- **Port already in use**: Change ports in `vite.config.ts` (frontend) or `server/index.js` (proxy)
- **Qdrant connection errors**: Verify `QDRANT_UPSTREAM_URL` is your Qdrant Cloud URL (not localhost)
- **Supabase errors**: Ensure RLS policies are enabled and you've run the schema SQL
- **Gemini API errors**: Check your API key is valid and billing is enabled (free tier has quotas)

---

## 💡 The Idea

### Short Description (Elevator Pitch – 60-90 seconds)

ShopNexus is the all-in-one AI operating system for small and medium-sized 24/7 self-service and autonomous convenience shops.

Today, independent owners lose dozens of hours per week on manual inventory counts, stockouts, overstock, expiry waste, and fragmented tools. In a market where food waste alone costs retailers billions annually and labor shortages make 24/7 operation increasingly difficult, most solutions are built for chains — too complex, too expensive, or completely missing the autonomous reality.

ShopNexus delivers a complete, ready-to-deploy suite:
- Real-time inventory via OCR shelf scanning and computer vision
- Intelligent POS with instant sales analytics
- Automated waste tracking and reduction alerts
- Product performance scoring and dynamic reordering
- RAG-powered natural language insights on Qdrant vector database ("show me products expiring this week within 5 km")

The true differentiator: a built-in peer-to-peer marketplace that connects nearby ShopNexus operators to buy/sell excess or urgent stock in minutes, with integrated logistics coordination (DPD/GLS partners or freelance drivers).

We cut management time by up to 85%, reduce waste 35–60%, and turn independent shops into a powerful local network — no central distributor needed.

Market: unmanned/autonomous retail growing from ~$82 Bn in 2025 at >24% CAGR, inside a $950 Bn+ global convenience channel.

ShopNexus is the OS that finally makes truly autonomous 24/7 retail profitable for independent owners.

---

## 🔧 Technology Stack

### Frontend
- **React 19** with **TypeScript** - Modern, type-safe UI framework
- **Tailwind CSS** - Utility-first styling system
- **Vite** - Fast build tool and dev server

### Backend & Services
- **Express.js** - Node.js server for Qdrant proxy
- **Qdrant** - Vector database for semantic search and storage
- **Supabase** - Authentication and relational data
- **Google Gemini API** - OCR, computer vision, and natural language processing

### AI & Machine Learning
- **Gemini 2.5 Flash** - Fast OCR, product identification, field extraction
- **Gemini 2.5 Pro** - Advanced inventory analysis with RAG
- **Vector Embeddings** - 768-dimensional embeddings for semantic search

---

## 🏗️ Architecture

### High-Level Overview

The application is a **Single Page Application (SPA)** with cloud-based data persistence. All data is stored in **Qdrant** (vector database) and **Supabase** (authentication). No local storage is used for data persistence - everything is synchronized in real-time.

### Core Services

#### 1. Gemini AI Service (`services/geminiService.ts`)

The central hub for all AI interactions, abstracting away the complexities of the Gemini API.

**Models Used:**
- **`gemini-2.5-flash`**: High-speed, cost-effective tasks
  - Full Image OCR - Analyzing product images and delivery notes
  - Product Identification - Identifying products from live camera feeds
  - Targeted Field Extraction - Reading specific fields (expiration dates, prices)
  - Learned Feature Recognition - Finding learned features in new images for "scan-and-learn"

- **`gemini-2.5-pro`**: Advanced analysis
  - Advanced Inventory Analysis - Complex natural language queries with deep insights

#### 2. Vector DB Service (Qdrant) (`services/qdrant/`)

Manages all data persistence using **Qdrant**, a production-ready vector database.

**Collections:**
- `users` - User profiles and authentication data
- `shops` - Shop/store records
- `customers` - Customer profiles
- `suppliers` - Supplier profiles (with semantic search)
- `products` - Canonical product definitions (with semantic search)
- `items` - Inventory stock items (with semantic search)
- `batches` - Delivery batch records
- `sales` - Sales transaction logs
- `drivers` - Driver profiles
- `visual` - Visual learning features for OCR
- `marketplace` - Peer-to-peer marketplace listings
- `dan_inventory` - DAN inventory offers

**Core Logic:**
- Business logic for inventory manipulation
- Adding batches with FEFO (First-Expired, First-Out) processing
- Product summaries and analytics
- Semantic search across all collections

📖 **For detailed Qdrant architecture, see [docs/qdrant-architecture-guide.md](docs/qdrant-architecture-guide.md)**

#### 3. Backend Service (`services/backendService.ts`)

Handles marketplace operations, order management, and driver coordination. All data stored in Qdrant collections.

- **Verification** - Shop and driver verification status
- **Marketplace** - Peer marketplace listings
- **Orders & Deliveries** - Order management and tracking

#### 4. Authentication Service (`services/shopAuthService.ts`)

Manages user authentication and session state using Supabase.

- **Registration** - Creates user accounts with role assignments (shop, customer, supplier, driver)
- **Session Management** - Secure session handling
- **Shop Context** - Active shop selection and Qdrant namespace association

---

## ⚙️ Implementation Details

### Key Components & UI Flow

#### `App.tsx` (Root Component)
- Main controller managing authentication state
- Tab-based navigation
- Data refresh through React state updates
- Role-based UI rendering (shop, customer, supplier)

#### Live OCR & Scanning System

**`ProductLearningScanner.tsx`** - Learn new products:
- Auto-scanning mode for continuous product discovery
- Manual field selection with bounding boxes
- Saves products to catalog AND creates inventory items
- Visual learning for improved future scans

**`CameraCapture.tsx`** - Inventory scanning:
- Multiple scanning modes:
  - **Auto-Scanning**: Periodic frame capture with Gemini OCR
  - **Learned Scanning**: Uses saved visual features for fast, accurate extraction
  - **Manual Capture**: Tap-to-crop for precise field extraction
- Confidence scoring - highest quality reading survives repeated passes
- Product matching against canonical catalog
- Auto-linking existing SKUs, only variable data needs confirmation

**`KioskScanner.tsx`** - Customer product discovery:
- Live camera scanner for product identification
- Automatic catalog search on product match

### Inventorization & Sales Flow

1. **Live OCR Capture**
   - Continuous frame capture with Gemini OCR
   - User can draw focus boxes for stubborn fields
   - Each field tagged with source (`manual`, `learned`, `auto`) and confidence score

2. **Product Matching & Manual Override**
   - Identified products matched against canonical catalog
   - Known products lock static metadata, allow variable field updates
   - Unknown products trigger "New Product" registration

3. **Visual Learning**
   - Cropped images saved to `visual` collection via `addImageForField`
   - Future scans reuse learned features for faster, more accurate extraction

4. **Batch Staging**
   - Items bundled with scan metadata and field capture audit trail
   - Editable until "Finish and Save Batch"

5. **Inventory Persistence**
   - Items saved to Qdrant `items` collection, scoped to active shop
   - Inventory page shows shop-specific items
   - Product Catalog shows all products (for reuse)

6. **Sales Integration**
   - Inventorized items immediately available in POS, kiosk, and cart flows
   - FEFO (First-Expired, First-Out) deduction logic
   - Real-time inventory updates

### Customer Experience

- **Vector-powered catalog search** - Semantic search across all products
- **Live camera scanner** - Product identification via camera
- **Multi-shop browsing** - Browse and shop from multiple stores
- **Shopping cart & checkout** - Complete e-commerce flow

### Marketplace & Network Features

- **Peer-to-peer marketplace** - Buy/sell excess or urgent stock
- **Verification system** - Shop and driver verification
- **Integrated logistics** - Driver coordination for deliveries

---

## 🔮 Future Outlook & Vision

### Shelf Scanning Feature

**Vision**: Continuous, automated shelf monitoring using fixed cameras or mobile devices.

**Capabilities:**
- **Real-time shelf monitoring** - Fixed cameras continuously monitor shelves
- **Automatic inventory updates** - Detects when items are removed or added
- **Expiration tracking** - Automatically tracks expiration dates from shelf labels
- **Stock level alerts** - Notifies when items are running low
- **Theft detection** - Identifies unusual patterns or missing items
- **Zero manual counts** - Eliminates need for periodic inventory counts

**Technology:**
- Fixed IP cameras with continuous video feed
- Mobile device placement for smaller shops
- Computer vision models trained on product recognition
- Real-time processing with Gemini Vision API
- Integration with existing OCR and learning systems

### Decentralized Autonomous Network (DAN)

**Vision**: A decentralized network that securely shares product, inventory, and fulfillment intelligence across shops, suppliers, drivers, and customers while preserving local control.

**Key Features:**

1. **Federated Collaboration**
   - Independent shops share structured signals (stock, expirations, fulfillment capacity)
   - No central ownership - peer-to-peer data sharing
   - Opt-in sharing with granular control

2. **Trust & Traceability**
   - Immutable provenance for every shared datum
   - Cryptographic signatures for authenticity
   - Verifiable audit logs mapped to Qdrant IDs

3. **Autonomous Workflows**
   - Smart policies trigger cross-organization automations
   - Automated restock alerts, driver assignments
   - Reduction in manual operations

4. **Composable Intelligence**
   - RAG/Gemini capabilities over shared data
   - Respects tenant boundaries
   - Latency comparable to local analytics

**Architecture:**
- **Local-first** - Each participant maintains authoritative Qdrant namespace
- **Event sourcing** - Changes propagated as append-only events
- **Cryptographic envelopes** - All shared artifacts signed by origin shop
- **Progressive decentralization** - Starts with Supabase + Qdrant, can migrate to community-hosted gateways

**Network Effects:**
- Once 15+ shops in a city use ShopNexus, waste drops another 50%
- Shop A's surplus becomes Shop B's emergency order
- Integrated logistics (GLS/DPD API or freelance drivers)
- Marketplace revenue share (4-6% transaction fee)

📖 **For detailed DAN architecture, see [docs/DAN-concept.md](docs/DAN-concept.md)**

### Additional Future Enhancements

- **Advanced Analytics Dashboard** - Predictive analytics, demand forecasting, automated reordering
- **Mobile Apps** - Native iOS/Android apps for shop owners and customers
- **IoT Integration** - Smart scales, RFID readers, temperature sensors
- **Multi-language Support** - International expansion with localization
- **API Ecosystem** - Third-party integrations for POS systems, accounting software
- **Advanced AI Features** - Predictive waste modeling, dynamic pricing optimization, demand forecasting

---

## 📚 Documentation

### Architecture Guides

- **[Qdrant Vector Database Architecture Guide](docs/qdrant-architecture-guide.md)**: Comprehensive guide covering collection strategy, point IDs, vector embeddings, payload structure, index strategy, query patterns, and best practices.

- **[DAN Architecture](docs/DAN-concept.md)**: Detailed explanation of the Decentralized Autonomous Network concept, architecture, and implementation.

- **[Pitch Deck](docs/Pitch.md)**: Business pitch and market analysis.

- **[Shop Workflow Plan](docs/shop-workflow-plan.md)**: Detailed workflow documentation for shop operations.

### Setup Scripts

- **`scripts/setupQdrant.mjs`**: Automated script to initialize all Qdrant collections and payload indexes. Run with `npm run setup:qdrant`.

- **`scripts/seedInventory.mjs`**: Script to seed test inventory data.

### Scripts Reference

```bash
npm run dev              # Start Vite dev server only
npm run proxy            # Start Qdrant proxy server only
npm run dev:full         # Start both proxy and dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run setup:qdrant     # Setup Qdrant collections
npm run setup:qdrant:recreate  # Recreate collections (WARNING: deletes data)
```

---

## 📊 Terminology

| Acronym | Full Form | Explanation | Context |
|---------|-----------|-------------|---------|
| **CAGR** | Compound Annual Growth Rate | Mean annual growth rate over time, accounting for compounding | Market growing at 24.7% CAGR from $82B to $600B+ |
| **POS** | Point of Sale | Hardware/software for retail transactions | Intelligent POS with real-time inventory sync |
| **OCR** | Optical Character Recognition | Extracts text from images | Powers shelf scanning for inventory |
| **RAG** | Retrieval-Augmented Generation | LLMs pull data from external sources before generating | Natural language queries on Qdrant database |
| **FEFO** | First-Expired, First-Out | Inventory management prioritizing expiring items | Sales deduction logic in inventory system |
| **DAN** | Decentralized Autonomous Network | Peer-to-peer network for sharing inventory intelligence | Future network layer for marketplace |

---

## 🤝 Contributing

This is an AI Studio submission. For questions or contributions, please contact the project maintainers.

---

## 📄 License

[Specify your license here]

---

**Built with ❤️ for autonomous retail**
