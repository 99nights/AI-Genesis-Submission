import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ProductDefinition } from '../types';
import { identifyProductNameFromImage } from '../services/geminiService';

interface CustomerProductScannerProps {
  products: ProductDefinition[];
  onClose: () => void;
  onMatch: (product: ProductDefinition | null) => void;
}

const CustomerProductScanner: React.FC<CustomerProductScannerProps> = ({ products, onClose, onMatch }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Align the product and tap capture to search.');

  const productMap = useMemo(() => new Map(products.map(p => [p.name, p])), [products]);
  const productNames = useMemo(() => products.map(p => p.name), [products]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setError('Unable to access camera. Please grant permission or try a different device.');
      }
    };
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || productNames.length === 0) {
      return;
    }
    setIsCapturing(true);
    setStatusMessage('Analyzing photo...');
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Camera unavailable');
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Failed to capture photo');
      const matchName = await identifyProductNameFromImage(blob, productNames);
      if (matchName) {
        const product = productMap.get(matchName) || null;
        setStatusMessage(product ? `Matched ${product.name}` : 'No matching product found.');
        stopCamera();
        onMatch(product);
        onClose();
      } else {
        setStatusMessage('No matching product found. Try again.');
        onMatch(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze photo.');
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" aria-modal="true">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 className="text-white text-lg font-semibold">Scan Product</h2>
          <button onClick={() => {
            stopCamera();
            onClose();
          }} className="text-gray-400 hover:text-white text-2xl leading-5" aria-label="Close scanner">&times;</button>
        </div>
        <div className="p-4 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-900/20 p-2 rounded">{error}</p>}
          <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <p className="text-sm text-gray-300">{statusMessage}</p>
          <button
            onClick={handleCapture}
            disabled={isCapturing}
            className="w-full py-3 rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-500 disabled:opacity-60"
          >
            {isCapturing ? 'Scanning...' : 'Capture & Search'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerProductScanner;
