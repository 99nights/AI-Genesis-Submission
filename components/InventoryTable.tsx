import React from 'react';
import { InventoryItem, InventoryBatch } from '../types';
import { formatDisplayDate } from '../utils/date';

export type InventoryEditPayload = {
  quantity?: number;
  expirationDate?: string;
  location?: string;
  costPerUnit?: number;
  sellPrice?: number;
};

interface InventoryTableProps {
  inventory: InventoryItem[];
  batches: InventoryBatch[];
  onEditRequest: (item: InventoryItem) => void;
  onDeleteRequest: (item: InventoryItem) => void;
}

const InventoryTable: React.FC<InventoryTableProps> = ({ inventory, batches, onEditRequest, onDeleteRequest }) => {
  if (inventory.length === 0) {
    return (
      <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 text-center text-gray-400">
        <h2 className="text-xl font-semibold mb-2 text-white">Current Inventory</h2>
        <p>Your inventory is empty. Add items using the form to see them here.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <h2 className="text-xl font-semibold text-white p-6">Current Inventory</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-800">
            <tr>
              <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-300 sm:pl-6">Product Name</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Manufacturer</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Exp. Date</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Quantity</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Supplier</th>
              <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Cost/Unit</th>
              <th scope="col" className="px-3 py-3.5 text-right text-sm font-semibold text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700 bg-gray-900/50">
            {inventory.map(item => (
              <tr key={item.id} className="hover:bg-gray-800 transition-colors">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">{item.productName}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">{item.manufacturer}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">{formatDisplayDate(item.expirationDate)}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">{item.quantity} {item.quantityType}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">{batches.find(b => b.id === item.batchId)?.supplier || 'N/A'}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">${item.costPerUnit.toFixed(2)}</td>
                <td className="whitespace-nowrap px-3 py-4 text-sm text-right text-gray-400">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => onEditRequest(item)}
                      disabled={!item.inventoryUuid}
                      className="px-3 py-1 rounded-md bg-gray-700 text-white text-xs hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDeleteRequest(item)}
                      disabled={!item.inventoryUuid}
                      className="px-3 py-1 rounded-md bg-red-700/70 text-white text-xs hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InventoryTable;
