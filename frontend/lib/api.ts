// TalimCRM — typed API client wrapping fetch calls to the NestJS backend.

import type { PublicQuestion, QuestionType, TestQuestion } from "./tests";

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

const PORTAL_TOKEN_KEY = "talimcrm_portal_token";

export function getPortalToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PORTAL_TOKEN_KEY);
}

export function setPortalToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PORTAL_TOKEN_KEY, token);
}

export function clearPortalToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PORTAL_TOKEN_KEY);
  localStorage.removeItem(PORTAL_SESSIONS_KEY);
}

// A parent may have several children signed in at once: one session each,
// switched without signing in again.
export type PortalViewer = "student" | "parent";
export interface PortalSession {
  accessToken: string;
  viewer?: PortalViewer;
  student: { id: string; fullName: string };
  tenant: { id: string; name: string };
}
const PORTAL_SESSIONS_KEY = "talimcrm_portal_sessions";

export function getPortalSessions(): PortalSession[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(PORTAL_SESSIONS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((s) => s?.accessToken && s?.student?.id) : [];
  } catch {
    return [];
  }
}

export function addPortalSessions(list: PortalSession[]): PortalSession[] {
  const byId = new Map(getPortalSessions().map((s) => [s.student.id, s]));
  for (const s of list) byId.set(s.student.id, s);
  const all = [...byId.values()];
  try {
    localStorage.setItem(PORTAL_SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // storage full or blocked: the active token still works
  }
  return all;
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  status: number;
  // Parsed JSON error body, for structured errors such as
  // { code: "DUPLICATE_LEAD", duplicates: [...] }.
  body?: Record<string, unknown> | null;
  constructor(message: string, status: number, body?: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.body = body;
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
  const isPortal = path.startsWith("/portal");
  const token = isPortal ? getPortalToken() : getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  // A caller may pass its own token (e.g. a staff token to a /portal door).
  if (token && !headers["Authorization"]) headers["Authorization"] = `Bearer ${token}`;

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
    if (isPortal) {
      clearPortalToken();
      throw new ApiError("Portal sessiyasi eskirgan", 401);
    }
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
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

// Downloads a file (xlsx/pdf) as a Blob, using the same auth header as
// request(), and triggers a browser save via a temporary <a download>.
async function download(path: string, filename: string, body?: unknown) {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_URL}${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
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

export type Role =
  | "SUPERADMIN"
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "RECEPTIONIST"
  | "TEACHER"
  | "ACCOUNTANT"
  | "STUDENT"
  | "PARENT";

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
  onboardingStep?: string;
  teachingCategories?: string[];
  country?: string;
  timezone?: string;
  studentAiDailyLimit?: number;
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
  endTime?: string | null;
  monthlyPrice: number;
  teacherName?: string | null;
  branchName?: string | null;
  // null when the group has no seat limit.
  seatsLeft?: number | null;
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
  phone?: string | null;
  mapUrl?: string | null;
}

export interface PublicShowcaseAnnouncement {
  id: string;
  title: string;
  content: string;
  priority: string;
  publishedAt: string;
}

// What a center writes about itself for its public site (Settings → Site).
export interface SiteContent {
  heroTitle: string | null;
  heroSubtitle: string | null;
  about: string | null;
  advantages: Array<{ icon: string; title: string; text: string }>;
  results: Array<{ name: string; result: string; detail: string }>;
  testimonials: Array<{ name: string; role: string; text: string }>;
  faq: Array<{ q: string; a: string }>;
  gallery: string[];
  workingHours: string | null;
  socials: { instagram: string | null; telegram: string | null; youtube: string | null; facebook: string | null; tiktok: string | null };
  videoUrl: string | null;
  trialLesson: boolean;
  trialText: string | null;
  placementTestId: string | null;
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
  site?: Omit<SiteContent, "placementTestId">;
  // The center's open placement test, when linked on the site.
  placementTest?: { token: string; title: string } | null;
}

export interface PublicApplyDto {
  fullName: string;
  phone: string;
  parentPhone?: string;
  subject?: string;
  branchId?: string;
  notes?: string;
  consent: boolean;
  // Anti-spam: hidden honeypot field and the time the form was rendered.
  website?: string;
  formStartedAt?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions?: string[] | null;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions?: string[] | null;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  tenant: Tenant;
  // The backend always sends this flag; only `true` means "let the user choose".
  requiresWorkspaceSelection?: false;
}

export interface WorkspaceItem {
  tenantId: string;
  name: string;
  subdomain: string;
  role: Role;
  logoUrl?: string | null;
  status: string;
}

export type LoginResponse =
  | AuthResponse
  | { twoFactorRequired: true; pendingToken: string }
  // Several centers: the backend already issued a session for the first one,
  // which authenticates the follow-up POST /auth/select-workspace.
  | { requiresWorkspaceSelection: true; workspaces: WorkspaceItem[]; accessToken: string; refreshToken: string };

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
  phone?: string | null;
  mapUrl?: string | null;
  createdAt: string;
}

export interface Group {
  // Seats taken (list endpoint only).
  studentCount?: number;
  id: string;
  tenantId: string;
  branchId: string | null;
  courseId?: string | null;
  status?: "PLANNED" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  name: string;
  subject: string;
  level: string | null;
  teacherId: string | null;
  startDate: string | null;
  maxStudents: number;
  schedule: string | null;
  scheduleDays: string | null;
  startTime: string | null;
  endTime?: string | null;
  monthlyPrice: number;
  description: string | null;
  durationMonths: number | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  teacher?: Teacher | null;
  branch?: Branch | null;
  course?: Course | null;
  enrollments?: Array<{ id: string; studentId: string; status?: string; student: Student }>;
}

export type LeadStatus = 'NEW' | 'CONTACTED' | 'TRIAL_BOOKED' | 'TRIAL_ATTENDED' | 'QUALIFIED' | 'ENROLLED' | 'LOST';
export type LeadSource = 'INSTAGRAM' | 'TELEGRAM' | 'WEBSITE' | 'REFERRAL' | 'WALK_IN' | 'PHONE' | 'ADVERTISEMENT' | 'OTHER';
export type LeadLostReason = 'TOO_EXPENSIVE' | 'NO_RESPONSE' | 'CHOSE_COMPETITOR' | 'SCHEDULE_MISMATCH' | 'LOCATION' | 'NOT_INTERESTED' | 'OTHER';
export type LeadActivityType =
  | 'NOTE' | 'CALL' | 'MESSAGE' | 'MEETING' | 'STATUS_CHANGE' | 'FOLLOW_UP_SCHEDULED'
  | 'TRIAL_BOOKED' | 'TRIAL_ATTENDED' | 'CONVERTED' | 'LOST' | 'REOPENED';
export type LeadTrialStatus = 'BOOKED' | 'ATTENDED' | 'MISSED' | 'CANCELLED' | 'RESCHEDULED';

export interface LeadTrial {
  id: string;
  leadId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: LeadTrialStatus;
  outcomeNote?: string | null;
  groupId?: string | null;
  teacherId?: string | null;
  roomId?: string | null;
  group?: { id: string; name: string } | null;
  teacher?: { id: string; fullName: string } | null;
  room?: { id: string; name: string } | null;
  lead?: { id: string; fullName: string; status: LeadStatus };
}

export interface Lead {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  phoneNormalized?: string | null;
  secondaryPhone?: string | null;
  email?: string | null;
  status: LeadStatus;
  source: LeadSource;
  desiredSubjectId?: string | null;
  desiredCourseId?: string | null;
  preferredBranchId?: string | null;
  assignedManagerUserId?: string | null;
  desiredSubject?: { id: string; name: string; status?: string } | null;
  desiredCourse?: { id: string; name: string; status?: string } | null;
  preferredBranch?: { id: string; name: string } | null;
  assignedManager?: { id: string; fullName: string } | null;
  assignedManagerActive?: boolean | null;
  followUpAt?: string | null;
  notes?: string | null;
  lostReason?: LeadLostReason | null;
  lostNote?: string | null;
  lostAt?: string | null;
  convertedAt?: string | null;
  convertedStudentId?: string | null;
  convertedStudent?: { id: string; fullName: string } | null;
  duplicateOfLeadId?: string | null;
  archivedAt?: string | null;
  legacySubject?: string | null;
  trials?: LeadTrial[];
  allowedTransitions?: LeadStatus[];
  // Detail view only: how the lead arrived and its level-test results.
  origin?: {
    channel: "STAFF" | "PUBLIC_FORM" | "PLACEMENT_TEST";
    createdBy: { id: string; fullName: string } | null;
    utm: { source?: string; medium?: string; campaign?: string } | null;
  };
  placementAttempts?: LeadPlacementAttempt[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadPlacementAttempt {
  id: string;
  testId: string;
  testTitle: string;
  subject: string;
  correct: number;
  total: number;
  percent: number;
  suggestedLevel: 1 | 2 | 3;
  reviewStatus: "PENDING" | "DONE";
  createdAt: string;
}

export interface LeadActivity {
  id: string;
  type: LeadActivityType;
  body?: string | null;
  fromStatus?: LeadStatus | null;
  toStatus?: LeadStatus | null;
  metadata?: Record<string, unknown> | null;
  occurredAt: string;
  actor?: { id: string; fullName: string } | null;
}

export interface LeadDuplicate {
  id: string;
  fullName: string;
  status: LeadStatus;
  matchedOn: 'phone' | 'email';
}

export interface LeadListResponse {
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  source?: string;
  preferredBranchId?: string;
  desiredSubjectId?: string;
  assignedManagerUserId?: string;
  followUp?: 'overdue' | 'today' | 'upcoming' | 'none';
  converted?: 'true' | 'false';
  lostReason?: string;
  includeArchived?: 'true' | 'false';
  sort?: 'newest' | 'oldest' | 'next_follow_up' | 'recently_updated';
}

export interface RateValue {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface FollowUpSummary {
  overdue: number;
  today: number;
  upcoming: number;
  asOf: string;
}

export interface LeadAnalytics {
  window: { from: string; to: string };
  snapshot: { total: number; byStatus: Record<LeadStatus, number> };
  cohort: {
    total: number;
    reached: Record<LeadStatus, number>;
    lost: number;
    rates: Record<'contacted' | 'trialBooked' | 'trialAttended' | 'qualified' | 'conversion' | 'lost', RateValue>;
    bySource: Array<{ source: LeadSource } & RateValue>;
    lostReasons: Array<{ reason: LeadLostReason; count: number }>;
    managers: Array<{ managerUserId: string | null; fullName: string | null; assigned: number; enrolled: number; lost: number; open: number }>;
  };
  followUps: FollowUpSummary;
}

// Legacy snapshot shape of GET /leads/funnel.
export interface FunnelStats {
  total: number;
  counts: Record<LeadStatus, number>;
  conversionRate: number;
  bySource?: Record<string, { total: number; enrolled: number; conversionRate: number }>;
}

export interface AssignableManager {
  userId: string;
  fullName: string;
  role: string;
}

export interface StudentMatchCandidate {
  id: string;
  fullName: string;
  matchedOn: 'phone' | 'parentPhone';
  exact?: boolean;
}

export interface ConvertLeadInput {
  studentResolution?: 'AUTO' | 'CREATE_NEW' | 'LINK_EXISTING';
  existingStudentId?: string;
  fullName?: string;
  gender?: Gender;
  birthDate?: string;
  address?: string;
  branchId?: string;
  guardianPhone?: string;
  groupIds?: string[];
  createInvoice?: boolean;
  invoiceForMonth?: string;
  invoiceDueDate?: string;
  invoiceAmount?: number;
}

export interface ConvertLeadResult {
  alreadyConverted: boolean;
  studentCreated: boolean;
  lead: Lead;
  student: Student;
  enrollments: Array<{ id: string; groupId: string; status: string }>;
  invoice: { id: string; amount: number; status: string } | null;
}

export type Gender = "MALE" | "FEMALE";

export interface StudentGuardian {
  id: string;
  relationship?: string;
  isPrimary?: boolean;
  user?: {
    id: string;
    fullName: string;
    phone?: string;
    email?: string;
  };
}

export interface Student {
  id: string;
  tenantId: string;
  branchId?: string | null;
  status?: "ACTIVE" | "PAUSED" | "GRADUATED" | "LEFT";
  leftAt?: string | null;
  leftReason?: string | null;
  notes?: string | null;
  avatarUrl?: string | null;
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
  branch?: Branch | null;
  guardians?: StudentGuardian[];
  enrollments?: { id: string; groupId: string; status?: string; enrolledAt?: string; joinedAt?: string; leftAt?: string | null; group: Group & { teacher?: { id: string; fullName: string } | null } }[];
  // Set when the student came through admissions (lead source).
  origin?: { leadId: string; source: LeadSource; convertedAt: string | null } | null;
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
  // Linked login (set via /teachers/:id/account).
  user?: { id: string; email: string } | null;
}

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface PaymentAllocation {
  id: string;
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  createdAt: string;
  payment?: Payment;
  invoice?: Invoice;
}

export interface Invoice {
  id: string;
  tenantId: string;
  studentId: string;
  enrollmentId?: string | null;
  amount: number;
  amountPaid: number;
  remainingAmount: number;
  currency: string;
  dueDate: string;
  forMonth: string;
  description?: string | null;
  status: InvoiceStatus;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  student?: Student;
  enrollment?: { id: string; group?: { id: string; name: string } };
  allocations?: PaymentAllocation[];
}

export interface Payment {
  id: string;
  tenantId: string;
  studentId: string;
  invoiceId?: string | null;
  amount: number;
  discount: number;
  method: string | null;
  status: string;
  forMonth: string;
  providerTxId?: string | null;
  receiptNumber?: string | null;
  paidAt: string | null;
  createdAt: string;
  student?: {
    id: string;
    fullName: string;
    phone?: string | null;
    parentPhone?: string | null;
    enrollments?: Array<{
      group?: {
        id: string;
        name: string;
        monthlyPrice: number;
      };
    }>;
  };
  invoice?: Invoice;
  allocations?: PaymentAllocation[];
}

export interface PaymentsSummary {
  totalPaid: number;
  pendingCount: number;
  failedCount: number;
  count: number;
}

export type ExpenseCategory =
  | "RENT"
  | "UTILITIES"
  | "SALARY"
  | "MARKETING"
  | "SUPPLIES"
  | "TAX"
  | "OTHER";

export interface Expense {
  id: string;
  tenantId: string;
  branchId?: string | null;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: string;
  date: string;
  notes?: string | null;
  recordedById?: string | null;
  branch?: { id: string; name: string } | null;
  recordedBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensesSummary {
  totalAmount: number;
  count: number;
  byCategory: Record<string, number>;
}

export interface DebtorItem {
  studentId: string;
  studentName: string;
  phone: string | null;
  parentPhone: string | null;
  groups: Array<{ id: string; name: string; monthlyPrice: number }>;
  expectedAmount: number;
  discountAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: "PAID" | "PARTIAL" | "UNPAID";
}

export interface DebtorsResponse {
  forMonth: string;
  totalExpected: number;
  totalPaid: number;
  totalDebt: number;
  totalStudents: number;
  debtorCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  debtors: DebtorItem[];
}

export interface FinanceSummary {
  forMonth: string;
  totalRevenue: number;
  totalCenterExpenses: number;
  totalSalaries: number;
  totalExpenses: number;
  netProfit: number;
  totalExpectedRevenue: number;
  totalOutstandingDebt: number;
  debtorCount: number;
  collectionRate: number;
  revenueByMethod: Record<string, number>;
  expensesByCategory: Record<string, number>;
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
  score?: number | null;
  feedback?: string | null;
  status: "PENDING" | "SUBMITTED" | "GRADED";
  submissionText?: string | null;
  submissionAttachmentUrl?: string | null;
  submittedAt?: string | null;
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
  maxScore: number;
  createdAt: string;
  updatedAt: string;
  group?: Group;
  completions?: HomeworkCompletion[];
}

// Placement questions use the shared rich question model (lib/tests.ts).
export type PlacementQuestion = TestQuestion & { level: 1 | 2 | 3 };

export interface PlacementTestSummary {
  id: string;
  title: string;
  subject: string;
  language: string;
  token: string;
  active: boolean;
  createdAt: string;
  questionCount?: number;
  attempts?: number;
  pending?: number;
}

export interface PlacementAttempt {
  id: string;
  fullName: string;
  phone: string | null;
  correct: number;
  total: number;
  percent: number;
  suggestedLevel: 1 | 2 | 3;
  reviewStatus?: "PENDING" | "DONE";
  leadId?: string | null;
  createdAt: string;
}

// Written answers are scored by the teacher; AI may suggest a score first.
export interface AiSuggestion {
  score: number;
  comment: string;
}

export interface PlacementAttemptDetail {
  id: string;
  fullName: string;
  phone: string | null;
  createdAt: string;
  reviewStatus: "PENDING" | "DONE";
  percent: number;
  earned: number;
  total: number;
  suggestedLevel: 1 | 2 | 3;
  manualScores: Record<string, number>;
  aiReview: Record<string, AiSuggestion>;
  items: Array<{ question: PlacementQuestion; answer: string; earned: number; max: number; pending: boolean; correct: boolean }>;
}

export interface PublicPlacementTest {
  title: string;
  subject: string;
  language: "UZ" | "RU" | "EN";
  centerName: string;
  questions: PublicQuestion[];
}

export const placementApi = {
  list: () => request<PlacementTestSummary[]>("/placement-tests"),
  create: (data: {
    subject: string;
    title?: string;
    level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
    groupId?: string;
    count?: number;
    language?: "UZ" | "RU" | "EN";
    questions?: PlacementQuestion[];
  }) => request<PlacementTestSummary & { source: "ai" | "bank" | "manual"; questions: PlacementQuestion[] }>("/placement-tests", { method: "POST", body: JSON.stringify(data) }),
  get: (id: string) => request<PlacementTestSummary & { questions: PlacementQuestion[] }>(`/placement-tests/${id}`),
  attempts: (id: string) => request<PlacementAttempt[]>(`/placement-tests/${id}/attempts`),
  setActive: (id: string, active: boolean) =>
    request<PlacementTestSummary>(`/placement-tests/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
  rename: (id: string, title: string) =>
    request<PlacementTestSummary>(`/placement-tests/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  getAttempt: (id: string, attemptId: string) => request<PlacementAttemptDetail>(`/placement-tests/${id}/attempts/${attemptId}`),
  gradeAttempt: (id: string, attemptId: string, scores: Record<string, number>) =>
    request<PlacementAttemptDetail>(`/placement-tests/${id}/attempts/${attemptId}/grade`, { method: "POST", body: JSON.stringify({ scores }) }),
  aiReviewAttempt: (id: string, attemptId: string) =>
    request<PlacementAttemptDetail>(`/placement-tests/${id}/attempts/${attemptId}/ai-review`, { method: "POST" }),
  parsePdf: (file: File) => uploadFile<{ questions: PlacementQuestion[] }>("/placement-tests/parse-pdf", file),
  publicGet: (token: string) => request<PublicPlacementTest>(`/public/placement/${encodeURIComponent(token)}`),
  publicSubmit: (token: string, data: { fullName: string; phone?: string; answers: string[] }) =>
    request<{ correct: number; total: number; percent: number; suggestedLevel: 1 | 2 | 3; pending: boolean }>(`/public/placement/${encodeURIComponent(token)}/submit`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  studentName: string;
  avatarLetter: string;
  totalScore: number;
  homeworkScore: number;
  examScore: number;
  completedHomeworkCount: number;
  badge: "GOLD" | "SILVER" | "BRONZE" | "TOP_PERFORMER" | "PARTICIPANT";
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

export type ExamQuestionType = QuestionType;

// A saved exam question (rich model, with answers - staff only).
export type ExamQuestion = TestQuestion & { id: string; order: number };

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
  reviewStatus?: "PENDING" | "DONE";
  createdAt: string;
  student?: Student;
}

export interface ExamAttemptBreakdown {
  questionId: string;
  prompt: string;
  questionType: ExamQuestionType;
  section: string | null;
  instruction: string | null;
  passage: string | null;
  options: ExamQuestionOption[];
  pairs: Array<{ left: string; right: string }> | null;
  words: string[] | null;
  rubric: string | null;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  pending: boolean;
  points: number;
  earned: number;
  explanation?: string | null;
}

export interface ExamAttemptDetail {
  id: string;
  student: { id: string; fullName: string };
  createdAt: string;
  reviewStatus: "PENDING" | "DONE";
  score: number;
  maxScore: number;
  passed: boolean;
  earnedPoints: number;
  totalPoints: number;
  manualScores: Record<string, number>;
  aiReview: Record<string, AiSuggestion>;
  breakdown: ExamAttemptBreakdown[];
}

export interface SubmitAttemptResult {
  attempt: ExamAttempt;
  score: number;
  maxScore: number;
  earnedPoints: number;
  totalPoints: number;
  passed: boolean;
  pending?: boolean;
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
    subdomain?: string;
    email: string;
    password: string;
    fullName: string;
    category?: TenantCategory;
  }) => request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email?: string; login?: string; password: string }) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),

  workspaces: () => request<WorkspaceItem[]>("/auth/workspaces"),

  selectWorkspace: (tenantId: string) =>
    request<AuthResponse>("/auth/select-workspace", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    }),

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
  list: (params?: { courseId?: string; status?: string; branchId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.courseId) qs.set("courseId", params.courseId);
    if (params?.status) qs.set("status", params.status);
    if (params?.branchId) qs.set("branchId", params.branchId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Group[]>(`/groups${suffix}`);
  },
  trash: () => request<Group[]>("/groups/trash"),
  get: (id: string) => request<Group>(`/groups/${id}`),
  create: (data: Partial<Group>) =>
    request<Group>("/groups", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Group>) =>
    request<Group>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/groups/${id}`, { method: "DELETE" }),
  restore: (id: string) => request<Group>(`/groups/${id}/restore`, { method: "POST" }),
  scheduleConflicts: (params: { teacherId: string; days: string; startTime: string; endTime?: string; excludeId?: string }) => {
    const qs = new URLSearchParams({
      teacherId: params.teacherId,
      days: params.days,
      startTime: params.startTime,
      ...(params.endTime ? { endTime: params.endTime } : {}),
      ...(params.excludeId ? { excludeId: params.excludeId } : {}),
    });
    return request<{ id: string; name: string; scheduleDays: string | null; startTime: string | null }[]>(
      `/groups/schedule-conflicts?${qs.toString()}`,
    );
  },
};

// ---- Students ----

export const studentsApi = {
  list: (params?: { status?: string; branchId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.branchId) qs.set("branchId", params.branchId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Student[]>(`/students${suffix}`);
  },
  trash: () => request<Student[]>("/students/trash"),
  get: (id: string) => request<Student>(`/students/${id}`),
  create: (data: Partial<Student> & { groupId?: string; groupIds?: string[] }) =>
    request<Student>("/students", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Student>) =>
    request<Student>(`/students/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/students/${id}`, { method: "DELETE" }),
  restore: (id: string) => request<Student>(`/students/${id}/restore`, { method: "POST" }),
  enroll: (id: string, groupId: string) =>
    request<{ success: boolean; enrollment?: any }>(`/students/${id}/enroll/${groupId}`, { method: "POST" }),
  unenroll: (id: string, groupId: string) =>
    request<{ success: boolean; enrollment?: any }>(`/students/${id}/enroll/${groupId}`, { method: "DELETE" }),
  getGuardians: (id: string) => request<StudentGuardian[]>(`/students/${id}/guardians`),
  linkGuardian: (id: string, data: { userId?: string; phone?: string; fullName?: string; relationship?: string; isPrimary?: boolean }) =>
    request<StudentGuardian>(`/students/${id}/guardians`, { method: "POST", body: JSON.stringify(data) }),
  unlinkGuardian: (id: string, guardianId: string) =>
    request<{ success: boolean }>(`/students/${id}/guardians/${guardianId}`, { method: "DELETE" }),
  portalPinStatus: (id: string) => request<{ hasPin: boolean; updatedAt: string | null }>(`/students/${id}/portal-pin`),
  issuePortalPin: (id: string) => request<{ pin: string; phone: string | null }>(`/students/${id}/portal-pin`, { method: "POST" }),
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
  createAccount: (id: string, data: { email: string; password: string }) =>
    request<Teacher>(`/teachers/${id}/account`, { method: "POST", body: JSON.stringify(data) }),
  removeAccount: (id: string) => request<Teacher>(`/teachers/${id}/account`, { method: "DELETE" }),
};

// ---- Payments ----

export const paymentsApi = {
  list: () => request<Payment[]>("/payments"),
  get: (id: string) => request<Payment>(`/payments/${id}`),
  summary: () => request<PaymentsSummary>("/payments/summary"),
  debtors: (params?: { forMonth?: string; onlyDebtors?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.forMonth) qs.set("forMonth", params.forMonth);
    if (params?.onlyDebtors !== undefined) qs.set("onlyDebtors", String(params.onlyDebtors));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<DebtorsResponse>(`/payments/debtors${suffix}`);
  },
  financeSummary: (forMonth?: string) =>
    request<FinanceSummary>(`/payments/finance-summary${forMonth ? `?forMonth=${forMonth}` : ""}`),
  create: (data: Partial<Payment>) =>
    request<Payment>("/payments", { method: "POST", body: JSON.stringify(data) }),
};

// ---- Invoices ----

export const invoicesApi = {
  list: (params?: { studentId?: string; forMonth?: string; status?: string; overdueOnly?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.studentId) qs.set("studentId", params.studentId);
    if (params?.forMonth) qs.set("forMonth", params.forMonth);
    if (params?.status) qs.set("status", params.status);
    if (params?.overdueOnly !== undefined) qs.set("overdueOnly", String(params.overdueOnly));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Invoice[]>(`/invoices${suffix}`);
  },
  get: (id: string) => request<Invoice>(`/invoices/${id}`),
  create: (data: { studentId: string; enrollmentId?: string; amount: number; dueDate: string; forMonth: string; description?: string }) =>
    request<Invoice>("/invoices", { method: "POST", body: JSON.stringify(data) }),
  generateMonthly: (forMonth?: string) =>
    request<{ forMonth: string; generatedCount: number; invoices: Invoice[] }>("/invoices/generate-monthly", {
      method: "POST",
      body: JSON.stringify({ forMonth }),
    }),
  cancel: (id: string) =>
    request<Invoice>(`/invoices/${id}/cancel`, { method: "POST" }),
};

// ---- Expenses ----

export const expensesApi = {
  list: (params?: { forMonth?: string; category?: string; branchId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.forMonth) qs.set("forMonth", params.forMonth);
    if (params?.category) qs.set("category", params.category);
    if (params?.branchId) qs.set("branchId", params.branchId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Expense[]>(`/expenses${suffix}`);
  },
  get: (id: string) => request<Expense>(`/expenses/${id}`),
  summary: (forMonth?: string) =>
    request<ExpensesSummary>(`/expenses/summary${forMonth ? `?forMonth=${forMonth}` : ""}`),
  create: (data: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    paymentMethod?: string;
    date: string;
    branchId?: string | null;
    notes?: string | null;
  }) => request<Expense>("/expenses", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Expense>) =>
    request<Expense>(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/expenses/${id}`, { method: "DELETE" }),
};

// ---- Attendance ----

export interface QrCheckInResponse {
  success: boolean;
  alreadyMarked: boolean;
  student: {
    id: string;
    fullName: string;
    phone: string | null;
    parentPhone?: string | null;
    telegramLinked: boolean;
  };
  group: {
    id: string;
    name: string;
    monthlyPrice?: number;
  };
  attendance: {
    date: string;
    status: AttendanceStatus;
    time: string;
  };
  finance: {
    monthlyPrice: number;
    totalPaid: number;
    hasDebt: boolean;
  };
}

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
  qrCheckIn: (data: { code: string; date?: string; groupId?: string }) =>
    request<QrCheckInResponse>("/attendance/qr-checkin", { method: "POST", body: JSON.stringify(data) }),
};


// ---- Salary payments & Teacher Payroll Engine (Spec §25) ----

export interface TeacherPayrollItem {
  teacherId: string;
  teacherName: string;
  phone: string | null;
  subject: string | null;
  salaryType: "FIXED" | "PER_LESSON" | "PERCENTAGE" | "PER_STUDENT";
  salaryValue: number;
  calculatedSalary: number;
  paidAmount: number;
  netPayable: number;
  isPaid: boolean;
  paidAt: string | null;
  details: {
    type: string;
    rate: number;
    lessonCount?: number;
    groupRevenue?: number;
    studentCount?: number;
    groupCount: number;
    plannedLessons?: number;
    absentLessons?: number;
    lateLessons?: number;
    substitutedLessons?: number;
    deduction?: number;
  };
}

export type TeacherMark = "PRESENT" | "LATE" | "ABSENT";

export interface TeacherLesson {
  groupId: string;
  groupName: string;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  teacherName: string | null;
  status: TeacherMark | null;
  substituteTeacherId: string | null;
  note: string | null;
}

export const teacherAttendanceApi = {
  day: (date: string) => request<TeacherLesson[]>(`/teacher-attendance?date=${date}`),
  mark: (date: string, entries: Array<{ groupId: string; status: TeacherMark; substituteTeacherId?: string | null; note?: string | null }>) =>
    request<TeacherLesson[]>("/teacher-attendance", { method: "POST", body: JSON.stringify({ date, entries }) }),
};

export interface PayrollCalculationResponse {
  forMonth: string;
  totalCalculated: number;
  totalPaid: number;
  totalPending: number;
  teacherCount: number;
  teachers: TeacherPayrollItem[];
}

export const salaryApi = {
  list: (teacherId?: string) =>
    request<SalaryPayment[]>(`/salary-payments${teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : ""}`),
  create: (data: { teacherId: string; amount: number; forMonth: string; paidAt?: string }) =>
    request<SalaryPayment>("/salary-payments", { method: "POST", body: JSON.stringify(data) }),
  // The signed-in teacher's own pay line (null when not linked to a teacher).
  mine: (forMonth?: string) =>
    request<TeacherPayrollItem | null>(`/salary-payments/me${forMonth ? `?forMonth=${encodeURIComponent(forMonth)}` : ""}`),
  calculate: (forMonth?: string) => {
    const q = forMonth ? `?forMonth=${encodeURIComponent(forMonth)}` : "";
    return request<PayrollCalculationResponse>(`/salary-payments/calculate${q}`);
  },
  disburse: (data: {
    teacherId: string;
    amount: number;
    forMonth: string;
    paymentMethod?: "CASH" | "CLICK" | "PAYME" | "BANK_TRANSFER";
    paidAt?: string;
    notes?: string;
  }) =>
    request<{ salaryPayment: SalaryPayment; expense: Expense }>("/salary-payments/disburse", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ---- Tenants (settings + superadmin) ----

export interface TenantsOverview {
  month: string;
  totals: { centers: number; active: number; trial: number; suspended: number; students: number; monthRevenue: number };
  items: Array<{
    id: string;
    name: string;
    subdomain: string;
    plan: string;
    status: string;
    trialEndsAt: string | null;
    createdAt: string;
    owner: { email: string; fullName: string } | null;
    students: number;
    groups: number;
    teachers: number;
    monthRevenue: number;
    lastActivityAt: string | null;
  }>;
}

export const tenantsApi = {
  // Superadmin: every center with its size, income, owner and activity.
  overview: () => request<TenantsOverview>("/tenants/overview"),
  listAll: () => request<Tenant[]>("/tenants"),
  get: (id: string) => request<Tenant>(`/tenants/${id}`),
  updateMe: (data: {
    name?: string; accentColor?: string; category?: TenantCategory; phone?: string; address?: string;
    email?: string; telegramUsername?: string; website?: string; websiteLabel?: string;
    language?: "UZ" | "RU" | "EN"; currency?: "UZS" | "USD" | "RUB"; teachingCategories?: string[];
    studentAiDailyLimit?: number;
  }) => request<Tenant>("/tenants/me", { method: "PATCH", body: JSON.stringify(data) }),
  uploadLogo: (file: File) => uploadFile<Tenant>("/tenants/me/logo", file),
  getSite: () => request<SiteContent>("/tenants/me/site"),
  updateSite: (data: SiteContent) => request<SiteContent>("/tenants/me/site", { method: "PATCH", body: JSON.stringify(data) }),
  uploadSiteImage: (file: File) => uploadFile<{ path: string }>("/tenants/me/site-image", file),
  updateStatus: (id: string, data: { status?: string; plan?: string }) =>
    request<Tenant>(`/tenants/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  bySubdomain: (subdomain: string) =>
    request<Pick<Tenant, "id" | "name" | "subdomain" | "accentColor" | "plan">>(`/tenants/by-subdomain/${subdomain}`),
  getPublicShowcase: (subdomain: string) =>
    request<PublicShowcaseData>(`/tenants/by-subdomain/${encodeURIComponent(subdomain)}/public-showcase`),
  publicApply: (subdomain: string, data: PublicApplyDto) =>
    request<{ success: boolean; message: string }>(
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
  create: (data: { fullName: string; email: string; password: string; role: Role; permissions?: string[] }) =>
    request<StaffMember>("/staff", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { role?: Role; permissions?: string[] }) =>
    request<StaffMember>(`/staff/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateRole: (id: string, role: Role) => request<StaffMember>(`/staff/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  remove: (id: string) => request<{ success: boolean }>(`/staff/${id}`, { method: "DELETE" }),
};

// ---- Billing (Click / Payme — online payments & webhook engine Spec §27) ----

export const billingApi = {
  getConfig: () => request<{ clickEnabled: boolean; paymeEnabled: boolean }>("/billing/config"),
  clickLink: (data: { studentId: string; amount: number; forMonth: string; invoiceId?: string }) =>
    request<BillingLink>("/billing/click/link", { method: "POST", body: JSON.stringify(data) }),
  paymeLink: (data: { studentId: string; amount: number; forMonth: string; invoiceId?: string }) =>
    request<BillingLink>("/billing/payme/link", { method: "POST", body: JSON.stringify(data) }),
  generateClickLink: (data: { studentId: string; amount: number; forMonth: string; invoiceId?: string }) =>
    request<BillingLink>("/billing/click/link", { method: "POST", body: JSON.stringify(data) }),
  generatePaymeLink: (data: { studentId: string; amount: number; forMonth: string; invoiceId?: string }) =>
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
  // purpose PARENT: a parent's chat (the student's own link stays).
  generateLinkToken: (studentId: string, purpose: "STUDENT" | "PARENT" = "STUDENT") =>
    request<{ token: string; linkUrl: string | null; expiresAt: string; studentName: string }>("/telegram/link-token", {
      method: "POST",
      body: JSON.stringify({ studentId, purpose }),
    }),
  // The signed-in staff member's own Telegram, for CRM reminders.
  myStatus: () => request<{ configured: boolean; botUsername: string | null; linked: boolean }>("/telegram/me"),
  myLink: () => request<{ linkUrl: string | null; expiresAt: string }>("/telegram/me/link", { method: "POST" }),
  myUnlink: () => request<{ linked: boolean }>("/telegram/me", { method: "DELETE" }),
};

// ---- AI ----

export interface TutorReport {
  group: { id: string; name: string; subject: string };
  days: number;
  totalQuestions: number;
  activeStudents: number;
  studentCount: number;
  students: Array<{ studentId: string; fullName: string; questions: number; lastAt: string | null; recent: Array<{ text: string; at: string }> }>;
}

export const aiApi = {
  // What a group's students asked the AI tutor (teachers: own groups only)
  tutorReport: (groupId: string, days: number) =>
    request<TutorReport>(`/ai/tutor-report?groupId=${encodeURIComponent(groupId)}&days=${days}`),
  tutorTopics: (groupId: string, days: number) =>
    request<{ summary: string | null; questions: number }>("/ai/tutor-report/topics", { method: "POST", body: JSON.stringify({ groupId, days }) }),
  groupInsights: (groupId: string) =>
    request<{ insight: string }>("/ai/insights", { method: "POST", body: JSON.stringify({ groupId }) }),
  generateMaterial: (data: { subject: string; level?: string; topic: string; type: string; customInstructions?: string }) =>
    request<{ material: string }>("/ai/materials", { method: "POST", body: JSON.stringify(data) }),
  suggestHomework: (data: { subject?: string; groupName?: string; topic?: string; level?: string; request?: string }) =>
    request<{ title: string; description: string; content: string | null; dueDays?: number }>("/ai/suggest-homework", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  // Saves the text as a PDF file (built on the server, Uzbek/Cyrillic safe).
  downloadPdf: (data: { title: string; subtitle?: string; content: string }) => {
    const name = `${data.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "material"}.pdf`;
    return download("/ai/pdf", name, data);
  },
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
  create: (data: { groupIds: string[]; title: string; description?: string; dueDate?: string; maxScore?: number }) =>
    request<Homework[]>("/homework", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; description?: string; dueDate?: string; maxScore?: number }) =>
    request<Homework>(`/homework/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/homework/${id}`, { method: "DELETE" }),
  uploadAttachment: (id: string, file: File) => uploadFile<Homework>(`/homework/${id}/attachment`, file),
  // Attaches written text (e.g. the AI task) as a PDF file.
  attachText: (id: string, data: { title: string; content: string }) =>
    request<Homework>(`/homework/${id}/attachment-text`, { method: "POST", body: JSON.stringify(data) }),
  roster: (id: string) =>
    request<{
      student: Student;
      completed: boolean;
      score?: number | null;
      feedback?: string | null;
      status: string;
      submissionText?: string | null;
      submissionAttachmentUrl?: string | null;
      submittedAt?: string | null;
    }[]>(`/homework/${id}/roster`),
  setCompletion: (id: string, studentId: string, completed: boolean) =>
    request<{ success: boolean }>(`/homework/${id}/completions`, { method: "POST", body: JSON.stringify({ studentId, completed }) }),
  submit: (id: string, data: { studentId: string; submissionText?: string; attachmentUrl?: string }) =>
    request<HomeworkCompletion>(`/homework/${id}/submit`, { method: "POST", body: JSON.stringify(data) }),
  grade: (id: string, data: { studentId: string; score: number; feedback?: string }) =>
    request<HomeworkCompletion>(`/homework/${id}/grade`, { method: "POST", body: JSON.stringify(data) }),
  leaderboard: (groupId?: string) =>
    request<LeaderboardEntry[]>(`/homework/leaderboard${groupId ? `?groupId=${groupId}` : ""}`),
};

// ---- Branches ----

export const branchesApi = {
  list: () => request<Branch[]>("/branches"),
  create: (data: { name: string; address?: string; phone?: string; mapUrl?: string }) =>
    request<Branch>("/branches", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; address?: string; phone?: string; mapUrl?: string }) =>
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
  createQuestion: (id: string, data: TestQuestion) =>
    request<ExamQuestion>(`/exams/${id}/questions`, { method: "POST", body: JSON.stringify(data) }),
  removeQuestion: (id: string, questionId: string) =>
    request<{ success: boolean }>(`/exams/${id}/questions/${questionId}`, { method: "DELETE" }),
  generateQuestions: (id: string, data: { count?: number; request?: string } = {}) =>
    request<ExamQuestion[]>(`/exams/${id}/generate-questions`, { method: "POST", body: JSON.stringify(data) }),
  parsePdfQuestions: (id: string, file: File) => uploadFile<{ questions: TestQuestion[] }>(`/exams/${id}/questions/parse-pdf`, file),
  parseTextQuestions: (id: string, text: string) =>
    request<{ questions: TestQuestion[] }>(`/exams/${id}/questions/parse-text`, { method: "POST", body: JSON.stringify({ text }) }),
  batchQuestions: (id: string, questions: TestQuestion[]) =>
    request<ExamQuestion[]>(`/exams/${id}/questions/batch`, { method: "POST", body: JSON.stringify({ questions }) }),
  startAttempt: (id: string, studentId: string) =>
    request<{
      exam: { id: string; title: string; description: string | null; durationMinutes: number | null; maxScore: number; passingScore: number | null; questionCount: number };
      student: { id: string; fullName: string };
      questions: Array<PublicQuestion & { id: string; order: number }>;
    }>(`/exams/${id}/start-attempt?studentId=${studentId}`),
  submitAttempt: (id: string, data: { studentId: string; answers: Record<string, string> }) =>
    request<SubmitAttemptResult>(`/exams/${id}/submit-attempt`, { method: "POST", body: JSON.stringify(data) }),
  getAttempt: (id: string, attemptId: string) => request<ExamAttemptDetail>(`/exams/${id}/attempts/${attemptId}`),
  gradeAttempt: (id: string, attemptId: string, scores: Record<string, number>) =>
    request<ExamAttemptDetail>(`/exams/${id}/attempts/${attemptId}/grade`, { method: "POST", body: JSON.stringify({ scores }) }),
  aiReviewAttempt: (id: string, attemptId: string) =>
    request<ExamAttemptDetail>(`/exams/${id}/attempts/${attemptId}/ai-review`, { method: "POST" }),
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

function leadQueryString(query: object = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

function postJson<T>(path: string, data: unknown = {}) {
  return request<T>(path, { method: "POST", body: JSON.stringify(data) });
}

export const leadsApi = {
  list: (query?: LeadQuery) => request<LeadListResponse>(`/leads${leadQueryString(query)}`),
  funnel: () => request<FunnelStats>("/leads/funnel"),
  analytics: (query?: { from?: string; to?: string }) => request<LeadAnalytics>(`/leads/analytics${leadQueryString(query)}`),
  followUpSummary: (mine = false) => request<FollowUpSummary>(`/leads/follow-ups/summary${mine ? "?mine=true" : ""}`),
  duplicates: (phone?: string, email?: string) =>
    request<{ duplicates: LeadDuplicate[] }>(`/leads/duplicates${leadQueryString({ phone, email })}`),
  managers: () => request<AssignableManager[]>("/leads/assignable-managers"),
  get: (id: string) => request<Lead>(`/leads/${id}`),
  timeline: (id: string) => request<LeadActivity[]>(`/leads/${id}/timeline`),
  create: (data: {
    fullName: string;
    phone: string;
    secondaryPhone?: string;
    email?: string;
    source?: LeadSource;
    desiredSubjectId?: string;
    desiredCourseId?: string;
    preferredBranchId?: string;
    assignedManagerUserId?: string;
    followUpAt?: string;
    notes?: string;
    allowDuplicate?: boolean;
    duplicateReason?: string;
  }) => postJson<Lead>("/leads", data),
  update: (id: string, data: {
    fullName?: string;
    phone?: string;
    secondaryPhone?: string | null;
    email?: string | null;
    source?: LeadSource;
    desiredSubjectId?: string | null;
    desiredCourseId?: string | null;
    preferredBranchId?: string | null;
    notes?: string | null;
  }) => request<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  transition: (id: string, toStatus: LeadStatus, note?: string) => postJson<Lead>(`/leads/${id}/transition`, { toStatus, note }),
  lose: (id: string, reason: LeadLostReason, note?: string) => postJson<Lead>(`/leads/${id}/lose`, { reason, note: note || undefined }),
  reopen: (id: string, note: string) => postJson<Lead>(`/leads/${id}/reopen`, { note }),
  assign: (id: string, managerUserId: string | null) => postJson<Lead>(`/leads/${id}/assign`, { managerUserId }),
  followUp: (id: string, followUpAt: string | null, note?: string) => postJson<Lead>(`/leads/${id}/follow-up`, { followUpAt, note }),
  addActivity: (id: string, type: "NOTE" | "CALL" | "MESSAGE" | "MEETING", body: string) =>
    postJson<LeadActivity>(`/leads/${id}/activities`, { type, body }),
  bookTrial: (id: string, data: { scheduledAt: string; durationMinutes?: number; groupId?: string; teacherId?: string; note?: string }) =>
    postJson<LeadTrial>(`/leads/${id}/trials`, data),
  rescheduleTrial: (id: string, trialId: string, data: { scheduledAt: string; note?: string }) =>
    postJson<LeadTrial>(`/leads/${id}/trials/${trialId}/reschedule`, data),
  attendTrial: (id: string, trialId: string, note?: string) => postJson<LeadTrial>(`/leads/${id}/trials/${trialId}/attend`, { note }),
  missTrial: (id: string, trialId: string, note?: string) => postJson<LeadTrial>(`/leads/${id}/trials/${trialId}/miss`, { note }),
  cancelTrial: (id: string, trialId: string, note?: string) => postJson<LeadTrial>(`/leads/${id}/trials/${trialId}/cancel`, { note }),
  studentMatch: (id: string) => request<{ candidates: StudentMatchCandidate[] }>(`/leads/${id}/student-match`),
  convert: (id: string, data: ConvertLeadInput) => postJson<ConvertLeadResult>(`/leads/${id}/convert`, data),
  archive: (id: string, reason?: string) => postJson<Lead>(`/leads/${id}/archive`, { reason }),
  restore: (id: string) => postJson<Lead>(`/leads/${id}/restore`),
  exportCsv: (query?: LeadQuery) => download(`/leads/export${leadQueryString(query)}`, "leads.csv"),
};

// ---- Reports (server-side monthly overview) ----

export interface ReportsOverview {
  month: string;
  timezone: string;
  definitions: Record<string, string>;
  students: {
    active: number;
    newThisMonth: number;
    byStatus: Record<string, number>;
    registrationsByMonth: Array<{ month: string; count: number }>;
  };
  groups: {
    active: number;
    averageOccupancy: number | null;
    items: Array<{ id: string; name: string; teacherName: string | null; students: number; maxStudents: number; occupancy: number | null; attendanceRate: number | null; collected: number }>;
  };
  attendance: { marks: number; byStatus: Record<string, number>; rate: number | null };
  atRisk: Array<{ studentId: string; fullName: string; phone: string | null; attendanceRate: number | null; overdueAmount: number; risk: "HIGH" | "MEDIUM" }>;
  // null when the viewer's role may not see finance.
  finance: null | {
    collected: number;
    expected: number;
    outstandingDebt: number;
    debtorCount: number;
    collectionRate: number | null;
    revenueByMethod: Record<string, number>;
    yearToDate: { thisYear: number; lastYear: number; growth: number | null };
    // Only for finance roles (not managers).
    expenses?: number;
    salaries?: number;
    netProfit?: number;
    expensesByCategory?: Record<string, number>;
  };
  admissions: LeadAnalytics | null;
}

export interface DashboardData {
  today: string;
  timezone: string;
  scopedToOwnGroups: boolean;
  counts: { activeStudents: number; activeGroups: number; teachers: number; todaysLessons: number; attendanceMarks: number };
  // Hand-ins waiting for a grade (own groups for teachers).
  homeworkToReview?: number;
  attendance: {
    week: Array<{ date: string; weekday: number; marks: number }>;
    months: Array<{ month: string; marks: number }>;
    days: Array<{ date: string; marks: number; present: number }>;
    todayBySlot: Array<{ startTime: string; marks: number }>;
    rates: { day: number | null; week: number | null; month: number | null };
  };
  todaysLessons: Array<{
    id: string;
    name: string;
    startTime: string | null;
    endTime: string | null;
    teacherName: string | null;
    students: number;
    // DONE: attendance marked; UNMARKED: started but not marked; PLANNED: later today.
    status: "DONE" | "UNMARKED" | "PLANNED";
    present: number | null;
    marked: number | null;
  }>;
  groupFill: Array<{ id: string; name: string; students: number; maxStudents: number }>;
  // null for roles that may not see payments (and for teachers).
  finance: null | {
    monthRevenue: number;
    debtorCount: number;
    paymentStatus: { paid: number; pending: number; failed: number; total: number };
    revenueByMonth: Array<{ month: string; amount: number }>;
    topDebtors: Array<{ studentId: string; fullName: string; groups: string[]; debt: number; overdueDays: number | null }>;
  };
}

export interface DirectorTrendRow {
  month: string;
  expected: number;
  collected: number;
  debt: number;
  collectionRate: number | null;
  newStudents: number;
  left: number;
  activeAtStart: number;
  churnRate: number | null;
  expenses?: number;
  salaries?: number;
  net?: number;
}
export interface DirectorReportData {
  month: string;
  timezone: string;
  trend: DirectorTrendRow[];
  debtors: {
    window: string[];
    totalDebt: number;
    count: number;
    multiMonth: number;
    items: Array<{ studentId: string; fullName: string; phone: string | null; parentPhone: string | null; status: string; groups: string[]; totalDebt: number; monthsBehind: number; oldestMonth: string | null; currentMonthDebt: number; lastPaymentAt: string | null }>;
  };
  churn: {
    left: number;
    activeAtStart: number;
    rate: number | null;
    reasonsLast3Months: Record<string, number>;
    leavers: Array<{ studentId: string; fullName: string; leftAt: string | null; reason: string | null; groups: string[]; monthsStudied: number | null }>;
  };
}

export const reportsApi = {
  director: (month?: string) => request<DirectorReportData>(`/reports/director${month ? `?month=${month}` : ""}`),
  overview: (month?: string) => request<ReportsOverview>(`/reports/overview${month ? `?month=${month}` : ""}`),
  dashboard: () => request<DashboardData>("/reports/dashboard"),
  // Students list columns: attendance % (last 30 days) and this month's payment state.
  studentsSummary: () =>
    request<{ withPayments: boolean; items: Array<{ studentId: string; attendanceRate: number | null; payment: "PAID" | "DEBT" | "PENDING" | "NONE" | null }> }>("/reports/students-summary"),
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

// ---- Scheduling & Rooms (Spec Section 17) ----

export interface Room {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  capacity: number;
  color: string;
  branch?: Branch | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleConflict {
  type: "ROOM" | "TEACHER" | "GROUP";
  message: string;
  conflictingScheduleId: string;
  groupName?: string;
  roomName?: string;
  teacherName?: string;
  startTime: string;
  endTime: string;
  dayOfWeek?: number | null;
  date?: string | null;
}

export interface ScheduleItem {
  id: string;
  tenantId: string;
  groupId: string;
  teacherId: string | null;
  roomId: string | null;
  branchId: string | null;
  dayOfWeek: number | null;
  date: string | null;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  onlineMeetingUrl: string | null;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  topic: string | null;
  group?: Group;
  teacher?: Teacher | null;
  room?: Room | null;
  branch?: Branch | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  groupId: string;
  teacherId?: string;
  roomId?: string;
  branchId?: string;
  dayOfWeek?: number;
  date?: string;
  startTime: string;
  endTime: string;
  isRecurring?: boolean;
  onlineMeetingUrl?: string;
  status?: string;
  topic?: string;
  allowCollision?: boolean;
}

export interface UpdateScheduleInput {
  groupId?: string;
  teacherId?: string;
  roomId?: string;
  branchId?: string;
  dayOfWeek?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  isRecurring?: boolean;
  onlineMeetingUrl?: string;
  status?: string;
  topic?: string;
  allowCollision?: boolean;
}

export interface CheckConflictInput {
  groupId: string;
  teacherId?: string;
  roomId?: string;
  dayOfWeek?: number;
  date?: string;
  startTime: string;
  endTime: string;
  excludeScheduleId?: string;
}

export const scheduleApi = {
  listRooms: () => request<Room[]>("/schedule/rooms"),
  getRoom: (id: string) => request<Room>(`/schedule/rooms/${id}`),
  createRoom: (data: { name: string; branchId?: string; capacity?: number; color?: string }) =>
    request<Room>("/schedule/rooms", { method: "POST", body: JSON.stringify(data) }),
  updateRoom: (id: string, data: { name?: string; branchId?: string; capacity?: number; color?: string }) =>
    request<Room>(`/schedule/rooms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRoom: (id: string) => request<{ success: boolean }>(`/schedule/rooms/${id}`, { method: "DELETE" }),

  checkConflicts: (data: CheckConflictInput) =>
    request<{ hasConflict: boolean; conflicts: ScheduleConflict[] }>("/schedule/check-conflict", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  list: (query?: { branchId?: string; groupId?: string; teacherId?: string; roomId?: string; dayOfWeek?: number }) => {
    const q = new URLSearchParams();
    if (query?.branchId) q.set("branchId", query.branchId);
    if (query?.groupId) q.set("groupId", query.groupId);
    if (query?.teacherId) q.set("teacherId", query.teacherId);
    if (query?.roomId) q.set("roomId", query.roomId);
    if (query?.dayOfWeek) q.set("dayOfWeek", String(query.dayOfWeek));
    const qs = q.toString();
    return request<ScheduleItem[]>(`/schedule${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<ScheduleItem>(`/schedule/${id}`),
  create: (data: CreateScheduleInput) =>
    request<ScheduleItem>("/schedule", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: UpdateScheduleInput) =>
    request<ScheduleItem>(`/schedule/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/schedule/${id}`, { method: "DELETE" }),
};

// ---- Student & Parent Portal (Spec Section 23 & 31) ----

export interface PortalMe {
  id: string;
  fullName: string;
  viewer?: PortalViewer;
  phone?: string | null;
  parentPhone?: string | null;
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    logoUrl?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  enrollments: Array<{
    id: string;
    group: {
      id: string;
      name: string;
      subject: string;
      schedule?: string | null;
      scheduleDays?: string | null;
      startTime?: string | null;
      teacher?: { fullName: string; phone?: string | null } | null;
      branch?: { name: string; address?: string | null } | null;
    };
  }>;
}

export interface PortalSchedule {
  timetable: Array<{
    id: string;
    dayOfWeek?: number | null;
    startTime: string;
    endTime: string;
    onlineMeetingUrl?: string | null;
    group?: { name: string; subject: string } | null;
    teacher?: { fullName: string } | null;
    room?: { name: string; color?: string | null } | null;
  }>;
  fallbackGroups: Array<{
    id: string;
    name: string;
    subject: string;
    schedule?: string | null;
    scheduleDays?: string | null;
    startTime?: string | null;
    teacher?: string | null;
    branch?: string | null;
  }>;
}

export interface PortalAttendance {
  rate: number;
  total: number;
  present: number;
  absent: number;
  late: number;
  streak?: number;
  byGroup?: Array<{ groupId: string; groupName: string | null; subject: string | null; lastDate: string; rate: number; total: number; present: number; absent: number; late: number }>;
  records: Array<{
    id: string;
    date: string;
    status: AttendanceStatus;
    groupId?: string;
    groupName?: string | null;
    subject?: string | null;
  }>;
}

export interface PortalPastLesson {
  date: string;
  groupId: string;
  groupName: string;
  subject: string | null;
  teacher: string | null;
  startTime: string | null;
  endTime: string | null;
  topic: string | null;
  cancelled: boolean;
  attendance: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | string | null;
  homework: Array<{
    id: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    attachmentPath: string | null;
    attachmentName: string | null;
    status: string | null;
    score: number | null;
    maxScore: number;
  }>;
  exams: Array<{ id: string; title: string; maxScore: number; passingScore: number | null; score: number | null }>;
}

export interface PortalHomework {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  groupName?: string;
  completed: boolean;
  completedAt?: string | null;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  maxScore?: number;
  submission?: {
    status: string;
    text: string | null;
    file: string | null;
    submittedAt: string | null;
    score: number | null;
    feedback: string | null;
  } | null;
}

export interface PortalExams {
  attempts: Array<{
    id: string;
    examTitle?: string;
    score: number;
    maxScore: number;
    passed: boolean;
    date: string;
  }>;
  results: Array<{
    id: string;
    examTitle?: string;
    score: number;
    note?: string | null;
    date: string;
  }>;
  certificates: Array<{
    id: string;
    code: string;
    title: string;
    grade?: string | null;
    issueDate: string;
    verifyUrl: string;
  }>;
}

export interface PortalPayments {
  forMonth: string;
  expectedTuition: number;
  monthPaid: number;
  debtAmount: number;
  status: "PAID" | "PARTIAL" | "UNPAID";
  history: Payment[];
  online?: { click: boolean; payme: boolean };
}

export interface PortalAnnouncement {
  id: string;
  title: string;
  content: string;
  priority: string;
  createdAt: string;
  targetGroupId?: string | null;
  read?: boolean;
}

export interface PortalAvailableExam {
  id: string;
  title: string;
  groupName: string | null;
  questionCount: number;
  durationMinutes: number | null;
  examDate: string | null;
  taken: boolean;
  score: number | null;
  maxScore: number;
}

export interface PortalTutorState {
  enabled: boolean;
  available: boolean;
  limit: number;
  left: number;
  messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
}
export type PortalTutorAnswer =
  | { status: "ok"; reply: string; left: number; limit: number }
  | { status: "limit"; limit: number }
  | { status: "off" | "unavailable" | "error" };

export const portalApi = {
  loginWithToken: (token: string) =>
    request<{ accessToken: string; student: any; tenant: any }>("/portal/auth/token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  // `subdomain`: signing in on a center's own address counts only that center.
  startPhoneLogin: (phone: string, subdomain?: string) =>
    request<{ telegramSent: boolean; pinAvailable: boolean }>("/portal/auth/phone/start", {
      method: "POST",
      body: JSON.stringify({ phone, subdomain }),
    }),
  verifyPhoneLogin: (data: { phone: string; code?: string; pin?: string; studentId?: string; subdomain?: string }) =>
    request<
      | PortalSession
      | { choose: Array<{ id: string; fullName: string; centerName: string }>; sessions?: PortalSession[] }
    >("/portal/auth/phone/verify", { method: "POST", body: JSON.stringify(data) }),
  // A parent signed in with their own account: sessions for their children.
  parentAccount: (staffToken: string) =>
    request<{ sessions: PortalSession[] }>("/portal/auth/parent-account", { method: "POST", headers: { Authorization: `Bearer ${staffToken}` } }),
  getMe: () => request<PortalMe>("/portal/me"),
  // AI tutor (same conversation and daily limit as the Telegram bot)
  aiState: () => request<PortalTutorState>("/portal/ai"),
  aiAsk: (message: string) => request<PortalTutorAnswer>("/portal/ai/ask", { method: "POST", body: JSON.stringify({ message }) }),
  aiReset: () => request<{ ok: boolean }>("/portal/ai/reset", { method: "POST" }),
  getSchedule: () => request<PortalSchedule>("/portal/schedule"),
  getPastLessons: (days = 30) => request<{ from: string; today: string; lessons: PortalPastLesson[] }>(`/portal/lessons?days=${days}`),
  getAttendance: () => request<PortalAttendance>("/portal/attendance"),
  getHomework: () => request<PortalHomework[]>("/portal/homework"),
  // Hands in homework: optional text and an optional photo/file.
  submitHomework: async (homeworkId: string, data: { text?: string; file?: File | null } = {}) => {
    const form = new FormData();
    if (data.text) form.append("text", data.text);
    if (data.file) form.append("file", data.file);
    const token = getPortalToken();
    const res = await fetch(`${API_URL}/portal/homework/${homeworkId}/submit`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(body?.message || "Yuborilmadi", res.status, body);
    return body as { success: boolean };
  },
  getExams: () => request<PortalExams>("/portal/exams"),
  getAvailableExams: () => request<PortalAvailableExam[]>("/portal/exams/available"),
  startExam: (id: string) =>
    request<{
      exam: { id: string; title: string; description: string | null; durationMinutes: number | null; maxScore: number; questionCount: number };
      questions: Array<PublicQuestion & { id: string }>;
    }>(`/portal/exams/${id}/start`),
  submitExam: (id: string, answers: Record<string, string>) =>
    request<SubmitAttemptResult>(`/portal/exams/${id}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),
  getInvoices: () => request<Invoice[]>("/portal/invoices"),
  getPayments: () => request<PortalPayments>("/portal/payments"),
  createCheckoutLink: (data: { provider: "CLICK" | "PAYME"; amount?: number; forMonth?: string; invoiceId?: string }) =>
    request<BillingLink>("/portal/payments/checkout-link", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getAnnouncements: () => request<PortalAnnouncement[]>("/portal/announcements"),
  readAnnouncement: (id: string) => request<{ marked: number }>(`/portal/announcements/${id}/read`, { method: "POST" }),
  readAllAnnouncements: () => request<{ marked: number }>("/portal/announcements/read-all", { method: "POST" }),
};

// ---- Multi-Channel Notifications (SMS & Telegram) ----

export interface NotificationLog {
  id: string;
  channel: "TELEGRAM" | "SMS" | "EMAIL" | "PUSH" | "IN_APP";
  event: string;
  status: "QUEUED" | "SENT" | "FAILED";
  recipient: string;
  title: string | null;
  content: string;
  errorMessage: string | null;
  provider: string | null;
  sentAt: string | null;
  createdAt: string;
  student?: { id: string; fullName: string; phone: string | null } | null;
}

export interface NotificationStats {
  total: number;
  totalSent: number;
  totalFailed: number;
  telegramCount: number;
  smsCount: number;
  successRate: number;
}

export interface NotificationSettings {
  id: string;
  smsProvider: "eskiz" | "playmobile";
  smsSender: string;
  smsApiToken: string | null;
  hasSmsApiToken: boolean;
  notifyOnAttendance: boolean;
  notifyOnPayment: boolean;
  notifyOnHomework: boolean;
  // Automatic reminders: day of month for debtors (0 = off), lessons.
  remindPaymentDay?: number;
  remindLessons?: boolean;
  dailyDigest?: boolean;
}

export const notificationsApi = {
  getSettings: () => request<NotificationSettings>("/notifications/settings"),
  updateSettings: (data: Partial<NotificationSettings>) =>
    request<NotificationSettings>("/notifications/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  getLogs: (params?: { channel?: string; status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.channel) q.append("channel", params.channel);
    if (params?.status) q.append("status", params.status);
    if (params?.limit) q.append("limit", String(params.limit));
    if (params?.offset) q.append("offset", String(params.offset));
    const str = q.toString();
    return request<NotificationLog[]>(`/notifications/logs${str ? `?${str}` : ""}`);
  },
  getStats: () => request<NotificationStats>("/notifications/stats"),
  sendTest: (data: { recipient: string; channel: "SMS" | "TELEGRAM"; content: string; title?: string }) =>
    request<NotificationLog>("/notifications/test", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sendDebtorReminders: (data?: { forMonth?: string; studentIds?: string[] }) =>
    request<{ success: boolean; processedDebtors: number }>("/notifications/debtor-reminders", {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
};

// ---- Onboarding ----
export const onboardingApi = {
  getState: () =>
    request<{
      tenant: {
        id: string;
        name: string;
        subdomain: string;
        phone: string | null;
        country: string;
        timezone: string;
        currency: string;
        logoUrl: string | null;
        teachingCategories: string[];
        onboardingStep: string;
      };
      counts: {
        subjects: number;
        branches: number;
        team: number;
        students: number;
      };
    }>("/onboarding/state"),

  checkSubdomain: (subdomain: string) =>
    request<{ available: boolean; reason?: string; slug?: string }>("/onboarding/check-subdomain", {
      method: "POST",
      body: JSON.stringify({ subdomain }),
    }),

  updateProfile: (data: {
    name: string;
    phone?: string;
    country?: string;
    timezone?: string;
    currency?: string;
    logoUrl?: string;
  }) =>
    request<{ success: boolean; nextStep: string; tenant: any }>("/onboarding/profile", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateCategories: (categories: string[]) =>
    request<{ success: boolean; nextStep: string; tenant: any }>("/onboarding/categories", {
      method: "POST",
      body: JSON.stringify({ categories }),
    }),

  updateWorkspace: (subdomain: string) =>
    request<{ success: boolean; nextStep: string; tenant: any }>("/onboarding/workspace", {
      method: "POST",
      body: JSON.stringify({ subdomain }),
    }),

  addBranch: (data: { name: string; address?: string; phone?: string }) =>
    request<{ success: boolean; nextStep: string; branch: any }>("/onboarding/branch", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  advance: (step: string) =>
    request<{ success: boolean; step: string }>(`/onboarding/advance/${step}`, { method: "POST" }),

  skip: (step: string) =>
    request<{ success: boolean; nextStep: string; tenant: any }>(`/onboarding/skip/${step}`, { method: "POST" }),

  complete: () =>
    request<{ success: boolean; ready: boolean; workspaceUrl: string; redirectUrl: string }>(
      "/onboarding/complete",
      { method: "POST" },
    ),
};

// ---- Subjects & Courses ----
export interface Subject {
  id: string;
  tenantId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  color?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
  courses?: Course[];
  createdAt: string;
}

export interface Course {
  id: string;
  tenantId: string;
  subjectId: string | null;
  name: string;
  description?: string | null;
  durationMonths?: number;
  price?: string;
  status?: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

export const subjectsApi = {
  list: (status?: "ACTIVE" | "ARCHIVED") =>
    request<Subject[]>(`/subjects${status ? `?status=${status}` : ""}`),
  get: (id: string) => request<Subject>(`/subjects/${id}`),
  create: (data: { name: string; code?: string; description?: string; color?: string; status?: "ACTIVE" | "ARCHIVED" }) =>
    request<Subject>("/subjects", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Subject>) =>
    request<Subject>(`/subjects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  archive: (id: string) =>
    request<Subject>(`/subjects/${id}/archive`, { method: "POST" }),
  remove: (id: string) => request<{ success: boolean; archived?: boolean; message?: string }>(`/subjects/${id}`, { method: "DELETE" }),
  bulk: (subjects: { name: string; courses?: string[] }[]) =>
    request<Subject[]>("/subjects/bulk", { method: "POST", body: JSON.stringify({ subjects }) }),
  listCourses: (subjectId?: string, status?: "ACTIVE" | "ARCHIVED") => {
    const qs = new URLSearchParams();
    if (subjectId) qs.set("subjectId", subjectId);
    if (status) qs.set("status", status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<Course[]>(`/subjects/courses${suffix}`);
  },
  createCourse: (data: { name: string; subjectId?: string; description?: string; durationMonths?: number; price?: string; status?: "ACTIVE" | "ARCHIVED" }) =>
    request<Course>("/subjects/courses", { method: "POST", body: JSON.stringify(data) }),
  updateCourse: (id: string, data: Partial<Course>) =>
    request<Course>(`/subjects/courses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  archiveCourse: (id: string) =>
    request<Course>(`/subjects/courses/${id}/archive`, { method: "POST" }),
  removeCourse: (id: string) => request<{ success: boolean; archived?: boolean; message?: string }>(`/subjects/courses/${id}`, { method: "DELETE" }),
};

// ---- Parent Portal ----
export const parentPortalApi = {
  listStudents: () => request<Student[]>("/portal/parent/students"),
  getStudentOverview: (studentId: string) => request<any>(`/portal/parent/students/${studentId}/overview`),
  getStudentSchedule: (studentId: string) => request<any>(`/portal/parent/students/${studentId}/schedule`),
  getStudentAttendance: (studentId: string) => request<any>(`/portal/parent/students/${studentId}/attendance`),
  getStudentPayments: (studentId: string) => request<any>(`/portal/parent/students/${studentId}/payments`),
  getStudentInvoices: (studentId: string) => request<Invoice[]>(`/portal/parent/students/${studentId}/invoices`),
  checkoutLink: (studentId: string, data: { provider: "CLICK" | "PAYME"; amount?: number; forMonth?: string; invoiceId?: string }) =>
    request<BillingLink>(`/portal/parent/students/${studentId}/checkout-link`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ---- Invitations ----
export interface Invitation {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
}

export const invitationsApi = {
  list: () => request<Invitation[]>("/invitations"),
  create: (data: { role: Role; email?: string; phone?: string }) =>
    request<{ id: string; role: Role; email: string | null; phone: string | null; expiresAt: string; inviteUrl: string; token: string }>("/invitations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  revoke: (id: string) => request<{ success: boolean }>(`/invitations/${id}`, { method: "DELETE" }),
  validate: (token: string) =>
    request<{
      valid: boolean;
      role: Role;
      email: string | null;
      phone: string | null;
      tenantName: string;
      tenantSubdomain: string;
      expiresAt: string;
    }>(`/invitations/${encodeURIComponent(token)}/validate`),
  accept: (token: string, data: { fullName?: string; password?: string }) =>
    request<{
      accessToken: string;
      refreshToken: string;
      user: User;
      tenant: { id: string; name: string; subdomain: string };
      redirectUrl: string;
    }>(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ---- IELTS mock tests ----

export type MockSection = "listening" | "reading" | "writing" | "speaking";
export const MOCK_SECTIONS: MockSection[] = ["listening", "reading", "writing", "speaking"];

export interface MockContent {
  listening: { durationMin: number; audioPath: string | null; parts: Array<{ title: string; instruction: string | null; audioPath: string | null; transcript: string | null; imagePath: string | null; questions: import("./tests").TestQuestion[] }> };
  reading: { durationMin: number; passages: Array<{ title: string; text: string; imagePath: string | null; questions: import("./tests").TestQuestion[] }> };
  writing: { durationMin: number; tasks: Array<{ title: string; prompt: string; minWords: number; imagePath: string | null }> };
  speaking: { parts: Array<{ title: string; instruction: string | null; prepSeconds: number; answerSeconds: number; questions: string[] }> };
}

export type MockLevel = "B4" | "B5" | "B6" | "B7" | "B8";
export const MOCK_LEVELS: MockLevel[] = ["B4", "B5", "B6", "B7", "B8"];

export interface MockTestSummary {
  id: string;
  title: string;
  subject: string;
  kind: string;
  status: "DRAFT" | "PUBLISHED";
  level: MockLevel | null;
  module: "ACADEMIC" | "GENERAL";
  source: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  summary: { listening: number; reading: number; writing: number; speaking: number };
}

export interface MockTest extends Omit<MockTestSummary, "attempts" | "summary"> {
  content: MockContent;
}

export interface ExaminerFeedback {
  band: number;
  criteria: Record<string, number>;
  strengths: string[];
  improvements: string[];
  summary: string;
  corrections?: Array<{ original: string; better: string }>;
}

export interface MockSectionResult {
  status: "DONE" | "PENDING" | "REVIEW";
  band: number | null;
  raw?: number;
  max?: number;
  marks?: boolean[];
  tasks?: Array<{ band: number | null; words: number; feedback: ExaminerFeedback | null }>;
  feedback?: ExaminerFeedback | null;
  teacherComment?: string | null;
  gradedBy?: "AUTO" | "AI" | "TEACHER";
  late?: boolean;
}
export type MockResults = Partial<Record<MockSection, MockSectionResult>> & { overall?: number | null };

export interface MockSpeakingAnswer { audio: string | null; transcript: string; seconds: number | null }
export interface MockAnswers {
  listening?: Record<string, string>;
  reading?: Record<string, string>;
  writing?: Record<string, string>;
  speaking?: Record<string, MockSpeakingAnswer>;
}

export interface MockAttemptRow {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  studentId: string;
  studentName: string;
  results: MockResults;
  sectionDone: Record<string, string>;
  createdAt: string;
  completedAt: string | null;
}

export interface MockAttemptDetail {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  student: { id: string; fullName: string };
  test: MockTest;
  answers: MockAnswers;
  results: MockResults;
  sectionDone: Record<string, string>;
  createdAt: string;
  completedAt: string | null;
}

type MockPublicQuestion = import("./tests").PublicQuestion & { id: string; no: number; span: number };
export interface PortalMockAttempt {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  test: {
    id: string;
    title: string;
    kind: string;
    subject: string;
    level: MockLevel | null;
    module: "ACADEMIC" | "GENERAL";
    content: {
      listening: { durationMin: number; audioPath: string | null; parts: Array<{ title: string; instruction: string | null; audioPath: string | null; imagePath: string | null; tts: string | null; questions: MockPublicQuestion[] }> };
      reading: { durationMin: number; passages: Array<{ title: string; text: string; imagePath: string | null; questions: MockPublicQuestion[] }> };
      writing: MockContent["writing"];
      speaking: MockContent["speaking"];
    };
  };
  answers: MockAnswers;
  sectionStarted: Record<string, string>;
  sectionDone: Record<string, string>;
  results: MockResults;
  keys: Partial<Record<"listening" | "reading", string[]>>;
  serverNow: string;
  aiFeedback: boolean;
}

export interface PortalPractice {
  aiFeedback: boolean;
  level: MockLevel | null;
  directions: Array<{
    subject: string;
    english: boolean;
    tests: Array<{
      id: string;
      title: string;
      kind: string;
      subject: string;
      level: MockLevel | null;
      module: "ACADEMIC" | "GENERAL";
      open: boolean;
      recommended: boolean;
      sections: { listening: number; reading: number; writing: number; speaking: number };
      durations: { listening: number; reading: number; writing: number };
      attempts: Array<{ id: string; status: "IN_PROGRESS" | "COMPLETED"; createdAt: string; completedAt: string | null; sectionDone: Record<string, string>; results: MockResults }>;
    }>;
  }>;
}

async function postForm<T>(path: string, form: FormData, token: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.message || "Yuklanmadi", res.status, body);
  return body as T;
}

export interface MockImport {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  error: string | null;
  createdAt: string;
  updatedAt: string;
  files: Array<{ name: string; type: string; size: number }>;
  progress: { step: string; message: string; done: number; total: number };
  result: {
    book?: string | null;
    tests?: Array<{ id: string; title: string; level: MockLevel | null; counts: Record<string, number>; warnings: string[] }>;
    unmatchedAudio?: string[];
  };
}

// Multipart upload with a progress callback (books and recordings are big).
function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError((body as { message?: string } | null)?.message || "Yuklanmadi", xhr.status, body as Record<string, unknown> | null));
    };
    xhr.onerror = () => reject(new ApiError("Tarmoq xatosi", 0));
    xhr.send(form);
  });
}

export const mockTestsApi = {
  startImport: (files: File[], onProgress?: (pct: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return uploadWithProgress<MockImport>("/mock-tests/import", form, onProgress);
  },
  imports: () => request<MockImport[]>("/mock-tests/imports"),
  importStatus: (id: string) => request<MockImport>(`/mock-tests/imports/${id}`),
  list: () => request<MockTestSummary[]>("/mock-tests"),
  get: (id: string) => request<MockTest>(`/mock-tests/${id}`),
  create: (data: { title?: string; subject?: string; sample?: boolean }) =>
    request<MockTest>("/mock-tests", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; subject?: string; status?: "DRAFT" | "PUBLISHED"; content?: MockContent; level?: MockLevel | null; module?: "ACADEMIC" | "GENERAL" }) =>
    request<MockTest>(`/mock-tests/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/mock-tests/${id}`, { method: "DELETE" }),
  uploadAsset: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return postForm<{ path: string; name: string; type: string }>(`/mock-tests/${id}/asset`, form, getToken());
  },
  attempts: (id: string) => request<MockAttemptRow[]>(`/mock-tests/${id}/attempts`),
  attempt: (attemptId: string) => request<MockAttemptDetail>(`/mock-tests/attempts/${attemptId}`),
  review: (attemptId: string, data: { section: "writing" | "speaking"; band: number; task1?: number; task2?: number; comment?: string }) =>
    request<MockAttemptDetail>(`/mock-tests/attempts/${attemptId}/review`, { method: "POST", body: JSON.stringify(data) }),
  regrade: (attemptId: string, section: "writing" | "speaking") =>
    request<MockAttemptDetail>(`/mock-tests/attempts/${attemptId}/regrade`, { method: "POST", body: JSON.stringify({ section }) }),
};

export const portalMockApi = {
  list: () => request<PortalPractice>("/portal/mock-tests"),
  start: (testId: string) => request<PortalMockAttempt>(`/portal/mock-tests/${testId}/start`, { method: "POST" }),
  get: (attemptId: string) => request<PortalMockAttempt>(`/portal/mock-tests/attempts/${attemptId}`),
  startSection: (attemptId: string, section: MockSection) =>
    request<PortalMockAttempt>(`/portal/mock-tests/attempts/${attemptId}/sections/${section}/start`, { method: "POST" }),
  save: (attemptId: string, section: MockSection, answers: Record<string, string>) =>
    request<{ saved: boolean }>(`/portal/mock-tests/attempts/${attemptId}/sections/${section}/answers`, { method: "POST", body: JSON.stringify({ answers }) }),
  submit: (attemptId: string, section: MockSection, answers?: Record<string, string>) =>
    request<PortalMockAttempt>(`/portal/mock-tests/attempts/${attemptId}/sections/${section}/submit`, { method: "POST", body: JSON.stringify(answers ? { answers } : {}) }),
  speaking: (attemptId: string, key: string, data: { audio?: Blob | null; transcript?: string; seconds?: number }) => {
    const form = new FormData();
    if (data.audio) form.append("audio", data.audio, `answer.${data.audio.type.includes("mp4") ? "m4a" : data.audio.type.includes("ogg") ? "ogg" : "webm"}`);
    if (data.transcript) form.append("transcript", data.transcript);
    if (data.seconds !== undefined) form.append("seconds", String(Math.round(data.seconds)));
    return postForm<{ saved: boolean }>(`/portal/mock-tests/attempts/${attemptId}/speaking/${key}`, form, getPortalToken());
  },
};
