import React, { useState, useEffect, useMemo } from 'react';
import { ProductSummary } from '../types';
import { fetchSuppliersForActiveShop } from '../services/vectorDBService';
import { SupplierProfile } from '../types';
import { formatDisplayDate } from '../utils/date';
import { InventoryItem } from '../legacyTypes';

interface InventoryGridProps {
  summaries: ProductSummary[];
  inventoryItems: InventoryItem[];
  onSelectProduct: (product: ProductSummary) => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (item: InventoryItem) => void;
}

const getInitials = (name: string) => {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const EXPIRY_THRESHOLD_DAYS = 7;
const LOW_STOCK_THRESHOLD = 10;

const InventoryGrid: React.FC<InventoryGridProps> = ({ summaries, inventoryItems, onSelectProduct, onEditItem, onDeleteItem }) => {
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'expiringSoon' | 'lowStock'>('all');
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const supplierList = await fetchSuppliersForActiveShop();
        setSuppliers(supplierList);
      } catch (err) {
        console.error('Failed to load suppliers:', err);
      }
    };
    loadSuppliers();
  }, []);

  const supplierFilteredSummaries = useMemo(() => {
    if (!selectedSupplierId) return summaries;
    return summaries.filter(summary => 
      summary.supplierIds && summary.supplierIds.includes(selectedSupplierId)
    );
  }, [summaries, selectedSupplierId]);

  const filteredSummaries = useMemo(() => {
    if (inventoryFilter === 'all') return supplierFilteredSummaries;

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    return supplierFilteredSummaries.filter(summary => {
      if (inventoryFilter === 'expiringSoon') {
        const expiration = new Date(summary.earliestExpiration);
        if (Number.isNaN(expiration.getTime())) return false;
        const diffDays = Math.ceil((expiration.getTime() - now.getTime()) / msPerDay);
        return diffDays >= 0 && diffDays <= EXPIRY_THRESHOLD_DAYS;
      }
      if (inventoryFilter === 'lowStock') {
        return summary.totalQuantity <= LOW_STOCK_THRESHOLD;
      }
      return true;
    });
  }, [supplierFilteredSummaries, inventoryFilter]);

  if (!summaries.length) {
    return (
      <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 text-center text-gray-400">
        <p className="mb-4">Your inventory is empty. Products need inventory items (stock) to appear here.</p>
        <div className="mt-4 p-4 bg-gray-900/50 rounded-lg text-left text-sm">
          <p className="text-yellow-400 font-semibold mb-2">💡 How to add inventory:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-300">
            <li>Use the form on the left to add inventory items for existing products</li>
            <li>Or use the "Batches" tab to log a delivery batch with multiple items</li>
            <li>Products from Product Catalog need inventory items added to show up here</li>
          </ol>
        </div>
      </div>
    );
  }

  const noMatches = summaries.length > 0 && !filteredSummaries.length;

  if (noMatches) {
    return (
      <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 text-center text-gray-400">
        <p className="mb-2">No products match the current filters.</p>
        <p className="text-sm text-gray-400">Try clearing the supplier or inventory filter above to see the full inventory list.</p>
      </div>
    );
  }

  const getSupplierNames = (supplierIds?: string[]): string[] => {
    if (!supplierIds || supplierIds.length === 0) return [];
    return supplierIds
      .map(id => suppliers.find(s => s.id === id)?.name)
      .filter((name): name is string => !!name);
  };

  const itemsByProduct = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    inventoryItems.forEach(item => {
      const list = map.get(item.productId) || [];
      list.push(item);
      map.set(item.productId, list);
    });
    return map;
  }, [inventoryItems]);

  const toggleExpanded = (productId: string) => {
    setExpandedProducts(prev => ({
      ...prev,
      [productId]: !prev[productId],
    }));
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <div className="flex flex-col gap-3 text-sm text-gray-300 md:flex-row md:items-center">
          {suppliers.length > 0 && (
            <div className="flex items-center gap-2">
              <label>Supplier:</label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="px-3 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">All Suppliers</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label>Inventory filter:</label>
            <select
              value={inventoryFilter}
              onChange={(e) => setInventoryFilter(e.target.value as typeof inventoryFilter)}
              className="px-3 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="all">All items</option>
              <option value="expiringSoon">Expiring in ≤ {EXPIRY_THRESHOLD_DAYS} days</option>
              <option value="lowStock">Low stock (≤ {LOW_STOCK_THRESHOLD})</option>
            </select>
          </div>
        </div>
      </div>
      {selectedSupplierId && (
        <p className="text-sm text-gray-400 mb-4">
          Showing {filteredSummaries.length} product(s) from {suppliers.find(s => s.id === selectedSupplierId)?.name || 'selected supplier'}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredSummaries.map(summary => {
          const supplierNames = getSupplierNames(summary.supplierIds);
          const productItems = itemsByProduct.get(summary.productId) || [];
          const isExpanded = expandedProducts[summary.productId];
          return (
          <div
            key={summary.productId}
            onClick={() => onSelectProduct(summary)}
            className="bg-gray-800/60 border border-gray-700 rounded-xl overflow-hidden text-left hover:border-cyan-500 transition cursor-pointer"
          >
            <div className="h-32 bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-3xl font-bold text-gray-300">
              {getInitials(summary.productName)}
            </div>
            <div className="p-4 space-y-2">
              <div>
                <p className="text-lg font-semibold text-white">{summary.productName}</p>
                <p className="text-sm text-gray-400">{summary.manufacturer}</p>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-300">
                <span className="font-medium text-white">{summary.totalQuantity} {summary.quantityType}</span>
                <span className="text-xs uppercase tracking-wide text-gray-400">Exp: {formatDisplayDate(summary.earliestExpiration)}</span>
              </div>
              {supplierNames.length > 0 && (
                <div className="pt-1 border-t border-gray-700">
                  <p className="text-xs text-gray-500 mb-1">Suppliers:</p>
                  <div className="flex flex-wrap gap-1">
                    {supplierNames.map((name, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 text-xs bg-cyan-900/30 text-cyan-300 rounded border border-cyan-700/50"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-500">Location: Not set</p>
              {productItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                    <span>{productItems.length} inventory item{productItems.length > 1 ? 's' : ''}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(summary.productId);
                      }}
                      className="text-cyan-300 hover:text-cyan-200"
                    >
                      {isExpanded ? 'Hide items' : 'Manage items'}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="space-y-2">
                      {productItems.map(item => (
                        <div
                          key={item.inventoryUuid || item.id}
                          className="p-2 bg-gray-900/60 rounded text-xs text-gray-300 border border-gray-800 flex flex-col gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex justify-between">
                            <span>Qty: {item.quantity} {item.quantityType}</span>
                            <span>Exp: {formatDisplayDate(item.expirationDate)}</span>
                          </div>
                          <div className="flex justify-between text-gray-400">
                            <span>{item.location ? `Loc: ${item.location}` : 'Location N/A'}</span>
                            <span>${item.costPerUnit.toFixed(2)}/unit</span>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditItem(item);
                              }}
                              disabled={!item.inventoryUuid}
                              className="px-2 py-1 rounded bg-gray-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteItem(item);
                              }}
                              disabled={!item.inventoryUuid}
                              className="px-2 py-1 rounded bg-red-700/80 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
};

export default InventoryGrid;
