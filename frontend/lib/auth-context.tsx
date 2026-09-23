"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  authApi,
  getToken,
  setToken,
  setRefreshToken,
  clearToken,
  Tenant,
  User,
  LoginResponse,
  AuthResponse,
  TenantCategory,
} from "./api";

interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  can: (permission: string) => boolean;
  login: (emailOrPhone: string, password: string) => Promise<LoginResponse>;
  selectWorkspace: (tenantId: string) => Promise<void>;
  completeTwoFactorLogin: (pendingToken: string, code: string) => Promise<void>;
  setAuthSession: (res: AuthResponse, redirectUrl?: string) => void;
  register: (data: {
    centerName: string;
    subdomain?: string;
    email: string;
    password: string;
    fullName: string;
    category?: TenantCategory;
  }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPERADMIN: ["*"],
  OWNER: ["*"],
  ADMIN: ["*"],
  MANAGER: [
    "students.read", "students.create", "students.update",
    "attendance.read", "attendance.mark",
    "groups.manage", "homework.manage", "exams.manage", "certificates.manage", "reports.export",
  ],
  RECEPTIONIST: [
    "students.read", "students.create", "students.update",
    "attendance.read", "payments.read", "payments.create", "notifications.send",
  ],
  ACCOUNTANT: [
    "payments.read", "payments.create", "expenses.manage", "reports.export", "notifications.send",
  ],
  TEACHER: [
    "students.read", "attendance.read", "attendance.mark", "homework.manage", "exams.manage",
  ],
  STUDENT: ["portal.access"],
  PARENT: ["portal.access"],
};

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

  function setAuthSession(res: AuthResponse, redirectUrl?: string) {
    setToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);

    const destination =
      redirectUrl ||
      (res.user.role === "STUDENT" || res.user.role === "PARENT"
        ? "/portal"
        : "/dashboard");
    router.push(destination);
  }

  async function login(emailOrPhone: string, password: string): Promise<LoginResponse> {
    const res = await authApi.login({ login: emailOrPhone, password });
    
    // Check if 2FA is required
    if ("pendingToken" in res) return res;

    // Check if workspace selection is required (user has multiple centers)
    if ("requiresWorkspaceSelection" in res) return res;

    // Single active membership: log straight into that workspace
    setAuthSession(res);
    return res;
  }

  async function selectWorkspace(tenantId: string) {
    const res = await authApi.selectWorkspace(tenantId);
    setAuthSession(res);
  }

  async function completeTwoFactorLogin(pendingToken: string, code: string) {
    const res = await authApi.verifyTwoFactorLogin(pendingToken, code);
    setAuthSession(res);
  }

  async function register(data: {
    centerName: string;
    subdomain?: string;
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
    // Directly start center onboarding wizard
    router.push("/onboarding");
  }

  function can(permission: string): boolean {
    if (!user) return false;
    if (user.role === "SUPERADMIN" || user.role === "OWNER" || user.role === "ADMIN") return true;
    const custom = user.permissions || [];
    if (custom.includes(permission)) return true;
    const defaults = DEFAULT_ROLE_PERMISSIONS[user.role] || [];
    return defaults.includes(permission) || defaults.includes("*");
  }

  function logout() {
    authApi.logout().catch(() => undefined);
    clearToken();
    setUser(null);
    setTenant(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        loading,
        can,
        login,
        selectWorkspace,
        completeTwoFactorLogin,
        setAuthSession,
        register,
        logout,
        refreshMe: loadMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
