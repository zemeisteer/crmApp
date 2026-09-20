"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authApi, getToken, setToken, setRefreshToken, clearToken, Tenant, User, LoginResponse, TenantCategory } from "./api";

interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  completeTwoFactorLogin: (pendingToken: string, code: string) => Promise<void>;
  register: (data: {
    centerName: string;
    subdomain: string;
    email: string;
    password: string;
    fullName: string;
    category?: TenantCategory;
  }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  function loadMe() {
    return authApi
      .me()
      .then(({ user, tenant }) => {
        setUser(user);
        setTenant(tenant);
      })
      .catch(() => {
        clearToken();
      });
  }

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    loadMe().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<LoginResponse> {
    const res = await authApi.login({ email, password });
    // Both response shapes carry `twoFactorRequired` (false on a normal
    // login too) — `pendingToken` only exists on the 2FA-pending shape,
    // so that's the real discriminator.
    if ("pendingToken" in res) return res;
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);
    router.push("/dashboard");
    return res;
  }

  async function completeTwoFactorLogin(pendingToken: string, code: string) {
    const res = await authApi.verifyTwoFactorLogin(pendingToken, code);
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);
    router.push("/dashboard");
  }

  async function register(data: {
    centerName: string;
    subdomain: string;
    email: string;
    password: string;
    fullName: string;
    category?: TenantCategory;
  }) {
    const res = await authApi.register(data);
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);
    router.push("/dashboard");
  }

  function logout() {
    authApi.logout().catch(() => undefined);
    clearToken();
    setUser(null);
    setTenant(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, completeTwoFactorLogin, register, logout, refreshMe: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
