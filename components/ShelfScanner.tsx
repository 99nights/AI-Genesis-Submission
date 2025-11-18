
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { scanShelfForProducts, ShelfScanResult, ShelfProductDetection, GeminiOverloadError } from '../services/geminiService';
import { ProductSummary } from '../types';
import { persistInventoryEntry, getActiveShopId } from '../services/vectorDBService';
import { v4 as uuidv4 } from 'uuid';
import type { StockItem, ScanMetadata } from '../types';
import { useToast } from './Toast';
import { ExpirationIcon } from './icons/ExpirationIcon';
import { CameraIcon } from './icons/CameraIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';

interface ShelfScannerProps {
  summaries: ProductSummary[];
  onScanComplete?: () => void;
  onClose: () => void;
}

type ScanStatus = 'idle' | 'scanning' | 'processing' | 'results' | 'updating';

const ShelfScanner: React.FC<ShelfScannerProps> = ({ summaries, onScanComplete, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ShelfScanResult | null>(null);
  const [updatingProducts, setUpdatingProducts] = useState<Set<string>>(new Set());
  const [updatedCount, setUpdatedCount] = useState(0);
  const { showToast } = useToast();
  const [geminiOverload, setGeminiOverload] = useState(false);

  const productNames = summaries.map(s => s.productName);
  const productLookup = new Map(summaries.map(s => [s.productName.toLowerCase(), s]));

  // Initialize camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    
    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Camera not supported. Please use a modern browser on HTTPS.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError("Could not access camera. Please grant permissions.");
      }
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const captureShelfPhoto = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    return new Promise<Blob | null>(resolve => 
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
  }, []);

  const handleScan = useCallback(async () => {
    setStatus('scanning');
    setError(null);
    setGeminiOverload(false);

    const photo = await captureShelfPhoto();
    if (!photo) {
      setError('Failed to capture photo');
      setStatus('idle');
      return;
    }

    setStatus('processing');
    try {
      const result = await scanShelfForProducts(photo, productNames);
      setScanResult(result);
      setStatus('results');
      showToast(`Detected ${result.totalProductsDetected} products on shelf!`, 'success');
    } catch (err) {
      if (err instanceof GeminiOverloadError) {
        setGeminiOverload(true);
        setError(err.message);
        setStatus('idle');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to scan shelf');
        setStatus('idle');
      }
    }
  }, [captureShelfPhoto, productNames, showToast]);

  const updateInventoryForProduct = useCallback(async (
    detection: ShelfProductDetection,
    productSummary?: ProductSummary
  ) => {
    const shopId = getActiveShopId();
    if (!shopId) {
      showToast('No active shop context', 'error');
      return false;
    }

    const productId = productSummary?.productId || uuidv4();
    const now = new Date().toISOString();
    const inventoryUuid = uuidv4();

    // Use detected expiration or default to 30 days from now
    let expirationDate = detection.expirationDate;
    if (!expirationDate) {
      const defaultExp = new Date();
      defaultExp.setDate(defaultExp.getDate() + 30);
      expirationDate = defaultExp.toISOString().split('T')[0];
    }

    const scanMetadata: ScanMetadata = {
      ocrText: detection.productName,
      confidence: detection.confidence,
      sourcePhotoId: inventoryUuid,
      fieldCaptures: [],
    };

    const inventoryItem: StockItem = {
      id: Date.now(),
      inventoryUuid,
      shopId,
      productId,
      batchId: '',
      expirationDate,
      quantity: Math.max(1, Math.round(detection.estimatedQuantity)),
      costPerUnit: productSummary?.averageCostPerUnit || 0,
      buyPrice: productSummary?.averageCostPerUnit || 0,
      sellPrice: productSummary?.averageCostPerUnit ? productSummary.averageCostPerUnit * 1.4 : undefined,
      location: detection.location,
      scanMetadata,
      qdrantId: inventoryUuid,
      status: 'ACTIVE',
      createdByUserId: shopId,
      createdAt: now,
      updatedAt: now,
      shareScope: ['local'],
    };

    try {
      await persistInventoryEntry(inventoryItem, scanMetadata);
      return true;
    } catch (err) {
      console.error('Failed to update inventory:', err);
      return false;
    }
  }, [showToast]);

  const handleUpdateInventory = useCallback(async () => {
    if (!scanResult) return;

    setStatus('updating');
    setUpdatingProducts(new Set());
    setUpdatedCount(0);

    let successCount = 0;
    let failCount = 0;

    for (const product of scanResult.products) {
      const productKey = product.productName.toLowerCase();
      setUpdatingProducts(prev => new Set(prev).add(product.productName));

      // Try to match to existing product
      const matchedProduct = productLookup.get(productKey);
      
      const success = await updateInventoryForProduct(product, matchedProduct || undefined);
      
      if (success) {
        successCount++;
        setUpdatedCount(successCount);
      } else {
        failCount++;
      }

      setUpdatingProducts(prev => {
        const next = new Set(prev);
        next.delete(product.productName);
        return next;
      });
    }

    setStatus('results');
    showToast(
      `Inventory updated: ${successCount} products added, ${failCount} failed`,
      successCount > 0 ? 'success' : 'error'
    );

    if (onScanComplete) {
      onScanComplete();
    }
  }, [scanResult, productLookup, updateInventoryForProduct, onScanComplete, showToast]);

  const getExpirationStatus = (expDate?: string): 'expired' | 'expiring-soon' | 'ok' => {
    if (!expDate) return 'ok';
    const exp = new Date(expDate);
    const now = new Date();
    const daysUntil = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) return 'expired';
    if (daysUntil <= 7) return 'expiring-soon';
    return 'ok';
  };

  const expiringProducts = scanResult?.products.filter(p => {
    const status = getExpirationStatus(p.expirationDate);
    return status === 'expired' || status === 'expiring-soon';
  }) || [];

  if (status === 'results' && scanResult) {
    return (
      <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">Shelf Scan Results</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl leading-5"
            >
              &times;
            </button>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm text-gray-300">
            <span>Shelf Fullness: <strong className="text-cyan-400">{scanResult.shelfFullness}%</strong></span>
            <span>Products Detected: <strong className="text-cyan-400">{scanResult.totalProductsDetected}</strong></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Expiration Alerts */}
          {expiringProducts.length > 0 && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <ExpirationIcon className="w-5 h-5 text-red-400" />
                <h3 className="font-semibold text-red-300">
                  Expiration Alerts ({expiringProducts.length})
                </h3>
              </div>
              <div className="space-y-2">
                {expiringProducts.map((product, idx) => {
                  const status = getExpirationStatus(product.expirationDate);
                  const daysUntil = product.expirationDate 
                    ? Math.ceil((new Date(product.expirationDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  
                  return (
                    <div key={idx} className="bg-red-900/30 rounded p-2 text-sm">
                      <span className="font-medium text-white">{product.productName}</span>
                      {product.expirationDate && (
                        <span className={`ml-2 ${status === 'expired' ? 'text-red-300' : 'text-yellow-300'}`}>
                          {status === 'expired' 
                            ? `Expired: ${product.expirationDate}`
                            : `Expires in ${daysUntil} days: ${product.expirationDate}`
                          }
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detected Products */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Detected Products</h3>
            <div className="space-y-3">
              {scanResult.products.map((product, idx) => {
                const isUpdating = updatingProducts.has(product.productName);
                const matchedProduct = productLookup.get(product.productName.toLowerCase());
                const expirationStatus = getExpirationStatus(product.expirationDate);
                
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      expirationStatus === 'expired' 
                        ? 'bg-red-900/20 border-red-700'
                        : expirationStatus === 'expiring-soon'
                        ? 'bg-yellow-900/20 border-yellow-700'
                        : 'bg-gray-700/50 border-gray-600'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-white">{product.productName}</h4>
                          {matchedProduct && (
                            <span className="text-xs px-2 py-0.5 bg-green-700/50 text-green-300 rounded">
                              In Catalog
                            </span>
                          )}
                          {expirationStatus === 'expired' && (
                            <ExpirationIcon className="w-4 h-4 text-red-400" />
                          )}
                          {expirationStatus === 'expiring-soon' && (
                            <ExpirationIcon className="w-4 h-4 text-yellow-400" />
                          )}
                        </div>
                        {product.manufacturer && (
                          <p className="text-sm text-gray-400">{product.manufacturer}</p>
                        )}
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-gray-400">Quantity: </span>
                            <span className="text-white font-medium">
                              {product.estimatedQuantity} ({product.visibleUnits} visible)
                            </span>
                          </div>
                          {product.expirationDate && (
                            <div>
                              <span className="text-gray-400">Expires: </span>
                              <span className={`font-medium ${
                                expirationStatus === 'expired' ? 'text-red-300' :
                                expirationStatus === 'expiring-soon' ? 'text-yellow-300' :
                                'text-green-300'
                              }`}>
                                {product.expirationDate}
                              </span>
                            </div>
                          )}
                          {product.location && (
                            <div>
                              <span className="text-gray-400">Location: </span>
                              <span className="text-white">{product.location}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-gray-400">Confidence: </span>
                            <span className="text-white">
                              {Math.round(product.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                        {product.notes && (
                          <p className="text-xs text-gray-500 mt-1">{product.notes}</p>
                        )}
                      </div>
                      {isUpdating && (
                        <div className="ml-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400"></div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Marketplace Opportunities */}
          {expiringProducts.length > 0 && (
            <div className="bg-indigo-900/20 border border-indigo-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <h3 className="font-semibold text-indigo-300">
                  Marketplace Opportunities ({expiringProducts.length})
                </h3>
              </div>
              <p className="text-sm text-gray-300 mb-3">
                These products are expiring soon and could be listed on the marketplace to reduce waste:
              </p>
              <div className="space-y-2">
                {expiringProducts.slice(0, 5).map((product, idx) => {
                  const daysUntil = product.expirationDate 
                    ? Math.ceil((new Date(product.expirationDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  
                  return (
                    <div key={idx} className="bg-indigo-900/30 rounded p-2 text-sm flex items-center justify-between">
                      <div>
                        <span className="font-medium text-white">{product.productName}</span>
                        {product.expirationDate && (
                          <span className="ml-2 text-indigo-300">
                            {daysUntil !== null && daysUntil > 0 
                              ? `${daysUntil} days left`
                              : 'Expired'
                            }
                          </span>
                        )}
                        <span className="ml-2 text-gray-400">
                          Qty: {product.estimatedQuantity}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          showToast(`Consider listing ${product.productName} on marketplace to reduce waste`, 'info');
                        }}
                        className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-white transition-colors"
                      >
                        List on Marketplace
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {scanResult.recommendations && scanResult.recommendations.length > 0 && (
            <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
              <h3 className="font-semibold text-blue-300 mb-2">Recommendations</h3>
              <ul className="space-y-1 text-sm text-gray-300">
                {scanResult.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-400">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-400">
              {status === 'updating' && (
                <span>Updating inventory... ({updatedCount}/{scanResult.products.length})</span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setStatus('idle');
                  setScanResult(null);
                }}
                className="px-4 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-600"
              >
                Scan Again
              </button>
              <button
                onClick={handleUpdateInventory}
                disabled={status === 'updating'}
                className="px-6 py-2 rounded-md bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {status === 'updating' ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Updating...
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-5 h-5" />
                    Update Inventory
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" aria-modal="true">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {geminiOverload && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-600/95 text-white p-4 rounded-lg text-center z-30 max-w-md mx-auto shadow-2xl border-2 border-yellow-400">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg className="w-6 h-6 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <h3 className="text-lg font-bold">Gemini API Overloaded</h3>
          </div>
          <p className="text-sm mb-3">{error || 'Please wait a moment and try again.'}</p>
          <button
            onClick={() => {
              setGeminiOverload(false);
              setError(null);
            }}
            className="px-4 py-2 bg-yellow-700 hover:bg-yellow-800 rounded-md text-sm font-semibold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {error && !geminiOverload && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-800/80 text-white p-3 rounded-lg text-center z-30 max-w-md">
          {error}
        </div>
      )}

      <div className="absolute top-4 left-4 bg-black/50 text-white px-4 py-2 rounded-full z-20">
        {status === 'scanning' && 'Capturing shelf photo...'}
        {status === 'processing' && 'Analyzing shelf for products...'}
        {status === 'idle' && 'Position your phone to scan the shelf'}
      </div>

      {status === 'processing' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4"></div>
            <p className="text-white text-lg">Analyzing shelf...</p>
            <p className="text-gray-400 text-sm mt-2">Detecting products and quantities</p>
          </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80 transition-colors z-30"
        aria-label="Close scanner"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-6 z-20">
        <div className="max-w-2xl mx-auto">
          <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
            <CameraIcon className="w-6 h-6 text-cyan-400" />
            Shelf Scanner
          </h3>
          <p className="text-sm text-gray-300 mb-4">
            Point your camera at a shelf to automatically detect all products, update stock levels, and check expiration dates.
          </p>
          <button
            onClick={handleScan}
            disabled={status === 'scanning' || status === 'processing'}
            className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-cyan-600 text-white font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-lg"
          >
            {status === 'scanning' || status === 'processing' ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                {status === 'scanning' ? 'Capturing...' : 'Processing...'}
              </>
            ) : (
              <>
                <CameraIcon className="w-6 h-6" />
                Scan Shelf
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShelfScanner;

