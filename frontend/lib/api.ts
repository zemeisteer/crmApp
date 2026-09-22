// TalimCRM — typed API client wrapping fetch calls to the NestJS backend.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const TOKEN_KEY = "talimcrm_token";
const REFRESH_KEY = "talimcrm_refresh";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REFRESH_KEY, token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

// Tries once to trade the stored refresh token for a new access token.
// Multiple 401s arriving at once share a single in-flight refresh call
// instead of each firing their own.
async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = await res.json();
        setToken(body.accessToken);
        setRefreshToken(body.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  _retried = false,
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

  // A 401 while we were sending a token: try a silent refresh once before
  // giving up and bouncing to login. A 401 with no token attached (e.g. a
  // failed login attempt itself) is just a normal error to surface.
  if (res.status === 401 && token) {
    if (!_retried && (await tryRefresh())) {
      return request<T>(path, options, true);
    }
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

// Downloads a file (xlsx/pdf) as a Blob, using the same auth header as
// request(), and triggers a browser save via a temporary <a download>.
async function download(path: string, filename: string) {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message || "Yuklab bo'lmadi", res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Types ----

export type Role = "SUPERADMIN" | "ADMIN" | "TEACHER" | "ACCOUNTANT";

export type TenantCategory = "TIL_MARKAZI" | "MATEMATIKA" | "IT" | "BOSHQA";

export const TENANT_CATEGORY_LABELS: Record<TenantCategory, string> = {
  TIL_MARKAZI: "Til markazi",
  MATEMATIKA: "Matematika markazi",
  IT: "IT markazi",
  BOSHQA: "Boshqa",
};

// Subject suggestions surfaced when creating a group, based on the tenant's
// category — e.g. a language center sees IELTS/English, not algebra.
export const CATEGORY_SUBJECT_SUGGESTIONS: Record<TenantCategory, string[]> = {
  TIL_MARKAZI: ["IELTS", "Ingliz tili", "Rus tili", "Koreys tili", "Nemis tili", "Arab tili", "Turk tili"],
  MATEMATIKA: ["Matematika", "Algebra", "Geometriya", "DTM tayyorlov"],
  IT: ["Dasturlash", "Web dasturlash", "Python", "Frontend", "Backend", "Grafik dizayn"],
  BOSHQA: [],
};

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  accentColor: string;
  category: TenantCategory;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
  telegramUsername: string | null;
  website: string | null;
  websiteLabel: string | null;
  language: "UZ" | "RU" | "EN";
  currency: "UZS" | "USD" | "RUB";
  plan: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShowcaseGroup {
  id: string;
  name: string;
  subject: string;
  level?: string | null;
  schedule?: string | null;
  scheduleDays?: string | null;
  startTime?: string | null;
  monthlyPrice: number;
  teacherName?: string | null;
  branchName?: string | null;
}

export interface PublicShowcaseTeacher {
  id: string;
  fullName: string;
  subject?: string | null;
  startDate?: string | null;
}

export interface PublicShowcaseBranch {
  id: string;
  name: string;
  address?: string | null;
}

export interface PublicShowcaseAnnouncement {
  id: string;
  title: string;
  content: string;
  priority: string;
  publishedAt: string;
}

export interface PublicShowcaseData {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    category: TenantCategory;
    accentColor: string;
    logoUrl?: string | null;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
    telegramUsername?: string | null;
    website?: string | null;
    websiteLabel?: string | null;
    language?: string;
  };
  stats: {
    coursesCount: number;
    teachersCount: number;
    branchesCount: number;
  };
  subjects: { subject: string; courses: string[]; groupCount: number }[];
  groups: PublicShowcaseGroup[];
  teachers: PublicShowcaseTeacher[];
  branches: PublicShowcaseBranch[];
  announcements: PublicShowcaseAnnouncement[];
}

export interface PublicApplyDto {
  fullName: string;
  phone: string;
  parentPhone?: string;
  subject?: string;
  branchId?: string;
  notes?: string;
}

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  tenant: Tenant;
}

export type LoginResponse = AuthResponse | { twoFactorRequired: true; pendingToken: string };

export interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  createdAt: string;
}

export interface Group {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  subject: string;
  level: string | null;
  teacherId: string | null;
  startDate: string | null;
  maxStudents: number;
  schedule: string | null;
  scheduleDays: string | null;
  startTime: string | null;
  monthlyPrice: number;
  description: string | null;
  durationMonths: number | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  teacher?: Teacher | null;
  branch?: Branch | null;
}

export type LeadStatus = 'NEW' | 'CONTACTED' | 'TRIAL_BOOKED' | 'TRIAL_ATTENDED' | 'QUALIFIED' | 'ENROLLED' | 'LOST';
export type LeadSource = 'INSTAGRAM' | 'TELEGRAM' | 'WEBSITE' | 'RECOMMENDATION' | 'BANNER' | 'WALK_IN' | 'OTHER';

export interface Lead {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  parentPhone?: string | null;
  status: LeadStatus;
  source: LeadSource;
  subject?: string | null;
  branchId?: string | null;
  branch?: Branch | null;
  trialDate?: string | null;
  trialGroupId?: string | null;
  trialGroup?: Group | null;
  convertedStudentId?: string | null;
  convertedStudent?: Student | null;
  lostReason?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FunnelStats {
  total: number;
  counts: Record<LeadStatus, number>;
  conversionRate: number;
}

export type Gender = "MALE" | "FEMALE";

export interface Student {
  id: string;
  tenantId: string;
  fullName: string;
  gender: Gender | null;
  phone: string | null;
  parentPhone: string | null;
  birthDate: string | null;
  address: string | null;
  telegramUsername: string | null;
  telegramChatId: string | null;
  startDate: string | null;
  deletedAt?: string | null;
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
  birthDate: string | null;
  startDate?: string | null;
  salaryType: string | null;
  salaryValue: number | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  studentId: string;
  amount: number;
  discount: number;
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

export interface SalaryPayment {
  id: string;
  tenantId: string;
  teacherId: string;
  amount: number;
  forMonth: string;
  paidAt: string;
  createdAt: string;
}

export interface BillingLink {
  url: string;
  transactionId: string;
}

export interface HomeworkCompletion {
  id: string;
  homeworkId: string;
  studentId: string;
  completed: boolean;
  updatedAt: string;
  student?: Student;
}

export interface Homework {
  id: string;
  tenantId: string;
  groupId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  createdAt: string;
  updatedAt: string;
  group?: Group;
  completions?: HomeworkCompletion[];
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  price: number;
  features: string;
  popular: boolean;
  active: boolean;
  tenantCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: "create" | "update" | "delete" | "restore";
  entityType: string;
  entityId: string;
  meta: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; email: string } | null;
}

export interface ExamQuestionOption {
  id: string;
  text: string;
}

export type ExamQuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER';

export interface ExamQuestion {
  id: string;
  tenantId: string;
  examId: string;
  prompt: string;
  questionType: ExamQuestionType;
  options: ExamQuestionOption[] | string | null;
  correctAnswer: string;
  explanation?: string | null;
  points: number;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamAttempt {
  id: string;
  tenantId: string;
  examId: string;
  studentId: string;
  startedAt: string;
  completedAt?: string | null;
  score: number;
  maxScore: number;
  passed: boolean;
  answers: string;
  createdAt: string;
  student?: Student;
}

export interface ExamAttemptBreakdown {
  questionId: string;
  prompt: string;
  questionType: ExamQuestionType;
  options: ExamQuestionOption[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  points: number;
  earned: number;
  explanation?: string;
}

export interface SubmitAttemptResult {
  attempt: ExamAttempt;
  score: number;
  maxScore: number;
  earnedPoints: number;
  totalPoints: number;
  passed: boolean;
  percentage: number;
  breakdown: ExamAttemptBreakdown[];
}

export interface Exam {
  id: string;
  tenantId: string;
  groupId: string;
  title: string;
  description: string | null;
  maxScore: number;
  passingScore: number | null;
  durationMinutes: number | null;
  materialPath: string | null;
  materialName: string | null;
  examDate: string | null;
  createdAt: string;
  group?: Group;
  results?: { id: string; studentId: string; score: number; note: string | null; student: Student }[];
  questions?: ExamQuestion[];
  attempts?: ExamAttempt[];
}

export interface Webhook {
  id: string;
  tenantId: string;
  url: string;
  event: string;
  secret: string;
  active: boolean;
  createdAt: string;
}

export interface Certificate {
  id: string;
  tenantId: string;
  studentId: string;
  groupId?: string | null;
  code: string;
  title: string;
  grade?: string | null;
  issueDate: string;
  signatoryName: string;
  signatoryTitle?: string | null;
  description?: string | null;
  createdAt: string;
  student?: { id: string; fullName: string; phone?: string };
  group?: { id: string; name: string; subject?: string };
}

export interface PublicCertificate {
  valid: boolean;
  message?: string;
  code?: string;
  studentName?: string;
  title?: string;
  grade?: string | null;
  issueDate?: string;
  organizationName?: string;
  courseName?: string | null;
  subject?: string | null;
  signatoryName?: string;
  signatoryTitle?: string | null;
  description?: string | null;
}

export type AnnouncementPriority = 'NORMAL' | 'HIGH' | 'URGENT';
export type AnnouncementAudience = 'ALL' | 'STUDENTS' | 'TEACHERS' | 'GROUP';

export interface Announcement {
  id: string;
  tenantId: string;
  authorId?: string | null;
  title: string;
  content: string;
  targetAudience: AnnouncementAudience;
  targetGroupId?: string | null;
  priority: AnnouncementPriority;
  sendTelegram: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; fullName: string; email: string };
  targetGroup?: { id: string; name: string; subject: string };
}

// ---- Auth ----

export const authApi = {
  register: (data: {
    centerName: string;
    subdomain: string;
    email: string;
    password: string;
    fullName: string;
    category?: TenantCategory;
  }) => request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  verifyTwoFactorLogin: (pendingToken: string, code: string) =>
    request<AuthResponse>("/auth/2fa/verify-login", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),

  setupTwoFactor: () => request<{ secret: string; qrDataUrl: string }>("/auth/2fa/setup", { method: "POST" }),
  confirmTwoFactor: (code: string) => request<{ message: string }>("/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  disableTwoFactor: (code: string) => request<{ message: string }>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) }),

  logout: () => {
    const refreshToken = getRefreshToken();
    return request<{ success: boolean }>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) });
  },

  sessions: () => request<Session[]>("/auth/sessions"),
  revokeSession: (id: string) => request<{ success: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" }),

  me: () => request<{ user: User; tenant: Tenant }>("/auth/me"),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, password: string) =>
    request<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),

  verifyEmail: (token: string) => request<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`),
};

// ---- Groups ----

export const groupsApi = {
  list: () => request<Group[]>("/groups"),
  trash: () => request<Group[]>("/groups/trash"),
  get: (id: string) => request<Group>(`/groups/${id}`),
  create: (data: Partial<Group>) =>
    request<Group>("/groups", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Group>) =>
    request<Group>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/groups/${id}`, { method: "DELETE" }),
  restore: (id: string) => request<Group>(`/groups/${id}/restore`, { method: "POST" }),
  scheduleConflicts: (params: { teacherId: string; days: string; startTime: string; excludeId?: string }) => {
    const qs = new URLSearchParams({
      teacherId: params.teacherId,
      days: params.days,
      startTime: params.startTime,
      ...(params.excludeId ? { excludeId: params.excludeId } : {}),
    });
    return request<{ id: string; name: string; scheduleDays: string | null; startTime: string | null }[]>(
      `/groups/schedule-conflicts?${qs.toString()}`,
    );
  },
};

// ---- Students ----

export const studentsApi = {
  list: () => request<Student[]>("/students"),
  trash: () => request<Student[]>("/students/trash"),
  get: (id: string) => request<Student>(`/students/${id}`),
  create: (data: Partial<Student> & { groupId?: string; groupIds?: string[] }) =>
    request<Student>("/students", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Student>) =>
    request<Student>(`/students/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/students/${id}`, { method: "DELETE" }),
  restore: (id: string) => request<Student>(`/students/${id}/restore`, { method: "POST" }),
  enroll: (id: string, groupId: string) =>
    request<{ success: boolean }>(`/students/${id}/enroll/${groupId}`, { method: "POST" }),
  unenroll: (id: string, groupId: string) =>
    request<{ success: boolean }>(`/students/${id}/enroll/${groupId}`, { method: "DELETE" }),
};

// ---- Teachers ----

export const teachersApi = {
  list: () => request<Teacher[]>("/teachers"),
  trash: () => request<Teacher[]>("/teachers/trash"),
  get: (id: string) => request<Teacher>(`/teachers/${id}`),
  create: (data: Partial<Teacher>) =>
    request<Teacher>("/teachers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Teacher>) =>
    request<Teacher>(`/teachers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/teachers/${id}`, { method: "DELETE" }),
  restore: (id: string) => request<Teacher>(`/teachers/${id}/restore`, { method: "POST" }),
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

// ---- Salary payments ----

export const salaryApi = {
  list: (teacherId?: string) =>
    request<SalaryPayment[]>(`/salary-payments${teacherId ? `?teacherId=${teacherId}` : ""}`),
  create: (data: { teacherId: string; amount: number; forMonth: string; paidAt?: string }) =>
    request<SalaryPayment>("/salary-payments", { method: "POST", body: JSON.stringify(data) }),
};

// ---- Tenants (settings + superadmin) ----

export const tenantsApi = {
  listAll: () => request<Tenant[]>("/tenants"),
  get: (id: string) => request<Tenant>(`/tenants/${id}`),
  updateMe: (data: {
    name?: string; accentColor?: string; category?: TenantCategory; phone?: string; address?: string;
    email?: string; telegramUsername?: string; website?: string; websiteLabel?: string;
    language?: "UZ" | "RU" | "EN"; currency?: "UZS" | "USD" | "RUB";
  }) => request<Tenant>("/tenants/me", { method: "PATCH", body: JSON.stringify(data) }),
  uploadLogo: (file: File) => uploadFile<Tenant>("/tenants/me/logo", file),
  updateStatus: (id: string, data: { status?: string; plan?: string }) =>
    request<Tenant>(`/tenants/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  bySubdomain: (subdomain: string) =>
    request<Pick<Tenant, "id" | "name" | "subdomain" | "accentColor" | "plan">>(`/tenants/by-subdomain/${subdomain}`),
  getPublicShowcase: (subdomain: string) =>
    request<PublicShowcaseData>(`/tenants/by-subdomain/${encodeURIComponent(subdomain)}/public-showcase`),
  publicApply: (subdomain: string, data: PublicApplyDto) =>
    request<{ success: boolean; leadId: string; message: string }>(
      `/tenants/by-subdomain/${encodeURIComponent(subdomain)}/apply`,
      { method: "POST", body: JSON.stringify(data) },
    ),
  create: (data: { name: string; subdomain: string; adminEmail: string; adminPassword: string; adminFullName: string }) =>
    request<{ tenant: Tenant; admin: { id: string; email: string; fullName: string } }>("/tenants", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  remove: (id: string) => request<{ success: boolean }>(`/tenants/${id}`, { method: "DELETE" }),
  exportData: () => request<Record<string, unknown>>("/tenants/me/export"),
  deleteMe: (password: string) => request<{ success: boolean }>("/tenants/me", { method: "DELETE", body: JSON.stringify({ password }) }),
};

// ---- Staff (tenant's own users — admins, teachers, accountants) ----

export const staffApi = {
  list: () => request<StaffMember[]>("/staff"),
  create: (data: { fullName: string; email: string; password: string; role: Role }) =>
    request<StaffMember>("/staff", { method: "POST", body: JSON.stringify(data) }),
  updateRole: (id: string, role: Role) => request<StaffMember>(`/staff/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  remove: (id: string) => request<{ success: boolean }>(`/staff/${id}`, { method: "DELETE" }),
};

// ---- Billing (Click / Payme — a tenant collecting payments from ITS students) ----

export const billingApi = {
  clickLink: (data: { studentId: string; amount: number; forMonth: string }) =>
    request<BillingLink>("/billing/click/link", { method: "POST", body: JSON.stringify(data) }),
  paymeLink: (data: { studentId: string; amount: number; forMonth: string }) =>
    request<BillingLink>("/billing/payme/link", { method: "POST", body: JSON.stringify(data) }),
};

// ---- Platform billing (a tenant paying TalimCRM itself) ----

export const platformBillingApi = {
  clickLink: (data: { plan: string; forMonth: string }) =>
    request<BillingLink & { amount: number }>("/platform-billing/click/link", { method: "POST", body: JSON.stringify(data) }),
  paymeLink: (data: { plan: string; forMonth: string }) =>
    request<BillingLink & { amount: number }>("/platform-billing/payme/link", { method: "POST", body: JSON.stringify(data) }),
};

// ---- Telegram ----

export const telegramApi = {
  status: () => request<{ configured: boolean; botUsername: string | null }>("/telegram/status"),
  generateLinkToken: (studentId: string) =>
    request<{ token: string; linkUrl: string | null; expiresAt: string; studentName: string }>("/telegram/link-token", {
      method: "POST",
      body: JSON.stringify({ studentId }),
    }),
};

// ---- AI ----

export const aiApi = {
  groupInsights: (groupId: string) =>
    request<{ insight: string }>("/ai/insights", { method: "POST", body: JSON.stringify({ groupId }) }),
  generateMaterial: (data: { subject: string; level?: string; topic: string; type: string; customInstructions?: string }) =>
    request<{ material: string }>("/ai/materials", { method: "POST", body: JSON.stringify(data) }),
  suggestHomework: (data: { subject?: string; groupName?: string; topic?: string }) =>
    request<{ title: string; description: string; dueDays?: number }>("/ai/suggest-homework", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};


// ---- Homework ----

async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.message || "Fayl yuklanmadi", res.status);
  return body as T;
}

export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = API_URL.replace(/\/api\/?$/, "");
  return `${base}/uploads/${path}`;
}

export const homeworkApi = {
  list: (groupId?: string) => request<Homework[]>(`/homework${groupId ? `?groupId=${groupId}` : ""}`),
  create: (data: { groupIds: string[]; title: string; description?: string; dueDate?: string }) =>
    request<Homework[]>("/homework", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; description?: string; dueDate?: string }) =>
    request<Homework>(`/homework/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/homework/${id}`, { method: "DELETE" }),
  uploadAttachment: (id: string, file: File) => uploadFile<Homework>(`/homework/${id}/attachment`, file),
  roster: (id: string) => request<{ student: Student; completed: boolean }[]>(`/homework/${id}/roster`),
  setCompletion: (id: string, studentId: string, completed: boolean) =>
    request<{ success: boolean }>(`/homework/${id}/completions`, { method: "POST", body: JSON.stringify({ studentId, completed }) }),
};

// ---- Branches ----

export const branchesApi = {
  list: () => request<Branch[]>("/branches"),
  create: (data: { name: string; address?: string }) =>
    request<Branch>("/branches", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; address?: string }) =>
    request<Branch>(`/branches/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/branches/${id}`, { method: "DELETE" }),
};

// ---- Exams / grading ----

export const examsApi = {
  list: (groupId?: string) => request<Exam[]>(`/exams${groupId ? `?groupId=${groupId}` : ""}`),
  get: (id: string) => request<Exam>(`/exams/${id}`),
  create: (data: {
    groupIds: string[];
    title: string;
    description?: string;
    maxScore?: number;
    passingScore?: number;
    durationMinutes?: number;
    examDate?: string;
  }) => request<Exam[]>("/exams", { method: "POST", body: JSON.stringify(data) }),
  submitResults: (examId: string, results: { studentId: string; score: number; note?: string }[]) =>
    request<unknown>(`/exams/${examId}/results`, { method: "POST", body: JSON.stringify({ results }) }),
  remove: (id: string) => request<{ success: boolean }>(`/exams/${id}`, { method: "DELETE" }),
  uploadMaterial: (id: string, file: File) => uploadFile<Exam>(`/exams/${id}/material`, file),
  getQuestions: (id: string) => request<ExamQuestion[]>(`/exams/${id}/questions`),
  createQuestion: (id: string, data: {
    prompt: string;
    questionType?: ExamQuestionType;
    options?: ExamQuestionOption[];
    correctAnswer: string;
    explanation?: string;
    points?: number;
    order?: number;
  }) => request<ExamQuestion>(`/exams/${id}/questions`, { method: "POST", body: JSON.stringify(data) }),
  removeQuestion: (id: string, questionId: string) =>
    request<{ success: boolean }>(`/exams/${id}/questions/${questionId}`, { method: "DELETE" }),
  generateQuestions: (id: string) =>
    request<ExamQuestion[]>(`/exams/${id}/generate-questions`, { method: "POST" }),
  startAttempt: (id: string, studentId: string) =>
    request<{
      exam: { id: string; title: string; description: string | null; durationMinutes: number | null; maxScore: number; passingScore: number | null; questionCount: number };
      student: { id: string; fullName: string };
      questions: { id: string; prompt: string; questionType: ExamQuestionType; options: ExamQuestionOption[]; points: number; order: number }[];
    }>(`/exams/${id}/start-attempt?studentId=${studentId}`),
  submitAttempt: (id: string, data: { studentId: string; answers: Record<string, string> }) =>
    request<SubmitAttemptResult>(`/exams/${id}/submit-attempt`, { method: "POST", body: JSON.stringify(data) }),
  getAttempts: (id: string) => request<ExamAttempt[]>(`/exams/${id}/attempts`),
};

// ---- Plans (superadmin plan management; public listing for landing/register) ----

export const plansApi = {
  listPublic: () => request<Plan[]>("/plans/public"),
  listAll: () => request<Plan[]>("/plans"),
  create: (data: { key: string; name: string; price: number; features?: string; popular?: boolean; active?: boolean }) =>
    request<Plan>("/plans", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; price: number; features: string; popular: boolean; active: boolean }>) =>
    request<Plan>(`/plans/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/plans/${id}`, { method: "DELETE" }),
};

// ---- Webhooks ----

export const webhooksApi = {
  list: () => request<Webhook[]>("/webhooks"),
  create: (data: { url: string; event: string }) =>
    request<Webhook>("/webhooks", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { active?: boolean }) =>
    request<Webhook>(`/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/webhooks/${id}`, { method: "DELETE" }),
};

// ---- Audit log ----

export const auditApi = {
  list: (entityType?: string) => request<AuditLog[]>(`/audit-logs${entityType ? `?entityType=${entityType}` : ""}`),
};

// ---- Export / import ----

export const exportApi = {
  studentsXlsx: () => download("/export/students.xlsx", "oquvchilar.xlsx"),
  paymentsXlsx: () => download("/export/payments.xlsx", "tolovlar.xlsx"),
  receiptPdf: (paymentId: string) => download(`/export/payments/${paymentId}/receipt.pdf`, `kvitansiya-${paymentId}.pdf`),
  importStudents: async (file: File) => {
    const token = getToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/export/students/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body?.message || "Import xato", res.status);
    return body as { imported: number; errors: string[] };
  },
};

// ---- Admissions / Leads CRM ----

export const leadsApi = {
  list: (query?: { status?: string; source?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (query?.status) q.set("status", query.status);
    if (query?.source) q.set("source", query.source);
    if (query?.search) q.set("search", query.search);
    const qs = q.toString();
    return request<Lead[]>(`/leads${qs ? `?${qs}` : ""}`);
  },
  funnel: () => request<FunnelStats>("/leads/funnel"),
  get: (id: string) => request<Lead>(`/leads/${id}`),
  create: (data: {
    fullName: string;
    phone: string;
    parentPhone?: string;
    status?: LeadStatus;
    source?: LeadSource;
    subject?: string;
    branchId?: string;
    trialDate?: string;
    trialGroupId?: string;
    notes?: string;
  }) => request<Lead>("/leads", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Lead>) =>
    request<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  convert: (
    id: string,
    data: { groupIds?: string[]; gender?: Gender; birthDate?: string; address?: string },
  ) =>
    request<{ student: Student; lead: Lead }>(`/leads/${id}/convert`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  remove: (id: string) => request<{ success: boolean }>(`/leads/${id}`, { method: "DELETE" }),
};

// ---- Certificates (Spec Section 23) ----

export const certificatesApi = {
  list: (query?: { studentId?: string; groupId?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (query?.studentId) q.set("studentId", query.studentId);
    if (query?.groupId) q.set("groupId", query.groupId);
    if (query?.search) q.set("search", query.search);
    const qs = q.toString();
    return request<Certificate[]>(`/certificates${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Certificate>(`/certificates/${id}`),
  create: (data: {
    studentId: string;
    groupId?: string;
    title: string;
    grade?: string;
    issueDate?: string;
    signatoryName?: string;
    signatoryTitle?: string;
    description?: string;
  }) => request<Certificate>("/certificates", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/certificates/${id}`, { method: "DELETE" }),
  verifyPublic: (code: string) =>
    request<PublicCertificate>(`/certificates/verify/${encodeURIComponent(code)}`),
};

// ---- Announcements & News (Spec Section 33) ----

export const announcementsApi = {
  list: (query?: { targetAudience?: string; priority?: string; targetGroupId?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (query?.targetAudience) q.set("targetAudience", query.targetAudience);
    if (query?.priority) q.set("priority", query.priority);
    if (query?.targetGroupId) q.set("targetGroupId", query.targetGroupId);
    if (query?.search) q.set("search", query.search);
    const qs = q.toString();
    return request<Announcement[]>(`/announcements${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Announcement>(`/announcements/${id}`),
  create: (data: {
    title: string;
    content: string;
    targetAudience?: string;
    targetGroupId?: string;
    priority?: string;
    sendTelegram?: boolean;
  }) => request<Announcement>("/announcements", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/announcements/${id}`, { method: "DELETE" }),
};


