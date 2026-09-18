"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authApi, getToken, setToken, clearToken, Tenant, User } from "./api";

interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    centerName: string;
    subdomain: string;
    email: string;
    password: string;
    fullName: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(({ user, tenant }) => {
        setUser(user);
        setTenant(tenant);
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await authApi.login({ email, password });
    setToken(res.accessToken);
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
  }) {
    const res = await authApi.register(data);
    setToken(res.accessToken);
    setUser(res.user);
    setTenant(res.tenant);
    router.push("/dashboard");
  }

  function logout() {
    clearToken();
    setUser(null);
    setTenant(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
