import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import * as backendService from '../services/backendService';

const BackendPage: React.FC = () => {
    const [pendingClients, setPendingClients] = useState<User[]>([]);
    const [verifiedClients, setVerifiedClients] = useState<User[]>([]);
    const [pendingDrivers, setPendingDrivers] = useState<User[]>([]);
    const [verifiedDrivers, setVerifiedDrivers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    const fetchAllData = useCallback(async () => {
        setIsLoading(true);
        const [pClients, vClients, pDrivers, vDrivers] = await Promise.all([
            backendService.getPendingClients(),
            backendService.getVerifiedClients(),
            backendService.getPendingDrivers(),
            backendService.getVerifiedDrivers()
        ]);
        setPendingClients(pClients);
        setVerifiedClients(vClients);
        setPendingDrivers(pDrivers);
        setVerifiedDrivers(vDrivers);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData, lastUpdated]);

    const handleVerifyClient = async (clientId: string) => {
        await backendService.verifyClient(clientId);
        setLastUpdated(new Date()); // Trigger re-fetch
    };
    
    const handleVerifyDriver = async (clientId: string) => {
        await backendService.verifyDriver(clientId);
        setLastUpdated(new Date());
    }
    
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-white">Backend Admin Panel</h1>
                <p className="text-lg text-gray-400">Simulated proxy server for verifying new shops and drivers.</p>
            </div>

            {/* SHOP VERIFICATION */}
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Pending Shop Verifications ({pendingClients.length})</h2>
                    <button onClick={() => setLastUpdated(new Date())} className="text-sm text-cyan-400 hover:text-cyan-300">Refresh</button>
                </div>
                {isLoading ? <p className="text-center text-gray-400">Loading...</p> : pendingClients.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No shops are awaiting verification.</p>
                ) : (
                     <UserTable users={pendingClients} onVerify={handleVerifyClient} />
                )}
            </div>
            
            {/* DRIVER VERIFICATION */}
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-semibold text-white mb-4">Pending Driver Verifications ({pendingDrivers.length})</h2>
                {isLoading ? <p className="text-center text-gray-400">Loading...</p> : pendingDrivers.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No drivers are awaiting verification.</p>
                ) : (
                     <UserTable users={pendingDrivers} onVerify={handleVerifyDriver} isDriverTable={true}/>
                )}
            </div>

            {/* ACTIVE PEERS */}
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
                <h2 className="text-xl font-semibold text-white mb-4">Active Network Participants</h2>
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-cyan-400">Verified Shops ({verifiedClients.length})</h3>
                    {verifiedClients.length > 0 ? <UserTable users={verifiedClients} /> : <p className="text-gray-500 text-sm">No verified shops.</p>}
                     <h3 className="text-lg font-semibold text-cyan-400 mt-6">Verified Drivers ({verifiedDrivers.length})</h3>
                    {verifiedDrivers.length > 0 ? <UserTable users={verifiedDrivers} isDriverTable={true}/> : <p className="text-gray-500 text-sm">No verified drivers.</p>}
                </div>
            </div>

             <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-cyan-800/50">
                <h4 className="font-semibold text-cyan-500">How this simulation works:</h4>
                <p className="text-xs text-gray-400 mt-1">
                    When a new user registers, they appear in the appropriate "Pending" list. Clicking "Verify" updates a shared `localStorage` value. The main application is continuously polling for this change. Once it detects it has been verified, it will automatically unlock the relevant features (Marketplace, Orders, or Driver panel).
                </p>
            </div>
        </div>
    );
};


const UserTable: React.FC<{users: User[], onVerify?: (clientId: string) => void, isDriverTable?: boolean}> = ({ users, onVerify, isDriverTable }) => (
    <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-800">
                <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-300 sm:pl-6">{isDriverTable ? 'Name' : 'Company'}</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Email</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-300">Client ID</th>
                    {onVerify && <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Verify</span></th>}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900/50">
                {users.map(client => (
                    <tr key={client.clientId}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6">{client.companyName}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-400">{client.email}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 font-mono text-xs">{client.clientId}</td>
                        {onVerify && (
                            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                <button onClick={() => onVerify(client.clientId)} className="py-1 px-3 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-green-600 hover:bg-green-700">
                                    Verify
                                </button>
                            </td>
                        )}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);


export default BackendPage;