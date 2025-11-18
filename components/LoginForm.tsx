import React, { useState } from 'react';
import { AuthenticatedProfile, loginUser } from '../services/shopAuthService';

interface LoginFormProps {
  onSuccess: (profile: AuthenticatedProfile) => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const profile = await loginUser({ username: username.trim(), password });
      onSuccess(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          autoComplete="username"
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
          autoComplete="current-password"
          required
        />
      </div>
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
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
};

export default LoginForm;
