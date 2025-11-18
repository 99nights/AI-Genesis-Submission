
import React, { useMemo } from 'react';
import { ProductSummary, InventoryItem, InventoryBatch } from '../types';
import { formatDisplayDate } from '../utils/date';

interface ProductDetailModalProps {
  product: ProductSummary;
  allItems: InventoryItem[];
  allBatches: InventoryBatch[];
  onClose: () => void;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ product, allItems, allBatches, onClose }) => {
  const formatCurrency = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A';
    return `$${value.toFixed(2)}`;
  };
  
  // Find all items for the selected product, then enrich them with batch info
  const productItemsWithBatchInfo = allItems
    .filter(item => item.productName === product.productName)
    .map(item => {
      const batch = allBatches.find(b => b.id === item.batchId);
      return { ...item, batch };
    })
    .sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

  const totalInventoryValue = useMemo(() => {
    return productItemsWithBatchInfo.reduce((sum, item) => {
      const unitCost = typeof item.costPerUnit === 'number' ? item.costPerUnit : 0;
      return sum + unitCost * item.quantity;
    }, 0);
  }, [productItemsWithBatchInfo]);

  const averageCost = product.totalQuantity > 0 ? totalInventoryValue / product.totalQuantity : 0;

  const batchCostSummary = useMemo(() => {
    const map = new Map<string, {
      batchId: string;
      supplier: string;
      inventoryDate?: string;
      quantity: number;
      totalValue: number;
    }>();

    productItemsWithBatchInfo.forEach(item => {
      const rawId = item.batch?.id ?? item.batchId ?? `line-${item.id}`;
      const key = String(rawId);
      const supplier = item.batch?.supplier ?? 'N/A';
      const inventoryDate = item.batch?.inventoryDate;
      const unitCost = typeof item.costPerUnit === 'number' ? item.costPerUnit : 0;
      const existing = map.get(key) ?? {
        batchId: key,
        supplier,
        inventoryDate,
        quantity: 0,
        totalValue: 0,
      };

      existing.quantity += item.quantity;
      existing.totalValue += unitCost * item.quantity;
      existing.supplier = supplier;
      existing.inventoryDate = inventoryDate;
      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => a.batchId.localeCompare(b.batchId));
  }, [productItemsWithBatchInfo]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-700">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-white">{product.productName}</h2>
              <p className="text-sm text-gray-400">{product.manufacturer}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mt-4 flex space-x-8 text-sm">
            <div>
              <p className="text-gray-400">Total Quantity</p>
              <p className="text-white font-semibold text-lg">{product.totalQuantity} {product.quantityType}</p>
            </div>
             <div>
              <p className="text-gray-400">Earliest Expiration</p>
              <p className="text-yellow-400 font-semibold text-lg">{formatDisplayDate(product.earliestExpiration)}</p>
            </div>
            <div>
              <p className="text-gray-400">Average Unit Cost</p>
              <p className="text-cyan-400 font-semibold text-lg">{formatCurrency(averageCost)}</p>
            </div>
            <div>
              <p className="text-gray-400">Inventory Value</p>
              <p className="text-green-400 font-semibold text-lg">{formatCurrency(totalInventoryValue)}</p>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto">
          <h3 className="text-lg font-semibold text-cyan-400 mb-3">Batch Details (First-Expired, First-Out)</h3>
           <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-800">
                <tr>
                    <th scope="col" className="py-3 pl-4 pr-3 text-left text-sm font-semibold text-gray-300 sm:pl-0">Quantity</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Exp. Date</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Supplier</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Inventory Date</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Cost / Unit</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Buy Price</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Sell Price</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Line Value</th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-300">Batch</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {productItemsWithBatchInfo.map((item) => (
                      <tr key={item.id}>
                          <td className="py-3 pl-4 pr-3 text-sm text-white sm:pl-0">
                            {item.quantity} {item.quantityType}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            {formatDisplayDate(item.expirationDate)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-400">
                            {item.batch?.supplier ?? 'N/A'}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-400">
                            {formatDisplayDate(item.batch?.inventoryDate)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            {formatCurrency(item.costPerUnit)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            {formatCurrency(item.buyPrice)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            {typeof item.sellPrice === 'number' ? formatCurrency(item.sellPrice) : '—'}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-300">
                            {formatCurrency((item.costPerUnit || 0) * item.quantity)}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-500">
                            {item.batch?.id ?? String(item.batchId)}
                          </td>
                      </tr>
                  ))}
                </tbody>
            </table>
        </div>

          {batchCostSummary.length > 0 && (
            <div className="mt-6">
              <h4 className="text-md font-semibold text-gray-200 mb-3">Cost Overview by Batch</h4>
              <div className="space-y-3">
                {batchCostSummary.map(batch => (
                  <div key={batch.batchId} className="p-4 bg-gray-900/40 border border-gray-700 rounded-lg flex flex-wrap gap-4 text-sm">
                    <div>
                      <p className="text-gray-400">Batch</p>
                      <p className="text-white font-semibold">{batch.batchId}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Supplier</p>
                      <p className="text-white">{batch.supplier}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Inventory Date</p>
                      <p className="text-white">{formatDisplayDate(batch.inventoryDate)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Quantity</p>
                      <p className="text-white">{batch.quantity} {product.quantityType}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Batch Value</p>
                      <p className="text-green-400 font-semibold">{formatCurrency(batch.totalValue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

         <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-cyan-800/50">
            <h4 className="font-semibold text-cyan-500">POS Integration Note</h4>
            <p className="text-xs text-gray-400 mt-1">
              The list above is sorted by expiration date. For a "First-Expired, First-Out" (FEFO) strategy, a Point-of-Sale system would automatically deduct sold items from the top of this list, ensuring optimal stock rotation and minimizing waste.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;
