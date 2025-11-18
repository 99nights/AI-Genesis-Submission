import React, { useState } from 'react';
import { recordSale, getProductSummaries, setActiveShopContext } from '../services/vectorDBService';
import { useToast } from './Toast';
import { CheckCircleIcon } from './icons/CheckCircleIcon';

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  stockItem: any;
}

interface CustomerCheckoutProps {
  cart: CartItem[];
  totalPrice: number;
  shopId: string;
  customerId?: string;
  onComplete: () => void;
  onCancel: () => void;
}

const CustomerCheckout: React.FC<CustomerCheckoutProps> = ({
  cart,
  totalPrice,
  shopId,
  customerId,
  onComplete,
  onCancel,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const { showToast } = useToast();

  const handlePurchase = async () => {
    try {
      setIsProcessing(true);

      // Get product summaries to create product map
      const summaries = await getProductSummaries();
      const productMap = new Map(
        summaries.map(p => [p.productName, { id: p.productId, name: p.productName }])
      );

      // Convert cart to sale format
      const saleCart = cart.map(item => ({
        productName: item.productName,
        quantity: item.quantity,
      }));

      // Set active shop context temporarily for the sale
      setActiveShopContext({
        id: shopId,
        name: null,
        contactEmail: null,
        location: null,
        qdrantNamespace: null,
      });
      
      try {
        // Record the sale
        await recordSale(saleCart, productMap);
      } finally {
        // Restore previous context (or clear it)
        setActiveShopContext(null);
      }

      setIsComplete(true);
      showToast('Purchase completed successfully!', 'success');
      
      // Wait a moment then complete
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (error) {
      console.error('Purchase error:', error);
      showToast('Purchase failed: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
      setIsProcessing(false);
    }
  };

  if (isComplete) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 text-center">
        <CheckCircleIcon className="w-16 h-16 text-green-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Purchase Complete!</h2>
        <p className="text-gray-400">Thank you for your purchase</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
      <h2 className="text-2xl font-bold text-white mb-4">Checkout</h2>

      {/* Order Summary */}
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 mb-4">
        <h3 className="font-semibold text-white mb-3">Order Summary</h3>
        <div className="space-y-2">
          {cart.map((item) => (
            <div key={item.productId} className="flex justify-between text-sm">
              <span className="text-gray-300">
                {item.productName} x {item.quantity}
              </span>
              <span className="text-white font-semibold">
                ${(item.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-700 mt-3 pt-3 flex justify-between">
          <span className="text-lg font-semibold text-white">Total</span>
          <span className="text-xl font-bold text-cyan-400">${totalPrice.toFixed(2)}</span>
        </div>
      </div>

      {/* Payment Method (simplified - just a button for now) */}
      <div className="mb-4">
        <label className="block text-sm font-semibold text-white mb-2">Payment Method</label>
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
          <p className="text-gray-300 text-sm">Cash / Card at pickup</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handlePurchase}
          disabled={isProcessing}
          className="flex-1 py-3 px-4 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
        >
          {isProcessing ? 'Processing...' : 'Complete Purchase'}
        </button>
      </div>
    </div>
  );
};

export default CustomerCheckout;

