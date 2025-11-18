import React, { useEffect, useState, useRef, useMemo } from 'react';
import { BatchRecord, BatchLineItem, BatchDocument, ProductDefinition, SupplierProfile } from '../types';
import { createBatchForShop, fetchBatchRecords, fetchSuppliersForActiveShop, fetchCanonicalProducts, syncBatchesFromQdrant } from '../services/vectorDBService';
import { analyzeBatchDocuments, AnalyzedBatchData } from '../services/geminiService';
import { UploadIcon } from './icons/UploadIcon';
import { SparkleIcon } from './icons/SparkleIcon';
import { TrashIcon } from './icons/TrashIcon';

const hashBlob = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

const BatchesPage: React.FC = () => {
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form State
  const [draftBatch, setDraftBatch] = useState<Partial<BatchRecord>>({
    deliveryDate: new Date().toISOString().split('T')[0],
    lineItems: [],
    documents: [],
  });
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name || s.id])), [suppliers]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [records, supplierList, productList] = await Promise.all([
        fetchBatchRecords(),
        fetchSuppliersForActiveShop(),
        fetchCanonicalProducts(),
      ]);
      setBatches(records.sort((a,b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()));
      setSuppliers(supplierList);
      setProducts(productList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setDraftBatch({
      deliveryDate: new Date().toISOString().split('T')[0],
      lineItems: [],
      documents: [],
    });
    setUploadedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
        setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };
  
  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  }
  
  const handleProcessDocuments = async () => {
      if (uploadedFiles.length === 0) return;
      setIsProcessingDoc(true);
      setError(null);
      try {
          const result: AnalyzedBatchData = await analyzeBatchDocuments(uploadedFiles);
          
          // Attempt to match supplier
          const matchedSupplier = suppliers.find(s => result.supplierName && s.name.toLowerCase().includes(result.supplierName.toLowerCase()));

          const newItems: BatchLineItem[] = result.items.map(item => {
              // Attempt to match product
              const matchedProduct = products.find(p => p.name.toLowerCase() === item.productName.toLowerCase());
              return {
                  productId: matchedProduct?.id || '', // Leave empty if no match
                  productName: item.productName,
                  quantity: item.quantity,
                  cost: item.costPerUnit
              };
          });

          setDraftBatch(prev => ({
              ...prev,
              supplierId: matchedSupplier?.id || prev.supplierId,
              invoiceNumber: result.invoiceNumber || prev.invoiceNumber,
              deliveryDate: result.deliveryDate || prev.deliveryDate,
              lineItems: newItems,
          }));

      } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to analyze documents.');
      } finally {
          setIsProcessingDoc(false);
      }
  };
  
  const updateLineItem = (index: number, field: keyof BatchLineItem, value: string | number) => {
    const updatedItems = [...(draftBatch.lineItems || [])];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    // If productId changes, update productName to match
    if (field === 'productId') {
        const product = productMap.get(value as string);
        if (product) {
            updatedItems[index].productName = product.name;
        }
    }
    setDraftBatch(prev => ({...prev, lineItems: updatedItems}));
  };
  
  const addLineItem = () => {
      const newItem: BatchLineItem = { productId: '', productName: 'Manual Entry', quantity: 1, cost: 0 };
      setDraftBatch(prev => ({...prev, lineItems: [...(prev.lineItems || []), newItem]}));
  };
  
  const removeLineItem = (index: number) => {
      setDraftBatch(prev => ({...prev, lineItems: prev.lineItems?.filter((_, i) => i !== index)}));
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftBatch.deliveryDate || !draftBatch.lineItems || draftBatch.lineItems.length === 0) {
      setError('Delivery date and at least one valid line item are required.');
      return;
    }
    const validLineItems = draftBatch.lineItems.filter(item => item.productId && item.quantity > 0);
    if(validLineItems.length === 0) {
        setError('At least one line item must be assigned to a product.');
        return;
    }
    
    setIsSubmitting(true);
    setError(null);
    try {
      // FIX: Add non-null assertion for deliveryDate as it's checked above, satisfying the function's type requirement.
      await createBatchForShop({
        ...draftBatch,
        deliveryDate: draftBatch.deliveryDate!,
        lineItems: validLineItems
      });
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create batch.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSyncBatches = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      await syncBatchesFromQdrant();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync batches.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <SparkleIcon className="w-6 h-6 text-cyan-400"/>
            Log New Delivery Batch
        </h2>
        <form onSubmit={handleCreateBatch} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Details & Docs */}
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Delivery Date</label>
                        <input type="date" className="form-input" value={draftBatch.deliveryDate || ''} onChange={(e) => setDraftBatch(p => ({...p, deliveryDate: e.target.value}))} required />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Supplier</label>
                        <select className="form-input" value={draftBatch.supplierId || ''} onChange={(e) => setDraftBatch(p => ({...p, supplierId: e.target.value || undefined}))}>
                            <option value="">Select Supplier...</option>
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="block text-sm text-gray-300 mb-1">Invoice Number</label>
                        <input className="form-input" value={draftBatch.invoiceNumber || ''} onChange={(e) => setDraftBatch(p => ({...p, invoiceNumber: e.target.value}))} />
                    </div>
                </div>
                 {/* Document Upload */}
                <div className="p-4 border border-gray-700 rounded-lg space-y-3">
                    <h3 className="text-base font-semibold text-gray-200">Upload Documents</h3>
                    <input type="file" ref={fileInputRef} onChange={handleFileSelected} accept="image/*" className="hidden" multiple />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="button-secondary w-full"><UploadIcon className="w-5 h-5"/> Add Document(s)</button>
                    <div className="space-y-2">
                        {uploadedFiles.map((file, index) => (
                            <div key={index} className="flex items-center justify-between bg-gray-900/50 p-2 rounded text-sm">
                                <span className="truncate text-gray-300">{file.name}</span>
                                <button type="button" onClick={() => removeFile(index)} className="text-red-400 hover:text-red-300"><TrashIcon className="w-4 h-4"/></button>
                            </div>
                        ))}
                    </div>
                    {uploadedFiles.length > 0 && (
                        <button type="button" onClick={handleProcessDocuments} disabled={isProcessingDoc} className="button-primary w-full">
                            {isProcessingDoc ? 'Analyzing...' : `Analyze ${uploadedFiles.length} Document(s) with AI`}
                        </button>
                    )}
                </div>
            </div>
            {/* Right Column: Line Items */}
            <div className="space-y-4 p-4 border border-gray-700 rounded-lg bg-gray-900/20">
                 <h3 className="text-base font-semibold text-gray-200">Line Items</h3>
                 <div className="space-y-3 max-h-96 overflow-y-auto">
                    {(draftBatch.lineItems || []).map((item, index) => (
                        <div key={index} className="p-2 rounded-md bg-gray-800/50 grid grid-cols-12 gap-2 items-center">
                           <div className="col-span-6">
                               <select className="form-input text-sm" value={item.productId} onChange={e => updateLineItem(index, 'productId', e.target.value)} required>
                                   <option value="">Match Product...</option>
                                   {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                               </select>
                               {item.productId === '' && <p className="text-xs text-yellow-400 mt-1">Unmatched: "{item.productName}"</p>}
                           </div>
                           <div className="col-span-2">
                                <input type="number" placeholder="Qty" className="form-input text-sm" value={item.quantity} onChange={e => updateLineItem(index, 'quantity', Number(e.target.value))}/>
                           </div>
                             <div className="col-span-3">
                                <input type="number" placeholder="Cost" step="0.01" className="form-input text-sm" value={item.cost} onChange={e => updateLineItem(index, 'cost', Number(e.target.value))}/>
                           </div>
                           <div className="col-span-1">
                               <button type="button" onClick={() => removeLineItem(index)} className="text-red-400 hover:text-red-300"><TrashIcon className="w-4 h-4"/></button>
                           </div>
                        </div>
                    ))}
                 </div>
                 <button type="button" onClick={addLineItem} className="button-secondary text-sm">Add Manual Item</button>
                 <button type="submit" disabled={isSubmitting} className="button-primary w-full">
                    {isSubmitting ? 'Saving Batch...' : 'Save Batch'}
                 </button>
            </div>
        </form>
        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>

      {/* Existing Batches */}
       <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Logged Batches</h2>
          <button onClick={loadData} className="button-secondary text-sm">Refresh</button>
        </div>
        {isLoading ? ( <p className="text-gray-400">Loading batches...</p> ) : 
          batches.length === 0 ? ( <p className="text-gray-500 text-center py-4">No batches logged yet.</p> ) : (
          <div className="space-y-3">
            {batches.map(batch => (
              <details key={batch.id} className="p-3 bg-gray-900/40 rounded-lg border border-gray-700 transition-colors">
                <summary className="cursor-pointer">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-white font-semibold">Delivery: {batch.deliveryDate}</p>
                            <p className="text-sm text-gray-400">Supplier: {supplierMap.get(batch.supplierId || '') || batch.supplierId || 'N/A'}</p>
                            <p className="text-xs text-gray-500">Invoice #: {batch.invoiceNumber || 'N/A'}</p>
                        </div>
                        <div className="text-right text-sm">
                            <span className="text-gray-300">{batch.lineItems?.length || 0} items</span>
                        </div>
                    </div>
                </summary>
                <div className="mt-3 pt-3 border-t border-gray-700">
                    <ul className="space-y-1 text-sm">
                        {batch.lineItems?.map((item, idx) => (
                           <li key={idx} className="flex justify-between text-gray-300">
                               <span>{item.quantity}x {productMap.get(item.productId)?.name || item.productName}</span>
                               <span className="text-gray-400">${item.cost.toFixed(2)}/unit</span>
                           </li>
                        ))}
                    </ul>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .form-input {
            width: 100%;
            padding: 0.5rem 0.75rem;
            border-radius: 0.375rem;
            background-color: #1f2937;
            border: 1px solid #4b5563;
            color: white;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-input:focus {
            outline: none;
            border-color: #22d3ee;
            box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.4);
        }
        .button-primary {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.625rem 1rem;
            border-radius: 0.375rem;
            background-color: #0891b2;
            color: white;
            font-weight: 600;
            transition: background-color 0.2s;
        }
        .button-primary:hover {
            background-color: #0e7490;
        }
        .button-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .button-secondary {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            background-color: #4b5563;
            color: white;
            font-weight: 500;
            transition: background-color 0.2s;
        }
        .button-secondary:hover {
            background-color: #6b7280;
        }
      `}</style>
    </div>
  );
};

export default BatchesPage;
