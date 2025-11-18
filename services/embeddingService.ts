import { GoogleGenAI } from "@google/genai";

export const TEXT_EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_VECTOR_SIZE = 768; // Standard size for text-embedding-004

// Helper to convert blob to inline data
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

export const embedText = async (text: string): Promise<number[]> => {
  if (!text || text.trim() === '') {
    return new Array(EMBEDDING_VECTOR_SIZE).fill(0); // Return zero vector for empty input
  }
  try {
    // FIX: Create instance per call as per coding guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); 
    const result = await ai.models.embedContent({
      model: TEXT_EMBEDDING_MODEL,
      // FIX: Changed 'content' to 'contents' as per Gemini API guidelines.
      contents: [{ parts: [{ text }] }],
    });
    // FIX: Changed 'embedding' to 'embeddings' and accessed the first item.
    if (result.embeddings?.[0]?.values) {
      return result.embeddings[0].values;
    }
    throw new Error('No embedding values returned from embedding service.');
  } catch (error) {
    console.error("Error generating embedding:", error);
    return new Array(EMBEDDING_VECTOR_SIZE).fill(0);
  }
};

/**
 * Generate embedding from an image for visual search
 * Uses text-embedding-004 which supports multimodal inputs
 */
export const embedImage = async (imageBlob: Blob): Promise<number[]> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const imagePart = await blobToGenerativePart(imageBlob);
    
    // text-embedding-004 supports multimodal (text + image) embeddings
    const result = await ai.models.embedContent({
      model: TEXT_EMBEDDING_MODEL,
      contents: [{ parts: [imagePart] }],
    });
    
    if (result.embeddings?.[0]?.values) {
      return result.embeddings[0].values;
    }
    throw new Error('No embedding values returned from image embedding service.');
  } catch (error) {
    console.error("Error generating image embedding:", error);
    return new Array(EMBEDDING_VECTOR_SIZE).fill(0);
  }
};

/**
 * Hybrid search: combine text and image embeddings
 * Returns a weighted combination for better search results
 */
export const hybridEmbed = async (
  textQuery: string,
  imageQuery?: Blob,
  textWeight: number = 0.7,
  imageWeight: number = 0.3
): Promise<number[]> => {
  const textEmbedding = await embedText(textQuery);
  
  if (!imageQuery) {
    return textEmbedding;
  }
  
  const imageEmbedding = await embedImage(imageQuery);
  
  // Weighted combination
  return textEmbedding.map((v, i) => 
    (v * textWeight) + (imageEmbedding[i] * imageWeight)
  );
};
