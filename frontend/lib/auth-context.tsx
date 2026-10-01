"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { centerRedirectBase, rememberCenter } from "./domain";
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
    "admissions.read", "admissions.create", "admissions.update", "admissions.assign",
    "admissions.convert", "admissions.analytics", "admissions.export", "admissions.manage",
  ],
  RECEPTIONIST: [
    "students.read", "students.create", "students.update",
    "attendance.read", "payments.read", "payments.create", "notifications.send",
    "admissions.read", "admissions.create", "admissions.update",
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

// The flag is present on every login response; only `true` asks for a choice.
export function isWorkspaceSelection(
  res: LoginResponse,
): res is Extract<LoginResponse, { requiresWorkspaceSelection: true }> {
  return "requiresWorkspaceSelection" in res && res.requiresWorkspaceSelection === true;
}

// Pages that never send staff to another address.
const STAY_PATHS = ["/", "/login", "/register", "/onboarding", "/pricing", "/privacy", "/terms", "/portal", "/t/", "/site/", "/invite", "/verify", "/reset-password", "/forgot-password", "/auth/"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Staff work on their center's own address (<center>.<domain>). Opened
  // anywhere else, the session is carried there with a one-time code and
  // closed here, so there is one login, on the right address. Students and
  // parents use /portal; the superadmin stays on the main site.
  async function moveToCenter(u: User, tn: Tenant | null, path: string): Promise<boolean> {
    if (!tn?.subdomain || u.role === "SUPERADMIN" || u.role === "STUDENT" || u.role === "PARENT") return false;
    const base = centerRedirectBase(tn.subdomain);
    if (!base) return false;
    try {
      const { code } = await authApi.handoff();
      authApi.logout().catch(() => undefined);
      clearToken();
      rememberCenter(tn.subdomain);
      window.location.replace(`${base}/auth/handoff?next=${encodeURIComponent(path)}#code=${code}`);
      return true;
    } catch {
      return false; // stay here: the app still works on this address
    }
  }

  function loadMe() {
    return authApi
      .me()
      .then(async ({ user, tenant }) => {
        const path = window.location.pathname;
        // Only from the back-office pages; public pages stay where they are.
        if (!STAY_PATHS.some((p) => (p === "/" ? path === "/" : path.startsWith(p))) && (await moveToCenter(user, tenant, path + window.location.search))) return;
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
    // New centers finish onboarding first (their address may still change).
    if (destination.startsWith("/onboarding")) {
      router.push(destination);
      return;
    }
    void moveToCenter(res.user, res.tenant, destination).then((moved) => {
      if (!moved) router.push(destination);
    });
  }

  async function login(emailOrPhone: string, password: string): Promise<LoginResponse> {
    const res = await authApi.login({ login: emailOrPhone, password });
    
    // Check if 2FA is required
    if ("pendingToken" in res) return res;

    // Several centers: keep the provisional session so the choice can be
    // submitted, but let the login page show the picker before navigating.
    if (isWorkspaceSelection(res)) {
      setToken(res.accessToken);
      setRefreshToken(res.refreshToken);
      return res;
    }

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
