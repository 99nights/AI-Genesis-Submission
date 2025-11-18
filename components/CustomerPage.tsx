import React, { useState, useEffect, useRef } from 'react';
import { ShopContextProvider, useShopContext } from '../contexts/ShopContext';
import { CustomerContextProvider, useCustomerContext } from '../contexts/CustomerContext';
import ShopSelector from './ShopSelector';
import CustomerCart from './CustomerCart';
import CustomerProductScanner from './CustomerProductScanner';
import CameraCapture from './CameraCapture';
import AuthPage from './AuthPage';
import { AuthenticatedProfile } from '../services/shopAuthService';
import { useToast } from './Toast';
import { StockItem, ProductSummary, ProductDefinition } from '../types';
import { getAllStockItems } from '../services/qdrant/services/inventory';
import { getProductSummaries, searchCatalogProducts } from '../services/vectorDBService';
import { CameraIcon } from './icons/CameraIcon';

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  stockItem: StockItem;
}

/**
 * Customer Shop Page - Shows inventory for selected shop with shopping cart
 */
const CustomerShopPage: React.FC = () => {
  const { currentShop, setCurrentShop } = useShopContext();
  const [inventory, setInventory] = useState<StockItem[]>([]);
  const [productSummaries, setProductSummaries] = useState<ProductSummary[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    if (currentShop) {
      loadInventory();
    }
  }, [currentShop]);

  const loadInventory = async () => {
    if (!currentShop) return;

    try {
      setIsLoading(true);
      // Fetch stock items for the selected shop
      const stockItems = await getAllStockItems(currentShop.id);
      // Filter active items only
      const activeItems = stockItems.filter(
        item => item.quantity > 0 && (!item.status || item.status === 'ACTIVE')
      );
      setInventory(activeItems);

      // Fetch product summaries to get product names
      const summaries = await getProductSummaries();
      setProductSummaries(summaries);
    } catch (error) {
      console.error('Failed to load inventory:', error);
      showToast('Failed to load inventory', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getProductName = (productId: string): string => {
    const summary = productSummaries.find(p => p.productId === productId);
    return summary?.productName || 'Unknown Product';
  };

  const addToCart = (item: StockItem) => {
    const productName = getProductName(item.productId);
    const existingCartItem = cart.find(c => c.productId === item.productId);

    if (existingCartItem) {
      // Increase quantity if item already in cart
      if (existingCartItem.quantity < item.quantity) {
        setCart(cart.map(c =>
          c.productId === item.productId
            ? { ...c, quantity: c.quantity + 1 }
            : c
        ));
        showToast(`Added ${productName} to cart`, 'success');
      } else {
        showToast(`Only ${item.quantity} available`, 'warning');
      }
    } else {
      // Add new item to cart
      const price = item.sellPrice || item.costPerUnit * 1.4;
      setCart([...cart, {
        productId: item.productId,
        productName,
        quantity: 1,
        price,
        stockItem: item,
      }]);
      showToast(`Added ${productName} to cart`, 'success');
    }
  };

  const updateCartQuantity = (productId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.productId === productId) {
        const newQuantity = item.quantity + delta;
        const maxQuantity = item.stockItem.quantity;
        if (newQuantity <= 0) {
          return null; // Remove item
        }
        if (newQuantity > maxQuantity) {
          showToast(`Only ${maxQuantity} available`, 'warning');
          return item;
        }
        return { ...item, quantity: newQuantity };
      }
      return item;
    }).filter(Boolean) as CartItem[]);
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  if (!currentShop) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 text-center">
        <p className="text-gray-400">Please select a shop to start shopping</p>
      </div>
    );
  }

  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return (
    <div className="space-y-6">
      {/* Shop Header */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{currentShop.name}</h1>
            {currentShop.contactEmail && (
              <p className="text-gray-400 text-sm">{currentShop.contactEmail}</p>
            )}
          </div>
          <button
            onClick={() => {
              setCurrentShop(null);
              setCart([]); // Clear cart when changing shop
            }}
            className="px-4 py-2 text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-600 rounded-lg hover:bg-cyan-900/30 transition whitespace-nowrap"
          >
            Change Shop
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inventory Grid */}
        <div className="lg:col-span-2">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
            <h2 className="text-xl font-bold text-white mb-4">Available Products</h2>

            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto"></div>
                <p className="text-gray-400 mt-4">Loading inventory...</p>
              </div>
            ) : inventory.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No products available at this shop</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {inventory.map((item) => {
                  const productName = getProductName(item.productId);
                  const price = item.sellPrice || item.costPerUnit * 1.4;
                  const cartItem = cart.find(c => c.productId === item.productId);
                  const inCart = cartItem !== undefined;

                  return (
                    <div
                      key={item.id}
                      className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 hover:border-cyan-600 transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <h3 className="font-semibold text-white">{productName}</h3>
                          <p className="text-sm text-gray-400">
                            {item.quantity} {item.quantityType || 'units'} available
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-cyan-400">${price.toFixed(2)}</p>
                          {item.expirationDate && (
                            <p className="text-xs text-gray-500">
                              Exp: {new Date(item.expirationDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => addToCart(item)}
                        disabled={item.quantity === 0 || (inCart && cartItem.quantity >= item.quantity)}
                        className={`w-full py-2 px-4 rounded-lg font-semibold transition ${
                          item.quantity === 0 || (inCart && cartItem.quantity >= item.quantity)
                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-cyan-600 hover:bg-cyan-700 text-white'
                        }`}
                      >
                        {inCart ? `In Cart (${cartItem.quantity})` : 'Add to Cart'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cart Sidebar */}
        <div className="lg:col-span-1">
          <CustomerCart
            cart={cart}
            onUpdateQuantity={updateCartQuantity}
            onRemoveItem={removeFromCart}
            totalPrice={totalPrice}
            shopId={currentShop.id}
            onPurchaseComplete={() => {
              setCart([]);
              loadInventory();
            }}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Customer Product Discovery - Search catalog and scan products
 */
const CustomerProductDiscovery: React.FC<{ name: string }> = ({ name }) => {
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [scannerCatalog, setScannerCatalog] = useState<ProductDefinition[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanMatch, setScanMatch] = useState<ProductDefinition | null>(null);
  const [visualSearchQuery, setVisualSearchQuery] = useState<string>('');
  const initialLoadRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const trimmed = query.trim();
      setIsSearching(Boolean(trimmed));
      if (!trimmed && !initialLoadRef.current) {
        setIsLoading(true);
      }
      try {
        const results = await searchCatalogProducts(trimmed, 30);
        if (cancelled) return;
        if (trimmed && results.length === 0) {
          setError('No such product found!');
          setProducts([]);
        } else {
          setProducts(results);
          setError(null);
        }
        initialLoadRef.current = true;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load products.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const loadScannerCatalog = async () => {
      try {
        const catalog = await searchCatalogProducts('', 200);
        setScannerCatalog(catalog);
      } catch (err) {
        console.warn('Failed to preload scanner catalog', err);
      }
    };
    loadScannerCatalog();
  }, []);

  const handleVisualSearchComplete = async (imageBlob: Blob) => {
    setIsScannerOpen(false);
    setIsSearching(true);
    setError(null);
    
    try {
      // Use scannerCatalog for product identification (has all products)
      const catalogForSearch = scannerCatalog.length > 0 ? scannerCatalog : products;
      
      // Use product identification to find the product
      const { identifyProductNameFromImage } = await import('../services/geminiService');
      const productNames = catalogForSearch.map(p => p.name);
      const matchedName = await identifyProductNameFromImage(imageBlob, productNames);
      
      if (matchedName) {
        const matchedProduct = catalogForSearch.find(p => p.name === matchedName);
        if (matchedProduct) {
          // Filter products to show only the matched product
          setProducts([matchedProduct]);
          setVisualSearchQuery(matchedProduct.name);
          setQuery(matchedProduct.name);
          setScanMatch(matchedProduct);
          setError(null);
        } else {
          setError('Product found in image but not in catalog.');
          setProducts([]);
        }
      } else {
        setError('Could not identify product from image. Please try again.');
        setProducts([]);
      }
    } catch (err) {
      setError('Visual search failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleScanMatch = (product: ProductDefinition | null) => {
    setScanMatch(product);
    if (product) {
      setQuery(product.name);
      setVisualSearchQuery('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Welcome, {name}!</h1>
        <p className="text-gray-300">
          Search the live catalog to see if a product is available in nearby autonomous shops. You can search by
          name, manufacturer, category, or use the live visual search to find products by image.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products by name, category, or manufacturer..."
            className="flex-1 px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            onClick={() => setIsScannerOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500"
          >
            <CameraIcon className="w-5 h-5" />
            Live Visual Search
          </button>
        </div>
        {(scanMatch || visualSearchQuery) && (
          <p className="mt-3 text-sm text-cyan-300">
            {visualSearchQuery ? (
              <>Showing results for visual search: <span className="font-semibold">{visualSearchQuery}</span></>
            ) : (
              <>Showing matches for <span className="font-semibold">{scanMatch?.name}</span> based on the latest scan.</>
            )}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Product Catalog</h2>
          {isLoading ? (
            <span className="text-sm text-gray-400">Loading catalog...</span>
          ) : isSearching ? (
            <span className="text-sm text-gray-400">Searching…</span>
          ) : (
            <span className="text-sm text-gray-400">{products.length} result(s)</span>
          )}
        </div>
        {isLoading ? (
          <p className="text-gray-400">Fetching catalog...</p>
        ) : products.length === 0 && query.trim() ? (
          <p className="text-gray-400">No such product found! Try a different keyword or use the live visual search.</p>
        ) : products.length === 0 ? (
          <p className="text-gray-400">No products available. Try searching or use the live visual search.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map(product => (
              <div key={product.id} className="p-4 rounded-lg bg-gray-900/60 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-white truncate" title={product.name}>{product.name}</h3>
                  {product.category && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-900/40 text-cyan-200 border border-cyan-700/40">
                      {product.category}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-400 mb-2">{product.manufacturer || 'Unknown manufacturer'}</p>
                {product.description && (
                  <p className="text-xs text-gray-400 line-clamp-3">{product.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isScannerOpen && (
        <CameraCapture
          onDataScanned={(result) => {
            // Get the image blob from the scan result
            const imageBlob = result.blobs.get('productName') || 
                            result.blobs.get('manufacturer') ||
                            Array.from(result.blobs.values())[0];
            if (imageBlob) {
              handleVisualSearchComplete(imageBlob);
            } else {
              setError('No image captured. Please try again.');
              setIsScannerOpen(false);
            }
          }}
          onClose={() => setIsScannerOpen(false)}
          productOptions={scannerCatalog.map(p => ({ productId: p.id, productName: p.name }))}
          mode="visual-search"
        />
      )}
    </div>
  );
};

/**
 * Customer App Content - Main customer interface with shop selection and shopping
 */
interface CustomerAppContentProps {
  onLogout?: () => void;
  name?: string;
}

const CustomerAppContent: React.FC<CustomerAppContentProps> = ({ onLogout, name }) => {
  const { currentShop, setCurrentShop } = useShopContext();
  const { customer, setCustomer, clearCustomer } = useCustomerContext();
  const [showAuth, setShowAuth] = useState(false);
  const [viewMode, setViewMode] = useState<'discovery' | 'shop'>('discovery');
  const { showToast } = useToast();

  const handleAuthSuccess = (profile: AuthenticatedProfile) => {
    const user = profile.user;
    
    // If user has shop role, they should use shop interface
    if (user.roles?.shop || user.shopId) {
      showToast('Shop account detected. Please sign in via the shop dashboard.', 'info');
      setShowAuth(false);
      return;
    }

    // Set customer context
    setCustomer(profile);
    setShowAuth(false);
    showToast('Welcome! You can now checkout.', 'success');
  };

  const handleLogout = () => {
    clearCustomer();
    showToast('Logged out successfully', 'success');
    onLogout?.();
    setShowAuth(false);
  };

  // Switch to shop view when a shop is selected
  useEffect(() => {
    if (currentShop) {
      setViewMode('shop');
    }
  }, [currentShop]);

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700 p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">ShopNexus Customer</h1>
            {customer && (
              <p className="text-sm text-gray-400">
                Logged in as {customer.user.companyName || customer.user.email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {currentShop && (
              <button
                onClick={() => {
                  setCurrentShop(null);
                  setViewMode('discovery');
                }}
                className="px-4 py-2 text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-600 rounded-lg hover:bg-cyan-900/30 transition"
              >
                Change Shop
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('discovery')}
                className={`px-4 py-2 text-sm border rounded-lg transition ${
                  viewMode === 'discovery'
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'text-gray-300 border-gray-600 hover:bg-gray-700'
                }`}
              >
                Browse Catalog
              </button>
              {currentShop && (
                <button
                  onClick={() => setViewMode('shop')}
                  className={`px-4 py-2 text-sm border rounded-lg transition ${
                    viewMode === 'shop'
                      ? 'bg-cyan-600 text-white border-cyan-600'
                      : 'text-gray-300 border-gray-600 hover:bg-gray-700'
                }`}
                >
                  Shop View
                </button>
              )}
            </div>
            {customer ? (
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-lg hover:bg-gray-700 transition"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="px-4 py-2 text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-600 rounded-lg hover:bg-cyan-900/30 transition"
              >
                Login
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto p-4 md:p-8">
        {showAuth ? (
          <div className="max-w-lg mx-auto">
            <AuthPage
              onAuthenticated={handleAuthSuccess}
            />
            <button
              onClick={() => setShowAuth(false)}
              className="mt-4 w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        ) : viewMode === 'discovery' ? (
          <>
            {!currentShop && <ShopSelector />}
            {currentShop && (
              <div className="mb-6">
                <ShopSelector />
              </div>
            )}
            <CustomerProductDiscovery name={name || 'Guest'} />
          </>
        ) : (
          <CustomerShopPage />
        )}
      </div>
    </div>
  );
};

/**
 * Customer Page - Main component with context providers
 */
interface CustomerPageProps {
  name: string;
  initialProfile?: AuthenticatedProfile | null;
  onLogout?: () => void;
}

const CustomerPage: React.FC<CustomerPageProps> = ({ name, initialProfile, onLogout }) => {
  return (
    <ShopContextProvider>
      <CustomerContextProvider initialCustomer={initialProfile}>
        <CustomerAppContent name={name} onLogout={onLogout} />
      </CustomerContextProvider>
    </ShopContextProvider>
  );
};

export default CustomerPage;
