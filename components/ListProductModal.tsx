
import React, { useState } from 'react';
import { ProductSummary } from '../types';

interface ListProductModalProps {
  summaries: ProductSummary[];
  onClose: () => void;
  onListProduct: (productName: string, quantity: number, price: number) => void;
}

const ListProductModal: React.FC<ListProductModalProps> = ({ summaries, onClose, onListProduct }) => {
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [error, setError] = useState('');

  const selectedSummary = summaries.find(s => s.productName === selectedProduct);
  const maxQuantity = selectedSummary?.totalQuantity || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedProduct || quantity <= 0 || price <= 0) {
      setError('Please fill all fields with valid values.');
      return;
    }
    if (quantity > maxQuantity) {
        setError(`Quantity cannot exceed available stock of ${maxQuantity}.`);
        return;
    }
    onListProduct(selectedProduct, quantity, price);
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">List Product on Marketplace</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
                <label htmlFor="product" className="block text-sm font-medium text-gray-300">Product</label>
                <select 
                    id="product" 
                    value={selectedProduct} 
                    onChange={e => setSelectedProduct(e.target.value)}
                    className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm"
                >
                    <option value="">Select a product...</option>
                    {summaries.map(s => (
                        <option key={s.productName} value={s.productName}>{s.productName} (In Stock: {s.totalQuantity})</option>
                    ))}
                </select>
            </div>
            
            <div>
                <label htmlFor="quantity" className="block text-sm font-medium text-gray-300">Quantity to List</label>
                 <input
                    type="number"
                    id="quantity"
                    value={quantity}
                    onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    min="1"
                    max={maxQuantity}
                    className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm"
                />
            </div>
            
            <div>
                <label htmlFor="price" className="block text-sm font-medium text-gray-300">Price per Unit ($)</label>
                 <input
                    type="number"
                    id="price"
                    value={price}
                    onChange={e => setPrice(parseFloat(e.target.value) || 0)}
                    min="0.01"
                    step="0.01"
                    className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm"
                />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            
            <div className="flex justify-end gap-4 pt-4">
                <button type="button" onClick={onClose} className="py-2 px-4 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-300 bg-gray-700/50 hover:bg-gray-700">Cancel</button>
                <button type="submit" className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700">List Product</button>
            </div>
        </form>
      </div>
    </div>
  );
};

export default ListProductModal;
