import React, { useState } from 'react';
import { SparkleIcon } from './icons/SparkleIcon';
import { User } from '../types';

type Tab = 'dashboard' | 'inventory' | 'marketplace' | 'kiosk' | 'catalog' | 'batches' | 'backend' | 'customer' | 'supplier';

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  user: User;
  onLogout: () => void;
  isBackendAvailable: boolean;
}

const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange, user, onLogout, isBackendAvailable }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Role-based permissions: Check both role flags AND IDs
  // If user has shopId/customerId/driverId/supplierId, they have that role and permissions
  const canShop = Boolean(user.roles?.shop || user.shopId);
  const canCustomer = Boolean(user.roles?.customer || user.customerId);
  const canDriver = Boolean(user.roles?.driver || user.driverId);
  const canSupplier = Boolean(user.roles?.supplier || user.supplierId);
  
  const getLinkClasses = (tab: Tab, isDisabled: boolean = false) => {
    let baseClasses = "px-3 py-2 rounded-md text-sm font-medium transition-colors";
    if (isDisabled) {
        return `${baseClasses} text-gray-500 cursor-not-allowed`;
    }
    baseClasses += " cursor-pointer";
    if (activeTab === tab) {
      return `${baseClasses} bg-cyan-600 text-white`;
    }
    return `${baseClasses} text-gray-300 hover:bg-gray-700 hover:text-white`;
  };

  const isMarketplaceDisabled = !user.isVerified;

  return (
    <header className="bg-gray-800/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between h-20 border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <SparkleIcon className="w-8 h-8 text-cyan-400" />
            <h1 className="text-2xl font-bold tracking-tight text-white">
              ShopNexus
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            <nav className="hidden md:flex items-center space-x-2 p-1 bg-gray-900/50 rounded-lg border border-gray-700">
              <a onClick={() => onTabChange('dashboard')} className={getLinkClasses('dashboard')}>Dashboard</a>
              
              {canShop && (
                <>
                  <a onClick={() => onTabChange('inventory')} className={getLinkClasses('inventory')}>Inventory</a>
                  <a onClick={() => onTabChange('catalog')} className={getLinkClasses('catalog')}>Products</a>
                  <a onClick={() => onTabChange('batches')} className={getLinkClasses('batches')}>Batches</a>
                  <a 
                    onClick={() => !isMarketplaceDisabled && onTabChange('marketplace')} 
                    className={getLinkClasses('marketplace', isMarketplaceDisabled)}
                    title={isMarketplaceDisabled ? 'Verification Pending' : 'Marketplace'}
                  >
                    Marketplace
                  </a>
                  <a onClick={() => onTabChange('kiosk')} className={getLinkClasses('kiosk')}>Kiosk</a>
                </>
              )}
              {canCustomer && (
                <a onClick={() => onTabChange('customer')} className={getLinkClasses('customer')}>
                  Customer
                </a>
              )}
              {canSupplier && (
                <a onClick={() => onTabChange('supplier')} className={getLinkClasses('supplier')}>
                  Supplier
                </a>
              )}

              {isBackendAvailable && <a onClick={() => onTabChange('backend')} className={getLinkClasses('backend')}>Backend</a>}
            </nav>
             <div className="relative">
                <button onClick={() => setDropdownOpen(!dropdownOpen)} className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-700">
                    <div className="w-8 h-8 bg-cyan-800 rounded-full flex items-center justify-center text-cyan-300 font-bold">
                        {user.companyName.charAt(0)}
                    </div>
                    <span className="hidden lg:inline text-sm font-medium text-white">{user.companyName}</span>
                </button>
                {dropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20">
                        <div className="px-4 py-3 border-b border-gray-700">
                           <p className="text-sm font-semibold text-white truncate">{user.companyName}</p>
                           <p className="text-xs text-gray-400 capitalize">{user.role}</p>
                        </div>
                        <div className="px-4 py-2 text-xs text-gray-400">
                            Shop: {canShop ? <span className="text-green-400">Enabled</span> : <span className="text-gray-500">Off</span>}
                            {user.shopId && <span className="text-gray-500 ml-2">(ID: {user.shopId.slice(0, 8)}...)</span>}
                        </div>
                        <div className="px-4 py-2 text-xs text-gray-400">
                            Customer: {canCustomer ? <span className="text-green-400">Enabled</span> : <span className="text-gray-500">Off</span>}
                            {user.customerId && <span className="text-gray-500 ml-2">(ID: {user.customerId.slice(0, 8)}...)</span>}
                        </div>
                        <div className="px-4 py-2 text-xs text-gray-400">
                            Driver: {canDriver ? <span className="text-green-400">Enabled</span> : <span className="text-gray-500">Off</span>}
                            {user.driverId && <span className="text-gray-500 ml-2">(ID: {user.driverId.slice(0, 8)}...)</span>}
                        </div>
                        <div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-700">
                            Supplier: {canSupplier ? <span className="text-green-400">Enabled</span> : <span className="text-gray-500">Off</span>}
                            {user.supplierId && <span className="text-gray-500 ml-2">(ID: {user.supplierId.slice(0, 8)}...)</span>}
                        </div>
                        <a onClick={onLogout} className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer">Logout</a>
                    </div>
                )}
            </div>
          </div>
          <button className="md:hidden text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
