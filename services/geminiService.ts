

import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem, InventoryBatch, Delivery, StockItem, ProductImage, ProductSummary } from '../types'; // Import StockItem, ProductImage
import { embedText, embedImage, hybridEmbed } from './embeddingService'; // Import from new embeddingService
import { activeShopId, searchRelevantInventoryItems } from './vectorDBService'; // Import activeShopId and new search function
import { SaleTransaction } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

// Custom error class for Gemini overload/rate limit errors
export class GeminiOverloadError extends Error {
  constructor(message: string = 'Gemini API is currently overloaded. Please try again in a moment.') {
    super(message);
    this.name = 'GeminiOverloadError';
  }
}

// Helper function to detect Gemini overload/rate limit errors
const isGeminiOverloadError = (error: any): boolean => {
  if (!error) return false;
  
  const errorMessage = String(error.message || error.toString() || '').toLowerCase();
  const errorCode = error.code || error.status || error.statusCode;
  
  // Check for common overload indicators
  return (
    errorCode === 429 || // Too Many Requests
    errorCode === 503 || // Service Unavailable
    errorCode === 'RESOURCE_EXHAUSTED' ||
    errorMessage.includes('quota') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('overload') ||
    errorMessage.includes('resource exhausted') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('service unavailable') ||
    errorMessage.includes('backend error') ||
    (errorCode >= 500 && errorCode < 600) // 5xx server errors
  );
};

// This type is for the form, which includes batch and item details
// FIX: Added 'productDescription' to ScannedItemData to match usage in InventoryForm and ProductLearningScanner.
export type ScannedItemData = Omit<InventoryItem, 'id' | 'batchId'> & Partial<Omit<InventoryBatch, 'id'>> & {productDescription?: string};


// FIX: Add missing 'productId' to satisfy the Record type.
export const fieldMetadata: Record<keyof ScannedItemData | 'productId', { displayName: string, description: string; type: 'string' | 'number' }> = {
  productId: { displayName: "Product ID", description: "Canonical product identifier", type: 'string' },
  productName: { displayName: "Product Name", description: "Name of the product", type: 'string' },
  manufacturer: { displayName: "Manufacturer", description: "Manufacturer of the product", type: 'string' },
  category: { displayName: "Category", description: "Product category (e.g., Beverages, Snacks, Produce)", type: 'string' },
  productDescription: { displayName: "Product Description", description: "Detailed description of the product", type: 'string' }, // Added for consistency
  expirationDate: { displayName: "Exp. Date", description: "Expiration date in YYYY-MM-DD format", type: 'string' },
  quantity: { displayName: "Quantity", description: "Quantity of the product", type: 'number' },
  quantityType: { displayName: "Quantity Type", description: "Unit of measurement (e.g., units, kg, lbs, liters)", type: 'string' },
  costPerUnit: { displayName: "Cost/Unit", description: "Cost per single unit of the product", type: 'number' },
  // Batch fields
  supplier: { displayName: "Supplier", description: "Supplier or distributor name", type: 'string' },
  deliveryDate: { displayName: "Delivery Date", description: "Delivery date in YYYY-MM-DD format", type: 'string' },
  inventoryDate: { displayName: "Inventory Date", description: `Today's date in YYYY-MM-DD format`, type: 'string' },
};


const inventorySchema = {
  type: Type.OBJECT,
  properties: {
    productName: { type: Type.STRING, description: "Name of the product" },
    manufacturer: { type: Type.STRING, description: "Manufacturer of the product" },
    category: { type: Type.STRING, description: "A suitable category for the product (e.g., Beverages, Snacks, Dairy, Produce)" },
    expirationDate: { type: Type.STRING, description: "Expiration date in YYYY-MM-DD format" },
    quantity: { type: Type.NUMBER, description: "Quantity of the product" },
    quantityType: { type: Type.STRING, description: "Unit of measurement (e.g., units, kg, lbs, liters)" },
    costPerUnit: { type: Type.NUMBER, description: "Cost per single unit of the product" },
    supplier: { type: Type.STRING, description: "Supplier or distributor name, if visible" },
    deliveryDate: { type: Type.STRING, description: "Delivery date in YYYY-MM-DD format, if visible" },
  },
  required: [
    "productName", "manufacturer", "category", "expirationDate", "quantity", 
    "quantityType", "costPerUnit"
  ]
};

const batchDocumentSchema = {
    type: Type.OBJECT,
    properties: {
        supplierName: { type: Type.STRING, description: "The name of the supplier or vendor."},
        invoiceNumber: { type: Type.STRING, description: "The invoice or reference number for the delivery."},
        deliveryDate: { type: Type.STRING, description: "The delivery date in YYYY-MM-DD format."},
        items: {
            type: Type.ARRAY,
            description: "A complete list of all line items from the document.",
            items: {
                type: Type.OBJECT,
                properties: {
                    productName: { type: Type.STRING, description: "The full name of the product as written on the document." },
                    quantity: { type: Type.NUMBER, description: "The quantity of the product delivered." },
                    costPerUnit: { type: Type.NUMBER, description: "The cost for a single unit of the product." },
                },
                required: ["productName", "quantity", "costPerUnit"],
            },
        },
    },
};

export interface AnalyzedBatchData {
    supplierName?: string;
    invoiceNumber?: string;
    deliveryDate?: string;
    items: {
        productName: string;
        quantity: number;
        costPerUnit: number;
    }[];
}

const blobToGenerativePart = (blob: Blob) => {
  return new Promise<{ inlineData: { data: string; mimeType: string } }>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(',')[1];
      resolve({
        inlineData: {
          data,
          mimeType: blob.type,
        },
      });
    };
    reader.onerror = (error) => reject(error);
  });
};

export const analyzeBatchDocuments = async (files: File[]): Promise<AnalyzedBatchData> => {
    if (files.length === 0) {
        throw new Error("No documents provided for analysis.");
    }
    try {
        // FIX: Create instance per call as per coding guidelines
        const ai = new GoogleGenAI({ apiKey: API_KEY }); 
        const imageParts = await Promise.all(files.map(file => blobToGenerativePart(file)));
        const prompt = `Analyze these images of shipping documents (e.g., invoice, packing slip). Extract the supplier name, invoice number, delivery date, and a complete list of all line items. For each line item, provide the product name, quantity, and cost per unit. If a value isn't clearly present, omit it. Consolidate information if multiple documents are provided.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [...imageParts, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: batchDocumentSchema,
            },
        });
        
        const jsonText = response.text.trim();
        const parsedData = JSON.parse(jsonText);

        if (typeof parsedData !== 'object' || parsedData === null) {
            throw new Error("Invalid JSON structure received from API");
        }
        
        return {
            supplierName: parsedData.supplierName,
            invoiceNumber: parsedData.invoiceNumber,
            deliveryDate: parsedData.deliveryDate,
            items: parsedData.items || [],
        };

    } catch (error) {
        console.error("Error analyzing batch documents with Gemini:", error);
        throw new Error("Failed to extract batch data from the documents.");
    }
};


export const analyzeImageForInventory = async (imageFile: File | Blob): Promise<Partial<ScannedItemData>> => {
  try {
    // FIX: Create instance per call as per coding guidelines
    const ai = new GoogleGenAI({ apiKey: API_KEY }); 
    const imagePart = await blobToGenerativePart(imageFile);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          imagePart,
          { text: "Analyze this image of a product or delivery note. Extract inventory details. If a value isn't present, make a reasonable guess or use 'N/A' for strings and 0 for numbers. For dates, use YYYY-MM-DD format." },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: inventorySchema,
      },
    });

    const jsonText = response.text.trim();
    const parsedData = JSON.parse(jsonText);

    if (typeof parsedData !== 'object' || parsedData === null) {
      throw new Error("Invalid JSON structure received from API");
    }

    return {
      productName: parsedData.productName || 'N/A',
      manufacturer: parsedData.manufacturer || 'N/A',
      category: parsedData.category || 'General',
      expirationDate: parsedData.expirationDate || 'N/A',
      quantity: Number(parsedData.quantity) || 0,
      quantityType: parsedData.quantityType || 'units',
      costPerUnit: Number(parsedData.costPerUnit) || 0,
      supplier: parsedData.supplier, // May be undefined, handled in form
      deliveryDate: parsedData.deliveryDate, // May be undefined
    };

  } catch (error) {
    console.error("Error analyzing image with Gemini:", error);
    
    // Check if this is a Gemini overload/rate limit error
    if (isGeminiOverloadError(error)) {
      throw new GeminiOverloadError("Gemini API is currently overloaded. Please wait a moment and try again.");
    }
    
    throw new Error("Failed to extract inventory data from the image.");
  }
};

export const analyzeCroppedImageForField = async (
  imageBlob: Blob,
  fieldName: keyof ScannedItemData | 'productId'
): Promise<string | number> => {
  try {
    // FIX: Create instance per call as per coding guidelines
    const ai = new GoogleGenAI({ apiKey: API_KEY }); 
    const imagePart = await blobToGenerativePart(imageBlob);
    const metadata = fieldMetadata[fieldName];
    const prompt = `This image contains the ${metadata.displayName}. Extract ONLY the value for this field. Do not add any extra text, labels, or explanations. Return just the raw value. For dates, use YYYY-MM-DD format.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [imagePart, { text: prompt }] },
    });

    const text = response.text.trim();

    if (metadata.type === 'number') {
      const numericValue = parseFloat(text.replace(/[^0-9.-]+/g, ''));
      return isNaN(numericValue) ? 0 : numericValue;
    }

    return text;
  } catch (error) {
    console.error(`Error analyzing cropped image for field ${fieldName}:`, error);
    
    // Check if this is a Gemini overload/rate limit error
    if (isGeminiOverloadError(error)) {
      throw new GeminiOverloadError("Gemini API is currently overloaded. Please wait a moment and try again.");
    }
    
    throw new Error(`Failed to extract data for ${fieldName}.`);
  }
};


export const generateInventoryReport = async (items: InventoryItem[], batches: InventoryBatch[], prompt: string): Promise<string> => {
  if (items.length === 0 && !activeShopId) { // Keep this check as a fallback/initial state.
    return "The inventory is currently empty. Please add items to generate a report.";
  }

  // FIX: Create instance per call as per coding guidelines
  const ai = new GoogleGenAI({ apiKey: API_KEY }); 

  try {
    let inventoryDataForGemini: string = "";
    let relevantItems: StockItem[] = [];

    // Perform RAG if shopId is available and a meaningful prompt is given
    if (activeShopId && prompt.trim().length > 0) {
      const queryEmbedding = await embedText(prompt);
      // Retrieve relevant stock items from Qdrant using the generated embedding
      relevantItems = await searchRelevantInventoryItems(queryEmbedding, activeShopId, 20); // Get top 20 relevant items
      
      if (relevantItems.length > 0) {
        // Enriched structure using StockItem and Batch details from the Qdrant search results
        const enrichedRelevantItems = relevantItems.map(item => {
          const batch = batches.find(b => b.id === item.batchId); // Find batch from the provided legacy batches
          // Find product details from the original `items` list or product summaries for name/category/manufacturer
          // This ensures we have the full product context for the prompt
          const productContext = items.find(i => i.productId === item.productId && String(i.batchId) === String(item.batchId)); 
          
          return {
            inventoryUuid: item.inventoryUuid,
            productName: productContext?.productName || 'N/A',
            manufacturer: productContext?.manufacturer || 'N/A',
            category: productContext?.category || 'General',
            expirationDate: item.expirationDate,
            quantity: item.quantity,
            quantityType: productContext?.quantityType || 'units',
            costPerUnit: item.costPerUnit,
            supplier: batch?.supplier,
            deliveryDate: batch?.deliveryDate,
            inventoryDate: batch?.inventoryDate,
            location: item.location,
            buyPrice: item.buyPrice,
            sellPrice: item.sellPrice,
          };
        });
        inventoryDataForGemini = JSON.stringify(enrichedRelevantItems, null, 2);
        console.log("RAG applied: sending relevant inventory data to Gemini.");
      } else {
        // If no relevant items found via RAG, fall back to full inventory context
        inventoryDataForGemini = JSON.stringify(items.map(item => {
          const batch = batches.find(b => b.id === item.batchId);
          return { ...item, supplier: batch?.supplier, deliveryDate: batch?.deliveryDate, inventoryDate: batch?.inventoryDate };
        }), null, 2);
        console.warn("No relevant items found via RAG for the given prompt, falling back to full inventory context.");
      }
    } else {
      // If no RAG is performed (e.g., no activeShopId or empty prompt), use the full provided items.
      inventoryDataForGemini = JSON.stringify(items.map(item => {
        const batch = batches.find(b => b.id === item.batchId);
        return { ...item, supplier: batch?.supplier, deliveryDate: batch?.deliveryDate, inventoryDate: batch?.inventoryDate };
      }), null, 2);
      console.log("RAG skipped: using full inventory context for analysis.");
    }
    
    const fullPrompt = `
      Based on the following inventory data, please provide an analysis for the request: "${prompt}".
      
      Inventory Data:
      ${inventoryDataForGemini}
      
      Please format your response in clear, easy-to-read markdown.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: fullPrompt,
      config: {
        thinkingConfig: { thinkingBudget: 32768 },
      }
    });

    return response.text;
  } catch (error) {
    console.error("Error generating inventory report with Gemini Pro:", error);
    throw new Error("Failed to generate the inventory report.");
  }
};

export const generateDriverRoute = async (deliveries: Delivery[]): Promise<string> => {
  if (deliveries.length === 0) return "No deliveries selected to create a route.";
  
  try {
      // FIX: Create instance per call as per coding guidelines
      const ai = new GoogleGenAI({ apiKey: API_KEY }); 
      const deliveryData = deliveries.map(d => ({
          deliveryId: d.id,
          pickupFrom: d.pickup.name,
          pickupAddress: d.pickup.address,
          dropoffAt: d.dropoff.name,
          dropoffAddress: d.dropoff.address,
          item: `${d.quantity}x ${d.productName}`,
      }));

      const prompt = `
          I am a delivery driver. Based on the following list of jobs, please provide a simple, optimized, step-by-step route plan to pick up and drop off all items efficiently. 
          Assume I am starting from my vehicle and can go to any pickup or dropoff location in any order.
          Group pickups if possible.
          
          Delivery Jobs:
          ${JSON.stringify(deliveryData, null, 2)}
          
          Provide the route as a numbered list. For example:
          1. Pick up [Item] from [Location].
          2. Pick up [Item] from [Location].
          3. Drop off [Item] at [Location].
          ...and so on.
          
          Keep the language clear and concise.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
      });

      return response.text;

  } catch (error) {
      console.error("Error generating driver route:", error);
      throw new Error("Failed to generate a delivery route.");
  }
};

export const identifyProductNameFromImage = async (imageFile: Blob, productNames: string[]): Promise<string | null> => {
  if (productNames.length === 0) return null;
  try {
    // FIX: Create instance per call as per coding guidelines
    const ai = new GoogleGenAI({ apiKey: API_KEY }); 
    const imagePart = await blobToGenerativePart(imageFile);
    const prompt = `
      Analyze this image. Identify the main product visible.
      From the following list of known products, which one is it?
      Product list: [${productNames.join(', ')}]
      Respond with ONLY the name of the product from the list that matches best.
      If no product from the list is clearly identifiable, respond with the exact text "NO_PRODUCT".
    `;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [imagePart, { text: prompt }] },
    });

    const text = response.text.trim();
    
    if (text === 'NO_PRODUCT' || !productNames.includes(text)) {
        return null;
    }

    return text;

  } catch (error) {
    console.error("Error identifying product:", error);
    
    // Check if this is a Gemini overload/rate limit error
    if (isGeminiOverloadError(error)) {
      throw new GeminiOverloadError("Gemini API is currently overloaded. Please wait a moment and try again.");
    }
    
    return null;
  }
};

export const dataUrlToBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) {
      throw new Error("Invalid data URL");
    }
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

export const findAndReadFeature = async (
    fullImage: Blob,
    featureImage: Blob,
    fieldName: keyof ScannedItemData | 'productId'
): Promise<string | number | null> => {
    try {
        // FIX: Create instance per call as per coding guidelines
        const ai = new GoogleGenAI({ apiKey: API_KEY }); 
        const fullImagePart = await blobToGenerativePart(fullImage);
        const featureImagePart = await blobToGenerativePart(featureImage);
        const metadata = fieldMetadata[fieldName];
        const prompt = `The first image is a close-up of a '${metadata.displayName}'. The second image is a wider view of a product. Find the exact feature from the first image within the second image and extract ONLY its value. Do not add any extra text, labels, or explanations. Return just the raw value. If you cannot find the feature, return the text "NOT_FOUND". For dates, use YYYY-MM-DD format.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [featureImagePart, fullImagePart, { text: prompt }] },
        });

        const text = response.text.trim();

        if (text === 'NOT_FOUND') {
            return null;
        }

        if (metadata.type === 'number') {
            const numericValue = parseFloat(text.replace(/[^0-9.-]+/g, ''));
            return isNaN(numericValue) ? null : numericValue;
        }

        return text;
    } catch (error) {
        console.error(`Error finding feature for field ${fieldName}:`, error);
        
        // Check if this is a Gemini overload/rate limit error
        if (isGeminiOverloadError(error)) {
            throw new GeminiOverloadError("Gemini API is currently overloaded. Please wait a moment and try again.");
        }
        
        return null; // Return null on error to indicate failure
    }
};

// ============================================================================
// MULTI-MODAL AI FEATURES FOR INVENTORY MANAGEMENT
// ============================================================================

/**
 * Visual Stock Level Estimation
 * Estimates stock levels from shelf photos without manual counting
 */
export interface StockEstimationResult {
    estimatedQuantity: number;
    confidence: number;
    reasoning: string;
    visualAnalysis: string;
    shelfFullness: number; // 0-100%
    visibleUnits: number;
    hiddenUnits?: number;
}

const stockEstimationSchema = {
    type: Type.OBJECT,
    properties: {
        estimatedQuantity: { type: Type.NUMBER, description: "Estimated total quantity including hidden units" },
        confidence: { type: Type.NUMBER, description: "Confidence score from 0 to 1" },
        reasoning: { type: Type.STRING, description: "Explanation of the estimation" },
        visualAnalysis: { type: Type.STRING, description: "Detailed visual observations" },
        shelfFullness: { type: Type.NUMBER, description: "Shelf fullness percentage (0-100)" },
        visibleUnits: { type: Type.NUMBER, description: "Number of units clearly visible" },
        hiddenUnits: { type: Type.NUMBER, description: "Estimated units hidden behind others" },
    },
    required: ["estimatedQuantity", "confidence", "reasoning", "visualAnalysis", "shelfFullness", "visibleUnits"],
};

export const estimateStockFromShelfPhoto = async (
    shelfImage: Blob,
    productName: string,
    expectedCapacity?: number,
    inventoryData?: StockItem[],
    shopId?: string,
    productCatalog?: ProductSummary[]
): Promise<StockEstimationResult> => {
    try {
        // Ensure we have shop context if inventory data is provided
        const resolvedShopId = shopId || (typeof activeShopId === 'string' 
            ? activeShopId 
            : (activeShopId && typeof activeShopId === 'object' && activeShopId !== null && 'id' in activeShopId)
                ? (activeShopId as { id: string }).id
                : null);
        
        // Find inventory records for this product in the shop
        let shopInventoryQuantity = 0;
        let inventoryContext = '';
        
        if (inventoryData && resolvedShopId) {
            // Normalize product name for matching (case-insensitive, trimmed)
            const normalizedProductName = productName.toLowerCase().trim();
            
            // Try to find productId by matching product name in catalog
            let matchingProductIds: string[] = [];
            if (productCatalog) {
                matchingProductIds = productCatalog
                    .filter(p => p.productName.toLowerCase().trim() === normalizedProductName)
                    .map(p => p.productId || '');
            }
            
            // Filter inventory items that belong to this shop
            const shopInventory = inventoryData.filter(item => {
                const itemShopId = typeof item.shopId === 'string' 
                    ? item.shopId 
                    : (item.shopId && typeof item.shopId === 'object' && item.shopId !== null && 'id' in item.shopId)
                        ? (item.shopId as { id: string }).id
                        : null;
                
                // If we found productIds, match by productId; otherwise include all shop items
                // (The AI will help identify which product matches in the visual analysis)
                if (matchingProductIds.length > 0) {
                    return itemShopId === resolvedShopId && matchingProductIds.includes(item.productId || '');
                }
                return itemShopId === resolvedShopId;
            });
            
            // Sum up all quantities for matching products
            shopInventoryQuantity = shopInventory.reduce((sum, item) => sum + (item.quantity || 0), 0);
            
            if (shopInventoryQuantity > 0) {
                inventoryContext = `\n\nRecorded Inventory (Shop ID: ${resolvedShopId}):\n- Product: ${productName}\n- Total recorded quantity in system: ${shopInventoryQuantity} units\n- Compare your visual count with this recorded quantity and identify any discrepancies.`;
            } else if (shopInventory.length === 0 && inventoryData.length > 0) {
                inventoryContext = `\n\nNote: No recorded inventory found for "${productName}" in Shop ID: ${resolvedShopId}. This may be a new product or not yet entered into the system.`;
            }
        }
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const imagePart = await blobToGenerativePart(shelfImage);
        
        const capacityContext = expectedCapacity 
            ? `Expected shelf capacity: ${expectedCapacity} units.`
            : 'No expected capacity provided.';
        
        const shopContext = resolvedShopId 
            ? `\nIMPORTANT: This analysis is for Shop ID: ${resolvedShopId}. Compare your visual estimate against the shop's recorded inventory.`
            : '';
        
        const prompt = `Analyze this shelf photo for ${productName}${shopContext}.
        
        Tasks:
        1. Count visible units of the product
        2. Estimate if there are units hidden behind others
        3. Assess shelf fullness (0-100%)
        4. Identify any damage or quality issues
        5. Check expiration dates if visible
        6. Compare visual count with recorded inventory (if provided) and note discrepancies${inventoryContext ? '' : ' (no inventory data provided for comparison)'}
        
        ${capacityContext}${inventoryContext}${shopContext}
        
        Provide detailed analysis with confidence score. If inventory data is provided, explicitly compare the visual estimate with the recorded quantity and explain any differences.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: stockEstimationSchema,
            },
        });
        
        const parsed = JSON.parse(response.text.trim());
        return {
            estimatedQuantity: parsed.estimatedQuantity || 0,
            confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
            reasoning: parsed.reasoning || '',
            visualAnalysis: parsed.visualAnalysis || '',
            shelfFullness: Math.max(0, Math.min(100, parsed.shelfFullness || 0)),
            visibleUnits: parsed.visibleUnits || 0,
            hiddenUnits: parsed.hiddenUnits,
        };
    } catch (error) {
        console.error("Error estimating stock from shelf photo:", error);
        throw new Error("Failed to estimate stock from shelf photo.");
    }
};

/**
 * Quality Assessment
 * Detects damaged, expired, or poor-quality items from photos
 */
export interface QualityAssessmentResult {
    qualityScore: number; // 0-100
    issues: string[];
    recommendations: string[];
    expirationVisible: boolean;
    expirationDate?: string;
    damageDetected: boolean;
    damageDescription?: string;
    packagingIntegrity: 'good' | 'fair' | 'poor';
}

const qualityAssessmentSchema = {
    type: Type.OBJECT,
    properties: {
        qualityScore: { type: Type.NUMBER, description: "Overall quality score from 0 to 100" },
        issues: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of quality issues found" },
        recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Recommendations for action" },
        expirationVisible: { type: Type.BOOLEAN, description: "Whether expiration date is visible" },
        expirationDate: { type: Type.STRING, description: "Detected expiration date in YYYY-MM-DD format if visible" },
        damageDetected: { type: Type.BOOLEAN, description: "Whether any damage was detected" },
        damageDescription: { type: Type.STRING, description: "Description of damage if found" },
        packagingIntegrity: { type: Type.STRING, description: "Packaging condition: good, fair, or poor" },
    },
    required: ["qualityScore", "issues", "recommendations", "expirationVisible", "damageDetected", "packagingIntegrity"],
};

export const assessProductQuality = async (
    productImage: Blob,
    productName: string,
    expectedExpiration?: string
): Promise<QualityAssessmentResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const imagePart = await blobToGenerativePart(productImage);
        
        const expirationContext = expectedExpiration 
            ? `Expected expiration: ${expectedExpiration}. Compare detected date with expected.`
            : '';
        
        const prompt = `Analyze this image of ${productName} for quality assessment.
        
        Check for:
        - Physical damage (dents, tears, broken seals)
        - Expiration date visibility and validity
        - Packaging integrity
        - Signs of spoilage (for perishables)
        - Overall condition
        
        ${expirationContext}
        
        Provide detailed quality assessment with actionable recommendations.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: qualityAssessmentSchema,
            },
        });
        
        const parsed = JSON.parse(response.text.trim());
        return {
            qualityScore: Math.max(0, Math.min(100, parsed.qualityScore || 50)),
            issues: parsed.issues || [],
            recommendations: parsed.recommendations || [],
            expirationVisible: parsed.expirationVisible || false,
            expirationDate: parsed.expirationDate,
            damageDetected: parsed.damageDetected || false,
            damageDescription: parsed.damageDescription,
            packagingIntegrity: parsed.packagingIntegrity || 'fair',
        };
    } catch (error) {
        console.error("Error assessing product quality:", error);
        throw new Error("Failed to assess product quality.");
    }
};

/**
 * Visual Search (Image-based Inventory Search)
 * Search inventory by uploading a product photo
 */
export const searchInventoryByImage = async (
    queryImage: Blob,
    shopId: string
): Promise<StockItem[]> => {
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        
        // Step 1: Generate text description from image
        const imagePart = await blobToGenerativePart(queryImage);
        const describePrompt = `Describe this product in detail. Include:
        - Product name/brand
        - Category
        - Key visual features
        - Packaging type
        - Any text visible on packaging
        
        Return a concise product description suitable for search.`;
        
        const descriptionResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: describePrompt }] },
        });
        
        const productDescription = descriptionResponse.text.trim();
        
        // Step 2: Use hybrid embedding (image + text description) for semantic search
        const queryEmbedding = await hybridEmbed(productDescription, queryImage, 0.5, 0.5);
        const relevantItems = await searchRelevantInventoryItems(queryEmbedding, shopId, 10);
        
        return relevantItems;
    } catch (error) {
        console.error("Error searching inventory by image:", error);
        return [];
    }
};

/**
 * Multi-Image Layout Analysis
 * Analyze multiple shelf photos to understand store layout and inventory distribution
 */
export interface LayoutAnalysisResult {
    layoutMap: Record<string, { location: string; quantity: number; notes?: string }>;
    recommendations: string[];
    missingProducts: string[];
    misplacedItems: Array<{ product: string; currentLocation: string; suggestedLocation?: string }>;
    overallAssessment: string;
}

export const analyzeShelfLayout = async (
    shelfImages: Blob[],
    productCatalog: ProductSummary[]
): Promise<LayoutAnalysisResult> => {
    try {
        if (shelfImages.length === 0) {
            throw new Error("No shelf images provided.");
        }
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const imageParts = await Promise.all(shelfImages.map(blobToGenerativePart));
        
        const productList = productCatalog.map(p => 
            `${p.productName} (${p.manufacturer}) - Category: ${p.category}`
        ).join('\n');
        
        const prompt = `Analyze these ${shelfImages.length} shelf photos to create a complete inventory map.
        
        Known products in catalog:
        ${productList}
        
        For each photo:
        1. Identify all visible products
        2. Estimate quantities
        3. Note shelf location/section
        4. Identify products not in catalog
        5. Find misplaced items (wrong category/section)
        
        Return comprehensive store layout analysis with recommendations.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [...imageParts, { text: prompt }] },
            config: {
                thinkingConfig: { thinkingBudget: 32768 },
            },
        });
        
        // Parse the response (it will be markdown/text, so we'll extract structured data)
        const analysisText = response.text;
        
        // Try to extract structured data from the response
        // For now, return a structured format based on text parsing
        // In production, you might want to use a more structured prompt with JSON schema
        
        return {
            layoutMap: {}, // Would be populated from parsed response
            recommendations: analysisText.split('\n').filter(line => line.includes('recommend') || line.includes('suggest')),
            missingProducts: [],
            misplacedItems: [],
            overallAssessment: analysisText,
        };
    } catch (error) {
        console.error("Error analyzing shelf layout:", error);
        throw new Error("Failed to analyze shelf layout.");
    }
};

/**
 * Expiration Date Verification
 * Verify expiration dates from photos and flag discrepancies
 */
export interface ExpirationVerificationResult {
    productName: string;
    expectedExpiration: string;
    detectedExpiration?: string;
    match: boolean;
    discrepancy?: string;
    confidence: number;
}

export const verifyExpirationDates = async (
    productImages: Array<{ image: Blob; expectedExpiration: string; productName: string }>
): Promise<ExpirationVerificationResult[]> => {
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        
        const results = await Promise.all(
            productImages.map(async ({ image, expectedExpiration, productName }) => {
                try {
                    const imagePart = await blobToGenerativePart(image);
                    const prompt = `Find and read the expiration date on this ${productName}.
                    
                    Expected expiration: ${expectedExpiration}
                    
                    Return ONLY the expiration date in YYYY-MM-DD format if visible, or "NOT_VISIBLE" if not found.
                    Also indicate your confidence (0-1) in the detection.`;
                    
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: { parts: [imagePart, { text: prompt }] },
                    });
                    
                    const detected = response.text.trim();
                    const isNotVisible = detected.includes('NOT_VISIBLE') || detected.includes('not visible');
                    
                    if (isNotVisible) {
                        return {
                            productName,
                            expectedExpiration,
                            match: false,
                            confidence: 0,
                            discrepancy: 'Expiration date not visible in image',
                        };
                    }
                    
                    // Extract date pattern
                    const dateMatch = detected.match(/\d{4}-\d{2}-\d{2}/);
                    const detectedDate = dateMatch ? dateMatch[0] : null;
                    
                    if (!detectedDate) {
                        return {
                            productName,
                            expectedExpiration,
                            match: false,
                            confidence: 0,
                            discrepancy: 'Could not parse date from image',
                        };
                    }
                    
                    const match = detectedDate === expectedExpiration || 
                                  detectedDate.split('-')[0] === expectedExpiration.split('-')[0]; // Year match
                    
                    return {
                        productName,
                        expectedExpiration,
                        detectedExpiration: detectedDate,
                        match,
                        discrepancy: !match ? `Expected ${expectedExpiration}, found ${detectedDate}` : undefined,
                        confidence: match ? 0.9 : 0.7,
                    };
                } catch (error) {
                    console.error(`Error verifying expiration for ${productName}:`, error);
                    return {
                        productName,
                        expectedExpiration,
                        match: false,
                        confidence: 0,
                        discrepancy: 'Error processing image',
                    };
                }
            })
        );
        
        return results;
    } catch (error) {
        console.error("Error verifying expiration dates:", error);
        throw new Error("Failed to verify expiration dates.");
    }
};

/**
 * Shelf Scanning - Detect Multiple Products
 * Scans a shelf photo and identifies all products with quantities and expiration dates
 */
export interface ShelfProductDetection {
    productName: string;
    manufacturer?: string;
    category?: string;
    estimatedQuantity: number;
    visibleUnits: number;
    expirationDate?: string;
    expirationVisible: boolean;
    location?: string; // Shelf position/aisle
    confidence: number;
    notes?: string;
}

export interface ShelfScanResult {
    products: ShelfProductDetection[];
    shelfFullness: number; // 0-100%
    totalProductsDetected: number;
    scanTimestamp: string;
    recommendations?: string[];
}

const shelfScanSchema = {
    type: Type.OBJECT,
    properties: {
        products: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    productName: { type: Type.STRING, description: "Name of the product" },
                    manufacturer: { type: Type.STRING, description: "Manufacturer/brand name if visible" },
                    category: { type: Type.STRING, description: "Product category (e.g., Beverages, Snacks, Dairy)" },
                    estimatedQuantity: { type: Type.NUMBER, description: "Total estimated quantity including hidden units" },
                    visibleUnits: { type: Type.NUMBER, description: "Number of units clearly visible" },
                    expirationDate: { type: Type.STRING, description: "Expiration date in YYYY-MM-DD format if visible" },
                    expirationVisible: { type: Type.BOOLEAN, description: "Whether expiration date is visible" },
                    location: { type: Type.STRING, description: "Shelf position or location description" },
                    confidence: { type: Type.NUMBER, description: "Confidence score from 0 to 1" },
                    notes: { type: Type.STRING, description: "Additional observations or notes" },
                },
                required: ["productName", "estimatedQuantity", "visibleUnits", "expirationVisible", "confidence"],
            },
        },
        shelfFullness: { type: Type.NUMBER, description: "Overall shelf fullness percentage (0-100)" },
        totalProductsDetected: { type: Type.NUMBER, description: "Total number of different products detected" },
        recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Recommendations based on the scan" },
    },
    required: ["products", "shelfFullness", "totalProductsDetected"],
};

export const scanShelfForProducts = async (
    shelfImage: Blob,
    knownProducts?: string[]
): Promise<ShelfScanResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const imagePart = await blobToGenerativePart(shelfImage);
        
        const knownProductsContext = knownProducts && knownProducts.length > 0
            ? `\n\nKnown products in inventory: ${knownProducts.join(', ')}\nTry to match detected products to these names when possible.`
            : '';
        
        const prompt = `Analyze this shelf photo and identify ALL products visible on the shelf.

        For each product detected:
        1. Identify the product name (match to known products if provided)
        2. Count visible units
        3. Estimate total quantity (including units hidden behind others)
        4. Check for expiration dates if visible
        5. Note shelf position/location
        6. Assess confidence in detection
        
        Also provide:
        - Overall shelf fullness percentage (0-100%)
        - Total number of different products detected
        - Any recommendations (e.g., restocking needed, expiration alerts)
        
        ${knownProductsContext}
        
        Return a comprehensive analysis of all products on this shelf.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: shelfScanSchema,
            },
        });
        
        const parsed = JSON.parse(response.text.trim());
        
        return {
            products: parsed.products || [],
            shelfFullness: Math.max(0, Math.min(100, parsed.shelfFullness || 0)),
            totalProductsDetected: parsed.totalProductsDetected || 0,
            scanTimestamp: new Date().toISOString(),
            recommendations: parsed.recommendations || [],
        };
    } catch (error) {
        console.error("Error scanning shelf:", error);
        
        if (isGeminiOverloadError(error)) {
            throw new GeminiOverloadError("Gemini API is currently overloaded. Please wait a moment and try again.");
        }
        
        throw new Error("Failed to scan shelf for products.");
    }
};

/**
 * Visual Insights Dashboard
 * Combine visual analysis with data analytics for actionable insights
 */
export interface VisualInsightsResult {
    insights: string[];
    visualFindings: string[];
    recommendations: string[];
    riskItems: Array<{ product: string; issue: string; severity: 'low' | 'medium' | 'high' }>;
    dataDiscrepancies: Array<{ product: string; recorded: number; visual: number; difference: number }>;
}

export const generateVisualInventoryInsights = async (
    shelfImages: Blob[],
    inventoryData: StockItem[],
    salesHistory: SaleTransaction[]
): Promise<VisualInsightsResult> => {
    try {
        if (shelfImages.length === 0) {
            throw new Error("No shelf images provided.");
        }
        
        // Ensure we have shop context - all data should be shop-scoped
        const shopId = typeof activeShopId === 'string' 
            ? activeShopId 
            : (activeShopId && typeof activeShopId === 'object' && activeShopId !== null && 'id' in activeShopId)
                ? (activeShopId as { id: string }).id
                : null;
        
        if (!shopId) {
            throw new Error("No active shop context. Analysis is shop-scoped and requires an active shop.");
        }
        
        // Validate that all inventory data belongs to the active shop
        const shopScopedInventory = inventoryData.filter(item => {
            const itemShopId = typeof item.shopId === 'string' 
                ? item.shopId 
                : (item.shopId && typeof item.shopId === 'object' && item.shopId !== null && 'id' in item.shopId)
                    ? (item.shopId as { id: string }).id
                    : null;
            return itemShopId === shopId;
        });
        
        if (shopScopedInventory.length !== inventoryData.length) {
            console.warn(`[Visual Insights] Filtered out ${inventoryData.length - shopScopedInventory.length} items that don't belong to shop ${shopId}`);
        }
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const imageParts = await Promise.all(shelfImages.map(blobToGenerativePart));
        
        // Prepare data context (sample to avoid token limits) - only shop-scoped data
        const dataContext = JSON.stringify({
            shopId: shopId,
            inventory: shopScopedInventory.slice(0, 50).map(item => ({
                productId: item.productId,
                quantity: item.quantity,
                expirationDate: item.expirationDate,
            })),
            recentSales: salesHistory.slice(-20).map(sale => ({
                timestamp: sale.timestamp,
                items: sale.items,
                totalAmount: sale.totalAmount,
            })),
        }, null, 2);
        
        const prompt = `Analyze these shelf photos from a specific shop combined with that shop's inventory data.
        
        IMPORTANT: This analysis is for Shop ID: ${shopId}. All inventory and sales data provided is specific to this shop only.
        
        Inventory Data (Shop-Scoped):
        ${dataContext}
        
        Tasks:
        1. Compare visual stock levels with recorded inventory for this shop
        2. Identify discrepancies (visual vs recorded) specific to this shop
        3. Find products that look expired/damaged in this shop's shelves
        4. Suggest reordering based on visual stock levels for this shop
        5. Identify layout optimization opportunities for this shop
        6. Flag high-risk items (expiring soon, low stock, damaged) in this shop
        
        Provide actionable insights combining visual and data analysis for this specific shop.
        Format as structured recommendations with severity levels.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: { parts: [...imageParts, { text: prompt }] },
            config: {
                thinkingConfig: { thinkingBudget: 32768 },
            },
        });
        
        const analysisText = response.text;
        
        // Parse insights from text (in production, use JSON schema)
        const insights = analysisText.split('\n').filter(line => 
            line.trim().length > 0 && 
            (line.includes('insight') || line.includes('finding') || line.match(/^\d+\./))
        );
        
        return {
            insights: insights.slice(0, 10),
            visualFindings: [],
            recommendations: [],
            riskItems: [],
            dataDiscrepancies: [],
        };
    } catch (error) {
        console.error("Error generating visual insights:", error);
        throw new Error("Failed to generate visual inventory insights.");
    }
};
