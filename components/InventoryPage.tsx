import React, { useState, useMemo, useCallback, useRef } from 'react';
import { ProductSummary, NewInventoryItemData, StockItem } from '../types';
import { InventoryItem, InventoryBatch } from '../legacyTypes';
import InventoryGrid from './InventoryGrid';
import InventoryTable, { InventoryEditPayload } from './InventoryTable';
import AnalysisPanel from './AnalysisPanel';
import ProductDetailModal from './ProductDetailModal';
import InventoryForm from './InventoryForm';
import CameraCapture, { CameraScanResult, ScanProductOption } from './CameraCapture';
import { GridViewIcon } from './icons/GridViewIcon';
import { ListViewIcon } from './icons/ListViewIcon';
import { ScanLineIcon } from './icons/ScanLineIcon';
import { CameraIcon } from './icons/CameraIcon';
import { ExpirationIcon } from './icons/ExpirationIcon';
import { useToast } from './Toast';
import { searchInventoryByImage } from '../services/geminiService';
import { getActiveShopId, updateInventoryItem, removeInventoryItem } from '../services/vectorDBService';

interface InventoryPageProps {
  summaries: ProductSummary[];
  items: InventoryItem[];
  batches: InventoryBatch[];
  onAddBatch: (batch: Omit<InventoryBatch, 'id'>, items: NewInventoryItemData[]) => void;
  onDataRefresh: () => void;
}

type ViewMode = 'grid' | 'table';
type InventoryMode = 'overview' | 'manual';

const InventoryPage: React.FC<InventoryPageProps> = ({ 
  summaries, 
  items, 
  batches, 
  onAddBatch, 
  onDataRefresh 
}) => {
  const [selectedProduct, setSelectedProduct] = useState<ProductSummary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>('overview');
  const [isLiveScanning, setIsLiveScanning] = useState(false);
  const [visualSearchResults, setVisualSearchResults] = useState<StockItem[] | null>(null);
  const [isVisualSearching, setIsVisualSearching] = useState(false);
  const { showToast } = useToast();
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState<InventoryEditPayload>({});
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [inventoryModalError, setInventoryModalError] = useState<string | null>(null);
  const [isMutatingItem, setIsMutatingItem] = useState(false);
  const scanProductOptions = useMemo<ScanProductOption[]>(() => (
    summaries.map(summary => ({
      productId: summary.productId,
      productName: summary.productName,
    }))
  ), [summaries]);

  // Calculate expiring products (within 7 days)
  const expiringProducts = useMemo(() => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return summaries.filter(summary => {
      const earliestExp = new Date(summary.earliestExpiration);
      return earliestExp <= sevenDaysFromNow && earliestExp >= now;
    });
  }, [summaries]);

  // Calculate expired products
  const expiredProducts = useMemo(() => {
    const now = new Date();
    return summaries.filter(summary => {
      const earliestExp = new Date(summary.earliestExpiration);
      return earliestExp < now;
    });
  }, [summaries]);

  const handleProductLearned = useCallback(() => {
    onDataRefresh();
    showToast('New product successfully learned and added to catalog!', 'success');
  }, [onDataRefresh, showToast]);

  const [pendingScanResult, setPendingScanResult] = useState<CameraScanResult | null>(null);

  const handleLiveScanComplete = useCallback((result: CameraScanResult) => {
    setIsLiveScanning(false);
    // Store the scan result and switch to manual mode
    setPendingScanResult(result);
    setInventoryMode('manual');
    showToast('Scan complete! Please verify and edit the pre-populated data in the form below before adding to inventory.', 'success');
  }, [showToast]);

  const handleBatchAdded = useCallback(() => {
    setInventoryMode('overview');
    onDataRefresh();
    showToast('Inventory batch added successfully!', 'success');
  }, [onDataRefresh, showToast]);

  const [isVisualScanning, setIsVisualScanning] = useState(false);

  const handleVisualSearchComplete = useCallback(async (imageBlob: Blob) => {
    setIsVisualScanning(false);
    setIsVisualSearching(true);
    setVisualSearchResults(null);

    try {
      const shopId = getActiveShopId();
      if (!shopId) {
        showToast('No active shop context. Please ensure you are logged in.', 'error');
        setIsVisualSearching(false);
        return;
      }

      const results = await searchInventoryByImage(imageBlob, shopId);
      
      setVisualSearchResults(results);
      if (results.length > 0) {
        showToast(`Found ${results.length} matching items in inventory!`, 'success');
      } else {
        showToast('This item is not in the inventory.', 'info');
      }
    } catch (error) {
      showToast('Visual search failed: ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
    } finally {
      setIsVisualSearching(false);
    }
  }, [showToast]);

  const openInventoryEdit = useCallback((item: InventoryItem) => {
    if (!item.inventoryUuid) {
      showToast('This entry was imported without a Qdrant reference and cannot be edited.', 'error');
      return;
    }
    setInventoryModalError(null);
    setEditForm({
      quantity: item.quantity,
      expirationDate: item.expirationDate,
      location: item.location || '',
      costPerUnit: item.costPerUnit,
      sellPrice: item.sellPrice ?? undefined,
    });
    setEditingItem(item);
  }, [showToast]);

  const openInventoryDelete = useCallback((item: InventoryItem) => {
    if (!item.inventoryUuid) {
      showToast('This entry was imported without a Qdrant reference and cannot be deleted.', 'error');
      return;
    }
    setInventoryModalError(null);
    setDeleteTarget(item);
  }, [showToast]);

  const handleEditFormChange = useCallback((field: keyof InventoryEditPayload, value: string) => {
    if (field === 'quantity' || field === 'costPerUnit' || field === 'sellPrice') {
      setEditForm(prev => ({
        ...prev,
        [field]: value === '' ? undefined : Number(value),
      }));
      return;
    }
    setEditForm(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const submitInventoryEdit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingItem?.inventoryUuid) return;
    setIsMutatingItem(true);
    setInventoryModalError(null);
    try {
      await updateInventoryItem(editingItem.inventoryUuid, editForm);
      await Promise.resolve(onDataRefresh());
      showToast('Inventory item updated.', 'success');
      setEditingItem(null);
    } catch (error) {
      setInventoryModalError(error instanceof Error ? error.message : 'Failed to update inventory item.');
    } finally {
      setIsMutatingItem(false);
    }
  }, [editingItem, editForm, onDataRefresh, showToast]);

  const confirmInventoryDelete = useCallback(async () => {
    if (!deleteTarget?.inventoryUuid) return;
    setIsMutatingItem(true);
    setInventoryModalError(null);
    try {
      await removeInventoryItem(deleteTarget.inventoryUuid);
      await Promise.resolve(onDataRefresh());
      showToast('Inventory item deleted.', 'success');
      setDeleteTarget(null);
    } catch (error) {
      setInventoryModalError(error instanceof Error ? error.message : 'Failed to delete inventory item.');
    } finally {
      setIsMutatingItem(false);
    }
  }, [deleteTarget, onDataRefresh, showToast]);

  return (
    <>
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          allItems={items}
          allBatches={batches}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {isLiveScanning && (
        <CameraCapture
          onDataScanned={handleLiveScanComplete}
          onClose={() => setIsLiveScanning(false)}
          productOptions={scanProductOptions}
        />
      )}

      {isVisualScanning && (
        <CameraCapture
          onDataScanned={(result) => {
            // For visual search, we just need the image blob
            // Get the first available blob from the result
            const imageBlob = result.blobs.get('productName') || 
                            result.blobs.get('manufacturer') ||
                            Array.from(result.blobs.values())[0];
            if (imageBlob) {
              handleVisualSearchComplete(imageBlob);
            } else {
              showToast('No image captured. Please try again.', 'error');
              setIsVisualScanning(false);
            }
          }}
          onClose={() => setIsVisualScanning(false)}
          productOptions={scanProductOptions}
          mode="visual-search"
        />
      )}

      <div className="space-y-6">
        {/* Header with Mode Tabs */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-white">Inventory Management</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInventoryMode('overview')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                  inventoryMode === 'overview'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setInventoryMode('manual')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                  inventoryMode === 'manual'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Manual Entry
              </button>
            </div>
          </div>

          {/* Expiring Products Alert */}
          {(expiringProducts.length > 0 || expiredProducts.length > 0) && (
            <div className="mt-4 p-4 rounded-lg border-l-4 bg-yellow-900/20 border-yellow-500">
              <div className="flex items-center gap-2 mb-2">
                <ExpirationIcon className="w-5 h-5 text-yellow-400" />
                <h3 className="font-semibold text-yellow-300">
                  {expiredProducts.length > 0 && `${expiredProducts.length} Expired`}
                  {expiredProducts.length > 0 && expiringProducts.length > 0 && ' • '}
                  {expiringProducts.length > 0 && `${expiringProducts.length} Expiring Soon`}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {expiredProducts.slice(0, 5).map(product => (
                  <span
                    key={product.productId}
                    className="px-2 py-1 bg-red-900/50 text-red-300 rounded text-xs"
                  >
                    {product.productName} (Expired)
                  </span>
                ))}
                {expiringProducts.slice(0, 5).map(product => (
                  <span
                    key={product.productId}
                    className="px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded text-xs"
                  >
                    {product.productName} (Expires: {new Date(product.earliestExpiration).toLocaleDateString()})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Content based on mode */}
        {inventoryMode === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 shadow-lg">
                <h2 className="text-xl font-semibold mb-4 text-white">Quick Actions</h2>
                <div className="space-y-4">
                  <button
                    onClick={() => setIsLiveScanning(true)}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all"
                  >
                    <CameraIcon className="w-6 h-6" />
                    Live Scan Item
                  </button>
                  <p className="text-xs text-gray-400 text-center px-2">
                    Use your camera to automatically extract product data
                  </p>

                  <button
                    onClick={() => setIsVisualScanning(true)}
                    disabled={isVisualSearching}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CameraIcon className="w-6 h-6" />
                    {isVisualSearching ? 'Searching...' : 'Live Imagery Search'}
                  </button>
                  <p className="text-xs text-gray-400 text-center px-2">
                    Use your camera to search inventory by image
                  </p>
                  
                  <button
                    onClick={() => setInventoryMode('manual')}
                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-600 rounded-md shadow-sm text-base font-medium text-gray-200 bg-gray-700/50 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all"
                  >
                    <ScanLineIcon className="w-6 h-6" />
                    Manual Entry
                  </button>
                  <p className="text-xs text-gray-400 text-center px-2">
                    Enter inventory details manually or complete a scan
                  </p>
                </div>

                {/* Visual Search Results */}
                {visualSearchResults && visualSearchResults.length > 0 && (
                  <div className="mt-4 p-4 bg-purple-900/20 border border-purple-700 rounded-lg">
                    <h3 className="text-sm font-semibold text-purple-300 mb-2">
                      Visual Search Results ({visualSearchResults.length} found)
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {visualSearchResults.map((item, idx) => (
                        <div key={idx} className="text-xs p-2 bg-gray-900/50 rounded">
                          <p className="text-white font-medium">Product ID: {item.productId}</p>
                          <p className="text-gray-400">Qty: {item.quantity} | Exp: {item.expirationDate}</p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setVisualSearchResults(null)}
                      className="mt-2 text-xs text-purple-400 hover:text-purple-300"
                    >
                      Clear results
                    </button>
                  </div>
                )}
              </div>
              
              <AnalysisPanel items={items} batches={batches} />
            </div>

            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-white">Current Inventory</h2>
                <div className="flex items-center p-1 bg-gray-900/50 rounded-lg border border-gray-700">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-cyan-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    aria-label="Grid view"
                    title="Grid View"
                  >
                    <GridViewIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-md transition-colors ${
                      viewMode === 'table'
                        ? 'bg-cyan-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    aria-label="Table view"
                    title="Table View"
                  >
                    <ListViewIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {viewMode === 'grid' ? (
                <InventoryGrid
                  summaries={summaries}
                  inventoryItems={items}
                  onSelectProduct={setSelectedProduct}
                  onEditItem={openInventoryEdit}
                  onDeleteItem={openInventoryDelete}
                />
              ) : (
                <InventoryTable
                  inventory={items}
                  batches={batches}
                  onEditRequest={openInventoryEdit}
                  onDeleteRequest={openInventoryDelete}
                />
              )}
            </div>
          </div>
        )}

        {inventoryMode === 'manual' && (
          <InventoryForm
            onAddBatch={(batch, items) => {
              onAddBatch(batch, items);
              handleBatchAdded();
              setPendingScanResult(null); // Clear pending scan after batch is added
            }}
            summaries={summaries}
            pendingScanResult={pendingScanResult}
            onScanResultProcessed={() => setPendingScanResult(null)}
          />
        )}

        {editingItem && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-lg">
              <div className="flex justify-between items-center border-b border-gray-700 p-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Edit Inventory Item</h3>
                  <p className="text-sm text-gray-400">{editingItem.productName}</p>
                </div>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setInventoryModalError(null);
                  }}
                  className="text-gray-400 hover:text-white text-2xl leading-5"
                  aria-label="Close edit item modal"
                >
                  &times;
                </button>
              </div>
              <form onSubmit={submitInventoryEdit} className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="text-sm text-gray-300">
                    Quantity
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white"
                      value={editForm.quantity ?? ''}
                      onChange={(e) => handleEditFormChange('quantity', e.target.value)}
                    />
                  </label>
                  <label className="text-sm text-gray-300">
                    Expiration Date
                    <input
                      type="date"
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white"
                      value={editForm.expirationDate ?? ''}
                      onChange={(e) => handleEditFormChange('expirationDate', e.target.value)}
                    />
                  </label>
                  <label className="text-sm text-gray-300">
                    Cost / Unit
                    <input
                      type="number"
                      step="0.01"
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white"
                      value={editForm.costPerUnit ?? ''}
                      onChange={(e) => handleEditFormChange('costPerUnit', e.target.value)}
                    />
                  </label>
                  <label className="text-sm text-gray-300">
                    Sell Price
                    <input
                      type="number"
                      step="0.01"
                      className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white"
                      value={editForm.sellPrice ?? ''}
                      onChange={(e) => handleEditFormChange('sellPrice', e.target.value)}
                    />
                  </label>
                </div>
                <label className="text-sm text-gray-300 block">
                  Location
                  <input
                    type="text"
                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-md p-2 text-white"
                    value={editForm.location ?? ''}
                    onChange={(e) => handleEditFormChange('location', e.target.value)}
                  />
                </label>
                {inventoryModalError && (
                  <p className="text-sm text-red-400">{inventoryModalError}</p>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingItem(null);
                      setInventoryModalError(null);
                    }}
                    className="px-4 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isMutatingItem}
                    className="px-4 py-2 rounded-md bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-60"
                  >
                    {isMutatingItem ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Delete Inventory Item</h3>
              <p className="text-sm text-gray-300">
                Are you sure you want to remove <span className="text-white font-semibold">{deleteTarget.productName}</span> from inventory?
                This action cannot be undone.
              </p>
              {inventoryModalError && (
                <p className="text-sm text-red-400 mt-3">{inventoryModalError}</p>
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setDeleteTarget(null);
                    setInventoryModalError(null);
                  }}
                  className="px-4 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmInventoryDelete}
                  disabled={isMutatingItem}
                  className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-500 disabled:opacity-60"
                >
                  {isMutatingItem ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default InventoryPage;
