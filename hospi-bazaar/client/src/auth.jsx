import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // Used after login / registration: the API returns { token, user }.
  const signIn = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

/** Where each kind of user lands after signing in. */
export function homeFor(user) {
  if (!user) return '/login';
  if (user.type === 'admin') return '/admin';
  if (user.type === 'supplier_user') return '/supplier';
  return '/hospital';
}
