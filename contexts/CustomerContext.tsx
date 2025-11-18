import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthenticatedProfile } from '../services/shopAuthService';

interface CustomerContextType {
  customer: AuthenticatedProfile | null;
  setCustomer: (profile: AuthenticatedProfile | null) => void;
  clearCustomer: () => void;
}

interface CustomerProviderProps {
  children: ReactNode;
  initialCustomer?: AuthenticatedProfile | null;
}

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

export const CustomerContextProvider: React.FC<CustomerProviderProps> = ({ children, initialCustomer }) => {
  const [customer, setCustomerState] = useState<AuthenticatedProfile | null>(() => {
    if (initialCustomer) {
      return initialCustomer;
    }
    if (typeof window !== 'undefined') {
      const storedCustomer = sessionStorage.getItem('customer_profile');
      return storedCustomer ? JSON.parse(storedCustomer) : null;
    }
    return null;
  });

  useEffect(() => {
    if (initialCustomer) {
      setCustomerState(prev => {
        if (prev?.user.clientId === initialCustomer.user.clientId) {
          return prev;
        }
        return initialCustomer;
      });
    }
  }, [initialCustomer]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (customer) {
        sessionStorage.setItem('customer_profile', JSON.stringify(customer));
      } else {
        sessionStorage.removeItem('customer_profile');
      }
    }
  }, [customer]);

  const setCustomer = (profile: AuthenticatedProfile | null) => {
    setCustomerState(profile);
  };

  const clearCustomer = () => {
    setCustomerState(null);
  };

  return (
    <CustomerContext.Provider value={{ customer, setCustomer, clearCustomer }}>
      {children}
    </CustomerContext.Provider>
  );
};

export const useCustomerContext = () => {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error('useCustomerContext must be used within a CustomerContextProvider');
  }
  return context;
};

