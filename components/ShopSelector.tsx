import React, { useState, useEffect } from 'react';
import { useShopContext } from '../contexts/ShopContext';
import { getAllShops, validateShopExists } from '../services/vectorDBService';
import { useToast } from './Toast';
import { ScanIcon } from './icons/ScanIcon';

interface ShopSelectorProps {
  onShopSelected?: () => void;
  showQRScanner?: boolean;
}

const ShopSelector: React.FC<ShopSelectorProps> = ({ onShopSelected, showQRScanner: enableQRScanner = false }) => {
  const { currentShop, setCurrentShop } = useShopContext();
  const [shops, setShops] = useState<{ id: string; name: string; contactEmail?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    loadShops();
  }, []);

  const loadShops = async () => {
    try {
      setIsLoading(true);
      const allShops = await getAllShops();
      setShops(allShops);
    } catch (error) {
      console.error('Failed to load shops:', error);
      showToast('Failed to load shops', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleShopSelect = (shop: { id: string; name: string; contactEmail?: string }) => {
    setCurrentShop(shop);
    showToast(`Selected shop: ${shop.name}`, 'success');
    if (onShopSelected) {
      onShopSelected();
    }
  };

  const handleQRSubmit = async () => {
    if (!qrInput.trim()) {
      showToast('Please enter a shop ID', 'error');
      return;
    }

    try {
      const shop = await validateShopExists(qrInput.trim());
      if (shop) {
        handleShopSelect(shop);
        setQrInput('');
        setShowQRScanner(false);
      } else {
        showToast('Shop not found. Please check the QR code.', 'error');
      }
    } catch (error) {
      console.error('Error validating shop:', error);
      showToast('Failed to validate shop', 'error');
    }
  };

  if (currentShop) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Current Shop</h3>
            <p className="text-gray-300">{currentShop.name}</p>
          </div>
          <button
            onClick={() => setCurrentShop(null)}
            className="px-4 py-2 text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-600 rounded-lg hover:bg-cyan-900/30 transition"
          >
            Change Shop
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
      <h2 className="text-2xl font-bold text-white mb-6">Select a Shop</h2>

      {/* QR Code Scanner - Only show if enabled */}
      {enableQRScanner && (
        <div className="mb-6">
          <button
            onClick={() => setShowQRScanner(!showQRScanner)}
            className="w-full flex items-center justify-center gap-3 py-3 px-6 border border-transparent rounded-lg shadow-lg text-base font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-all mb-4"
          >
            <ScanIcon className="w-5 h-5" />
            {showQRScanner ? 'Hide QR Scanner' : 'Scan Shop QR Code'}
          </button>

          {showQRScanner && (
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-3">Enter shop ID from QR code:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleQRSubmit()}
                  placeholder="Shop ID"
                  className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <button
                  onClick={handleQRSubmit}
                  className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold transition"
                >
                  Go
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shop List */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Or Browse Shops</h3>
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto"></div>
            <p className="text-gray-400 mt-2">Loading shops...</p>
          </div>
        ) : shops.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400">No shops available</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {shops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => handleShopSelect(shop)}
                className="w-full text-left px-4 py-3 bg-gray-900/50 border border-gray-700 rounded-lg hover:bg-gray-900 hover:border-cyan-600 transition text-white"
              >
                <div className="font-semibold">{shop.name}</div>
                {shop.contactEmail && (
                  <div className="text-sm text-gray-400">{shop.contactEmail}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShopSelector;

