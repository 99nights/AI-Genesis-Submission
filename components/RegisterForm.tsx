import React, { useState } from 'react';
import { AuthenticatedProfile, registerUser } from '../services/shopAuthService';

interface RegisterFormProps {
  onSuccess: (profile: AuthenticatedProfile) => void;
}

const RegisterForm: React.FC<RegisterFormProps> = ({ onSuccess }) => {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseId, setLicenseId] = useState('');
  const [roles, setRoles] = useState({ shop: false, customer: false, driver: false, supplier: false });
  const [supplierShopId, setSupplierShopId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const toggleRole = (key: keyof typeof roles) => {
    setRoles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const selected = roles.shop || roles.customer || roles.driver || roles.supplier;
      if (!selected) {
        throw new Error('Please select at least one role.');
      }
      if (roles.shop && !name.trim()) {
        throw new Error('Shop owners must provide a shop name.');
      }
      if (!roles.shop && !name.trim()) {
        throw new Error('Please provide your display name.');
      }
      const profile = await registerUser({
        username: username.trim(),
        email: email.trim(),
        password,
        displayName: name.trim(),
        roles,
        licenseId: roles.driver ? licenseId.trim() : undefined,
        supplierShopId: roles.supplier ? supplierShopId.trim() || undefined : undefined,
      });
      onSuccess(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex space-x-2">
        {(['shop', 'customer', 'driver', 'supplier'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggleRole(option)}
            className={`flex-1 py-2 rounded-md text-sm font-semibold capitalize ${
              roles[option] ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {roles.shop ? 'Shop Name' : 'Display Name'}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          required
        />
      </div>
      {roles.driver && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">License ID (optional)</label>
          <input
            type="text"
            value={licenseId}
            onChange={(e) => setLicenseId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      )}
      {roles.supplier && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Associated Shop ID (optional)</label>
          <input
            type="text"
            value={supplierShopId}
            onChange={(e) => setSupplierShopId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="Link yourself to a shop UUID if applicable"
          />
        </div>
      )}
      {error && (
        <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white font-semibold transition disabled:opacity-60"
      >
        {isLoading ? 'Creating...' : 'Create Account'}
      </button>
    </form>
  );
};

export default RegisterForm;
