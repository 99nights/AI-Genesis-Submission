import React, { useState } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import { AuthenticatedProfile } from '../services/shopAuthService';

interface AuthPageProps {
  onAuthenticated: (profile: AuthenticatedProfile) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-2xl">
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-md font-semibold ${
              mode === 'login'
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded-md font-semibold ${
              mode === 'register'
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Create Account
          </button>
        </div>
        {mode === 'login' ? (
          <LoginForm onSuccess={onAuthenticated} />
        ) : (
          <RegisterForm
            onSuccess={(profile) => {
              onAuthenticated(profile);
              setMode('login');
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AuthPage;
