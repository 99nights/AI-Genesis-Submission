import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ProductSummary } from '../types';
import { identifyProductNameFromImage } from '../services/geminiService';

interface KioskScannerProps {
  summaries: ProductSummary[];
  onProductScanned: (productName: string) => void;
  onClose: () => void;
}

type ScanStatus = 'SCANNING' | 'DETECTED' | 'NO_PRODUCT' | 'ERROR';

const KioskScanner: React.FC<KioskScannerProps> = ({ summaries, onProductScanned, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [status, setStatus] = useState<ScanStatus>('SCANNING');
  const [lastScannedProduct, setLastScannedProduct] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fix: Import 'useMemo' from 'react' to resolve 'Cannot find name 'useMemo''.
  const productNames = useMemo(() => summaries.map(s => s.productName), [summaries]);
  
  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
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

  const performScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || document.hidden) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      canvas.toBlob(async (blob) => {
        if (blob && scanIntervalRef.current) { // Check if still active
          try {
            const productName = await identifyProductNameFromImage(blob, productNames);
            if (productName) {
              setLastScannedProduct(productName);
              setStatus('DETECTED');
              onProductScanned(productName);
              // Pause scanning for a moment after detection
              stopScanner();
              setTimeout(() => {
                setStatus('SCANNING');
                setLastScannedProduct(null);
                scanIntervalRef.current = window.setInterval(performScan, 2000);
              }, 2500);
            } else {
               setStatus('NO_PRODUCT');
            }
          } catch (err) {
            console.warn("Scan failed:", err);
            setStatus('ERROR');
          }
        }
      }, 'image/jpeg', 0.8);
    }
  }, [productNames, onProductScanned, stopScanner]);

  useEffect(() => {
    const startCameraAndScanner = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        stopScanner();
        scanIntervalRef.current = window.setInterval(performScan, 2000);
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Could not access the camera. Please ensure permissions are granted.");
        setStatus('ERROR');
      }
    };

    startCameraAndScanner();

    return () => {
      stopScanner();
      stopCamera();
    };
  }, [performScan, stopScanner, stopCamera]);

  const getStatusUI = () => {
    switch(status) {
      case 'SCANNING':
        return { message: 'Point camera at a product', color: 'border-gray-500' };
      case 'DETECTED':
        return { message: `${lastScannedProduct} added to cart!`, color: 'border-green-500 animate-pulse-border' };
      case 'NO_PRODUCT':
         return { message: 'Searching for product...', color: 'border-yellow-500' };
      case 'ERROR':
        return { message: 'Scanner error. Please try again.', color: 'border-red-500' };
      default:
        return { message: '', color: 'border-transparent' };
    }
  };

  const { message, color } = getStatusUI();

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center" aria-modal="true">
        <style>{`
            @keyframes pulse-border {
                0%, 100% { box-shadow: 0 0 0 0 rgba(4, 120, 87, 0.7); }
                50% { box-shadow: 0 0 0 10px rgba(4, 120, 87, 0); }
            }
            .animate-pulse-border {
                animation: pulse-border 1.5s infinite;
            }
        `}</style>
      <div className={`relative w-full max-w-4xl aspect-video bg-black rounded-lg overflow-hidden border-4 ${color} transition-all`}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover"></video>
        <canvas ref={canvasRef} className="hidden"></canvas>
      </div>

      <div className="mt-4 text-center">
        <p className="text-white text-lg font-semibold">{message}</p>
        {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
      </div>

      <button onClick={() => {
        stopCamera();
        onClose();
      }} className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80 transition-colors z-30" aria-label="Close scanner">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>

      <button
        onClick={() => {
          stopCamera();
          onClose();
        }}
        className="mt-8 px-8 py-3 bg-cyan-600 text-white font-bold rounded-lg hover:bg-cyan-700 transition-colors shadow-lg"
      >
        Done Scanning
      </button>
    </div>
  );
};

export default KioskScanner;