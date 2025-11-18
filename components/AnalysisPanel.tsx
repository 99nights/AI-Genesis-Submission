
import React, { useState } from 'react';
import { InventoryItem, InventoryBatch } from '../types';
import { generateInventoryReport } from '../services/geminiService';
import { BrainIcon } from './icons/BrainIcon';

interface AnalysisPanelProps {
  items: InventoryItem[];
  batches: InventoryBatch[];
}

const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ items, batches }) => {
  const [prompt, setPrompt] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const examplePrompts = [
    "Which items expire in the next 30 days?",
    "What is the total value of my current inventory?",
    "Summarize stock levels by supplier.",
    "Identify my most expensive items per unit."
  ];

  const handleGenerateReport = async () => {
    if (!prompt) {
      setError("Please enter a query for the report.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setReport(null);
    try {
      const generatedReport = await generateInventoryReport(items, batches, prompt);
      setReport(generatedReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
      <h2 className="text-xl font-semibold mb-4 text-white flex items-center">
        <BrainIcon className="w-6 h-6 mr-2 text-cyan-400" />
        Advanced Inventory Analysis (Gemini Pro)
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Use our most powerful model to get deep insights into your inventory. Ask complex questions to make better business decisions.
      </p>

      <div className="mb-4">
          <label htmlFor="analysis-prompt" className="block text-sm font-medium text-gray-300 mb-2">
            Your Analysis Request
          </label>
          <textarea
            id="analysis-prompt"
            rows={3}
            className="block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm"
            placeholder="e.g., What is the total value of my current stock?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
      </div>

       <div className="mb-4 flex flex-wrap gap-2">
         <span className="text-sm text-gray-400 self-center">Try:</span>
         {examplePrompts.map((p) => (
          <button key={p} onClick={() => setPrompt(p)} className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded-md hover:bg-cyan-800 hover:text-white transition-colors">
            {p}
          </button>
        ))}
      </div>


      <button
        onClick={handleGenerateReport}
        disabled={isLoading || items.length === 0}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
      >
        {isLoading ? 'Thinking...' : 'Generate Report'}
      </button>

      {items.length === 0 && <p className="text-yellow-400 text-sm mt-2 text-center">Add items to inventory to enable analysis.</p>}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      
      {isLoading && (
         <div className="flex items-center justify-center my-4 p-4 bg-gray-900/50 rounded-lg">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
            <p className="ml-3 text-cyan-400">Gemini Pro is processing your request...</p>
        </div>
      )}

      {report && (
        <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-2">Analysis Report</h3>
          <div className="prose prose-invert prose-sm max-w-none text-gray-300" dangerouslySetInnerHTML={{ __html: report.replace(/\n/g, '<br />') }}>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisPanel;
