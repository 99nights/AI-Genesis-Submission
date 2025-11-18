import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ProductSummary, Batch as InventoryBatch, StockItem, User } from './types';
import { NewInventoryItemData, PeerListing } from './types';
import * as dataService from './services/vectorDBService';
import * as backendService from './services/backendService';
import { ActiveShopContextType } from './services/vectorDBService';
import { AuthenticatedProfile } from './services/shopAuthService';
import AuthPage from './components/AuthPage';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import InventoryPage from './components/InventoryPage';
import KioskPage from './components/KioskPage';
import MarketplacePage from './components/MarketplacePage';
import BackendPage from './components/BackendPage';
import CustomerPage from './components/CustomerPage';
import SupplierPage from './components/SupplierPage';
import ProductCatalogPage from './components/ProductCatalogPage';
import BatchesPage from './components/BatchesPage';
import ToastContainer, { useToast } from './components/Toast';
import { BACKEND_SERVICE_URL, IS_SIMULATED_BACKEND } from './config';

type Tab = 'dashboard' | 'inventory' | 'marketplace' | 'kiosk' | 'catalog' | 'batches' | 'backend' | 'customer' | 'supplier';

const App: React.FC = () => {
  const [session, setSession] = useState<AuthenticatedProfile | null>(null);
  const { toasts, removeToast } = useToast();
  const currentUser = session?.user ?? null;
  
  const hasShopRole = Boolean(currentUser?.roles?.shop || currentUser?.shopId);
  const hasCustomerRole = Boolean(currentUser?.roles?.customer || currentUser?.customerId);
  const hasSupplierRole = Boolean(currentUser?.roles?.supplier || currentUser?.supplierId);
  
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [productSummaries, setProductSummaries] = useState<ProductSummary[]>([]);
  const [allItems, setAllItems] = useState<StockItem[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  const requiresLogin = dataService.usesSupabaseStorage() && !currentUser;

  // Memoize shop context to avoid unnecessary recalculations
  const activeShopContextValue: ActiveShopContextType | null = useMemo(() => {
    if (!session?.shopContext || !currentUser) {
      return null;
    }
    
    // Extract shopId - handle both string and object cases
    let shopId: string;
    if (typeof session.shopContext === 'string') {
      shopId = session.shopContext;
    } else if (session.shopContext && typeof session.shopContext === 'object' && 'id' in session.shopContext) {
      shopId = (session.shopContext as any).id;
    } else {
      return null;
    }
    
    return {
      id: shopId,
      name: currentUser.companyName,
      contactEmail: currentUser.email,
      location: currentUser.address,
      qdrantNamespace: shopId,
    };
  }, [session?.shopContext, session?.user?.shopId, currentUser?.shopId, currentUser?.companyName, currentUser?.email, currentUser?.address]);

  // Only update shop context when it actually changes
  const previousShopContextRef = useRef<ActiveShopContextType | null>(null);
  useEffect(() => {
    const previousId = previousShopContextRef.current?.id;
    const currentId = activeShopContextValue?.id;
    
    // Only update if the shop ID actually changed
    if (previousId !== currentId) {
      previousShopContextRef.current = activeShopContextValue;
      dataService.setActiveShopContext(activeShopContextValue);
    }
  }, [activeShopContextValue]);

  const refreshData = useCallback(async (user?: User) => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    
    const userHasShop = Boolean(user.roles?.shop || user.shopId);
    
    setIsLoading(true);
    
    if (userHasShop) {
      const summaries = await dataService.getProductSummaries();
      const allBatches = await dataService.getAllBatches();
      const allStockItems = await dataService.getAllStockItems();
      setProductSummaries(summaries);
      setBatches(allBatches as InventoryBatch[]);
      setAllItems(allStockItems);
    } else {
      setProductSummaries([]);
      setBatches([]);
      setAllItems([]);
    }

    setIsLoading(false);
  }, []);

  // Track if we've initialized to avoid re-initializing
  const hasInitializedRef = useRef(false);
  const lastShopIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (requiresLogin || !currentUser) {
      hasInitializedRef.current = false;
      return;
    }
    
    const userHasShop = Boolean(currentUser.roles?.shop || currentUser.shopId);
    const currentShopId = currentUser.shopId || null;
    
    // Only initialize if shop changed or hasn't been initialized
    if (!userHasShop || (hasInitializedRef.current && lastShopIdRef.current === currentShopId)) {
      return;
    }
    
    const init = async () => {
      // Initialize database - this will load data from Qdrant
      await dataService.initializeAndSeedDatabase();
      // Refresh data to populate state
      await refreshData(currentUser);
      hasInitializedRef.current = true;
      lastShopIdRef.current = currentShopId;
    };
    init();
  }, [requiresLogin, currentUser?.shopId, refreshData]);

  // Track if inventory form is active to prevent auto-refresh during scanning
  const isInventoryFormActiveRef = useRef(false);

  useEffect(() => {
    if (!currentUser || !hasShopRole) return;
    const interval = setInterval(() => {
      // Don't refresh if user is actively using the inventory form (scanning/adding items)
      if (!isInventoryFormActiveRef.current) {
        refreshData(currentUser);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser, hasShopRole, refreshData]);

  const handleAuthSuccess = useCallback((profile: AuthenticatedProfile) => {
    setSession(profile);
    setIsLoading(false);
    
    const user = profile.user;
    if (user.shopId || user.roles?.shop) setActiveTab('dashboard');
    else if (user.supplierId || user.roles?.supplier) setActiveTab('supplier');
    else if (user.customerId || user.roles?.customer) setActiveTab('customer');
    else setActiveTab('dashboard');
  }, []);

  const handleLogout = useCallback(() => {
    setSession(null);
    setBatches([]);
    setProductSummaries([]);
    setAllItems([]);
    setActiveTab('dashboard');
  }, []);

  const addInventoryBatch = async (batchData: Omit<InventoryBatch, 'id'>, newItemsData: NewInventoryItemData[]) => {
    await dataService.addInventoryBatch(batchData, newItemsData);
    if (currentUser) await refreshData(currentUser);
  };

  const handlePurchase = async (cart: { productName: string; quantity: number }[]) => {
    await dataService.recordSale(cart);
    if (currentUser) await refreshData(currentUser);
  };

  const handleMarketplacePurchase = async (item: PeerListing, quantity: number) => {
    await dataService.purchaseFromMarketplace(item, quantity);
    await backendService.consumePeerListing(item.listingId, quantity);
    if (currentUser) await refreshData(currentUser);
  };

  const handleTabChange = (tab: Tab) => setActiveTab(tab);

  const legacyItems = useMemo(() => {
    if (!currentUser || !hasShopRole) {
      return [];
    }
    const filtered = allItems
      .filter(item => item.quantity > 0 && (!item.status || item.status === 'ACTIVE'));
    
    // Create a map for faster lookups
    const summaryMap = new Map<string, ProductSummary>(productSummaries.map(p => [p.productId, p]));
    
    return filtered.map(item => {
        const summary = summaryMap.get(item.productId);
        return {
          id: item.id,
          batchId: String(item.batchId),
          productId: item.productId,
          inventoryUuid: item.inventoryUuid,
          productName: summary?.productName || 'N/A',
          manufacturer: summary?.manufacturer || 'N/A',
          category: summary?.category || 'N/A',
          expirationDate: item.expirationDate,
          quantity: item.quantity,
          quantityType: summary?.quantityType || 'units',
          costPerUnit: item.costPerUnit,
          location: item.location || undefined,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          supplierId: item.supplierId || null,
          buyPrice: item.buyPrice ?? item.costPerUnit,
          sellPrice: item.sellPrice ?? undefined,
        };
      });
  }, [allItems, productSummaries, currentUser?.shopId, hasShopRole]);

  // Show customer app if:
  // 1. User is customer-only (no shop role)
  // 2. No user logged in (anonymous browsing)
  // Only show CustomerPage if user is customer-only (no shop role)
  // Shop users should see the main shop interface
  const shouldShowCustomerApp = currentUser && hasCustomerRole && !hasShopRole;

  if (shouldShowCustomerApp) {
    return <CustomerPage name={currentUser.companyName || 'Guest'} initialProfile={session ?? undefined} onLogout={handleLogout} />;
  }
  
  if (requiresLogin) {
    return <AuthPage onAuthenticated={handleAuthSuccess} />;
  }

  if (!currentUser || (hasShopRole && isLoading)) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
        <p className="mt-4 text-lg">Initializing Application...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        user={currentUser}
        onLogout={handleLogout}
        isBackendAvailable={IS_SIMULATED_BACKEND}
      />
      <main className="container mx-auto p-4 md:p-8">
        {activeTab === 'dashboard' && (
          <Dashboard 
            summaries={hasShopRole ? productSummaries : []} 
            onNavigateToInventory={() => hasShopRole && handleTabChange('inventory')} 
            onRefreshData={currentUser ? () => refreshData(currentUser) : undefined}
          />
        )}
        
        {activeTab === 'inventory' && hasShopRole && (
        <InventoryPage 
          summaries={productSummaries} 
          items={legacyItems} 
          batches={batches} 
          onAddBatch={addInventoryBatch} 
          onDataRefresh={() => currentUser && refreshData(currentUser)}
          onInventoryFormActiveChange={(isActive) => {
            isInventoryFormActiveRef.current = isActive;
          }}
        />
        )}
        {activeTab === 'catalog' && hasShopRole && <ProductCatalogPage />}
        {activeTab === 'batches' && hasShopRole && <BatchesPage />}
        {activeTab === 'kiosk' && hasShopRole && (
          <KioskPage summaries={productSummaries} onPurchase={handlePurchase} />
        )}
        {activeTab === 'marketplace' && hasShopRole && (
          <MarketplacePage summaries={productSummaries} user={currentUser} onPurchase={handleMarketplacePurchase} />
        )}
        
        {activeTab === 'customer' && hasCustomerRole && <CustomerPage name={currentUser.companyName} />}
        {activeTab === 'supplier' && hasSupplierRole && <SupplierPage name={currentUser.companyName} />}
        {IS_SIMULATED_BACKEND && activeTab === 'backend' && <BackendPage />}
        
        {!hasShopRole && ['inventory', 'catalog', 'batches', 'kiosk', 'marketplace'].includes(activeTab) && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 text-center">
            <p className="text-red-400">Access Denied: Shop role required</p>
          </div>
        )}
        {!hasCustomerRole && activeTab === 'customer' && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 text-center">
            <p className="text-red-400">Access Denied: Customer role required</p>
          </div>
        )}
        {!hasSupplierRole && activeTab === 'supplier' && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 text-center">
            <p className="text-red-400">Access Denied: Supplier role required</p>
          </div>
        )}
      </main>
      <footer className="text-center p-4 mt-8 text-gray-500 text-sm">
        <p>Built for the modern autonomous shop. &copy; 2024 Inventory AI</p>
      </footer>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default App;
