import React, { useState } from 'react';
import { useCustomerContext } from '../contexts/CustomerContext';
import CustomerCheckout from './CustomerCheckout';
import { ShoppingCartIcon } from './icons/ShoppingCartIcon';
import { PlusIcon } from './icons/PlusIcon';
import { MinusIcon } from './icons/MinusIcon';
import { TrashIcon } from './icons/TrashIcon';

interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  stockItem: any;
}

interface CustomerCartProps {
  cart: CartItem[];
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemoveItem: (productId: string) => void;
  totalPrice: number;
  shopId: string;
  onPurchaseComplete: () => void;
}

const CustomerCart: React.FC<CustomerCartProps> = ({
  cart,
  onUpdateQuantity,
  onRemoveItem,
  totalPrice,
  shopId,
  onPurchaseComplete,
}) => {
  const { customer } = useCustomerContext();
  const [showCheckout, setShowCheckout] = useState(false);

  if (showCheckout) {
    return (
      <CustomerCheckout
        cart={cart}
        totalPrice={totalPrice}
        shopId={shopId}
        customerId={customer?.user.customerId || customer?.user.clientId}
        onComplete={onPurchaseComplete}
        onCancel={() => setShowCheckout(false)}
      />
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 sticky top-4">
      <div className="flex items-center gap-2 mb-4">
        <ShoppingCartIcon className="w-6 h-6 text-cyan-400" />
        <h2 className="text-xl font-bold text-white">Cart</h2>
        {cart.length > 0 && (
          <span className="bg-cyan-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
            {cart.length}
          </span>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-400">Your cart is empty</p>
          <p className="text-sm text-gray-500 mt-2">Add items to get started</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 max-h-96 overflow-y-auto mb-4">
            {cart.map((item) => (
              <div
                key={item.productId}
                className="bg-gray-900/50 border border-gray-700 rounded-lg p-3"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-sm">{item.productName}</h3>
                    <p className="text-xs text-gray-400">${item.price.toFixed(2)} each</p>
                  </div>
                  <button
                    onClick={() => onRemoveItem(item.productId)}
                    className="text-gray-400 hover:text-red-400 transition"
                    aria-label="Remove item"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onUpdateQuantity(item.productId, -1)}
                      className="p-1 bg-gray-700 hover:bg-gray-600 rounded text-white transition"
                      aria-label="Decrease quantity"
                    >
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <span className="text-white font-semibold w-8 text-center">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(item.productId, 1)}
                      className="p-1 bg-gray-700 hover:bg-gray-600 rounded text-white transition"
                      aria-label="Increase quantity"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-cyan-400 font-semibold">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-700 pt-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-white">Total</span>
              <span className="text-2xl font-bold text-cyan-400">${totalPrice.toFixed(2)}</span>
            </div>

            <button
              onClick={() => {
                if (!customer) {
                  alert('Please log in to checkout');
                  return;
                }
                setShowCheckout(true);
              }}
              className="w-full py-3 px-4 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg transition"
            >
              {customer ? 'Checkout' : 'Login to Checkout'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default CustomerCart;

