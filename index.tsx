
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './tailwind.js';

console.log('[index.tsx] Starting app initialization...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[index.tsx] Root element not found!');
  throw new Error("Could not find root element to mount to");
}

console.log('[index.tsx] Root element found, creating React root...');

const root = ReactDOM.createRoot(rootElement);

console.log('[index.tsx] Rendering App component...');

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

console.log('[index.tsx] App rendered successfully');
