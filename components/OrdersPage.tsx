import React, { useState, useMemo } from 'react';
import { User, ProductSummary, Order, SupplyProposal } from '../types';
import * as backendService from '../services/backendService';

interface OrdersPageProps {
    user: User;
    summaries: ProductSummary[];
    orders: Order[];
    proposals: SupplyProposal[];
    onDataChange: () => void;
}

const OrdersPage: React.FC<OrdersPageProps> = ({ user, summaries, orders, proposals, onDataChange }) => {
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isProposalModalOpen, setProposalModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    const myOrders = useMemo(() => orders.filter(o => o.requesterShop.id === user.clientId), [orders, user.clientId]);
    const networkOrders = useMemo(() => orders.filter(o => o.requesterShop.id !== user.clientId && o.status === 'OPEN'), [orders, user.clientId]);

    const handleCreateOrder = async (productName: string, quantity: number) => {
        await backendService.createOrder({ productName, quantity, requesterShop: {id: user.clientId, name: user.companyName, address: user.address} }, user);
        setCreateModalOpen(false);
        onDataChange();
    };
    
    const handleMakeProposal = async (order: Order, price: number) => {
        await backendService.createSupplyProposal({ orderId: order.id, pricePerUnit: price, supplierShop: {id: user.clientId, name: user.companyName, address: user.address} }, user);
        setProposalModalOpen(false);
        setSelectedOrder(null);
        onDataChange();
    };

    const handleAcceptProposal = async (proposalId: string) => {
        await backendService.acceptProposal(proposalId);
        onDataChange();
    };

    if (!user.isVerified) {
        return (
            <div className="text-center bg-gray-800/50 p-12 rounded-lg border border-gray-700">
                <h1 className="text-2xl font-bold text-yellow-400">Verification Pending</h1>
                <p className="text-lg text-gray-400 mt-2">The Orders tab requires shop verification.</p>
            </div>
        );
    }

    return (
        <>
            {isCreateModalOpen && <CreateOrderModal summaries={summaries} onClose={() => setCreateModalOpen(false)} onCreateOrder={handleCreateOrder} />}
            {isProposalModalOpen && selectedOrder && <MakeProposalModal order={selectedOrder} summaries={summaries} onClose={() => {setProposalModalOpen(false); setSelectedOrder(null);}} onMakeProposal={handleMakeProposal} />}
            
            <div className="space-y-8">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Orders & Deliveries</h1>
                        <p className="text-lg text-gray-400">Manage your B2B supply chain.</p>
                    </div>
                    <button onClick={() => setCreateModalOpen(true)} className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                        Create New Order
                    </button>
                </div>

                {/* MY ORDERS */}
                <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-white mb-4">My Supply Requests</h2>
                    <div className="space-y-4">
                        {myOrders.length === 0 ? <p className="text-gray-500">You have not created any orders.</p> :
                            myOrders.map(order => (
                                <div key={order.id} className="bg-gray-900/50 p-4 rounded-lg">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-bold text-white">{order.quantity}x {order.productName}</p>
                                            <p className="text-xs text-gray-500 font-mono">{order.id}</p>
                                        </div>
                                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${order.status === 'OPEN' ? 'bg-blue-800 text-blue-300' : 'bg-green-800 text-green-300'}`}>{order.status}</span>
                                    </div>
                                    <div className="mt-3">
                                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Proposals ({proposals.filter(p => p.orderId === order.id).length})</h4>
                                        <div className="space-y-2">
                                            {proposals.filter(p => p.orderId === order.id).map(p => (
                                                <div key={p.id} className="flex justify-between items-center bg-gray-800 p-2 rounded-md text-sm">
                                                    <div>
                                                        <p className="text-gray-200">{p.supplierShop.name}</p>
                                                        <p className="font-bold text-cyan-400">${p.pricePerUnit.toFixed(2)} / unit</p>
                                                    </div>
                                                    {order.status === 'OPEN' && (
                                                        <button onClick={() => handleAcceptProposal(p.id)} className="py-1 px-3 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md">
                                                            Accept
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </div>

                {/* NETWORK ORDERS */}
                <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                    <h2 className="text-xl font-semibold text-white mb-4">Network Supply Requests</h2>
                    <div className="space-y-2">
                        {networkOrders.map(order => {
                            const myProposal = proposals.find(p => p.orderId === order.id && p.supplierShop.id === user.clientId);
                            const stockInfo = summaries.find(s => s.productName === order.productName);
                            const hasStock = (stockInfo?.totalQuantity || 0) >= order.quantity;

                            return (
                                <div key={order.id} className="grid grid-cols-4 gap-4 items-center p-3 bg-gray-900/50 rounded-md">
                                    <div>
                                        <p className="font-semibold text-white">{order.quantity}x {order.productName}</p>
                                        <p className="text-sm text-gray-400">{order.requesterShop.name}</p>
                                    </div>
                                    <div className="text-sm text-gray-300">
                                        Stock: <span className={hasStock ? 'text-green-400' : 'text-red-400'}>{stockInfo?.totalQuantity || 0}</span> / {order.quantity}
                                    </div>
                                    <div className="text-sm">
                                        {myProposal ? <span className="text-yellow-400">Proposal Sent</span> : '-'}
                                    </div>
                                    <div>
                                        <button 
                                            disabled={!hasStock || !!myProposal}
                                            onClick={() => {setSelectedOrder(order); setProposalModalOpen(true);}}
                                            className="w-full py-2 px-3 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed"
                                        >
                                            Propose Supply
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </>
    )
}

const CreateOrderModal: React.FC<{summaries: ProductSummary[], onClose: () => void, onCreateOrder: (productName: string, quantity: number) => void}> = ({ summaries, onClose, onCreateOrder }) => {
    const [productName, setProductName] = useState('');
    const [quantity, setQuantity] = useState(10);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (productName && quantity > 0) {
            onCreateOrder(productName, quantity);
        }
    };
    
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          <form onSubmit={handleSubmit}>
            <div className="p-6">
                <h2 className="text-xl font-bold text-white">Create Supply Request</h2>
                <div className="mt-4 space-y-4">
                    <div>
                        <label htmlFor="productName" className="block text-sm font-medium text-gray-300">Product Name</label>
                        <input type="text" id="productName" value={productName} onChange={e => setProductName(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white"/>
                    </div>
                    <div>
                        <label htmlFor="quantity" className="block text-sm font-medium text-gray-300">Quantity</label>
                        <input type="number" id="quantity" value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} min="1" required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white"/>
                    </div>
                </div>
            </div>
            <div className="bg-gray-900/50 px-6 py-3 flex justify-end gap-4">
                <button type="button" onClick={onClose} className="py-2 px-4 border border-gray-600 rounded-md text-sm text-gray-300">Cancel</button>
                <button type="submit" className="py-2 px-4 bg-indigo-600 text-white rounded-md text-sm">Post Order</button>
            </div>
          </form>
        </div>
      </div>
    );
};

const MakeProposalModal: React.FC<{order: Order, summaries: ProductSummary[], onClose: () => void, onMakeProposal: (order: Order, price: number) => void}> = ({ order, summaries, onClose, onMakeProposal }) => {
    const [price, setPrice] = useState(0);
    const stockInfo = summaries.find(s => s.productName === order.productName);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (price > 0) {
            onMakeProposal(order, price);
        }
    };
    
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          <form onSubmit={handleSubmit}>
            <div className="p-6">
                <h2 className="text-xl font-bold text-white">Propose to Supply</h2>
                <div className="mt-2 text-gray-300">
                    <p>Order: <span className="font-semibold">{order.quantity}x {order.productName}</span></p>
                    <p>For: <span className="font-semibold">{order.requesterShop.name}</span></p>
                    <p className="mt-2 text-sm">Your cost is approx. <span className="font-semibold text-cyan-400">${(stockInfo?.averageCostPerUnit || 0).toFixed(2)}/unit</span></p>
                </div>
                <div className="mt-4">
                    <label htmlFor="price" className="block text-sm font-medium text-gray-300">Your Price per Unit ($)</label>
                    <input type="number" id="price" value={price} onChange={e => setPrice(parseFloat(e.target.value) || 0)} min="0.01" step="0.01" required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white"/>
                </div>
            </div>
            <div className="bg-gray-900/50 px-6 py-3 flex justify-end gap-4">
                <button type="button" onClick={onClose} className="py-2 px-4 border border-gray-600 rounded-md text-sm text-gray-300">Cancel</button>
                <button type="submit" className="py-2 px-4 bg-cyan-600 text-white rounded-md text-sm">Send Proposal</button>
            </div>
          </form>
        </div>
      </div>
    );
}

export default OrdersPage;