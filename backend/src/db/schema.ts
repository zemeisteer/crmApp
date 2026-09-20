import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

export const roleEnum = pgEnum('role', [
  'SUPERADMIN',
  'ADMIN',
  'TEACHER',
  'ACCOUNTANT',
]);
export const tenantStatusEnum = pgEnum('tenant_status', [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
]);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE']);
export const languageEnum = pgEnum('language', ['UZ', 'RU', 'EN']);
export const currencyEnum = pgEnum('currency', ['UZS', 'USD', 'RUB']);
export const paymentMethodEnum = pgEnum('payment_method', [
  'CLICK',
  'PAYME',
  'BANK_TRANSFER',
  'CASH',
]);
export const paymentStatusEnum = pgEnum('payment_status', [
  'PAID',
  'PENDING',
  'FAILED',
]);
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'PRESENT',
  'ABSENT',
  'LATE',
]);
export const billingProviderEnum = pgEnum('billing_provider', ['CLICK', 'PAYME']);
export const billingTxStatusEnum = pgEnum('billing_tx_status', [
  'CREATED',
  'PAID',
  'CANCELLED',
]);

// The center's vertical — drives subject suggestions and (later) which
// dashboard widgets make sense for it. Free-ish text on purpose (an admin
// can still type anything in "boshqa"), but the known set gets curated
// subject suggestions in the frontend.
export const tenantCategoryEnum = pgEnum('tenant_category', [
  'TIL_MARKAZI',
  'MATEMATIKA',
  'IT',
  'BOSHQA',
]);

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  subdomain: text('subdomain').notNull(),
  category: tenantCategoryEnum('category').notNull().default('BOSHQA'),
  accentColor: text('accent_color').notNull().default('#4F46E5'),
  logoUrl: text('logo_url'),
  phone: text('phone'),
  address: text('address'),
  email: text('email'),
  telegramUsername: text('telegram_username'),
  website: text('website'),
  websiteLabel: text('website_label'),
  language: languageEnum('language').notNull().default('UZ'),
  currency: currencyEnum('currency').notNull().default('UZS'),
  // References plans.key — kept as free text (not the old enum) so
  // superadmins can add new tariffs without a schema migration.
  plan: text('plan').notNull().default('STARTER'),
  status: tenantStatusEnum('status').notNull().default('TRIAL'),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  subdomainIdx: uniqueIndex('tenants_subdomain_idx').on(t.subdomain),
}));

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  role: roleEnum('role').notNull().default('ADMIN'),
  emailVerified: boolean('email_verified').notNull().default(false),
  resetTokenHash: text('reset_token_hash'),
  resetTokenExpiresAt: timestamp('reset_token_expires_at'),
  verifyTokenHash: text('verify_token_hash'),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
  tenantIdx: index('users_tenant_idx').on(t.tenantId),
}));

// One row per logged-in device/browser, so a user can see and revoke
// individual sessions instead of a single shared refresh token.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  tokenIdx: uniqueIndex('sessions_token_idx').on(t.refreshTokenHash),
}));

export const branches = pgTable('branches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('branches_tenant_idx').on(t.tenantId),
}));

export const teachers = pgTable('teachers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id),
  fullName: text('full_name').notNull(),
  subject: text('subject'),
  phone: text('phone'),
  email: text('email'),
  birthDate: timestamp('birth_date'),
  salaryType: text('salary_type'),
  salaryValue: integer('salary_value'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('teachers_tenant_idx').on(t.tenantId),
}));

export const groups = pgTable('groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  level: text('level'),
  teacherId: text('teacher_id').references(() => teachers.id),
  startDate: timestamp('start_date'),
  maxStudents: integer('max_students').notNull().default(20),
  schedule: text('schedule'),
  scheduleDays: text('schedule_days'), // comma-separated: "MON,WED,FRI"
  startTime: text('start_time'), // "16:00"
  monthlyPrice: integer('monthly_price').notNull().default(0),
  description: text('description'),
  durationMonths: integer('duration_months'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('groups_tenant_idx').on(t.tenantId),
}));

export const students = pgTable('students', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  gender: genderEnum('gender'),
  phone: text('phone'),
  parentPhone: text('parent_phone'),
  birthDate: timestamp('birth_date'),
  address: text('address'),
  telegramUsername: text('telegram_username'),
  telegramChatId: text('telegram_chat_id'),
  startDate: timestamp('start_date').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('students_tenant_idx').on(t.tenantId),
}));

export const enrollments = pgTable('enrollments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('enrollments_student_group_idx').on(t.studentId, t.groupId),
}));

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  discount: integer('discount').notNull().default(0),
  method: paymentMethodEnum('method').notNull().default('CASH'),
  status: paymentStatusEnum('status').notNull().default('PAID'),
  forMonth: text('for_month').notNull(),
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('payments_tenant_idx').on(t.tenantId),
}));

export const attendance = pgTable('attendance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // "2026-09-19"
  status: attendanceStatusEnum('status').notNull().default('PRESENT'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('attendance_tenant_idx').on(t.tenantId),
  groupDateIdx: index('attendance_group_date_idx').on(t.groupId, t.date),
  uniq: uniqueIndex('attendance_student_group_date_idx').on(t.studentId, t.groupId, t.date),
}));

export const salaryPayments = pgTable('salary_payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  forMonth: text('for_month').notNull(), // "2026-09"
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('salary_payments_tenant_idx').on(t.tenantId),
  uniq: uniqueIndex('salary_payments_teacher_month_idx').on(t.teacherId, t.forMonth),
}));

export const billingTransactions = pgTable('billing_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  provider: billingProviderEnum('provider').notNull(),
  providerTxId: text('provider_tx_id'),
  amount: integer('amount').notNull(),
  forMonth: text('for_month').notNull(),
  status: billingTxStatusEnum('status').notNull().default('CREATED'),
  paymentId: text('payment_id').references(() => payments.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('billing_tx_tenant_idx').on(t.tenantId),
  providerTxIdx: index('billing_tx_provider_tx_idx').on(t.provider, t.providerTxId),
}));

export const homework = pgTable('homework', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  dueDate: timestamp('due_date'),
  attachmentPath: text('attachment_path'),
  attachmentName: text('attachment_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('homework_tenant_idx').on(t.tenantId),
  groupIdx: index('homework_group_idx').on(t.groupId),
}));

// Per-student completion status for a homework assignment — lets a teacher
// mark who has turned work in, and lets group-level "who's falling behind"
// charts be computed from real data instead of guessed.
export const homeworkCompletions = pgTable('homework_completions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  homeworkId: text('homework_id').notNull().references(() => homework.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  completed: boolean('completed').notNull().default(false),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('homework_completions_hw_student_idx').on(t.homeworkId, t.studentId),
}));

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(), // "create" | "update" | "delete" | "restore"
  entityType: text('entity_type').notNull(), // "group" | "student" | ...
  entityId: text('entity_id').notNull(),
  meta: text('meta'), // JSON.stringify'd details, kept as plain text for portability
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
  entityIdx: index('audit_logs_entity_idx').on(t.entityType, t.entityId),
}));

// TalimCRM's own pricing tiers — managed by the platform superadmin
// (Tariflar page), shown on the public site and offered to tenant admins.
export const plans = pgTable('plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  key: text('key').notNull(), // stable slug tenants.plan / platformSubscriptions.plan point at
  name: text('name').notNull(),
  price: integer('price').notNull(),
  features: text('features').notNull().default(''), // one feature per line
  popular: boolean('popular').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  keyIdx: uniqueIndex('plans_key_idx').on(t.key),
}));

export const platformSubscriptions = pgTable('platform_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull(),
  amount: integer('amount').notNull(),
  forMonth: text('for_month').notNull(), // "2026-09"
  status: billingTxStatusEnum('status').notNull().default('CREATED'),
  provider: billingProviderEnum('provider'),
  providerTxId: text('provider_tx_id'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('platform_subs_tenant_idx').on(t.tenantId),
  uniq: uniqueIndex('platform_subs_tenant_month_idx').on(t.tenantId, t.forMonth),
}));

export const exams = pgTable('exams', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'), // "nimadan bo'ladi" — topic/scope
  maxScore: integer('max_score').notNull().default(100),
  passingScore: integer('passing_score'),
  durationMinutes: integer('duration_minutes'),
  examDate: timestamp('exam_date'),
  materialPath: text('material_path'),
  materialName: text('material_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('exams_tenant_idx').on(t.tenantId),
  groupIdx: index('exams_group_idx').on(t.groupId),
}));

export const examResults = pgTable('exam_results', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  examId: text('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  score: integer('score').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('exam_results_exam_student_idx').on(t.examId, t.studentId),
}));

// Outgoing event notifications to a tenant's own systems (Zapier-style).
export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  event: text('event').notNull(), // "payment.created" | "attendance.marked" | "student.created" | "*"
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('webhooks_tenant_idx').on(t.tenantId),
}));

// Global (tenantId null) or per-tenant feature toggle, checked at request time.
export const featureFlags = pgTable('feature_flags', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('feature_flags_tenant_key_idx').on(t.tenantId, t.key),
}));

// ---- relations ----
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  groups: many(groups),
  students: many(students),
  teachers: many(teachers),
  payments: many(payments),
  attendance: many(attendance),
  branches: many(branches),
  homework: many(homework),
  auditLogs: many(auditLogs),
  platformSubscriptions: many(platformSubscriptions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [exams.tenantId], references: [tenants.id] }),
  group: one(groups, { fields: [exams.groupId], references: [groups.id] }),
  results: many(examResults),
}));

export const examResultsRelations = relations(examResults, ({ one }) => ({
  exam: one(exams, { fields: [examResults.examId], references: [exams.id] }),
  student: one(students, { fields: [examResults.studentId], references: [students.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  tenant: one(tenants, { fields: [webhooks.tenantId], references: [tenants.id] }),
}));

export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  tenant: one(tenants, { fields: [featureFlags.tenantId], references: [tenants.id] }),
}));

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [teachers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [teachers.userId], references: [users.id] }),
  groups: many(groups),
  salaryPayments: many(salaryPayments),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [groups.tenantId], references: [tenants.id] }),
  teacher: one(teachers, { fields: [groups.teacherId], references: [teachers.id] }),
  branch: one(branches, { fields: [groups.branchId], references: [branches.id] }),
  enrollments: many(enrollments),
  attendance: many(attendance),
  homework: many(homework),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  tenant: one(tenants, { fields: [branches.tenantId], references: [tenants.id] }),
  groups: many(groups),
}));

export const homeworkRelations = relations(homework, ({ one, many }) => ({
  tenant: one(tenants, { fields: [homework.tenantId], references: [tenants.id] }),
  group: one(groups, { fields: [homework.groupId], references: [groups.id] }),
  completions: many(homeworkCompletions),
}));

export const homeworkCompletionsRelations = relations(homeworkCompletions, ({ one }) => ({
  homework: one(homework, { fields: [homeworkCompletions.homeworkId], references: [homework.id] }),
  student: one(students, { fields: [homeworkCompletions.studentId], references: [students.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const platformSubscriptionsRelations = relations(platformSubscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [platformSubscriptions.tenantId], references: [tenants.id] }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  tenant: one(tenants, { fields: [students.tenantId], references: [tenants.id] }),
  enrollments: many(enrollments),
  payments: many(payments),
  attendance: many(attendance),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(students, { fields: [enrollments.studentId], references: [students.id] }),
  group: one(groups, { fields: [enrollments.groupId], references: [groups.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [payments.studentId], references: [students.id] }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  tenant: one(tenants, { fields: [attendance.tenantId], references: [tenants.id] }),
  group: one(groups, { fields: [attendance.groupId], references: [groups.id] }),
  student: one(students, { fields: [attendance.studentId], references: [students.id] }),
}));

export const salaryPaymentsRelations = relations(salaryPayments, ({ one }) => ({
  tenant: one(tenants, { fields: [salaryPayments.tenantId], references: [tenants.id] }),
  teacher: one(teachers, { fields: [salaryPayments.teacherId], references: [teachers.id] }),
}));

export const billingTransactionsRelations = relations(billingTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [billingTransactions.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [billingTransactions.studentId], references: [students.id] }),
  payment: one(payments, { fields: [billingTransactions.paymentId], references: [payments.id] }),
}));
