
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ProductSummary, StockItem, SaleTransaction } from '../types';
import { ValueIcon } from './icons/ValueIcon';
import { ItemsIcon } from './icons/ItemsIcon';
import { ExpirationIcon } from './icons/ExpirationIcon';
import { useToast } from './Toast';
import { createCanonicalProduct, registerLocalSupplier, createBatchForShop, addInventoryBatch, getAllStockItems } from '../services/vectorDBService';
import { getAllSales } from '../services/qdrant/services/sales';
import { ProductImage, BatchLineItem } from '../types';
import VisualInsightsPanel from './VisualInsightsPanel';

interface DashboardProps {
    summaries: ProductSummary[];
    onNavigateToInventory: () => void;
    onRefreshData?: () => Promise<void> | void;
    isActive?: boolean; // Only load heavy data when Dashboard tab is active
}

const Dashboard: React.FC<DashboardProps> = ({ summaries, onNavigateToInventory, onRefreshData, isActive = true }) => {
    const [isCreatingTestData, setIsCreatingTestData] = useState(false);
    const [inventoryItems, setInventoryItems] = useState<StockItem[]>([]);
    const [salesHistory, setSalesHistory] = useState<SaleTransaction[]>([]);
    const [isLoadingInsights, setIsLoadingInsights] = useState(true);
    const { showToast } = useToast();

    // Lazy load inventory items and sales only when Dashboard is active
    // Simple pattern like ProductCatalogPage: render page, show loading, then display data when ready
    useEffect(() => {
        if (!isActive) {
            // Clear data when Dashboard is not active to save memory
            setInventoryItems([]);
            setSalesHistory([]);
            setIsLoadingInsights(true);
            return;
        }

        let cancelled = false;
        setIsLoadingInsights(true);

        const loadData = async () => {
            try {
                // Load data in parallel for better performance
                // Use cached data from vectorDBService (not fresh Qdrant fetch)
                const [items, shopId] = await Promise.all([
                    getAllStockItems(), // This uses cached data from loadDataFromQdrant
                    import('../services/vectorDBService').then(m => m.getActiveShopId())
                ]);
                
                if (cancelled) return;
                
                setInventoryItems(items);
                
                // Try to load sales if available
                if (shopId) {
                    try {
                        const sales = await getAllSales(shopId);
                        if (!cancelled) {
                            setSalesHistory(sales);
                        }
                    } catch (err) {
                        console.warn('Could not load sales history:', err);
                    }
                }
            } catch (err) {
                console.error('Error loading inventory data:', err);
            } finally {
                if (!cancelled) {
                    setIsLoadingInsights(false);
                }
            }
        };
        
        loadData();

        return () => {
            cancelled = true;
        };
    }, [isActive]); // Only reload when Dashboard becomes active/inactive

    const handleCreateTestData = async () => {
        if (!confirm('This will create sample products, suppliers, batches, and inventory items. Continue?')) {
            return;
        }

        setIsCreatingTestData(true);
        try {
            // Sample data - More suppliers and products
            const SAMPLE_PRODUCTS = [
                { name: 'Organic Milk - Whole', manufacturer: 'Fresh Dairy Co.', category: 'Dairy', description: 'Fresh organic whole milk, 1 gallon', imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200' },
                { name: 'Whole Wheat Bread', manufacturer: 'Baker\'s Delight', category: 'Bakery', description: 'Fresh baked whole wheat bread, 1 loaf', imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200' },
                { name: 'Bananas - Organic', manufacturer: 'Tropical Farms', category: 'Produce', description: 'Organic bananas, 1 bunch (~2 lbs)', imageUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200' },
                { name: 'Chicken Breast - Free Range', manufacturer: 'Farm Fresh Poultry', category: 'Meat', description: 'Free range chicken breast, 1 lb', imageUrl: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=200' },
                { name: 'Organic Eggs - Large', manufacturer: 'Happy Hens Farm', category: 'Dairy', description: 'Organic large eggs, 12 count', imageUrl: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200' },
                { name: 'Tomatoes - Roma', manufacturer: 'Garden Fresh', category: 'Produce', description: 'Fresh Roma tomatoes, 1 lb', imageUrl: 'https://images.unsplash.com/photo-1546470427-e26264be0b01?w=200' },
            ];
            const SAMPLE_SUPPLIERS = [
                { name: 'Fresh Dairy Co.', contactEmail: 'orders@fresherdairy.com' },
                { name: 'Baker\'s Delight', contactEmail: 'supply@bakersdelight.com' },
                { name: 'Tropical Farms', contactEmail: 'sales@tropicalfarms.com' },
                { name: 'Farm Fresh Poultry', contactEmail: 'info@farmfreshpoultry.com' },
                { name: 'Happy Hens Farm', contactEmail: 'orders@happyhens.com' },
                { name: 'Garden Fresh', contactEmail: 'wholesale@gardenfresh.com' },
                { name: 'Organic Foods Dist.', contactEmail: 'sales@organicfoods.com' },
                { name: 'Premium Meats Co.', contactEmail: 'orders@premiummeats.com' },
            ];

            // Create suppliers
            const suppliers = [];
            for (const supplier of SAMPLE_SUPPLIERS) {
                try {
                    const sup = await registerLocalSupplier(supplier);
                    suppliers.push(sup);
                } catch (err) {
                    console.warn('Failed to create supplier:', err);
                }
            }

            // Create products
            const products = [];
            for (let i = 0; i < SAMPLE_PRODUCTS.length; i++) {
                const product = SAMPLE_PRODUCTS[i];
                // Match product to supplier by manufacturer name or use first supplier
                const supplier = suppliers.find(s => s.name.toLowerCase().includes(product.manufacturer.toLowerCase().split(' ')[0])) || suppliers[i] || suppliers[0];
                try {
                    const images: ProductImage[] = product.imageUrl ? [{
                        url: product.imageUrl,
                        type: 'manual',
                        source: 'user',
                        addedAt: new Date().toISOString(),
                    }] : [];
                    const prod = await createCanonicalProduct({
                        ...product,
                        defaultSupplierId: supplier?.id,
                        images,
                    });
                    products.push(prod);
                } catch (err) {
                    console.warn('Failed to create product:', err);
                }
            }

            // Create multiple batches from different suppliers for the same products
            const today = new Date();
            const deliveryDate1 = new Date(today);
            deliveryDate1.setDate(deliveryDate1.getDate() - 7);
            const deliveryDate2 = new Date(today);
            deliveryDate2.setDate(deliveryDate2.getDate() - 5);

            // Batch 1: First supplier for first 3 products
            const lineItems1: BatchLineItem[] = products.slice(0, 3).map(p => ({
                productId: p.id,
                productName: p.name,
                quantity: Math.floor(Math.random() * 80) + 20,
                cost: Math.random() * 8 + 2,
            }));

            const batch1 = await createBatchForShop({
                supplierId: suppliers[0]?.id,
                deliveryDate: deliveryDate1.toISOString().split('T')[0],
                invoiceNumber: `INV-${Date.now()}-1`,
                documents: [],
                lineItems: lineItems1,
            });

            // Batch 2: Second supplier for same products (to show multiple suppliers)
            const lineItems2: BatchLineItem[] = products.slice(0, 2).map(p => ({
                productId: p.id,
                productName: p.name,
                quantity: Math.floor(Math.random() * 60) + 15,
                cost: Math.random() * 10 + 3,
            }));

            const batch2 = await createBatchForShop({
                supplierId: suppliers[1]?.id,
                deliveryDate: deliveryDate2.toISOString().split('T')[0],
                invoiceNumber: `INV-${Date.now()}-2`,
                documents: [],
                lineItems: lineItems2,
            });

            // Batch 3: Different supplier for remaining products
            const lineItems3: BatchLineItem[] = products.slice(3, 6).map(p => ({
                productId: p.id,
                productName: p.name,
                quantity: Math.floor(Math.random() * 70) + 20,
                cost: Math.random() * 9 + 2,
            }));

            const batch3 = await createBatchForShop({
                supplierId: suppliers[3]?.id || suppliers[2]?.id || suppliers[0]?.id,
                deliveryDate: deliveryDate1.toISOString().split('T')[0],
                invoiceNumber: `INV-${Date.now()}-3`,
                documents: [],
                lineItems: lineItems3,
            });

            // Create inventory items for batch 1
            const inventoryItems1 = lineItems1.map((item, i) => {
                const product = products[i];
                const expirationDays = [7, 14, 21, 30][Math.floor(Math.random() * 4)];
                const expDate = new Date(today);
                expDate.setDate(expDate.getDate() + expirationDays);
                const buyPrice = item.cost;
                const sellPrice = buyPrice * 1.5; // 50% markup
                return {
                    productName: product.name,
                    manufacturer: product.manufacturer,
                    category: product.category,
                    quantity: item.quantity,
                    quantityType: 'units',
                    costPerUnit: buyPrice,
                    buyPrice: buyPrice, // Explicit buyPrice field
                    sellPrice: sellPrice, // Explicit sellPrice field
                    expirationDate: expDate.toISOString().split('T')[0],
                    location: ['A-1', 'B-2', 'C-3'][Math.floor(Math.random() * 3)],
                    images: product.images || [],
                    supplierId: suppliers[0]?.id, // Add supplier ID to inventory item
                    scanMetadata: null, // No scan metadata for test data
                };
            });

            // Create inventory items for batch 2 (same products, different supplier)
            const inventoryItems2 = lineItems2.map((item, i) => {
                const product = products[i];
                const expirationDays = [10, 17, 24, 31][Math.floor(Math.random() * 4)];
                const expDate = new Date(today);
                expDate.setDate(expDate.getDate() + expirationDays);
                const buyPrice = item.cost;
                const sellPrice = buyPrice * 1.5; // 50% markup
                return {
                    productName: product.name,
                    manufacturer: product.manufacturer,
                    category: product.category,
                    quantity: item.quantity,
                    quantityType: 'units',
                    costPerUnit: buyPrice,
                    buyPrice: buyPrice, // Explicit buyPrice field
                    sellPrice: sellPrice, // Explicit sellPrice field
                    expirationDate: expDate.toISOString().split('T')[0],
                    location: ['D-1', 'E-2', 'F-3'][Math.floor(Math.random() * 3)],
                    images: product.images || [],
                    supplierId: suppliers[1]?.id, // Add supplier ID to inventory item
                    scanMetadata: null, // No scan metadata for test data
                };
            });

            // Create inventory items for batch 3
            const inventoryItems3 = lineItems3.map((item, i) => {
                const product = products[3 + i];
                const expirationDays = [7, 14, 21, 30][Math.floor(Math.random() * 4)];
                const expDate = new Date(today);
                expDate.setDate(expDate.getDate() + expirationDays);
                const buyPrice = item.cost;
                const sellPrice = buyPrice * 1.5; // 50% markup
                return {
                    productName: product.name,
                    manufacturer: product.manufacturer,
                    category: product.category,
                    quantity: item.quantity,
                    quantityType: 'units',
                    costPerUnit: buyPrice,
                    buyPrice: buyPrice, // Explicit buyPrice field
                    sellPrice: sellPrice, // Explicit sellPrice field
                    expirationDate: expDate.toISOString().split('T')[0],
                    location: ['G-1', 'H-2', 'I-3'][Math.floor(Math.random() * 3)],
                    images: product.images || [],
                    supplierId: suppliers[3]?.id || suppliers[2]?.id || suppliers[0]?.id,
                    scanMetadata: null, // No scan metadata for test data
                };
            });

            // Add all batches
            await addInventoryBatch({
                supplier: suppliers[0]?.name || 'Test Supplier',
                deliveryDate: deliveryDate1.toISOString().split('T')[0],
                inventoryDate: today.toISOString().split('T')[0],
            }, inventoryItems1);

            await addInventoryBatch({
                supplier: suppliers[1]?.name || 'Test Supplier 2',
                deliveryDate: deliveryDate2.toISOString().split('T')[0],
                inventoryDate: today.toISOString().split('T')[0],
            }, inventoryItems2);

            await addInventoryBatch({
                supplier: suppliers[3]?.name || suppliers[2]?.name || 'Test Supplier 3',
                deliveryDate: deliveryDate1.toISOString().split('T')[0],
                inventoryDate: today.toISOString().split('T')[0],
            }, inventoryItems3);

            showToast(`Test data created: ${suppliers.length} suppliers, ${products.length} products, 3 batches, ${inventoryItems1.length + inventoryItems2.length + inventoryItems3.length} inventory items`, 'success');
            if (onRefreshData) {
                await onRefreshData();
            }
        } catch (err) {
            console.error('Error creating test data:', err);
            showToast('Failed to create test data: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
        } finally {
            setIsCreatingTestData(false);
        }
    };

    const kpis = useMemo(() => {
        // Calculate real inventory value using averageCostPerUnit from summaries
        // Always calculate from summaries - no need to return empty values
        const totalValue = summaries.reduce((acc, summary) => {
            // Use actual averageCostPerUnit if available, otherwise fallback to 0
            const avgCost = summary.averageCostPerUnit || 0;
            return acc + (summary.totalQuantity * avgCost);
        }, 0);

        const uniqueProducts = summaries.length;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        thirtyDaysFromNow.setHours(23, 59, 59, 999);

        // Items expiring in the next 30 days
        const expiringSoonList = summaries.filter(s => {
            const expDate = new Date(s.earliestExpiration);
            expDate.setHours(0, 0, 0, 0);
            return expDate >= today && expDate <= thirtyDaysFromNow;
        });

        // Items that have already expired
        const expiredList = summaries.filter(s => {
            const expDate = new Date(s.earliestExpiration);
            expDate.setHours(0, 0, 0, 0);
            return expDate < today;
        });

        return { 
            totalValue, 
            uniqueProducts, 
            expiringSoon: expiringSoonList.length, 
            expired: expiredList.length,
            expiringSoonList,
            expiredList
        };
    }, [summaries]); // Only depend on summaries - loading state is handled in render

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-white">Dashboard</h1>
                <p className="text-lg text-gray-400">A high-level overview of your inventory status.</p>
            </div>
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Show loading skeleton if summaries are empty (data still loading) OR insights are loading */}
                {/* This ensures loading shows immediately when Dashboard first renders */}
                {summaries.length === 0 || isLoadingInsights ? (
                    <>
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 flex items-center space-x-4">
                                <div className="p-3 bg-gray-700/50 rounded-lg animate-pulse">
                                    <div className="w-8 h-8 bg-gray-600 rounded" />
                                </div>
                                <div className="flex-1">
                                    <div className="h-4 bg-gray-700 rounded w-24 mb-2 animate-pulse" />
                                    <div className="h-8 bg-gray-700 rounded w-32 animate-pulse" />
                                </div>
                            </div>
                        ))}
                    </>
                ) : (
                    <>
                        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 flex items-center space-x-4">
                            <div className="p-3 bg-cyan-900/50 rounded-lg">
                                <ValueIcon className="w-8 h-8 text-cyan-400" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-400">Total Inventory Value</p>
                                <p className="text-2xl font-bold text-white">${kpis.totalValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                            </div>
                        </div>
                        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 flex items-center space-x-4">
                             <div className="p-3 bg-cyan-900/50 rounded-lg">
                                <ItemsIcon className="w-8 h-8 text-cyan-400" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-400">Unique Products</p>
                                <p className="text-2xl font-bold text-white">{kpis.uniqueProducts}</p>
                            </div>
                        </div>
                        <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700 flex items-center space-x-4">
                             <div className="p-3 bg-red-900/50 rounded-lg">
                                <ExpirationIcon className="w-8 h-8 text-red-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-400">Expiring in 30 Days</p>
                                <p className="text-2xl font-bold text-white">{kpis.expiringSoon} items</p>
                                {kpis.expired > 0 && (
                                    <p className="text-xs text-red-400 mt-1">{kpis.expired} expired</p>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Expiration Alerts */}
            {(kpis.expired > 0 || kpis.expiringSoon > 0) && (
                <div className="bg-gray-800/50 p-6 rounded-lg border border-red-700">
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <ExpirationIcon className="w-6 h-6 text-red-400" />
                        Expiration Alerts
                    </h2>
                    {kpis.expired > 0 && (
                        <div className="mb-4">
                            <p className="text-red-400 font-semibold mb-2">⚠️ Expired Items ({kpis.expired})</p>
                            <ul className="space-y-2">
                                {kpis.expiredList.slice(0, 5).map(summary => (
                                    <li key={summary.productName} className="text-sm p-2 bg-red-900/30 rounded-md">
                                        <span className="text-white font-medium">{summary.productName}</span>
                                        <span className="text-red-300 ml-2">Expired: {summary.earliestExpiration}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {kpis.expiringSoon > 0 && (
                        <div>
                            <p className="text-yellow-400 font-semibold mb-2">⏰ Expiring Soon ({kpis.expiringSoon})</p>
                            <ul className="space-y-2">
                                {kpis.expiringSoonList.slice(0, 5).map(summary => {
                                    const expDate = new Date(summary.earliestExpiration);
                                    const daysUntil = Math.ceil((expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                                    return (
                                        <li key={summary.productName} className="text-sm p-2 bg-yellow-900/30 rounded-md">
                                            <span className="text-white font-medium">{summary.productName}</span>
                                            <span className="text-yellow-300 ml-2">Expires in {daysUntil} days: {summary.earliestExpiration}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* Multi-Modal AI Visual Insights */}
            {isLoadingInsights ? (
                <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <div className="animate-pulse">
                        <div className="h-6 bg-gray-700 rounded w-48 mb-4" />
                        <div className="h-32 bg-gray-700/50 rounded" />
                    </div>
                </div>
            ) : (
                <VisualInsightsPanel
                    inventoryData={inventoryItems}
                    salesHistory={salesHistory}
                    productCatalog={summaries}
                />
            )}

            {/* Quick Actions & Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
                    <div className="space-y-3">
                        <button 
                            onClick={onNavigateToInventory}
                            className="w-full text-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all"
                        >
                            Add New Inventory Batch
                        </button>
                        {summaries.length === 0 && (
                            <button
                                onClick={handleCreateTestData}
                                disabled={isCreatingTestData}
                                className="w-full text-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isCreatingTestData ? 'Creating Test Data...' : '🎲 Create Test Data'}
                            </button>
                        )}
                    </div>
                </div>
                 <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-white mb-4">Recently Added Products</h2>
                    {summaries.length > 0 ? (
                        <ul className="space-y-3">
                            {summaries.slice(0, 3).map(summary => (
                                <li key={summary.productName} className="flex justify-between items-center text-sm p-3 bg-gray-900/50 rounded-md">
                                    <div>
                                        <p className="font-medium text-white">{summary.productName}</p>
                                        <p className="text-gray-400">{summary.manufacturer}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-white">{summary.totalQuantity} {summary.quantityType}</p>
                                        <p className="text-gray-400">Exp: {summary.earliestExpiration}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-center text-gray-500 py-4">No inventory data available.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
