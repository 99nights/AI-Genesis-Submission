import React, { useEffect, useState } from 'react';
import { ProductDefinition, ProductImage } from '../types';
import { createCanonicalProduct, updateCanonicalProduct, deleteCanonicalProduct, fetchCanonicalProducts, fetchSuppliersForActiveShop } from '../services/vectorDBService';
import { useToast } from './Toast';
import ProductLearningScanner from './ProductLearningScanner';
import { BrainCircuitIcon } from './icons/BrainCircuitIcon';
import { BookOpenIcon } from './icons/BookOpenIcon';

const ProductCatalogPage: React.FC = () => {
  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<ProductDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | undefined>(undefined);
  const [imageUrl, setImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterManufacturer, setFilterManufacturer] = useState<string>('');
  const [editingProduct, setEditingProduct] = useState<ProductDefinition | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [isLearningScannerOpen, setIsLearningScannerOpen] = useState(false);
  const { showToast } = useToast();

  const loadProducts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, supplierList] = await Promise.all([
        fetchCanonicalProducts(),
        fetchSuppliersForActiveShop(),
      ]);
      setProducts(list);
      setFilteredProducts(list);
      setSuppliers(supplierList.map(s => ({ id: s.id, name: s.name || s.id })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products.');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter products based on search and filters
  React.useEffect(() => {
    let filtered = products;

    // Search by name, manufacturer, category, or description
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.manufacturer.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query))
      );
    }

    // Filter by category
    if (filterCategory) {
      filtered = filtered.filter(p => p.category === filterCategory);
    }

    // Filter by manufacturer
    if (filterManufacturer) {
      filtered = filtered.filter(p => p.manufacturer === filterManufacturer);
    }

    setFilteredProducts(filtered);
  }, [products, searchQuery, filterCategory, filterManufacturer]);

  useEffect(() => {
    loadProducts();
  }, []);

  const handleProductLearned = () => {
    loadProducts();
    showToast('New product successfully learned and added to catalog!', 'success');
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const images: ProductImage[] = imageUrl
        ? [{ url: imageUrl.trim(), type: 'manual', source: 'user', addedAt: new Date().toISOString() }]
        : [];
      await createCanonicalProduct({
        name,
        manufacturer,
        category,
        description,
        defaultSupplierId: defaultSupplierId,
        images,
      });
      setName('');
      setManufacturer('');
      setCategory('');
      setDescription('');
      setImageUrl('');
      setDefaultSupplierId(undefined);
      await loadProducts();
      showToast('Product created successfully!', 'success');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create product.';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditProduct = (product: ProductDefinition) => {
    setEditingProduct(product);
    setName(product.name);
    setManufacturer(product.manufacturer);
    setCategory(product.category);
    setDescription(product.description || '');
    setImageUrl(product.images?.[0]?.url || '');
    setDefaultSupplierId(product.defaultSupplierId || undefined);
  };

  const handleCancelEdit = () => {
    setEditingProduct(null);
    setName('');
    setManufacturer('');
    setCategory('');
    setDescription('');
    setImageUrl('');
    setDefaultSupplierId(undefined);
    setError(null);
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !name.trim()) {
      setError('Name is required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const images: ProductImage[] = imageUrl
        ? [{ url: imageUrl.trim(), type: 'manual', source: 'user', addedAt: new Date().toISOString() }]
        : [];
      await updateCanonicalProduct(editingProduct.id, {
        name,
        manufacturer,
        category,
        description,
        defaultSupplierId: defaultSupplierId,
        images,
      });
      handleCancelEdit();
      await loadProducts();
      showToast('Product updated successfully!', 'success');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update product.';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    try {
      await deleteCanonicalProduct(productId);
      setShowDeleteConfirm(null);
      await loadProducts();
      showToast('Product deleted successfully!', 'success');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete product.';
      showToast(errorMsg, 'error');
    }
  };

  return (
    <>
      {isLearningScannerOpen && (
        <ProductLearningScanner
          onClose={() => setIsLearningScannerOpen(false)}
          onProductCreated={handleProductLearned}
        />
      )}

      <div className="space-y-6">
        {/* Header with Scan/Train Button */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-white">Product Catalog</h1>
            <button
              onClick={() => setIsLearningScannerOpen(true)}
              className="flex items-center justify-center gap-3 py-3 px-6 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all"
            >
              <BrainCircuitIcon className="w-6 h-6" />
              Scan & Train New Product
            </button>
          </div>
          <p className="text-gray-400 text-sm">
            Use the AI scanner to learn new products. The system will extract all relevant information sections 
            from the product image and learn where to look for specific data fields for future scans.
          </p>
        </div>

        {/* Manual Product Creation Form */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4">
            {editingProduct ? 'Edit Product' : 'Create Product Manually'}
          </h2>
          <form onSubmit={editingProduct ? handleUpdateProduct : handleCreateProduct} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Name</label>
              <input
                className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Manufacturer</label>
                <input
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Category</label>
                <input
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Description</label>
              <textarea
                className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Default Supplier</label>
                <select
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={defaultSupplierId || ''}
                  onChange={(e) => setDefaultSupplierId(e.target.value || undefined)}
                >
                  <option value="">None</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Image URL</label>
                <input
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-md bg-cyan-600 text-white font-semibold disabled:opacity-60 hover:bg-cyan-700 transition-colors"
              >
                {isSubmitting ? (editingProduct ? 'Updating...' : 'Creating...') : (editingProduct ? 'Update Product' : 'Create Product')}
              </button>
              {editingProduct && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-md bg-gray-700 text-white font-semibold disabled:opacity-60 hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        {/* Products List */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">All Products</h2>
            <button
              onClick={loadProducts}
              className="px-3 py-1.5 rounded-md bg-gray-700 text-sm text-white hover:bg-gray-600"
            >
              Refresh
            </button>
          </div>

          {/* Search and Filter Controls */}
          <div className="mb-6 space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Search Products</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                placeholder="Search by name, manufacturer, category, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Filter by Category</label>
                <select
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="">All Categories</option>
                  {Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort().map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Filter by Manufacturer</label>
                <select
                  className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white"
                  value={filterManufacturer}
                  onChange={(e) => setFilterManufacturer(e.target.value)}
                >
                  <option value="">All Manufacturers</option>
                  {Array.from(new Set(products.map(p => p.manufacturer).filter(Boolean))).sort().map(man => (
                    <option key={man} value={man}>{man}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {isLoading ? (
            <p className="text-gray-400">Loading products...</p>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <BookOpenIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">
                {products.length === 0 ? 'No products yet.' : 'No products match your filters.'}
              </p>
              {products.length === 0 && (
                <button
                  onClick={() => setIsLearningScannerOpen(true)}
                  className="mt-4 px-6 py-3 rounded-md bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Scan Your First Product
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Showing {filteredProducts.length} of {products.length} products
              </p>
              {filteredProducts.map(product => (
                <div key={product.id} className="p-4 bg-gray-900/40 rounded-lg border border-gray-700 hover:bg-gray-900/60 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-3">
                        {product.images && product.images[0] && (
                          <img
                            src={product.images[0].url}
                            alt={product.name}
                            className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-lg">{product.name}</p>
                          <p className="text-sm text-gray-400 mt-1">{product.manufacturer} · {product.category}</p>
                          {product.description && (
                            <p className="text-sm text-gray-400 mt-2 line-clamp-2">{product.description}</p>
                          )}
                          {product.defaultSupplierId && (
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <p className="text-xs text-gray-500 mb-1">Default Supplier:</p>
                              <span className="inline-block px-2 py-0.5 text-xs bg-blue-900/30 text-blue-300 rounded border border-blue-700/50">
                                {suppliers.find(s => s.id === product.defaultSupplierId)?.name || product.defaultSupplierId}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleEditProduct(product)}
                        className="px-3 py-1.5 rounded-md bg-blue-600/80 text-white text-sm hover:bg-blue-600 transition-colors"
                        title="Edit product"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(product.id)}
                        className="px-3 py-1.5 rounded-md bg-red-600/80 text-white text-sm hover:bg-red-600 transition-colors"
                        title="Delete product"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {showDeleteConfirm === product.id && (
                    <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-md">
                      <p className="text-red-300 text-sm mb-3">Are you sure you want to delete "{product.name}"?</p>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 transition-colors"
                        >
                          Yes, Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(null)}
                          className="px-3 py-1.5 rounded-md bg-gray-700 text-white text-sm hover:bg-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ProductCatalogPage;
