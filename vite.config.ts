import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // In production, use relative URLs since frontend and backend are on same server
    const isProduction = mode === 'production';
    const qdrantUrl = isProduction 
      ? '/qdrant' 
      : (env.QDRANT_URL || env.QDRANT_PROXY_URL || 'http://localhost:8787/qdrant');
    const qdrantProxyUrl = isProduction ? '' : (env.QDRANT_PROXY_URL || '');
    
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.QDRANT_URL': JSON.stringify(qdrantUrl),
        'process.env.QDRANT_PROXY_URL': JSON.stringify(qdrantProxyUrl),
        'process.env.QDRANT_COLLECTION': JSON.stringify(env.QDRANT_COLLECTION || 'product_visual_features'),
        'process.env.QDRANT_PRODUCTS_COLLECTION': JSON.stringify(env.QDRANT_PRODUCTS_COLLECTION || 'products'),
        'process.env.QDRANT_BATCHES_COLLECTION': JSON.stringify(env.QDRANT_BATCHES_COLLECTION || 'batches'),
        'process.env.QDRANT_STOCK_ITEMS_COLLECTION': JSON.stringify(env.QDRANT_STOCK_ITEMS_COLLECTION || 'stock_items'),
        'process.env.QDRANT_SALES_COLLECTION': JSON.stringify(env.QDRANT_SALES_COLLECTION || 'sales_transactions'),
        'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || ''),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
