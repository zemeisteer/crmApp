// TalimCRM — typed API client wrapping fetch calls to the NestJS backend.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const TOKEN_KEY = "talimcrm_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  // A 401 while we were sending a token means the session expired — clear it
  // and bounce to login. A 401 with no token attached (e.g. a failed login
  // attempt itself) is just a normal error to surface to the caller.
  if (res.status === 401 && token) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!res.ok) {
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : body?.message || "Xatolik yuz berdi";
    throw new ApiError(message, res.status);
  }

  return body as T;
}

// ---- Types ----

export type Role = "SUPERADMIN" | "ADMIN" | "TEACHER" | "ACCOUNTANT";

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  accentColor: string;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
  tenant: Tenant;
}

export interface Group {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  level: string | null;
  teacherId: string | null;
  startDate: string | null;
  maxStudents: number;
  schedule: string | null;
  monthlyPrice: number;
  createdAt: string;
  updatedAt: string;
  teacher?: Teacher | null;
}

export interface Student {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string | null;
  parentPhone: string | null;
  birthDate: string | null;
  address: string | null;
  telegramUsername: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  enrollments?: { id: string; groupId: string; joinedAt: string; group: Group }[];
}

export interface Teacher {
  id: string;
  tenantId: string;
  userId: string | null;
  fullName: string;
  subject: string | null;
  phone: string | null;
  email: string | null;
  salaryType: string | null;
  salaryValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  studentId: string;
  amount: number;
  method: string | null;
  status: string;
  forMonth: string;
  paidAt: string | null;
  createdAt: string;
}

export interface PaymentsSummary {
  totalPaid: number;
  pendingCount: number;
  failedCount: number;
  count: number;
}

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE";

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  groupId: string;
  studentId: string;
  date: string;
  status: AttendanceStatus;
  createdAt: string;
  updatedAt: string;
}

// ---- Auth ----

export const authApi = {
  register: (data: {
    centerName: string;
    subdomain: string;
    email: string;
    password: string;
    fullName: string;
  }) => request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  me: () => request<{ user: User; tenant: Tenant }>("/auth/me"),
};

// ---- Groups ----

export const groupsApi = {
  list: () => request<Group[]>("/groups"),
  get: (id: string) => request<Group>(`/groups/${id}`),
  create: (data: Partial<Group>) =>
    request<Group>("/groups", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Group>) =>
    request<Group>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/groups/${id}`, { method: "DELETE" }),
};

// ---- Students ----

export const studentsApi = {
  list: () => request<Student[]>("/students"),
  get: (id: string) => request<Student>(`/students/${id}`),
  create: (data: Partial<Student> & { groupId?: string }) =>
    request<Student>("/students", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Student>) =>
    request<Student>(`/students/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/students/${id}`, { method: "DELETE" }),
  enroll: (id: string, groupId: string) =>
    request<{ success: boolean }>(`/students/${id}/enroll/${groupId}`, { method: "POST" }),
  unenroll: (id: string, groupId: string) =>
    request<{ success: boolean }>(`/students/${id}/enroll/${groupId}`, { method: "DELETE" }),
};

// ---- Teachers ----

export const teachersApi = {
  list: () => request<Teacher[]>("/teachers"),
  get: (id: string) => request<Teacher>(`/teachers/${id}`),
  create: (data: Partial<Teacher>) =>
    request<Teacher>("/teachers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Teacher>) =>
    request<Teacher>(`/teachers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/teachers/${id}`, { method: "DELETE" }),
};

// ---- Payments ----

export const paymentsApi = {
  list: () => request<Payment[]>("/payments"),
  summary: () => request<PaymentsSummary>("/payments/summary"),
  create: (data: Partial<Payment>) =>
    request<Payment>("/payments", { method: "POST", body: JSON.stringify(data) }),
};

// ---- Attendance ----

export const attendanceApi = {
  list: (params?: { groupId?: string; studentId?: string; date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.groupId) qs.set("groupId", params.groupId);
    if (params?.studentId) qs.set("studentId", params.studentId);
    if (params?.date) qs.set("date", params.date);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AttendanceRecord[]>(`/attendance${suffix}`);
  },
  mark: (data: { groupId: string; date: string; entries: { studentId: string; status: AttendanceStatus }[] }) =>
    request<AttendanceRecord[]>("/attendance", { method: "POST", body: JSON.stringify(data) }),
};
