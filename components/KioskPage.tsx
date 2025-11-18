
import React, { useState, useMemo } from 'react';
import { ProductSummary } from '../types';
import { ShoppingCartIcon } from './icons/ShoppingCartIcon';
import { ItemsIcon } from './icons/ItemsIcon';
import { PlusIcon } from './icons/PlusIcon';
import { MinusIcon } from './icons/MinusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ScanIcon } from './icons/ScanIcon';
import KioskScanner from './KioskScanner';

const RETAIL_MARKUP = 1.4; // 40% markup

interface KioskPageProps {
  summaries: ProductSummary[];
  onPurchase: (cart: { productName: string; quantity: number }[]) => void;
}

interface CartItem {
  productName: string;
  quantity: number;
  price: number;
}

const KioskPage: React.FC<KioskPageProps> = ({ summaries, onPurchase }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isScanning, setIsScanning] = useState(false);

  const products = useMemo(() => {
    return summaries
        .map(summary => ({
            ...summary,
            price: summary.averageCostPerUnit * RETAIL_MARKUP
        }))
        .filter(product => {
            if (selectedCategory === 'All') return true;
            return product.category === selectedCategory;
        });
  }, [summaries, selectedCategory]);

  const categories = useMemo(() => {
      const allCategories = new Set(summaries.map(s => s.category));
      return ['All', ...Array.from(allCategories)];
  }, [summaries]);

  const handleAddToCart = (product: typeof products[0]) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.productName === product.productName);
      if (existingItem) {
        // Prevent adding more than available stock
        const stock = getStockForProduct(product.productName);
        if (existingItem.quantity >= stock) return prevCart;
        
        return prevCart.map(item =>
          item.productName === product.productName
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prevCart, { productName: product.productName, quantity: 1, price: product.price }];
    });
  };
  
  const updateCartQuantity = (productName: string, change: 1 | -1) => {
    setCart(prevCart => {
      const updatedCart = prevCart.map(item => {
        if (item.productName === productName) {
          return { ...item, quantity: item.quantity + change };
        }
        return item;
      });
      return updatedCart.filter(item => item.quantity > 0);
    });
  };

  const removeFromCart = (productName: string) => {
    setCart(prevCart => prevCart.filter(item => item.productName !== productName));
  };
  
  const cartTotal = useMemo(() => {
    return cart.reduce((total, item) => total + item.price * item.quantity, 0);
  }, [cart]);

  const handleCheckout = () => {
    onPurchase(cart.map(({ productName, quantity }) => ({ productName, quantity })));
    setCart([]);
    setPurchaseComplete(true);
    setTimeout(() => setPurchaseComplete(false), 4000); // Reset message after 4s
  };
  
  const getStockForProduct = (productName: string): number => {
    return summaries.find(s => s.productName === productName)?.totalQuantity || 0;
  };
  
  const getQuantityInCart = (productName: string): number => {
    return cart.find(item => item.productName === productName)?.quantity || 0;
  };

  const handleProductScanned = (productName: string) => {
    const product = summaries.find(p => p.productName === productName);
    if (product) {
        const productWithPrice = { ...product, price: product.averageCostPerUnit * RETAIL_MARKUP };
        handleAddToCart(productWithPrice);
    }
  };


  return (
    <>
    {isScanning && (
        <KioskScanner
            summaries={summaries}
            onProductScanned={handleProductScanned}
            onClose={() => setIsScanning(false)}
        />
    )}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Product Grid */}
      <div className="lg:col-span-2">
        <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
            <h1 className="text-3xl font-bold text-white">Welcome to the Kiosk</h1>
            <button
                onClick={() => setIsScanning(true)}
                className="flex items-center justify-center gap-2 py-2 px-4 border border-cyan-600 rounded-md shadow-sm text-sm font-medium text-cyan-400 bg-cyan-900/30 hover:bg-cyan-900/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all"
            >
                <ScanIcon className="w-5 h-5"/>
                Scan Item to Add
            </button>
        </div>

        <div className="mb-6">
            <div className="flex flex-wrap gap-2">
                {categories.map(category => (
                    <button
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                            selectedCategory === category
                                ? 'bg-cyan-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        {category}
                    </button>
                ))}
            </div>
        </div>

        {products.length === 0 ? (
          <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 text-center text-gray-400">
            <p>There are no products available in this category. Please check back later.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {products.map(product => {
              const inCart = getQuantityInCart(product.productName);
              const availableStock = product.totalQuantity;
              const canAddToCart = inCart < availableStock;

              return (
                <div key={product.productName} className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden flex flex-col">
                  <div className="p-4 flex-grow">
                     <div className="flex justify-center items-center h-24 w-24 bg-gray-700/50 rounded-lg mx-auto mb-4">
                        <ItemsIcon className="w-12 h-12 text-gray-500" />
                     </div>
                    <h3 className="font-semibold text-white truncate">{product.productName}</h3>
                    <p className="text-sm text-gray-400 mb-2 truncate">{product.manufacturer}</p>
                    <p className="text-xl font-bold text-cyan-400">${product.price.toFixed(2)}</p>
                  </div>
                  <div className="p-4 bg-gray-900/50">
                    <button 
                      onClick={() => handleAddToCart(product)}
                      disabled={!canAddToCart}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                      <ShoppingCartIcon className="w-5 h-5"/>
                      {canAddToCart ? 'Add to Cart' : 'Out of Stock'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Sidebar */}
      <div className="lg:col-span-1">
        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 sticky top-28">
           <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <ShoppingCartIcon className="w-6 h-6 text-cyan-400"/>
            Your Cart
          </h2>
          {purchaseComplete && (
            <div className="bg-green-800/50 border border-green-600 text-green-300 p-4 rounded-lg mb-4 text-center">
              <h3 className="font-bold">Purchase Successful!</h3>
              <p className="text-sm">Thank you for your order.</p>
            </div>
          )}
          {cart.length > 0 ? (
            <div className="space-y-4">
              <ul className="space-y-3 max-h-80 overflow-y-auto pr-2 -mr-2">
                {cart.map(item => (
                  <li key={item.productName} className="flex items-center gap-4 text-sm">
                    <div className="flex-grow">
                      <p className="font-medium text-white truncate">{item.productName}</p>
                      <p className="text-gray-400">${item.price.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-1 bg-gray-700/50 rounded-md">
                      <button onClick={() => updateCartQuantity(item.productName, -1)} className="p-1 text-gray-300 hover:text-white"><MinusIcon className="w-4 h-4"/></button>
                      <span className="font-bold text-white px-1">{item.quantity}</span>
                      <button 
                        onClick={() => updateCartQuantity(item.productName, 1)}
                        disabled={item.quantity >= getStockForProduct(item.productName)}
                        className="p-1 text-gray-300 hover:text-white disabled:text-gray-600"
                      ><PlusIcon className="w-4 h-4"/></button>
                    </div>
                    <button onClick={() => removeFromCart(item.productName)} className="p-1 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-700 pt-4 space-y-4">
                <div className="flex justify-between font-bold text-lg">
                  <span className="text-gray-300">Total:</span>
                  <span className="text-white">${cartTotal.toFixed(2)}</span>
                </div>
                 <button 
                    onClick={handleCheckout}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all"
                 >
                    Checkout
                </button>
              </div>
            </div>
          ) : (
             <p className="text-center text-gray-500 py-8">Your cart is empty.</p>
          )}
        </div>
      </div>
    </div>
    </>
  );
};

export default KioskPage;