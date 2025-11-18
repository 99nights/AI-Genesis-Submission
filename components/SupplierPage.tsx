import React, { useEffect, useState } from 'react';
import { SupplierProfile } from '../types';
import { fetchSuppliersForActiveShop, registerLocalSupplier } from '../services/vectorDBService';

interface SupplierPageProps {
  name: string;
}

const SupplierPage: React.FC<SupplierPageProps> = ({ name }) => {
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadSuppliers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchSuppliersForActiveShop();
      setSuppliers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) {
      setError('Supplier name is required.');
      return;
    }
    setError(null);
    try {
      await registerLocalSupplier({ name: newSupplierName.trim(), contactEmail: newSupplierEmail.trim() || undefined });
      setNewSupplierName('');
      setNewSupplierEmail('');
      await loadSuppliers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supplier.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <h1 className="text-3xl font-bold text-white mb-4">Supplier Console</h1>
        <p className="text-gray-300">
          Hello {name}! Manage your supplier network here. Register local suppliers (created by your shop) or review 
          existing ones (local or global suppliers linked to registered users).
        </p>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Register Local Supplier</h2>
        <form onSubmit={handleAddSupplier} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Supplier Name</label>
            <input
              className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Contact Email (optional)</label>
            <input
              type="email"
              className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
              value={newSupplierEmail}
              onChange={(e) => setNewSupplierEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-cyan-600 text-white font-semibold"
          >
            Add Supplier
          </button>
        </form>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Suppliers</h2>
          <button onClick={loadSuppliers} className="px-3 py-1.5 bg-gray-700 rounded-md text-sm text-white hover:bg-gray-600">
            Refresh
          </button>
        </div>
        {isLoading ? (
          <p className="text-gray-400">Loading suppliers...</p>
        ) : suppliers.length === 0 ? (
          <p className="text-gray-500">No suppliers yet. Add a local supplier above.</p>
        ) : (
          <div className="space-y-3">
            {suppliers.map((supplier) => (
              <div key={supplier.id} className="p-3 bg-gray-900/40 rounded-lg border border-gray-700 hover:bg-gray-900/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold">{supplier.name}</p>
                      {supplier.shopId ? (
                        <span className="text-xs bg-cyan-600/20 text-cyan-400 px-2 py-1 rounded">Local</span>
                      ) : supplier.linkedUserId ? (
                        <span className="text-xs bg-green-600/20 text-green-400 px-2 py-1 rounded">Global</span>
                      ) : null}
                    </div>
                    {supplier.contact && <p className="text-sm text-gray-400 mt-1">{supplier.contact}</p>}
                    {supplier.linkedUserId && (
                      <p className="text-xs text-gray-500 mt-1">Linked User ID: {supplier.linkedUserId}</p>
                    )}
                    {supplier.shopId && (
                      <p className="text-xs text-gray-500 mt-1">Shop ID: {supplier.shopId}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierPage;
