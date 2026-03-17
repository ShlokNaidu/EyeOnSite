import React, { createContext, useContext, useState, useEffect } from 'react';
import { getMe, getToken, clearToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await getMe();
      setUser(res.data);
    } catch {
      clearToken();
      setUser(null);
    }
    setLoading(false);
  }

  function loginUser(userData) {
    setUser(userData);
  }

  function logoutUser() {
    clearToken();
    setUser(null);
  }

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && user?.email === 'admin@eyeonsite.com';

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated, isAdmin, isSuperAdmin, loginUser, logoutUser, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
