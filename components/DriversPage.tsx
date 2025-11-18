import React, { useState } from 'react';
import { User, Delivery } from '../types';
import * as backendService from '../services/backendService';
import * as geminiService from '../services/geminiService';

interface DriversPageProps {
    user: User;
    deliveries: Delivery[];
    onDataChange: () => void;
}

const DriversPage: React.FC<DriversPageProps> = ({ user, deliveries, onDataChange }) => {
    const [selectedDeliveries, setSelectedDeliveries] = useState<Set<string>>(new Set());
    const [suggestedRoute, setSuggestedRoute] = useState<string | null>(null);
    const [isLoadingRoute, setIsLoadingRoute] = useState(false);
    const isDriver = Boolean(user.roles?.driver);
    const isShopOnly = user.roles?.shop && !isDriver;
    
    const availableDeliveries = deliveries.filter(d => d.status === 'AWAITING_DRIVER');
    const myDeliveries = deliveries.filter(d => d.driver?.id === user.clientId);

    const handleAcceptDelivery = async (deliveryId: string) => {
        await backendService.acceptDelivery(deliveryId, user);
        onDataChange();
    };

    const toggleDeliverySelection = (deliveryId: string) => {
        const newSelection = new Set(selectedDeliveries);
        if (newSelection.has(deliveryId)) {
            newSelection.delete(deliveryId);
        } else {
            newSelection.add(deliveryId);
        }
        setSelectedDeliveries(newSelection);
    };

    const handleGetRoute = async () => {
        if (selectedDeliveries.size === 0) return;
        setIsLoadingRoute(true);
        setSuggestedRoute(null);
        const deliveriesForRoute = availableDeliveries.filter(d => selectedDeliveries.has(d.id));
        try {
            const route = await geminiService.generateDriverRoute(deliveriesForRoute);
            setSuggestedRoute(route);
        } catch (error) {
            console.error(error);
            setSuggestedRoute("Error generating route. Please try again.");
        } finally {
            setIsLoadingRoute(false);
        }
    };
    
    if (isShopOnly) {
        return (
             <div className="text-center bg-gray-800/50 p-12 rounded-lg border border-gray-700">
                <h1 className="text-2xl font-bold text-white">Driver Network</h1>
                <p className="text-lg text-gray-400 mt-2">This is the hub for verified drivers to find and manage deliveries.</p>
                <p className="text-sm text-gray-500 mt-1">To use driver functions, please log in with a driver account.</p>
            </div>
        )
    }

    if (isDriver && !user.isDriverVerified) {
        return (
            <div className="text-center bg-gray-800/50 p-12 rounded-lg border border-gray-700">
                <h1 className="text-2xl font-bold text-yellow-400">Driver Verification Pending</h1>
                <p className="text-lg text-gray-400 mt-2">Your driver account is awaiting verification by the network admin.</p>
                <p className="text-gray-500 mt-4">Once verified, you will be able to accept delivery jobs here.</p>
            </div>
        );
    }

    if (!isDriver) {
        return (
            <div className="text-center bg-gray-800/50 p-12 rounded-lg border border-gray-700">
                <h1 className="text-2xl font-bold text-white">Driver Dashboard</h1>
                <p className="text-gray-400">Enable the driver role on your account to access this area.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-white">Driver Dashboard</h1>
                <p className="text-lg text-gray-400">Find and manage your delivery jobs.</p>
            </div>

            {/* MY DELIVERIES */}
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-semibold text-white mb-4">My Active Deliveries ({myDeliveries.length})</h2>
                <div className="space-y-3">
                    {myDeliveries.map(d => (
                        <div key={d.id} className="bg-gray-900/50 p-3 rounded-md">
                            <p className="font-semibold text-white">{d.quantity}x {d.productName}</p>
                            <p className="text-sm text-gray-400">From: {d.pickup.name}</p>
                            <p className="text-sm text-gray-400">To: {d.dropoff.name}</p>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-sm font-bold text-green-400">Fee: ${d.fee.toFixed(2)}</span>
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-800 text-yellow-300">{d.status}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* AVAILABLE JOBS */}
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Available Jobs ({availableDeliveries.length})</h2>
                    <button onClick={handleGetRoute} disabled={selectedDeliveries.size === 0 || isLoadingRoute} className="py-2 px-4 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600">
                        {isLoadingRoute ? 'Thinking...' : 'Get Optimal Route'}
                    </button>
                </div>

                {suggestedRoute && (
                    <div className="mb-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                        <h3 className="text-lg font-semibold text-cyan-400 mb-2">Suggested Route</h3>
                        <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: suggestedRoute.replace(/\n/g, '<br />') }}></div>
                    </div>
                )}

                <div className="space-y-2">
                    {availableDeliveries.map(d => (
                        <div key={d.id} className="grid grid-cols-6 gap-4 items-center p-3 bg-gray-900/50 rounded-md">
                           <div className="col-span-1">
                                <input type="checkbox" checked={selectedDeliveries.has(d.id)} onChange={() => toggleDeliverySelection(d.id)} className="w-5 h-5 bg-gray-700 border-gray-600 rounded text-cyan-500 focus:ring-cyan-600"/>
                           </div>
                           <div className="col-span-3">
                                <p className="font-semibold text-white">{d.quantity}x {d.productName}</p>
                                <p className="text-xs text-gray-400">{d.pickup.name} ➔ {d.dropoff.name}</p>
                           </div>
                           <div className="text-sm font-bold text-green-400">
                                ${d.fee.toFixed(2)}
                           </div>
                           <div className="col-span-1">
                               <button onClick={() => handleAcceptDelivery(d.id)} className="w-full py-2 px-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md">
                                    Accept
                               </button>
                           </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DriversPage;
