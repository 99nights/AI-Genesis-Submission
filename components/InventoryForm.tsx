import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ProductSummary, NewInventoryItemData, ProductDefinition, SupplierProfile, DanShareScope } from '../types';
import { InventoryBatch } from '../legacyTypes'; // For batch data shape
import { analyzeImageForInventory, ScannedItemData } from '../services/geminiService';
import { addImageForField, fetchCanonicalProducts, fetchSuppliersForActiveShop, registerLocalSupplier } from '../services/vectorDBService';
import { UploadIcon } from './icons/UploadIcon';
import { SparkleIcon } from './icons/SparkleIcon';
import { CameraIcon } from './icons/CameraIcon';
import CameraCapture, { CameraScanResult, ScanProductOption } from './CameraCapture';
import { ENABLE_DAN_EXPERIMENT } from '../config';

interface InventoryFormProps {
  onAddBatch: (batch: Omit<InventoryBatch, 'id'>, items: NewInventoryItemData[]) => void;
  summaries: ProductSummary[];
  pendingScanResult?: CameraScanResult | null;
}

const initialBatchState: Omit<InventoryBatch, 'id'> = {
  supplier: '',
  deliveryDate: '',
  inventoryDate: new Date().toISOString().split('T')[0],
};

const initialItemState: NewInventoryItemData = {
  productName: '',
  manufacturer: '',
  category: '',
  productDescription: '',
  productId: undefined,
  supplierId: undefined,
  expirationDate: '',
  quantity: 0,
  quantityType: 'units',
  costPerUnit: 0,
  location: '',
  buyPrice: 0,
  sellPrice: undefined,
  images: [],
  scanMetadata: null,
  shareScope: ['local'],
};

const InventoryForm: React.FC<InventoryFormProps> = ({ onAddBatch, summaries, pendingScanResult }) => {
  const [batchData, setBatchData] = useState<Omit<InventoryBatch, 'id'>>(initialBatchState);
  const [currentItem, setCurrentItem] = useState(initialItemState);
  const [stagedItems, setStagedItems] = useState<NewInventoryItemData[]>([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scannedFieldBlobs, setScannedFieldBlobs] = useState<Map<keyof ScannedItemData | 'productId', Blob>>(new Map());
  const [fieldImagePreviews, setFieldImagePreviews] = useState<Map<keyof ScannedItemData | 'productId', string>>(new Map());
  const [canonicalProducts, setCanonicalProducts] = useState<ProductDefinition[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<SupplierProfile[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [productMode, setProductMode] = useState<'existing' | 'new'>('existing');
  const [supplierMode, setSupplierMode] = useState<'existing' | 'new'>('existing');
  const [newSupplierForm, setNewSupplierForm] = useState({ name: '', email: '' });
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);
  const [pendingScanContext, setPendingScanContext] = useState<CameraScanResult | null>(null);
  const [needsProductRegistration, setNeedsProductRegistration] = useState(false);
  const processedScanResultRef = useRef<CameraScanResult | null>(null);
  const isProcessingScanRef = useRef(false);

  const productOptions = useMemo<ScanProductOption[]>(() => {
    const map = new Map<string, ScanProductOption>();
    canonicalProducts.forEach(product => {
      map.set(product.name, { productId: product.id, productName: product.name });
    });
    summaries.forEach(summary => {
      if (!map.has(summary.productName)) {
        map.set(summary.productName, { productId: summary.productId, productName: summary.productName });
      }
    });
    return Array.from(map.values());
  }, [canonicalProducts, summaries]);

  const normalizeShareScope = useCallback((scopes?: DanShareScope[]) => {
    const set = new Set<DanShareScope>(['local']);
    (scopes || []).forEach(scope => scope && set.add(scope));
    return Array.from(set);
  }, []);

const slugifyProductName = useCallback((value?: string) => {
  if (!value) return 'unlabeled-product';
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gi, '-');
}, []);

  const updateShareScope = useCallback((scope: DanShareScope, enabled: boolean) => {
    setCurrentItem(prev => {
      const next = new Set<DanShareScope>(normalizeShareScope(prev.shareScope));
      if (enabled) next.add(scope);
      else next.delete(scope);
      if (!next.size) next.add('local');
      return { ...prev, shareScope: Array.from(next) };
    });
  }, [normalizeShareScope]);

useEffect(() => {
  // Cleanup object URLs on component unmount to prevent memory leaks
  return () => {
      fieldImagePreviews.forEach(url => URL.revokeObjectURL(url));
  };
}, [fieldImagePreviews]);

useEffect(() => {
  if (productMode === 'new') {
    setSelectedProductId('');
    setCurrentItem(prev => ({ ...prev, productId: undefined }));
  }
}, [productMode]);

useEffect(() => {
  if (supplierMode === 'new') {
    setSelectedSupplierId('');
    setCurrentItem(prev => ({ ...prev, supplierId: undefined }));
  }
}, [supplierMode]);

const refreshReferences = useCallback(async () => {
  try {
    const [products, suppliers] = await Promise.all([
      fetchCanonicalProducts(),
      fetchSuppliersForActiveShop(),
    ]);
    setCanonicalProducts(products);
    setSupplierOptions(suppliers);
  } catch (err) {
    console.error('Failed to load reference data', err);
  }
}, []);

useEffect(() => {
  refreshReferences();
}, [refreshReferences]);

  const processImageFile = useCallback(async (file: File | Blob) => {
    setImagePreview(URL.createObjectURL(file));
    setIsProcessing(true);
    setError(null);

    try {
      const extractedData = await analyzeImageForInventory(file);
      
      setBatchData(prev => ({
        ...prev,
        supplier: prev.supplier || extractedData.supplier || '',
        deliveryDate: prev.deliveryDate || extractedData.deliveryDate || '',
      }));
      
      setCurrentItem(prev => ({
        ...prev,
        productName: extractedData.productName || '',
        manufacturer: extractedData.manufacturer || '',
        category: extractedData.category || '',
        expirationDate: extractedData.expirationDate || '',
        quantity: extractedData.quantity || 0,
        quantityType: extractedData.quantityType || 'units',
        costPerUnit: extractedData.costPerUnit || 0,
      }));

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  }, [processImageFile]);

  const handleDataScanned = useCallback((result: CameraScanResult) => {
    const { data: scannedData, blobs, identifiedProductId } = result;
    setIsScanning(false);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPendingScanContext(result);

    fieldImagePreviews.forEach(url => URL.revokeObjectURL(url));
    const newPreviews = new Map<keyof ScannedItemData | 'productId', string>();
    blobs.forEach((blob, field) => newPreviews.set(field, URL.createObjectURL(blob)));
    setFieldImagePreviews(newPreviews);
    setScannedFieldBlobs(blobs);

    setBatchData(prev => ({
        ...prev,
        supplier: prev.supplier || scannedData.supplier || '',
        deliveryDate: prev.deliveryDate || scannedData.deliveryDate || '',
    }));

    if (identifiedProductId) {
        const product = canonicalProducts.find(p => p.id === identifiedProductId);
        if (product) {
            setNeedsProductRegistration(false);
            setProductMode('existing');
            setSelectedProductId(product.id);
            setCurrentItem(prev => ({
                ...prev,
                productId: product.id,
                productName: product.name,
                manufacturer: product.manufacturer,
                category: product.category,
                productDescription: product.description || '',
                expirationDate: scannedData.expirationDate || prev.expirationDate || '',
                quantity: scannedData.quantity || prev.quantity || 1,
                quantityType: scannedData.quantityType || prev.quantityType || 'units',
                costPerUnit: scannedData.costPerUnit || prev.costPerUnit || 0,
            }));
            return;
        }
    }

    setProductMode('new');
    setNeedsProductRegistration(true);
    setCurrentItem(prev => ({
        ...prev,
        productName: scannedData.productName || prev.productName || '',
        manufacturer: scannedData.manufacturer || prev.manufacturer || '',
        category: scannedData.category || prev.category || '',
        expirationDate: scannedData.expirationDate || prev.expirationDate || '',
        quantity: scannedData.quantity || prev.quantity || 0,
        quantityType: scannedData.quantityType || prev.quantityType || 'units',
        costPerUnit: scannedData.costPerUnit || prev.costPerUnit || 0,
    }));
  }, [fieldImagePreviews, canonicalProducts]);

// Process pending scan result from overview mode - prepopulate form for user verification
useEffect(() => {
  // Only process if we have a new pendingScanResult that we haven't processed yet
  // and we're not already processing one
  if (pendingScanResult && pendingScanResult !== processedScanResultRef.current && !isProcessingScanRef.current) {
    // Mark as processing to prevent concurrent processing
    isProcessingScanRef.current = true;
    // Mark this scan result as processed to avoid reprocessing
    processedScanResultRef.current = pendingScanResult;
    
    // Use a stable reference to handleDataScanned to avoid dependency issues
    // We'll call it directly without including it in dependencies
    const processScan = () => {
      handleDataScanned(pendingScanResult);
    };
    
    // Process the scan
    processScan();
    
    // Reset processing flag after a short delay to allow state updates to complete
    setTimeout(() => {
      isProcessingScanRef.current = false;
    }, 100);
    
    // Note: The scan context will be kept available for when user clicks "Add Item to Batch"
    // The scan context will be cleared when the item is added or form is reset
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pendingScanResult]); // Only depend on pendingScanResult, not handleDataScanned


  const handleBatchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBatchData(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const isNumber = type === 'number';
    setCurrentItem(prev => ({
      ...prev,
      [name]: isNumber ? parseFloat(value) || 0 : value,
    }));
  };

  const handleSupplierSelect = (value: string) => {
    setSelectedSupplierId(value);
    setCurrentItem(prev => ({ ...prev, supplierId: value || undefined }));
    const supplierName = supplierOptions.find(s => s.id === value)?.name;
    if (supplierName) {
      setBatchData(prev => ({ ...prev, supplier: supplierName }));
    }
  };

  const handleNewSupplierInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewSupplierForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierForm.name.trim()) {
      setError('Supplier name is required.');
      return;
    }

    setIsCreatingSupplier(true);
    setError(null);
    try {
      const created = await registerLocalSupplier({
        name: newSupplierForm.name.trim(),
        contactEmail: newSupplierForm.email.trim() || undefined,
      });
      await refreshReferences();
      setSupplierMode('existing');
      setSelectedSupplierId(created.id);
      setCurrentItem(prev => ({ ...prev, supplierId: created.id }));
      setBatchData(prev => ({ ...prev, supplier: created.name || created.id }));
      setNewSupplierForm({ name: '', email: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supplier.');
    } finally {
      setIsCreatingSupplier(false);
    }
  };
  
  const handleAddItemToStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentItem.productName && currentItem.quantity > 0) {
      let fieldCaptures: { field: string; captureId: string; source: string; confidence?: number }[] = [];
      if (scannedFieldBlobs.size > 0 && currentItem.productName) {
        setIsProcessing(true);
        setError(null);
        try {
          const captureResults = await Promise.all(
            Array.from(scannedFieldBlobs.entries()).map(async ([field, blob]) => {
              const captureId = await addImageForField(
                currentItem.productName,
                field as keyof ScannedItemData | 'productId',
                blob,
                {
                  productId: selectedProductId || currentItem.productId || slugifyProductName(currentItem.productName),
                  source: pendingScanContext?.fieldSources.get(field) || 'manual',
                }
              );
              return {
                field: String(field),
                captureId,
                source: pendingScanContext?.fieldSources.get(field) || 'manual',
                confidence: pendingScanContext?.fieldConfidences.get(field),
              };
            })
          );
          const capturedAt = new Date().toISOString();
          fieldCaptures = captureResults.map(entry => ({
            ...entry,
            capturedAt,
          }));
        } catch (err) {
          console.error(err);
          setError("Could not save scan images.");
        } finally {
          setIsProcessing(false);
        }
      }

      const confidenceValues = pendingScanContext
        ? Array.from(pendingScanContext.fieldConfidences.values()).filter((value): value is number => typeof value === 'number')
        : [];
      const aggregateConfidence =
        confidenceValues.length > 0
          ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
          : undefined;

      const scanMetadata = fieldCaptures.length
        ? {
            confidence: aggregateConfidence,
            fieldCaptures,
          }
        : aggregateConfidence !== undefined
          ? { confidence: aggregateConfidence }
          : null;

      setStagedItems(prev => [...prev, {
        ...currentItem,
        productId: selectedProductId || currentItem.productId,
        supplierId: selectedSupplierId || currentItem.supplierId,
        shareScope: normalizeShareScope(currentItem.shareScope),
        scanMetadata,
      }]);
      setCurrentItem(initialItemState);
      setSelectedProductId('');
      setSelectedSupplierId('');
      setImagePreview(null);
      setPendingScanContext(null);
      setNeedsProductRegistration(false);
      if (fileInputRef.current) fileInputRef.current.value = '';

      setScannedFieldBlobs(new Map());
      fieldImagePreviews.forEach(url => URL.revokeObjectURL(url));
      setFieldImagePreviews(new Map());
      
      // Clear the processed scan result ref so a new scan can be processed
      processedScanResultRef.current = null;
      isProcessingScanRef.current = false;
    }
  };

  const handleFinishBatch = () => {
    if (stagedItems.length > 0 && batchData.supplier && batchData.deliveryDate) {
      onAddBatch(batchData, stagedItems);
      setBatchData(initialBatchState);
      setStagedItems([]);
    } else {
      setError("Please add at least one item and fill in all batch details (Supplier, Delivery Date).")
    }
  };

  return (
    <>
      {isScanning && (
        <CameraCapture 
          onDataScanned={handleDataScanned}
          onClose={() => setIsScanning(false)}
          productOptions={productOptions}
        />
      )}
      <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-sm p-8 rounded-xl border border-gray-700/50 shadow-2xl">
        <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <SparkleIcon className="w-6 h-6 text-cyan-400" />
          </div>
          Add New Inventory Batch
        </h2>

        <div className="space-y-6 p-6 bg-gray-900/40 border border-gray-700/50 rounded-xl mb-6 backdrop-blur-sm shadow-inner">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <span className="text-cyan-400 font-bold text-sm">1</span>
              </div>
              <h3 className="font-bold text-xl text-gray-100">Batch Details</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="space-y-4 p-4 bg-gray-800/30 rounded-lg border border-gray-700/30">
                <div>
                  <p className="text-sm font-semibold text-gray-200 mb-3">Product Selection</p>
                  <div className="flex gap-2 mb-4">
                    {(['existing', 'new'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setProductMode(mode)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                          productMode === mode 
                            ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30' 
                            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        {mode === 'existing' ? 'Existing Product' : 'New Product'}
                      </button>
                    ))}
                  </div>
                </div>
                {needsProductRegistration && productMode === 'new' && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-100">
                    New product detected. Review the static fields below so we can register it in the catalog when this batch is saved.
                  </div>
                )}
                {productMode === 'existing' ? (
                  <div>
                    <select
                      className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                      value={selectedProductId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSelectedProductId(value);
                        if (!value) {
                          setCurrentItem(prev => ({ ...prev, productId: undefined, productName: '', manufacturer: '', category: '', productDescription: '' }));
                          return;
                        }
                        const product = canonicalProducts.find(p => p.id === value);
                        if (product) {
                          setCurrentItem(prev => ({
                            ...prev,
                            productId: product.id,
                            productName: product.name,
                            manufacturer: product.manufacturer,
                            category: product.category,
                            productDescription: product.description || '',
                          }));
                        }
                      }}
                    >
                      <option value="">Select from catalog</option>
                      {canonicalProducts.map(product => (
                        <option key={product.id} value={product.id}>
                          {product.name} — {product.manufacturer}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <p className="text-sm text-blue-300">
                      Manual entry enabled. Fill in the product fields below to register a new product as you scan it.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4 p-4 bg-gray-800/30 rounded-lg border border-gray-700/30">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-gray-200">Supplier Management</p>
                </div>
                <div className="flex gap-2 mb-4">
                  {(['existing', 'new'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSupplierMode(mode)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                        supplierMode === mode 
                          ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30' 
                          : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`}
                    >
                      {mode === 'existing' ? 'Choose Supplier' : 'Create Supplier'}
                    </button>
                  ))}
                </div>
                {supplierMode === 'existing' ? (
                  <select
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                    value={selectedSupplierId}
                    onChange={(e) => handleSupplierSelect(e.target.value)}
                  >
                    <option value="">Select Supplier</option>
                    {supplierOptions.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <form onSubmit={handleCreateSupplier} className="space-y-3">
                    <input
                      name="name"
                      value={newSupplierForm.name}
                      onChange={handleNewSupplierInput}
                      className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                      placeholder="Supplier name"
                    />
                    <input
                      type="email"
                      name="email"
                      value={newSupplierForm.email}
                      onChange={handleNewSupplierInput}
                      className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                      placeholder="Contact email (optional)"
                    />
                    <button
                      type="submit"
                      disabled={isCreatingSupplier}
                      className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 text-white text-sm font-semibold disabled:opacity-60 hover:from-cyan-500 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
                    >
                      {isCreatingSupplier ? 'Creating...' : 'Create & Use Supplier'}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-700/50">
              {Object.keys(initialBatchState).map((key) => (
                <div key={key}>
                  <label htmlFor={`batch-${key}`} className="block text-sm font-medium text-gray-300 mb-2 capitalize">
                    {key.replace(/([A-Z])/g, ' $1')}
                  </label>
                  <input
                    type={key.includes('Date') ? 'date' : 'text'}
                    name={key}
                    id={`batch-${key}`}
                    value={batchData[key as keyof typeof batchData]}
                    onChange={handleBatchChange}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all shadow-sm"
                  />
                </div>
              ))}
            </div>
        </div>

        <div className="space-y-6 p-6 bg-gray-900/40 border border-gray-700/50 rounded-xl backdrop-blur-sm shadow-inner">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <span className="text-cyan-400 font-bold text-sm">2</span>
              </div>
              <h3 className="font-bold text-xl text-gray-100">Add Items to Batch</h3>
            </div>
            
            <div className="space-y-3">
              <div 
                className="flex justify-center px-6 pt-6 pb-6 border-2 border-gray-600/50 border-dashed rounded-xl cursor-pointer hover:border-cyan-400/50 hover:bg-cyan-500/5 transition-all duration-200 group"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="space-y-2 text-center">
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="mx-auto h-32 w-auto rounded-lg object-cover shadow-lg" />
                  ) : (
                    <div className="mx-auto p-4 bg-gray-800/50 rounded-full group-hover:bg-cyan-500/10 transition-all">
                      <UploadIcon className="h-10 w-10 text-gray-400 group-hover:text-cyan-400 transition-colors" />
                    </div>
                  )}
                  <p className="text-sm text-gray-400 group-hover:text-cyan-300 transition-colors">
                    {isProcessing ? "Analyzing..." : "Click to upload image"}
                  </p>
                </div>
              </div>
              <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} ref={fileInputRef} accept="image/*" />
              <button 
                type="button" 
                onClick={() => setIsScanning(true)} 
                className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-gray-600/50 rounded-lg text-sm font-semibold text-gray-200 bg-gray-700/30 hover:bg-gray-700/50 hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all shadow-sm"
              >
                <CameraIcon className="w-5 h-5" /> 
                Live Scan Item
              </button>
            </div>

            {isProcessing && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-7 w-7 border-2 border-cyan-400 border-t-transparent"></div>
                <p className="ml-3 text-cyan-400 font-medium">Extracting data...</p>
              </div>
            )}
            {error && (
              <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
            
            <form onSubmit={handleAddItemToStage} className="space-y-5 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Product Name</label>
                  <input 
                    name="productName" 
                    value={currentItem.productName} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white disabled:bg-gray-800/50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    disabled={!!selectedProductId} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Manufacturer</label>
                  <input 
                    name="manufacturer" 
                    value={currentItem.manufacturer} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white disabled:bg-gray-800/50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    disabled={!!selectedProductId} 
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Category</label>
                  <input 
                    name="category" 
                    value={currentItem.category} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white disabled:bg-gray-800/50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    disabled={!!selectedProductId} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Expiration Date</label>
                  <input 
                    type="date" 
                    name="expirationDate" 
                    value={currentItem.expirationDate} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Product Description</label>
                <textarea 
                  name="productDescription" 
                  value={currentItem.productDescription} 
                  onChange={handleItemChange} 
                  rows={3} 
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white disabled:bg-gray-800/50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all resize-none" 
                  disabled={!!selectedProductId} 
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Quantity</label>
                  <input 
                    type="number" 
                    name="quantity" 
                    value={currentItem.quantity} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Quantity Type</label>
                  <input 
                    name="quantityType" 
                    value={currentItem.quantityType} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Location</label>
                  <input 
                    name="location" 
                    value={currentItem.location} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Cost Per Unit</label>
                  <input 
                    type="number" 
                    name="costPerUnit" 
                    value={currentItem.costPerUnit} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    step="0.01" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Buy Price</label>
                  <input 
                    type="number" 
                    name="buyPrice" 
                    value={currentItem.buyPrice ?? ''} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    step="0.01" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Sell Price</label>
                  <input 
                    type="number" 
                    name="sellPrice" 
                    value={currentItem.sellPrice ?? ''} 
                    onChange={handleItemChange} 
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-900/80 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all" 
                    step="0.01" 
                  />
                </div>
              </div>
              {ENABLE_DAN_EXPERIMENT && (
                <div className="p-4 bg-cyan-900/10 border border-cyan-800/40 rounded-lg space-y-2">
                  <div className="flex items-start gap-3">
                    <input
                      id="dan-sharing"
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-500 text-cyan-500 focus:ring-cyan-400 bg-gray-900"
                      checked={(currentItem.shareScope || []).includes('dan')}
                      onChange={(event) => updateShareScope('dan', event.target.checked)}
                    />
                    <label htmlFor="dan-sharing" className="text-sm text-gray-200">
                      <span className="font-semibold text-cyan-200">Share with DAN network (beta)</span>
                      <span className="block text-gray-400">
                        Broadcast anonymized surplus signals (product, quantity, expiration bucket, aisle zone) so trusted partners can discover this offer.
                      </span>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 pl-7">
                    Provenance proofs are signed with your shop key. Disable anytime to keep inventory local-only.
                  </p>
                </div>
              )}
              <button 
                type="submit" 
                disabled={isProcessing} 
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20"
              >
                {isProcessing ? 'Saving Scan...' : 'Add This Item'}
              </button>
            </form>
        </div>

        {stagedItems.length > 0 && (
            <div className="mt-6">
                <h3 className="font-semibold text-lg text-gray-200 mb-2">Items in this Batch ({stagedItems.length})</h3>
                <ul className="space-y-2 max-h-40 overflow-y-auto p-2 bg-gray-900/50 rounded-md">
                    {stagedItems.map((item, index) => (
                        <li key={index} className="text-sm text-gray-300 p-2 bg-gray-700/50 rounded-md flex justify-between items-center gap-3">
                            <span>{item.quantity}x {item.productName}</span>
                            <span className="flex items-center gap-2">
                              <span>Exp: {item.expirationDate}</span>
                              {item.shareScope?.includes('dan') && (
                                <span className="text-xs px-2 py-0.5 rounded-full border border-cyan-600/40 bg-cyan-900/40 text-cyan-200">
                                  DAN
                                </span>
                              )}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        )}
        <button
            onClick={handleFinishBatch}
            disabled={stagedItems.length === 0}
            className="mt-6 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
        >
            Finish and Save Batch
        </button>
      </div>
    </>
  );
};

export default InventoryForm;
