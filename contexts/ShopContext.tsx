import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ShopContextType {
  currentShop: { id: string; name: string; contactEmail?: string } | null;
  setCurrentShop: (shop: { id: string; name: string; contactEmail?: string } | null) => void;
}

const ShopContext = createContext<ShopContextType | undefined>(undefined);

export const ShopContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentShop, setCurrentShop] = useState<{ id: string; name: string; contactEmail?: string } | null>(() => {
    if (typeof window !== 'undefined') {
      const storedShop = sessionStorage.getItem('current_shop');
      return storedShop ? JSON.parse(storedShop) : null;
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentShop) {
        sessionStorage.setItem('current_shop', JSON.stringify(currentShop));
      } else {
        sessionStorage.removeItem('current_shop');
      }
    }
  }, [currentShop]);

  return (
    <ShopContext.Provider value={{ currentShop, setCurrentShop }}>
      {children}
    </ShopContext.Provider>
  );
};

export const useShopContext = () => {
  const context = useContext(ShopContext);
  if (context === undefined) {
    throw new Error('useShopContext must be used within a ShopContextProvider');
  }
  return context;
};

