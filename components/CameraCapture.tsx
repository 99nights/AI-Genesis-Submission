

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { analyzeCroppedImageForField, analyzeImageForInventory, fieldMetadata, ScannedItemData, identifyProductNameFromImage, findAndReadFeature, dataUrlToBlob, GeminiOverloadError } from '../services/geminiService';
import { getLearnedFieldsForProduct } from '../services/vectorDBService';
import { LockIcon } from './icons/LockIcon';
import { BrainCircuitIcon } from './icons/BrainCircuitIcon';

export type CameraScanSource = 'manual' | 'learned' | 'auto';

export interface CameraScanResult {
  data: Partial<ScannedItemData>;
  blobs: Map<keyof ScannedItemData | 'productId', Blob>;
  identifiedProductId?: string;
  fieldSources: Map<keyof ScannedItemData | 'productId', CameraScanSource>;
  fieldConfidences: Map<keyof ScannedItemData | 'productId', number>;
}

export interface ScanProductOption {
  productId: string;
  productName: string;
}

interface CameraCaptureProps {
  onDataScanned: (result: CameraScanResult) => void;
  onClose: () => void;
  productOptions: ScanProductOption[];
  mode?: 'scan' | 'visual-search';
}

type ScanMode = 'auto-scanning' | 'selecting-field' | 'manual-capture' | 'analyzing';

const CameraCapture: React.FC<CameraCaptureProps> = ({ onDataScanned, onClose, productOptions, mode: captureMode = 'scan' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const autoScanIntervalRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [geminiOverload, setGeminiOverload] = useState(false);
  const [scannedData, setScannedData] = useState<Partial<ScannedItemData>>({});
  const [fieldSources, setFieldSources] = useState(new Map<keyof ScannedItemData | 'productId', CameraScanSource>());
  const [fieldConfidences, setFieldConfidences] = useState(new Map<keyof ScannedItemData | 'productId', number>());
  const [mode, setMode] = useState<ScanMode>('auto-scanning');
  const [selectedField, setSelectedField] = useState<keyof ScannedItemData | 'productId' | null>(null);
  
  const [firstTapCorner, setFirstTapCorner] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [manuallyScannedFields, setManuallyScannedFields] = useState(new Set<keyof ScannedItemData | 'productId'>());
  const [capturedBlobs, setCapturedBlobs] = useState<Map<keyof ScannedItemData | 'productId', Blob>>(new Map());
  
  const [identifiedProduct, setIdentifiedProduct] = useState<ScanProductOption | null>(null);
  const [learnedScannedFields, setLearnedScannedFields] = useState(new Set<keyof ScannedItemData | 'productId'>());

  const productLookup = useMemo(() => {
    const map = new Map<string, ScanProductOption>();
    productOptions.forEach(option => {
      if (!map.has(option.productName)) {
        map.set(option.productName, option);
      }
    });
    return map;
  }, [productOptions]);
  const productNames = useMemo(() => Array.from(productLookup.keys()), [productLookup]);

  const scannedDataRef = useRef(scannedData);
  const fieldConfidenceRef = useRef(fieldConfidences);

  useEffect(() => {
    scannedDataRef.current = scannedData;
  }, [scannedData]);

  useEffect(() => {
    fieldConfidenceRef.current = fieldConfidences;
  }, [fieldConfidences]);

  const updateFieldValue = useCallback((
    field: keyof ScannedItemData | 'productId',
    value: any,
    source: CameraScanSource,
    confidence: number
  ) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;

    const existingConfidence = fieldConfidenceRef.current.get(field) ?? 0;
    const hasExistingValue = (scannedDataRef.current as any)[field] !== undefined &&
      (scannedDataRef.current as any)[field] !== null &&
      String((scannedDataRef.current as any)[field]).length > 0;

    if (hasExistingValue && existingConfidence >= confidence) {
      return;
    }

    setScannedData(prev => ({ ...prev, [field]: value }));
    setFieldSources(prev => {
      const next = new Map(prev);
      next.set(field, source);
      return next;
    });
    setFieldConfidences(prev => {
      const next = new Map(prev);
      next.set(field, confidence);
      return next;
    });
  }, []);

  const clearAutoScanInterval = useCallback(() => {
    if (autoScanIntervalRef.current) {
      clearInterval(autoScanIntervalRef.current);
      autoScanIntervalRef.current = null;
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

  useEffect(() => {
    let stream: MediaStream | null = null;
    
    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Camera not supported on this browser. Please use a modern browser on a secure (HTTPS) connection.");
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
          videoRef.current.onloadedmetadata = () => handleResize();
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Could not access the camera. Please ensure permissions are granted and you are on a secure (HTTPS) site.");
      }
    };

    startCamera();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearAutoScanInterval();
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [handleResize, clearAutoScanInterval]);

  const performAutoScan = useCallback(async () => {
    if (!videoRef.current || !captureCanvasRef.current || document.hidden || mode !== 'auto-scanning') return;

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const fullImageBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));

    if (!fullImageBlob || mode !== 'auto-scanning') return;

    let matchedProduct: ScanProductOption | null = null;
    try {
      const productName = await identifyProductNameFromImage(fullImageBlob, productNames);
      matchedProduct = productName ? productLookup.get(productName) || null : null;
      if (matchedProduct?.productId !== identifiedProduct?.productId) {
        setIdentifiedProduct(matchedProduct);
      }
      // Clear overload error if request succeeds
      if (geminiOverload) {
        setGeminiOverload(false);
        setError(null);
      }
    } catch (err) {
      if (err instanceof GeminiOverloadError) {
        setGeminiOverload(true);
        setError(err.message);
        // Pause auto-scanning when overloaded
        clearAutoScanInterval();
        return;
      }
      console.warn('Product identification failed:', err);
    }

    if (matchedProduct) {
      try {
        const learnedFieldsToScan = await getLearnedFieldsForProduct(matchedProduct.productId);
        if (learnedFieldsToScan.size > 0) {
          await Promise.all(
            Array.from(learnedFieldsToScan.entries()).map(async ([fieldName, imageData]) => {
              const typedField = fieldName as keyof ScannedItemData | 'productId';
              if (manuallyScannedFields.has(typedField) || learnedScannedFields.has(typedField)) return;
              const existingConfidence = fieldConfidenceRef.current.get(typedField) ?? 0;
              if (existingConfidence >= 0.85) return;
              const featureBlob = dataUrlToBlob(`data:${imageData.mimeType};base64,${imageData.imageBase64}`);
              try {
                const result = await findAndReadFeature(fullImageBlob, featureBlob, typedField);
                if (result !== null) {
                  updateFieldValue(typedField, result, 'learned', 0.85);
                  setLearnedScannedFields(prev => new Set(prev).add(typedField));
                }
              } catch (fieldErr) {
                if (fieldErr instanceof GeminiOverloadError) {
                  throw fieldErr; // Re-throw to be caught by outer catch
                }
              }
            })
          );
        }
        // Clear overload error if request succeeds
        if (geminiOverload) {
          setGeminiOverload(false);
          setError(null);
        }
      } catch (err) {
        if (err instanceof GeminiOverloadError) {
          setGeminiOverload(true);
          setError(err.message);
          clearAutoScanInterval();
          return;
        }
        console.warn('Learned field scan failed:', err);
      }
    }

    try {
      const genericResult = await analyzeImageForInventory(fullImageBlob);
      for (const key in genericResult) {
        const fieldKey = key as keyof ScannedItemData;
        if (!manuallyScannedFields.has(fieldKey)) {
          updateFieldValue(fieldKey, (genericResult as any)[fieldKey], 'auto', 0.6);
        }
      }
      // Clear overload error if request succeeds
      if (geminiOverload) {
        setGeminiOverload(false);
        setError(null);
      }
    } catch (err) {
      if (err instanceof GeminiOverloadError) {
        setGeminiOverload(true);
        setError(err.message);
        clearAutoScanInterval();
        return;
      }
      console.warn("Generic auto-scan analysis failed:", err);
    }
  }, [
    identifiedProduct,
    manuallyScannedFields,
    mode,
    productLookup,
    productNames,
    updateFieldValue,
    learnedScannedFields,
    geminiOverload,
    clearAutoScanInterval
  ]);

  useEffect(() => {
    if (mode === 'auto-scanning' && !autoScanIntervalRef.current) {
      autoScanIntervalRef.current = window.setInterval(performAutoScan, 4000);
    } else if (mode !== 'auto-scanning') {
      clearAutoScanInterval();
    }
  }, [mode, performAutoScan, clearAutoScanInterval]);
  
  useEffect(() => {
      const canvas = overlayCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          if (firstTapCorner) {
            ctx.fillStyle = '#06b6d4';
            ctx.beginPath();
            ctx.arc(firstTapCorner.x, firstTapCorner.y, 10, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          if (selectionBox) {
              ctx.strokeStyle = '#06b6d4';
              ctx.lineWidth = 3;
              ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
          }
      }
  }, [firstTapCorner, selectionBox]);

  const handleFieldSelect = (field: keyof ScannedItemData | 'productId') => {
    setSelectedField(field);
    setMode('manual-capture');
    setFirstTapCorner(null);
    setSelectionBox(null);
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (mode === 'auto-scanning') {
        setMode('selecting-field');
        return;
    }
    
    if (mode === 'manual-capture' && selectedField) {
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
            if (box.width > 10 && box.height > 10) {
                setSelectionBox(box);
                captureAndAnalyze(box);
            } else {
                setFirstTapCorner(null);
            }
        }
    }
  };

  const captureAndAnalyze = useCallback(async (cropBox: { x: number; y: number; width: number; height: number; }) => {
    if (!videoRef.current || !captureCanvasRef.current || !selectedField) return;

    setMode('analyzing');
    setFirstTapCorner(null);

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const videoRect = video.getBoundingClientRect();
    
    const scaleX = video.videoWidth / videoRect.width;
    const scaleY = video.videoHeight / videoRect.height;
    
    const sourceX = cropBox.x * scaleX;
    const sourceY = cropBox.y * scaleY;
    const sourceWidth = cropBox.width * scaleX;
    const sourceHeight = cropBox.height * scaleY;
    
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    const ctx = canvas.getContext('2d');
    if(ctx) {
      ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      
      canvas.toBlob(async (blob) => {
        if(blob) {
          try {
            setCapturedBlobs(prev => new Map(prev).set(selectedField, blob));
            const result = await analyzeCroppedImageForField(blob, selectedField);
            updateFieldValue(selectedField, result, 'manual', 1);
            setManuallyScannedFields(prev => new Set(prev).add(selectedField));
            setLearnedScannedFields(prev => {
                const newSet = new Set(prev);
                newSet.delete(selectedField);
                return newSet;
            });
          } catch(err) {
            if (err instanceof GeminiOverloadError) {
              setGeminiOverload(true);
              setError(err.message);
            } else {
              console.error(err);
              setError(err instanceof Error ? err.message : 'Analysis failed');
            }
          }
        }
        setSelectedField(null);
        setSelectionBox(null);
        setMode('auto-scanning');
      }, 'image/jpeg', 0.9);
    }
  }, [selectedField, updateFieldValue]);

  const handleConfirmData = async () => {
    // For visual search mode, just capture the current frame
    if (captureMode === 'visual-search') {
      if (!videoRef.current || !captureCanvasRef.current) {
        setError('Camera not ready');
        return;
      }
      const video = videoRef.current;
      const canvas = captureCanvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('Failed to get canvas context');
        return;
      }
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) {
        const result: CameraScanResult = {
          data: {},
          blobs: new Map([['productName', blob]]), // Use productName as the key for the image
          fieldSources: new Map(),
          fieldConfidences: new Map(),
        };
        onDataScanned(result);
        onClose();
      } else {
        setError('Failed to capture image');
      }
      return;
    }
    
    // Normal scan mode
    onDataScanned({
      data: { ...scannedData },
      blobs: new Map(capturedBlobs),
      identifiedProductId: identifiedProduct?.productId,
      fieldSources: new Map(fieldSources),
      fieldConfidences: new Map(fieldConfidences),
    });
    onClose();
  };
  
  const getPrompt = () => {
      switch(mode) {
          case 'auto-scanning':
              if (identifiedProduct) {
                  return `Identified: ${identifiedProduct.productName}. Using learned fields to scan.`;
              }
              return 'Scanning automatically... Tap screen to select a field manually.';
          case 'selecting-field':
              return 'Select a field to capture manually.';
          case 'manual-capture':
              if (!selectedField) return 'Select a field.';
              if (!firstTapCorner) return `Tap the first corner for ${fieldMetadata[selectedField].displayName}.`;
              return `Tap the opposite corner.`;
          case 'analyzing':
                return `Analyzing ${fieldMetadata[selectedField!].displayName}...`
          default:
              return 'Ready to scan.';
      }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center" aria-modal="true">
      <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover"></video>
      <canvas ref={captureCanvasRef} className="hidden"></canvas>
      <canvas 
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full object-cover z-10 cursor-pointer"
        onClick={handleCanvasClick}
      />

      {mode === 'selecting-field' && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20 p-4">
          <h3 className="text-xl font-bold mb-6 text-white">Select a field to capture</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl">
            {(Object.keys(fieldMetadata) as Array<keyof typeof fieldMetadata>).map(key => (
              <button 
                key={key} 
                onClick={() => handleFieldSelect(key)}
                className="p-3 bg-gray-700 text-white rounded-lg hover:bg-cyan-600 transition-colors text-sm"
              >
                {fieldMetadata[key].displayName}
              </button>
            ))}
          </div>
          <button onClick={() => setMode('auto-scanning')} className="mt-8 bg-gray-600 px-6 py-2 rounded-lg hover:bg-gray-500 transition-colors">
            Cancel & Resume Auto-Scan
          </button>
        </div>
      )}

      {geminiOverload && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-600/95 text-white p-4 rounded-lg text-center z-30 max-w-md mx-auto shadow-2xl border-2 border-yellow-400">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg className="w-6 h-6 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <h3 className="text-lg font-bold">Gemini API Overloaded</h3>
          </div>
          <p className="text-sm mb-3">{error || 'Gemini API is currently overloaded. Please wait a moment and try again.'}</p>
          <button
            onClick={() => {
              setGeminiOverload(false);
              setError(null);
              // Resume auto-scanning
              if (mode === 'auto-scanning' && !autoScanIntervalRef.current) {
                autoScanIntervalRef.current = window.setInterval(performAutoScan, 4000);
              }
            }}
            className="px-4 py-2 bg-yellow-700 hover:bg-yellow-800 rounded-md text-sm font-semibold transition-colors"
          >
            Retry Now
          </button>
        </div>
      )}
      {error && !geminiOverload && (
        <div className="absolute top-4 bg-red-800/80 text-white p-3 rounded-lg text-center z-30 max-w-md mx-auto">{error}</div>
      )}

      <div className="absolute top-4 bg-black/50 text-white px-4 py-2 rounded-full z-20 text-center">
        <p>{getPrompt()}</p>
      </div>
      
      {mode === 'analyzing' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
        </div>
      )}

      <button onClick={onClose} className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80 transition-colors z-30" aria-label="Close scanner">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>

      <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-4 text-white rounded-t-lg shadow-2xl shadow-black z-20">
        {captureMode === 'visual-search' ? (
          <>
            <h3 className="text-lg font-bold text-cyan-400 mb-2">Visual Search</h3>
            <p className="text-sm text-gray-300 mb-4">Position the product in view and click "Capture & Search" to check if it's in inventory.</p>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-cyan-400 mb-2">Scanned Data</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm max-h-32 overflow-y-auto">
              {Object.keys(scannedData).length > 0 ? (
                Object.entries(scannedData).map(([key, value]) => {
                  const fieldKey = key as keyof typeof fieldMetadata;
                  const source = fieldSources.get(fieldKey as keyof ScannedItemData | 'productId');
                  return (
                    <div key={key} className="truncate flex items-center">
                      <span className="font-semibold capitalize text-gray-400">{fieldMetadata[fieldKey].displayName}: </span>
                      <span className="text-gray-100 ml-1">{String(value)}</span>
                      {source === 'manual' && <LockIcon className="w-3 h-3 ml-2 text-cyan-400 flex-shrink-0" />}
                      {source === 'learned' && <BrainCircuitIcon className="w-4 h-4 ml-2 text-indigo-400 flex-shrink-0" />}
                    </div>
                  )
                })
              ) : (
                <p className="col-span-full text-gray-500 text-center py-4">Data will appear here as it's scanned...</p>
              )}
            </div>
          </>
        )}
        <button 
          onClick={handleConfirmData} 
          disabled={(captureMode === 'scan' && Object.keys(scannedData).length === 0) || mode === 'analyzing'}
          className="mt-4 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black focus:ring-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
        >
          {captureMode === 'visual-search' ? 'Capture & Search' : 'Confirm & Use This Data'}
        </button>
      </div>
    </div>
  );
};

export default CameraCapture;
