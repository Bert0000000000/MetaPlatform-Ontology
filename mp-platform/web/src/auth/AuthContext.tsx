// src/auth/AuthContext.tsx
// 简易 AuthContext, 全局共享登录态

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getToken, getUser, setToken, setUser, clearSession, type SessionUser,
} from '@/api/client';

interface AuthCtx {
  user: SessionUser | null;
  token: string | null;
  login: (jwt: string, user: SessionUser) => void;
  logout: () => void;
  isReady: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setU] = useState<SessionUser | null>(null);
  const [token, setT] = useState<string | null>(null);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    setU(getUser());
    setT(getToken());
    setReady(true);
  }, []);

  const login = (jwt: string, u: SessionUser) => {
    setToken(jwt);
    setUser(u);
    setU(u);
    setT(jwt);
  };

  const logout = () => {
    clearSession();
    setU(null);
    setT(null);
  };

  return (
    <Ctx.Provider value={{ user, token, login, logout, isReady }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
