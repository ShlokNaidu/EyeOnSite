import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function NotFound() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-50 flex flex-col items-center justify-center px-6">
      {/* Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-sky-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 text-center max-w-md">
        {/* 404 number */}
        <div className="text-[120px] font-black leading-none bg-gradient-to-br from-sky-400 to-blue-600 bg-clip-text text-transparent mb-4 select-none">
          404
        </div>

        <h1 className="text-2xl font-bold text-slate-800 mb-3">Page Not Found</h1>
        <p className="text-slate-500 mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {isAuthenticated && (
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-sky-200"
            >
              Go to Dashboard
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-white hover:bg-sky-50 text-slate-700 font-semibold rounded-xl border border-sky-200 transition-all hover:scale-[1.02]"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
