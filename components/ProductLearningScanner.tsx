

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { fieldMetadata, ScannedItemData, analyzeImageForInventory, analyzeCroppedImageForField } from '../services/geminiService';
import { createCanonicalProduct, addImageForField, persistInventoryEntry } from '../services/vectorDBService';
import { activeShopId } from '../services/qdrant/core';
import { v4 as uuidv4 } from 'uuid';
import type { StockItem, ScanMetadata } from '../types';
import { LockIcon } from './icons/LockIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';

interface ProductLearningScannerProps {
  onClose: () => void;
  onProductCreated: () => void;
}

type Mode = 'scanning' | 'selectingField' | 'drawingBox' | 'analyzing' | 'verifying';

const ProductLearningScanner: React.FC<ProductLearningScannerProps> = ({ onClose, onProductCreated }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<Mode>('scanning');
  const [error, setError] = useState<string | null>(null);
  
  // FIX: Corrected type of scannedData to allow spreading object properties and accessing fields like productName, and explicitly added productDescription.
  const [scannedData, setScannedData] = useState<Partial<ScannedItemData & { productId?: string; productDescription?: string }>>({});
  const [manuallyCapturedFields, setManuallyCapturedFields] = useState(new Set<keyof ScannedItemData | 'productId'>());
  const [capturedBlobs, setCapturedBlobs] = useState<Map<keyof ScannedItemData | 'productId', Blob>>(new Map());

  const [selectedField, setSelectedField] = useState<keyof ScannedItemData | 'productId' | null>(null);
  const [firstTapCorner, setFirstTapCorner] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearScanInterval = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);
  
  const handleResize = useCallback(() => {
    if (videoRef.current && overlayCanvasRef.current) {
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      const rect = video.getBoundingClientRect();
      overlay.width = rect.width;
      overlay.height = rect.height;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => handleResize();
        }
      } catch (err) {
        setError("Could not access camera. Please grant permissions.");
      }
    };
    startCamera();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearScanInterval();
      stopCamera();
    };
  }, [handleResize, clearScanInterval, stopCamera]);

  const performAutoScan = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || document.hidden || mode !== 'scanning') return;

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));

    if (!blob || mode !== 'scanning') return;

    try {
      const result = await analyzeImageForInventory(blob);
      setScannedData(prev => {
          // FIX: Use object spread directly as scannedData is now a proper object type
          const updated = {...prev};
          for(const key in result) {
              const fieldKey = key as keyof ScannedItemData;
              // Only update if not manually captured
              if(!manuallyCapturedFields.has(fieldKey)) {
                  (updated as any)[fieldKey] = result[fieldKey];
              }
          }
          return updated;
      });
    } catch (err) {
      console.warn("Auto-scan failed:", err);
    }
  }, [mode, manuallyCapturedFields]);

  useEffect(() => {
    if (mode === 'scanning' && !scanIntervalRef.current) {
      scanIntervalRef.current = window.setInterval(performAutoScan, 3500);
    } else if (mode !== 'scanning') {
      clearScanInterval();
    }
  }, [mode, performAutoScan, clearScanInterval]);

  const handleFieldSelect = (field: keyof ScannedItemData | 'productId') => {
    setSelectedField(field);
    setMode('drawingBox');
    setFirstTapCorner(null);
    setSelectionBox(null);
  };
  
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (mode !== 'drawingBox' || !selectedField) return;

    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!firstTapCorner) {
        setFirstTapCorner({ x, y });
    } else {
        const box = {
            x: Math.min(firstTapCorner.x, x),
            y: Math.min(firstTapCorner.y, y),
            width: Math.abs(x - firstTapCorner.x),
            height: Math.abs(y - firstTapCorner.y),
        };
        if (box.width > 5 && box.height > 5) {
            setSelectionBox(box);
            captureAndAnalyze(box);
        }
        setFirstTapCorner(null);
    }
  };

  const captureAndAnalyze = useCallback(async (cropBox: { x: number; y: number; width: number; height: number; }) => {
    if (!videoRef.current || !captureCanvasRef.current || !selectedField) return;

    setMode('analyzing');

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const scaleX = video.videoWidth / video.clientWidth;
    const scaleY = video.videoHeight / video.clientHeight;
    
    const sourceX = cropBox.x * scaleX;
    const sourceY = cropBox.y * scaleY;
    const sourceWidth = cropBox.width * scaleX;
    const sourceHeight = cropBox.height * scaleY;
    
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    if(ctx) {
      ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob) {
        // FIX: Use object spread directly as capturedBlobs is a Map
        setCapturedBlobs(prev => new Map(prev).set(selectedField, blob));
        try {
          const result = await analyzeCroppedImageForField(blob, selectedField);
          // FIX: Use object spread directly as scannedData is now a proper object type
          setScannedData(prev => ({ ...prev, [selectedField]: result }));
          setManuallyCapturedFields(prev => new Set(prev).add(selectedField!));
        } catch(err) {
          setError(err instanceof Error ? err.message : 'Analysis failed');
        }
      }
    }
    setSelectedField(null);
    setSelectionBox(null);
    setMode('scanning');
  }, [selectedField]);

  const handleSaveProduct = async () => {
    // FIX: Cast scannedData to ScannedItemData for property access
    const currentScannedData = scannedData as ScannedItemData; 

    if (!currentScannedData.productName || !currentScannedData.manufacturer || !currentScannedData.category) {
        setError('Product Name, Manufacturer, and Category are required to save.');
        setMode('scanning');
        return;
    }
    
    if (!activeShopId) {
        setError('No shop selected. Please select a shop before saving.');
        setMode('scanning');
        return;
    }
    
    setIsSubmitting(true);
    setError(null);
    try {
        // Create the canonical product in the products collection
        const newProduct = await createCanonicalProduct({
            name: currentScannedData.productName,
            manufacturer: currentScannedData.manufacturer,
            category: currentScannedData.category,
            // FIX: Cast scannedData to ScannedItemData for productDescription property
            description: currentScannedData.productDescription || '', 
        });

        // Add images for product fields (for OCR learning)
        const imagePromises = Array.from(capturedBlobs.entries()).map(([field, blob]) => 
            addImageForField(newProduct.name, field, blob, { productId: newProduct.id, source: 'manual' })
        );
        await Promise.all(imagePromises);
        
        // CRITICAL: Create an inventory item in the items collection
        // This links the discovered product to actual inventory
        const now = new Date().toISOString();
        const inventoryUuid = uuidv4();
        
        // Build scan metadata from captured fields
        const scanMetadata: ScanMetadata = {
            ocrText: currentScannedData.productName || '',
            confidence: 1.0,
            sourcePhotoId: inventoryUuid,
            fieldCaptures: Array.from(capturedBlobs.keys()).map(field => ({
                field: String(field),
                captureId: uuidv4(),
                source: 'manual' as const,
                capturedAt: now,
                confidence: 0.9,
            })),
        };
        
        // Extract images from captured blobs for the inventory item
        const productImages = Array.from(capturedBlobs.entries()).map(([field, blob]) => {
            // Note: In a real implementation, these would be uploaded to storage
            // For now, we'll use placeholder URLs or store the metadata
            return {
                url: '', // Will be populated when images are uploaded to storage
                type: 'manual' as const,
                source: String(field),
                addedAt: now,
            };
        });
        
        // Create the inventory item (StockItem)
        const inventoryItem: StockItem = {
            id: Date.now(), // Legacy numeric ID
            inventoryUuid,
            shopId: activeShopId,
            productId: newProduct.id,
            batchId: '', // No batch for scanned items
            expirationDate: currentScannedData.expirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // Default 1 year if not provided
            quantity: currentScannedData.quantity || 1, // Default to 1 item when scanning
            costPerUnit: currentScannedData.buyPrice || 0,
            buyPrice: currentScannedData.buyPrice,
            sellPrice: currentScannedData.sellPrice || (currentScannedData.buyPrice ? currentScannedData.buyPrice * 1.4 : undefined),
            location: currentScannedData.location,
            images: productImages.length > 0 ? productImages : undefined,
            scanMetadata,
            qdrantId: inventoryUuid,
            status: 'ACTIVE',
            createdByUserId: activeShopId,
            createdAt: now,
            updatedAt: now,
            shareScope: ['local'],
        };
        
        // Persist the inventory item to Qdrant items collection
        await persistInventoryEntry(inventoryItem, scanMetadata);
        
        // Stop camera before closing
        stopCamera();
        onProductCreated();
        onClose();
    } catch(err) {
        setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
        setIsSubmitting(false);
    }
  };

  const getPromptMessage = () => {
      // FIX: Updated prompt message for 'scanning' mode
      if (mode === 'scanning') return 'Auto-scanning product... Tap screen to manually select a field.'; 
      if (mode === 'drawingBox') {
          if(!firstTapCorner) return `Tap the first corner for ${fieldMetadata[selectedField!].displayName}.`;
          return 'Tap the opposite corner to create a selection.';
      }
      if (mode === 'analyzing') return `Analyzing ${fieldMetadata[selectedField!].displayName}...`;
      if (mode === 'verifying') return 'Review the extracted data and confirm to save the new product.';
      return '';
  };

  if (mode === 'verifying') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-50 p-4 sm:p-8 flex flex-col" aria-modal="true">
        <h2 className="text-2xl font-bold text-white mb-4">Verify New Product</h2>
        {error && <p className="bg-red-900/50 text-red-300 p-3 rounded-md mb-4">{error}</p>}
        <div className="flex-grow overflow-y-auto space-y-4 bg-gray-800/50 p-4 rounded-lg">
            {Object.entries(scannedData).map(([key, value]) => {
                const field = key as keyof ScannedItemData | 'productId';
                const blob = capturedBlobs.get(field);
                return (
                    <div key={key}>
                        <label className="block text-sm font-medium text-gray-400">{fieldMetadata[field]?.displayName || key}</label>
                        <div className="flex items-center gap-4">
                            <input value={String(value)} onChange={e => setScannedData(p => ({...p, [field]: e.target.value}))} className="flex-grow px-3 py-2 rounded-md bg-gray-700 border border-gray-600 text-white" />
                            {blob && <img src={URL.createObjectURL(blob)} alt={`Crop of ${key}`} className="w-24 h-12 object-contain rounded-md bg-black" />}
                        </div>
                    </div>
                )
            })}
        </div>
        <div className="flex-shrink-0 pt-6 flex justify-end gap-4">
            <button onClick={() => setMode('scanning')} disabled={isSubmitting} className="px-6 py-2 rounded-md bg-gray-600 text-white font-semibold">Back to Scanner</button>
            <button onClick={handleSaveProduct} disabled={isSubmitting} className="px-6 py-2 rounded-md bg-cyan-600 text-white font-semibold">{isSubmitting ? 'Saving...' : 'Confirm & Save Product'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex" aria-modal="true">
      <div className="flex-grow relative">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
        <canvas ref={captureCanvasRef} className="hidden"></canvas>
        <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full z-10" onClick={handleCanvasClick} />
        {error && <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-800/80 text-white p-3 rounded-lg text-center z-30 max-w-md mx-auto">{error}</div>}
         <div className="absolute top-4 left-4 bg-black/50 text-white px-4 py-2 rounded-full z-20 text-center text-sm">{getPromptMessage()}</div>
      </div>

      <div className="w-full md:w-96 bg-gray-900/80 backdrop-blur-sm border-l border-gray-700 flex flex-col p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Learn Product</h2>
            <button onClick={() => {
              stopCamera();
              onClose();
            }} className="text-gray-400 hover:text-white">&times;</button>
          </div>
          <div className="flex-grow overflow-y-auto space-y-2 pr-2">
            {(Object.keys(fieldMetadata) as Array<keyof typeof fieldMetadata>).map(key => {
                const isCaptured = manuallyCapturedFields.has(key);
                // FIX: Cast scannedData to ScannedItemData to access properties safely
                const hasValue = (scannedData as ScannedItemData)[key] !== undefined && (scannedData as ScannedItemData)[key] !== '' && (scannedData as ScannedItemData)[key] !== 0;
                return (
                    <button key={key} onClick={() => handleFieldSelect(key)} className={`w-full text-left p-3 rounded-md transition-colors flex items-center justify-between ${isCaptured ? 'bg-indigo-800/50' : 'bg-gray-700/50 hover:bg-gray-700'}`}>
                        <div>
                            <span className="font-semibold text-white">{fieldMetadata[key].displayName}</span>
                            {hasValue && <p className="text-sm text-cyan-300 truncate">{String((scannedData as ScannedItemData)[key])}</p>}
                        </div>
                        {isCaptured && <LockIcon className="w-5 h-5 text-indigo-300 flex-shrink-0" />}
                    </button>
                )
            })}
          </div>
          <div className="flex-shrink-0">
            <button onClick={() => setMode('verifying')} className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 transition-colors">
                <CheckCircleIcon className="w-6 h-6"/>
                Verify & Save
            </button>
          </div>
      </div>
    </div>
  );
};

export default ProductLearningScanner;
