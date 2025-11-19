import React, { useState, useRef, useCallback } from 'react';
import { StockItem, ProductSummary, SaleTransaction } from '../types';
import { 
  generateVisualInventoryInsights, 
  estimateStockFromShelfPhoto,
  assessProductQuality,
  searchInventoryByImage,
  verifyExpirationDates,
  StockEstimationResult,
  QualityAssessmentResult,
  VisualInsightsResult,
  ExpirationVerificationResult
} from '../services/geminiService';
import { getActiveShopId } from '../services/vectorDBService';
import { BrainIcon } from './icons/BrainIcon';
import { CameraIcon } from './icons/CameraIcon';
import { useToast } from './Toast';
import CameraCapture from './CameraCapture';

interface VisualInsightsPanelProps {
  inventoryData: StockItem[];
  salesHistory: SaleTransaction[];
  productCatalog: ProductSummary[];
}

type AnalysisMode = 'insights' | 'stock-estimation' | 'quality-assessment' | 'visual-search' | 'expiration-verify';

const VisualInsightsPanel: React.FC<VisualInsightsPanelProps> = ({ 
  inventoryData, 
  salesHistory,
  productCatalog 
}) => {
  const [mode, setMode] = useState<AnalysisMode>('insights');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<Blob[]>([]);
  const [results, setResults] = useState<any>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const { showToast } = useToast();

  const handleImageCaptured = useCallback((imageBlob: Blob) => {
    setSelectedImages([imageBlob]);
    setIsCapturing(false);
    setError(null);
    showToast('Image captured! Click "Analyze Images" to process.', 'success');
  }, [showToast]);

  const handleAnalyze = async () => {
    if (selectedImages.length === 0) {
      setError('Please capture at least one image.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      switch (mode) {
        case 'insights':
          // For insights, we can use multiple images if available, but typically one is enough
          const insights = await generateVisualInventoryInsights(
            selectedImages,
            inventoryData,
            salesHistory
          );
          setResults(insights);
          showToast('Visual insights generated successfully!', 'success');
          break;

        case 'stock-estimation':
          {
            const productName = prompt('Enter product name for stock estimation:') || 'Unknown Product';
            const capacity = prompt('Enter expected shelf capacity (optional):');
            const shopId = getActiveShopId();
            const stockResult = await estimateStockFromShelfPhoto(
              selectedImages[0],
              productName,
              capacity ? parseInt(capacity) : undefined,
              inventoryData, // Pass shop-scoped inventory data
              shopId || undefined, // Pass shop ID
              productCatalog // Pass product catalog for name-to-ID matching
            );
            setResults(stockResult);
            showToast('Stock estimation completed!', 'success');
          }
          break;

        case 'quality-assessment':
          const productNameForQuality = prompt('Enter product name:') || 'Unknown Product';
          const expectedExp = prompt('Enter expected expiration date (YYYY-MM-DD, optional):');
          const qualityResult = await assessProductQuality(
            selectedImages[0],
            productNameForQuality,
            expectedExp || undefined
          );
          setResults(qualityResult);
          showToast('Quality assessment completed!', 'success');
          break;

        case 'visual-search':
          {
            const shopId = getActiveShopId();
            if (!shopId) {
              setError('No active shop context. Please ensure you are logged in.');
              setIsLoading(false);
              return;
            }
            const searchResults = await searchInventoryByImage(selectedImages[0], shopId);
            setResults({ items: searchResults, count: searchResults.length });
            showToast(`Found ${searchResults.length} matching items!`, 'success');
          }
          break;

        case 'expiration-verify':
          // For expiration verification, we need product info for each image
          const verificationData = await Promise.all(
            selectedImages.map(async (image, index) => {
              const productName = prompt(`Enter product name for image ${index + 1}:`) || 'Unknown Product';
              const expectedExp = prompt(`Enter expected expiration (YYYY-MM-DD) for image ${index + 1}:`) || '';
              return { image, productName, expectedExpiration: expectedExp };
            })
          );
          const verifyResults = await verifyExpirationDates(verificationData);
          setResults({ verifications: verifyResults });
          showToast('Expiration verification completed!', 'success');
          break;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(errorMessage);
      showToast(`Error: ${errorMessage}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const renderResults = () => {
    if (!results) return null;

    switch (mode) {
      case 'insights':
        const insights = results as VisualInsightsResult;
        return (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Visual Insights</h3>
            {insights.insights.length > 0 && (
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <h4 className="text-cyan-400 font-medium mb-2">Key Insights</h4>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  {insights.insights.map((insight, idx) => (
                    <li key={idx}>{insight}</li>
                  ))}
                </ul>
              </div>
            )}
            {insights.riskItems.length > 0 && (
              <div className="bg-red-900/20 p-4 rounded-lg border border-red-700">
                <h4 className="text-red-400 font-medium mb-2">Risk Items</h4>
                <ul className="space-y-2">
                  {insights.riskItems.map((item, idx) => (
                    <li key={idx} className="text-sm text-gray-300">
                      <span className="font-semibold">{item.product}</span>: {item.issue}
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                        item.severity === 'high' ? 'bg-red-600' :
                        item.severity === 'medium' ? 'bg-yellow-600' : 'bg-gray-600'
                      }`}>
                        {item.severity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 'stock-estimation':
        const stock = results as StockEstimationResult;
        return (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Stock Estimation Results</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Estimated Quantity</p>
                <p className="text-2xl font-bold text-cyan-400">{stock.estimatedQuantity}</p>
              </div>
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Confidence</p>
                <p className="text-2xl font-bold text-cyan-400">{(stock.confidence * 100).toFixed(0)}%</p>
              </div>
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Visible Units</p>
                <p className="text-2xl font-bold text-white">{stock.visibleUnits}</p>
              </div>
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Shelf Fullness</p>
                <p className="text-2xl font-bold text-white">{stock.shelfFullness}%</p>
              </div>
            </div>
            <div className="bg-gray-900/50 p-4 rounded-lg">
              <h4 className="text-cyan-400 font-medium mb-2">Reasoning</h4>
              <p className="text-gray-300 text-sm">{stock.reasoning}</p>
            </div>
            <div className="bg-gray-900/50 p-4 rounded-lg">
              <h4 className="text-cyan-400 font-medium mb-2">Visual Analysis</h4>
              <p className="text-gray-300 text-sm">{stock.visualAnalysis}</p>
            </div>
          </div>
        );

      case 'quality-assessment':
        const quality = results as QualityAssessmentResult;
        const qualityColor = quality.qualityScore >= 80 ? 'text-green-400' :
                           quality.qualityScore >= 60 ? 'text-yellow-400' : 'text-red-400';
        return (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Quality Assessment</h3>
            <div className="bg-gray-900/50 p-4 rounded-lg">
              <p className="text-sm text-gray-400">Quality Score</p>
              <p className={`text-4xl font-bold ${qualityColor}`}>{quality.qualityScore}/100</p>
            </div>
            {quality.issues.length > 0 && (
              <div className="bg-red-900/20 p-4 rounded-lg border border-red-700">
                <h4 className="text-red-400 font-medium mb-2">Issues Found</h4>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  {quality.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {quality.recommendations.length > 0 && (
              <div className="bg-cyan-900/20 p-4 rounded-lg border border-cyan-700">
                <h4 className="text-cyan-400 font-medium mb-2">Recommendations</h4>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  {quality.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Packaging</p>
                <p className="text-lg font-semibold text-white capitalize">{quality.packagingIntegrity}</p>
              </div>
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Damage Detected</p>
                <p className={`text-lg font-semibold ${quality.damageDetected ? 'text-red-400' : 'text-green-400'}`}>
                  {quality.damageDetected ? 'Yes' : 'No'}
                </p>
              </div>
            </div>
            {quality.expirationDate && (
              <div className="bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm text-gray-400">Detected Expiration</p>
                <p className="text-lg font-semibold text-white">{quality.expirationDate}</p>
              </div>
            )}
          </div>
        );

      case 'visual-search':
        const search = results as { items: StockItem[]; count: number };
        return (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">
              Search Results ({search.count} items found)
            </h3>
            {search.items.length > 0 ? (
              <div className="space-y-2">
                {search.items.map((item, idx) => (
                  <div key={idx} className="bg-gray-900/50 p-4 rounded-lg">
                    <p className="font-semibold text-white">Product ID: {item.productId}</p>
                    <p className="text-sm text-gray-400">Quantity: {item.quantity} | Expiration: {item.expirationDate}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400">No matching items found in inventory.</p>
            )}
          </div>
        );

      case 'expiration-verify':
        const verify = results as { verifications: ExpirationVerificationResult[] };
        return (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Expiration Verification Results</h3>
            <div className="space-y-3">
              {verify.verifications.map((v, idx) => (
                <div 
                  key={idx} 
                  className={`p-4 rounded-lg border ${
                    v.match ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-white">{v.productName}</p>
                    <span className={`px-2 py-1 rounded text-xs ${
                      v.match ? 'bg-green-600' : 'bg-red-600'
                    }`}>
                      {v.match ? 'Match' : 'Mismatch'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-gray-400">Expected</p>
                      <p className="text-white">{v.expectedExpiration}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Detected</p>
                      <p className="text-white">{v.detectedExpiration || 'Not visible'}</p>
                    </div>
                  </div>
                  {v.discrepancy && (
                    <p className="text-red-400 text-sm mt-2">{v.discrepancy}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
      <h2 className="text-xl font-semibold mb-4 text-white flex items-center">
        <BrainIcon className="w-6 h-6 mr-2 text-cyan-400" />
        Multi-Modal AI Visual Analysis
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Use AI-powered visual analysis to gain insights from shelf photos, assess product quality, estimate stock levels, and more.
      </p>

      {/* Mode Selection */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(['insights', 'stock-estimation', 'quality-assessment', 'visual-search', 'expiration-verify'] as AnalysisMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setResults(null);
              setSelectedImages([]);
              setError(null);
              setIsCapturing(false);
            }}
            className={`px-3 py-2 rounded-md text-sm font-medium transition ${
              mode === m
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {m.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </button>
        ))}
      </div>

      {/* Live Capture */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Capture Image {mode === 'insights' || mode === 'expiration-verify' ? '(Can capture multiple)' : '(Single capture)'}
        </label>
        <button
          onClick={() => setIsCapturing(true)}
          disabled={isCapturing || isLoading}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-200 bg-gray-700/50 hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CameraIcon className="w-5 h-5" />
          {selectedImages.length > 0 
            ? `Re-capture Image (${selectedImages.length} captured)`
            : 'Capture Image with Camera'}
        </button>
        {selectedImages.length > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            {selectedImages.length} image(s) ready for analysis. Click "Analyze Images" to process.
          </p>
        )}
      </div>

      {/* Camera Capture Modal */}
      {isCapturing && (
        <CameraCapture
          mode="visual-search"
          productOptions={[]}
          onDataScanned={(result) => {
            // Extract the image blob from the result
            // CameraCapture in visual-search mode returns a blob with key 'productName'
            if (result.blobs && result.blobs.size > 0) {
              // Get the blob (visual-search mode uses 'productName' as the key)
              const imageBlob = result.blobs.get('productName') || Array.from(result.blobs.values())[0];
              if (imageBlob) {
                handleImageCaptured(imageBlob);
              } else {
                showToast('Failed to capture image. Please try again.', 'error');
                setIsCapturing(false);
              }
            } else {
              showToast('Failed to capture image. Please try again.', 'error');
              setIsCapturing(false);
            }
          }}
          onClose={() => setIsCapturing(false)}
        />
      )}

      {/* Analyze Button */}
      <button
        onClick={handleAnalyze}
        disabled={isLoading || selectedImages.length === 0}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
      >
        {isLoading ? 'Analyzing...' : 'Analyze Images'}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center my-4 p-4 bg-gray-900/50 rounded-lg">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          <p className="ml-3 text-cyan-400">AI is analyzing your images...</p>
        </div>
      )}

      {renderResults()}
    </div>
  );
};

export default VisualInsightsPanel;

