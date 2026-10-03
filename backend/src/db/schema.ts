import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  primaryKey,
  index,
  jsonb,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

export const roleEnum = pgEnum('role', [
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'MANAGER',
  'RECEPTIONIST',
  'TEACHER',
  'ACCOUNTANT',
  'STUDENT',
  'PARENT',
]);

export const membershipStatusEnum = pgEnum('membership_status', [
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
]);

export const invitationStatusEnum = pgEnum('invitation_status', [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'TELEGRAM',
  'SMS',
  'EMAIL',
  'PUSH',
  'IN_APP',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED',
  'SENT',
  'FAILED',
]);

export const notificationEventEnum = pgEnum('notification_event', [
  'ATTENDANCE_ABSENT',
  'ATTENDANCE_LATE',
  'PAYMENT_DUE',
  'PAYMENT_RECEIVED',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_GRADED',
  'EXAM_RESULT',
  'ANNOUNCEMENT',
  'MANUAL',
  'LESSON_REMINDER',
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
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
]);
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'OPEN',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);


export const expenseCategoryEnum = pgEnum('expense_category', [
  'RENT',
  'UTILITIES',
  'SALARY',
  'MARKETING',
  'SUPPLIES',
  'TAX',
  'OTHER',
]);

export const leadStatusEnum = pgEnum('lead_status', [
  'NEW',
  'CONTACTED',
  'TRIAL_BOOKED',
  'TRIAL_ATTENDED',
  'QUALIFIED',
  'ENROLLED',
  'LOST',
]);

// Value order mirrors the database after migration 0003, which renamed
// RECOMMENDATION -> REFERRAL and BANNER -> ADVERTISEMENT in place and
// appended PHONE (Postgres appends new enum values at the end).
export const leadSourceEnum = pgEnum('lead_source', [
  'INSTAGRAM',
  'TELEGRAM',
  'WEBSITE',
  'REFERRAL',
  'ADVERTISEMENT',
  'WALK_IN',
  'OTHER',
  'PHONE',
]);

export const leadLostReasonEnum = pgEnum('lead_lost_reason', [
  'TOO_EXPENSIVE',
  'NO_RESPONSE',
  'CHOSE_COMPETITOR',
  'SCHEDULE_MISMATCH',
  'LOCATION',
  'NOT_INTERESTED',
  'OTHER',
]);

export const leadActivityTypeEnum = pgEnum('lead_activity_type', [
  'NOTE',
  'CALL',
  'MESSAGE',
  'MEETING',
  'STATUS_CHANGE',
  'FOLLOW_UP_SCHEDULED',
  'TRIAL_BOOKED',
  'TRIAL_ATTENDED',
  'CONVERTED',
  'LOST',
  'REOPENED',
]);

export const leadTrialStatusEnum = pgEnum('lead_trial_status', [
  'BOOKED',
  'ATTENDED',
  'MISSED',
  'CANCELLED',
  'RESCHEDULED',
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

export const examQuestionTypeEnum = pgEnum('exam_question_type', [
  'MCQ',
  'TRUE_FALSE',
  'SHORT_ANSWER',
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
  smsProvider: text('sms_provider').notNull().default('eskiz'),
  smsApiToken: text('sms_api_token'),
  smsSender: text('sms_sender').notNull().default('4546'),
  notifyOnAttendance: boolean('notify_on_attendance').notNull().default(true),
  notifyOnPayment: boolean('notify_on_payment').notNull().default(true),
  notifyOnHomework: boolean('notify_on_homework').notNull().default(true),
  onboardingStep: text('onboarding_step').notNull().default('COMPLETED'),
  teachingCategories: text('teaching_categories').array(),
  country: text('country').notNull().default('UZ'),
  timezone: text('timezone').notNull().default('Asia/Tashkent'),
  // Public site content written by the center (JSON, see tenants/site-content.ts).
  siteContent: text('site_content'),
  // Questions a student may ask the AI tutor in Telegram per day (0 = off).
  studentAiDailyLimit: integer('student_ai_daily_limit').notNull().default(20),
  // Automatic reminders: day of month debtors are reminded (0 = off), and
  // Telegram reminders before lessons.
  remindPaymentDay: integer('remind_payment_day').notNull().default(5),
  remindLessons: boolean('remind_lessons').notNull().default(true),
  // Evening summary (20:00) to owners/admins/managers linked to the bot.
  dailyDigest: boolean('daily_digest').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  subdomainIdx: uniqueIndex('tenants_subdomain_idx').on(t.subdomain),
}));

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  role: roleEnum('role').notNull().default('ADMIN'),
  permissions: text('permissions').array(),
  emailVerified: boolean('email_verified').notNull().default(false),
  resetTokenHash: text('reset_token_hash'),
  resetTokenExpiresAt: timestamp('reset_token_expires_at'),
  verifyTokenHash: text('verify_token_hash'),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  // Staff Telegram chat for CRM reminders, linked through a one-time bot
  // deep link (see TelegramService.generateStaffLinkToken).
  telegramChatId: text('telegram_chat_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
  telegramChatIdx: index('users_telegram_chat_idx').on(t.telegramChatId),
  tenantIdx: index('users_tenant_idx').on(t.tenantId),
}));

// One row per logged-in device/browser, so a user can see and revoke
// individual sessions instead of a single shared refresh token.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  // The workspace this session works in: refresh keeps it (and re-checks
  // the membership) instead of falling back to the user's default center.
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  tokenIdx: uniqueIndex('sessions_token_idx').on(t.refreshTokenHash),
}));

export const organizationMemberships = pgTable('organization_memberships', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('ADMIN'),
  status: membershipStatusEnum('status').notNull().default('ACTIVE'),
  permissions: text('permissions').array(),
  // Set when a member is removed from the center. The row stays (SUSPENDED)
  // as the record that access was taken away; adding the person again
  // clears it.
  removedAt: timestamp('removed_at'),
  removedByUserId: text('removed_by_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userTenantIdx: uniqueIndex('org_memberships_user_tenant_idx').on(t.userId, t.tenantId),
  tenantIdx: index('org_memberships_tenant_idx').on(t.tenantId),
  userIdx: index('org_memberships_user_idx').on(t.userId),
}));

export const invitations = pgTable('invitations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email'),
  phone: text('phone'),
  role: roleEnum('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  status: invitationStatusEnum('status').notNull().default('PENDING'),
  targetEntityId: text('target_entity_id'),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tokenIdx: uniqueIndex('invitations_token_idx').on(t.tokenHash),
  tenantIdx: index('invitations_tenant_idx').on(t.tenantId),
}));

export const subjects = pgTable('subjects', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  code: text('code'),
  color: text('color').default('#3B82F6'),
  description: text('description'),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'ARCHIVED'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantNameIdx: uniqueIndex('subjects_tenant_name_idx').on(t.tenantId, t.name),
  tenantIdx: index('subjects_tenant_idx').on(t.tenantId),
}));

export const courses = pgTable('courses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subjectId: text('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  durationMonths: integer('duration_months').default(3),
  price: text('price').default('0'),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'ARCHIVED'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('courses_tenant_idx').on(t.tenantId),
  subjectIdx: index('courses_subject_idx').on(t.subjectId),
}));

export const branches = pgTable('branches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
  // Map link (Google/Yandex) shown on the public site and to students.
  mapUrl: text('map_url'),
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
  startDate: timestamp('start_date'),
  salaryType: text('salary_type'),
  salaryValue: integer('salary_value'),
  // Retry protection for the create form (the same pattern as payments):
  // a retried request with the same key returns this row; requestHash
  // tells a retry from a different request reusing the key.
  idempotencyKey: text('idempotency_key'),
  requestHash: text('request_hash'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('teachers_tenant_idx').on(t.tenantId),
  idemUniq: uniqueIndex('teachers_tenant_idem_uniq').on(t.tenantId, t.idempotencyKey),
}));

export const groups = pgTable('groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id),
  courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  level: text('level'),
  teacherId: text('teacher_id').references(() => teachers.id),
  status: text('status').notNull().default('ACTIVE'), // 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
  startDate: timestamp('start_date'),
  maxStudents: integer('max_students').notNull().default(20),
  schedule: text('schedule'),
  scheduleDays: text('schedule_days'), // comma-separated: "MON,WED,FRI"
  startTime: text('start_time'), // "16:00"
  // Lesson end, "17:30". Weekly timetable rows are generated from
  // scheduleDays + startTime/endTime (see GroupsService.syncWeeklyLessons).
  endTime: text('end_time'),
  monthlyPrice: integer('monthly_price').notNull().default(0),
  description: text('description'),
  durationMonths: integer('duration_months'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('groups_tenant_idx').on(t.tenantId),
  courseIdx: index('groups_course_idx').on(t.courseId),
}));

// Every monthly price a group has had, so the tuition of a past month is
// worked out with the price of that time, not today's.
export const groupPriceHistory = pgTable('group_price_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  monthlyPrice: integer('monthly_price').notNull(),
  effectiveFrom: timestamp('effective_from').notNull().defaultNow(),
  // RECORDED: the price was set (or confirmed by an authorized person) to
  // apply from `effectiveFrom`. ASSUMED: all that is known is that the
  // group cost this much when the row was written (`createdAt`); what it
  // cost before that was never recorded, so earlier months are estimates.
  source: text('source').notNull().default('RECORDED'),
  // Set on a price confirmed or corrected by hand, with an optional reason.
  confirmedByUserId: text('confirmed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  groupIdx: index('group_price_history_group_idx').on(t.groupId, t.effectiveFrom),
  tenantIdx: index('group_price_history_tenant_idx').on(t.tenantId),
}));

export const students = pgTable('students', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  fullName: text('full_name').notNull(),
  gender: genderEnum('gender'),
  phone: text('phone'),
  parentPhone: text('parent_phone'),
  birthDate: timestamp('birth_date'),
  address: text('address'),
  telegramUsername: text('telegram_username'),
  telegramChatId: text('telegram_chat_id'),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'LEFT'
  // Set when the status becomes LEFT/GRADUATED (churn reports); reason is one of LEFT_REASONS.
  leftAt: timestamp('left_at'),
  leftReason: text('left_reason'),
  // Set while the status is PAUSED: months before it are still owed.
  pausedAt: timestamp('paused_at'),
  notes: text('notes'),
  avatarUrl: text('avatar_url'),
  startDate: timestamp('start_date').notNull().defaultNow(),
  // Retry protection for the create form (the same pattern as payments).
  idempotencyKey: text('idempotency_key'),
  requestHash: text('request_hash'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('students_tenant_idx').on(t.tenantId),
  idemUniq: uniqueIndex('students_tenant_idem_uniq').on(t.tenantId, t.idempotencyKey),
  branchIdx: index('students_branch_idx').on(t.branchId),
  leftAtIdx: index('students_left_at_idx').on(t.tenantId, t.leftAt),
}));

export const enrollments = pgTable('enrollments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('ACTIVE'), // 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),
}, (t) => ({
  tenantIdx: index('enrollments_tenant_idx').on(t.tenantId),
  uniq: uniqueIndex('enrollments_student_group_idx').on(t.studentId, t.groupId),
}));

export const studentGuardians = pgTable('student_guardians', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  relationship: text('relationship').notNull().default('PARENT'), // 'PARENT' | 'FATHER' | 'MOTHER' | 'GUARDIAN'
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('student_guardians_tenant_idx').on(t.tenantId),
  studentIdx: index('student_guardians_student_idx').on(t.studentId),
  userIdx: index('student_guardians_user_idx').on(t.userId),
  uniq: uniqueIndex('student_guardians_student_user_idx').on(t.studentId, t.userId),
}));

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  enrollmentId: text('enrollment_id').references(() => enrollments.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  amountPaid: integer('amount_paid').notNull().default(0),
  remainingAmount: integer('remaining_amount').notNull(),
  currency: currencyEnum('currency').notNull().default('UZS'),
  dueDate: timestamp('due_date').notNull(),
  forMonth: text('for_month').notNull(),
  description: text('description'),
  status: invoiceStatusEnum('status').notNull().default('OPEN'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('invoices_tenant_idx').on(t.tenantId),
  studentIdx: index('invoices_student_idx').on(t.studentId),
  statusIdx: index('invoices_status_idx').on(t.status),
  monthIdx: index('invoices_month_idx').on(t.forMonth),
}));

export const paymentAllocations = pgTable('payment_allocations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  paymentId: text('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('payment_allocations_tenant_idx').on(t.tenantId),
  paymentIdx: index('payment_allocations_payment_idx').on(t.paymentId),
  invoiceIdx: index('payment_allocations_invoice_idx').on(t.invoiceId),
  uniq: uniqueIndex('payment_allocations_payment_invoice_uniq').on(t.paymentId, t.invoiceId),
}));

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  discount: integer('discount').notNull().default(0),
  method: paymentMethodEnum('method').notNull().default('CASH'),
  status: paymentStatusEnum('status').notNull().default('PAID'),
  forMonth: text('for_month').notNull(),
  providerTxId: text('provider_tx_id'),
  receiptNumber: text('receipt_number'),
  // Retry protection for payments entered by staff: the same key from the
  // same center returns the first payment instead of taking the money twice;
  // requestHash tells a retry from a different request reusing the key.
  idempotencyKey: text('idempotency_key'),
  requestHash: text('request_hash'),
  paidAt: timestamp('paid_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('payments_tenant_idx').on(t.tenantId),
  invoiceIdx: index('payments_invoice_idx').on(t.invoiceId),
  idemUniq: uniqueIndex('payments_tenant_idem_uniq').on(t.tenantId, t.idempotencyKey),
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

// What was covered in a lesson: one row per group and local date, entered
// together with attendance.
export const lessonTopics = pgTable('lesson_topics', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // "2026-09-19"
  topic: text('topic').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  groupDateIdx: uniqueIndex('lesson_topics_group_date_idx').on(t.groupId, t.date),
  tenantIdx: index('lesson_topics_tenant_idx').on(t.tenantId),
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
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
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
  invoiceIdx: index('billing_tx_invoice_idx').on(t.invoiceId),
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
  maxScore: integer('max_score').notNull().default(100),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('homework_tenant_idx').on(t.tenantId),
  groupIdx: index('homework_group_idx').on(t.groupId),
}));

// Per-student completion status for a homework assignment — lets a teacher
// mark who has turned work in, score submissions, and provide feedback.
export const homeworkCompletions = pgTable('homework_completions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  homeworkId: text('homework_id').notNull().references(() => homework.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  completed: boolean('completed').notNull().default(false),
  submissionText: text('submission_text'),
  submissionAttachmentUrl: text('submission_attachment_url'),
  submittedAt: timestamp('submitted_at'),
  score: integer('score'),
  feedback: text('feedback'),
  status: text('status').notNull().default('PENDING'), // PENDING | SUBMITTED | GRADED
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

export const examQuestions = pgTable('exam_questions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  examId: text('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  // See common/test-questions.ts for the types (MCQ, TRUE_FALSE_NG,
  // MATCHING, ESSAY, ...). Plain text so new types need no migration.
  questionType: text('question_type').notNull().default('MCQ'),
  options: text('options'), // JSON string: [{ "id": "A", "text": "..." }, ...]
  correctAnswer: text('correct_answer').notNull(), // "A", "true", accepted texts "a|b", matching JSON
  // Shown once above a run of questions: section title, instruction and a
  // reading passage the questions refer to.
  section: text('section'),
  instruction: text('instruction'),
  passage: text('passage'),
  // Type-specific extras as JSON: matching pairs, word-order words, essay rubric.
  meta: text('meta'),
  explanation: text('explanation'),
  points: integer('points').notNull().default(1),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('exam_questions_tenant_idx').on(t.tenantId),
  examIdx: index('exam_questions_exam_idx').on(t.examId),
}));

export const examAttempts = pgTable('exam_attempts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  examId: text('exam_id').notNull().references(() => exams.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  score: integer('score').notNull().default(0),
  maxScore: integer('max_score').notNull().default(0),
  passed: boolean('passed').notNull().default(false),
  answers: text('answers'), // JSON string: { [questionId]: string }
  // PENDING while essays wait for the teacher; DONE otherwise.
  reviewStatus: text('review_status').notNull().default('DONE'),
  manualScores: text('manual_scores'), // JSON { [questionId]: points }
  aiReview: text('ai_review'), // JSON { [questionId]: { score, comment } }
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('exam_attempts_tenant_idx').on(t.tenantId),
  examStudentIdx: index('exam_attempts_exam_student_idx').on(t.examId, t.studentId),
}));

// Portal PIN the center hands a student (bcrypt hash). Kept out of the
// students table so student reads never carry it.
export const studentPortalPins = pgTable('student_portal_pins', {
  studentId: text('student_id').primaryKey().references(() => students.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// One-time portal login codes sent to a student's Telegram. Keyed by the
// normalized phone the person typed; only the hash is stored.
export const portalLoginCodes = pgTable('portal_login_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  phone: text('phone').notNull(), // "+998901234567"
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  phoneIdx: index('portal_login_codes_phone_idx').on(t.phone),
}));

// Whether the teacher taught a given group's lesson on a date. ABSENT
// lessons are taken off the payroll; a substitute gets the lesson instead
// (per-lesson pay).
export const teacherAttendance = pgTable('teacher_attendance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  status: text('status').notNull(), // 'PRESENT' | 'LATE' | 'ABSENT'
  substituteTeacherId: text('substitute_teacher_id').references(() => teachers.id, { onDelete: 'set null' }),
  note: text('note'),
  markedByUserId: text('marked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  groupDateIdx: uniqueIndex('teacher_attendance_group_date_idx').on(t.groupId, t.date),
  tenantDateIdx: index('teacher_attendance_tenant_date_idx').on(t.tenantId, t.date),
}));

// Placement (level) tests shared by link: new students open
// /t/<token>, enter name and phone, and answer. Questions include the
// answers, so the public endpoint strips them.
export const placementTests = pgTable('placement_tests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  subject: text('subject').notNull(),
  language: text('language').notNull().default('UZ'),
  questions: text('questions').notNull(), // JSON: PlacementQuestion[]
  token: text('token').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tokenIdx: uniqueIndex('placement_tests_token_idx').on(t.token),
  tenantIdx: index('placement_tests_tenant_idx').on(t.tenantId),
}));

export const placementAttempts = pgTable('placement_attempts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  testId: text('test_id').notNull().references(() => placementTests.id, { onDelete: 'cascade' }),
  // The admissions lead this attempt was filed under (matched or created
  // by phone when the test was submitted).
  leadId: text('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  answers: text('answers').notNull(), // JSON: string[] by question index
  correct: integer('correct').notNull().default(0),
  total: integer('total').notNull().default(0),
  percent: integer('percent').notNull().default(0),
  suggestedLevel: integer('suggested_level').notNull().default(1), // 1-3
  reviewStatus: text('review_status').notNull().default('DONE'),
  manualScores: text('manual_scores'), // JSON { [questionIndex]: points }
  aiReview: text('ai_review'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  testIdx: index('placement_attempts_test_idx').on(t.testId),
  leadIdx: index('placement_attempts_lead_idx').on(t.leadId),
  tenantIdx: index('placement_attempts_tenant_idx').on(t.tenantId),
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

// Secure, time-limited, single-use linking token for Telegram bot account attachment
export const telegramLinkTokens = pgTable('telegram_link_tokens', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').references(() => students.id, { onDelete: 'cascade' }),
  // Set instead of studentId when a staff member links their own Telegram.
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  // 'STUDENT' links the student's own chat, 'PARENT' adds a parent's chat.
  purpose: text('purpose').notNull().default('STUDENT'),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tokenIdx: uniqueIndex('telegram_link_tokens_token_idx').on(t.token),
  tenantIdx: index('telegram_link_tokens_tenant_idx').on(t.tenantId),
}));

// One row per reminder sent, so a reminder goes out once even across
// restarts or several servers (kind + target + key is unique).
export const reminderLog = pgTable('reminder_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'PAYMENT' | 'LESSON' | 'LESSON_TEACHER'
  targetId: text('target_id').notNull(), // student or teacher user id
  key: text('key').notNull(), // e.g. '2026-09' or '2026-09-29:<groupId>'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  onceIdx: uniqueIndex('reminder_log_once_idx').on(t.kind, t.targetId, t.key),
  tenantIdx: index('reminder_log_tenant_idx').on(t.tenantId, t.createdAt),
}));

// A student's conversation with the AI tutor in the Telegram bot (kept for
// context and the daily limit; old rows are pruned).
export const studentAiMessages = pgTable('student_ai_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  studentIdx: index('student_ai_messages_student_idx').on(t.studentId, t.createdAt),
  tenantIdx: index('student_ai_messages_tenant_idx').on(t.tenantId),
}));

// One-time codes that move a staff session to the center's own address
// (the browser keeps a separate login per host). Stored hashed, 60 seconds.
export const authHandoffCodes = pgTable('auth_handoff_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  codeHash: text('code_hash').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  hashIdx: uniqueIndex('auth_handoff_codes_hash_idx').on(t.codeHash),
}));

// A parent's Telegram chat, linked to one or more children (the student's
// own chat stays on students.telegram_chat_id). `active` = the child the
// parent is looking at in the bot.
export const telegramParentChats = pgTable('telegram_parent_chats', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull(),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  studentChatIdx: uniqueIndex('telegram_parent_chats_student_chat_idx').on(t.studentId, t.chatId),
  chatIdx: index('telegram_parent_chats_chat_idx').on(t.chatId),
}));

// Admissions & Sales CRM — Leads management
// A lead is a prospect, never a student: a student row only appears through
// the explicit conversion flow, and the lead row is kept (never deleted)
// afterwards as the admissions history. See migration 0003.
export const leads = pgTable('leads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  // Canonical form used for duplicate detection (+998XXXXXXXXX for Uzbek
  // numbers, +<digits> otherwise). Always derived server-side from `phone`.
  phoneNormalized: text('phone_normalized'),
  secondaryPhone: text('secondary_phone'),
  email: text('email'),
  emailNormalized: text('email_normalized'),
  status: leadStatusEnum('status').notNull().default('NEW'),
  source: leadSourceEnum('source').notNull().default('OTHER'),
  desiredSubjectId: text('desired_subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  desiredCourseId: text('desired_course_id').references(() => courses.id, { onDelete: 'set null' }),
  preferredBranchId: text('preferred_branch_id').references(() => branches.id, { onDelete: 'set null' }),
  assignedManagerUserId: text('assigned_manager_user_id').references(() => users.id, { onDelete: 'set null' }),
  followUpAt: timestamp('follow_up_at'),
  // Set when LeadFollowUpDue was emitted for the current followUpAt; cleared
  // whenever followUpAt changes so each scheduled follow-up fires once.
  followUpNotifiedAt: timestamp('follow_up_notified_at'),
  notes: text('notes'),
  lostReason: leadLostReasonEnum('lost_reason'),
  lostNote: text('lost_note'),
  lostAt: timestamp('lost_at'),
  convertedAt: timestamp('converted_at'),
  convertedStudentId: text('converted_student_id').references(() => students.id),
  // Set only by an audited duplicate override; such rows are exempt from the
  // per-tenant uniqueness indexes below.
  duplicateOfLeadId: text('duplicate_of_lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
  archivedAt: timestamp('archived_at'),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  // Legacy, non-authoritative: free-text interest from before desiredSubjectId
  // existed (and from public forms whose text matched no subject).
  legacySubject: text('subject'),
  // Legacy trial columns, superseded by lead_trials (backfilled in 0003).
  legacyTrialDate: timestamp('trial_date'),
  legacyTrialGroupId: text('trial_group_id').references(() => groups.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('leads_tenant_idx').on(t.tenantId),
  statusIdx: index('leads_status_idx').on(t.status),
  tenantStatusIdx: index('leads_tenant_status_idx').on(t.tenantId, t.status),
  tenantFollowUpIdx: index('leads_tenant_follow_up_idx').on(t.tenantId, t.followUpAt),
  tenantManagerIdx: index('leads_tenant_manager_idx').on(t.tenantId, t.assignedManagerUserId),
  tenantCreatedIdx: index('leads_tenant_created_idx').on(t.tenantId, t.createdAt),
  phoneUniq: uniqueIndex('leads_tenant_phone_active_uniq')
    .on(t.tenantId, t.phoneNormalized)
    .where(sql`${t.archivedAt} IS NULL AND ${t.duplicateOfLeadId} IS NULL AND ${t.phoneNormalized} IS NOT NULL`),
  emailUniq: uniqueIndex('leads_tenant_email_active_uniq')
    .on(t.tenantId, t.emailNormalized)
    .where(sql`${t.archivedAt} IS NULL AND ${t.duplicateOfLeadId} IS NULL AND ${t.emailNormalized} IS NOT NULL`),
}));

// Append-only admissions timeline. Distinct from audit_logs: activities are
// the sales conversation (calls, notes, stage moves) shown to staff, while
// audit_logs record security-relevant actions.
export const leadActivities = pgTable('lead_activities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  type: leadActivityTypeEnum('type').notNull(),
  body: text('body'),
  fromStatus: leadStatusEnum('from_status'),
  toStatus: leadStatusEnum('to_status'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantLeadIdx: index('lead_activities_tenant_lead_idx').on(t.tenantId, t.leadId, t.occurredAt),
  tenantTypeIdx: index('lead_activities_tenant_type_idx').on(t.tenantId, t.type),
}));

// Trial lessons are a first-class record rather than attendance rows, so a
// prospect never appears in (or corrupts) student attendance.
export const leadTrials = pgTable('lead_trials', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  subjectId: text('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
  courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
  teacherId: text('teacher_id').references(() => teachers.id, { onDelete: 'set null' }),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  roomId: text('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  scheduledAt: timestamp('scheduled_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  status: leadTrialStatusEnum('status').notNull().default('BOOKED'),
  outcomeNote: text('outcome_note'),
  rescheduledFromTrialId: text('rescheduled_from_trial_id').references((): AnyPgColumn => leadTrials.id, { onDelete: 'set null' }),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantLeadIdx: index('lead_trials_tenant_lead_idx').on(t.tenantId, t.leadId),
  tenantScheduledIdx: index('lead_trials_tenant_scheduled_idx').on(t.tenantId, t.scheduledAt),
  oneBookedPerLead: uniqueIndex('lead_trials_one_booked_per_lead')
    .on(t.leadId)
    .where(sql`${t.status} = 'BOOKED'`),
}));

// Verifiable Digital Certificates (CRMAPP Master Spec Section 23)
export const certificates = pgTable('certificates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  code: text('code').notNull(), // Unique public verification code, e.g. "CERT-2026-9A8B"
  title: text('title').notNull(), // e.g. "General English (B2) Bitiruv Sertifikati"
  grade: text('grade'), // e.g. "A+", "IELTS 7.5", "A'lo"
  issueDate: timestamp('issue_date').notNull().defaultNow(),
  signatoryName: text('signatory_name').notNull().default("O'quv bo'limi"),
  signatoryTitle: text('signatory_title'),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('certificates_tenant_idx').on(t.tenantId),
  codeIdx: uniqueIndex('certificates_code_idx').on(t.code),
  studentIdx: index('certificates_student_idx').on(t.studentId),
}));

// Announcements & News (CRMAPP Master Spec Section 33)
export const announcements = pgTable('announcements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  targetAudience: text('target_audience').notNull().default('ALL'), // 'ALL' | 'STUDENTS' | 'TEACHERS' | 'GROUP'
  targetGroupId: text('target_group_id').references(() => groups.id, { onDelete: 'cascade' }),
  priority: text('priority').notNull().default('NORMAL'), // 'NORMAL' | 'HIGH' | 'URGENT'
  sendTelegram: boolean('send_telegram').notNull().default(false),
  publishedAt: timestamp('published_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('announcements_tenant_idx').on(t.tenantId),
  publishedAtIdx: index('announcements_published_at_idx').on(t.publishedAt),
}));

// Which announcements a student has read in the portal (a parent reading in
// the child's cabinet marks it for that child too).
export const announcementReads = pgTable('announcement_reads', {
  announcementId: text('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('announcement_reads_ann_student_idx').on(t.announcementId, t.studentId),
  studentIdx: index('announcement_reads_student_idx').on(t.studentId),
}));

// Which announcements a staff user has read (or dismissed) on the dashboard.
export const announcementUserReads = pgTable('announcement_user_reads', {
  announcementId: text('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('announcement_user_reads_ann_user_idx').on(t.announcementId, t.userId),
  userIdx: index('announcement_user_reads_user_idx').on(t.userId),
}));

// Mock and practice tests solved in the student portal. kind IELTS: the
// four IELTS sections (content: mock-tests/ielts.ts); PRACTICE: timed
// sections for any direction (mock-tests/practice.ts).
export const mockTests = pgTable('mock_tests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('IELTS'),
  // Direction it belongs to: students see tests of their groups' subjects.
  subject: text('subject').notNull().default('Ingliz tili'),
  status: text('status').notNull().default('DRAFT'), // DRAFT | PUBLISHED
  // Target band B4..B8 (see mock-tests/ielts.ts LEVELS); null: all levels.
  level: text('level'),
  module: text('module').notNull().default('ACADEMIC'), // ACADEMIC | GENERAL
  // Where it came from, e.g. "Cambridge IELTS 18 — Test 2".
  source: text('source'),
  importId: text('import_id'),
  // Which test of the imported book this is (0, 1, ...): an import that is
  // retried or picked up by another server cannot create it twice.
  importIndex: integer('import_index'),
  // Set on a practice test the AI made for one student: only they see it.
  ownerStudentId: text('owner_student_id').references(() => students.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default('{}'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('mock_tests_tenant_idx').on(t.tenantId),
  ownerStudentIdx: index('mock_tests_owner_student_idx').on(t.ownerStudentId),
  importUniq: uniqueIndex('mock_tests_import_uniq').on(t.importId, t.importIndex),
}));

// A batch of uploaded materials (PDF books, audio) turned into mock tests in
// the background: the tests are found in the PDFs, extracted by AI, and the
// recordings matched to their parts.
export const mockImports = pgTable('mock_imports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('QUEUED'), // QUEUED | RUNNING | DONE | FAILED
  files: text('files').notNull().default('[]'),
  progress: text('progress').notNull().default('{}'),
  result: text('result').notNull().default('{}'),
  error: text('error'),
  // Who started it.
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  // Servers only take jobs of their own queue (IMPORT_QUEUE), so a test run
  // or a second environment on the same database never runs these.
  queue: text('queue').notNull().default('default'),
  // The job is a row in this table, not memory: any server may take it.
  // `lockedBy` is the server working on it and `lockedAt` its heartbeat; a
  // job whose heartbeat stopped is taken over. `attempts` counts starts.
  attempts: integer('attempts').notNull().default(0),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at'),
  // Not before this time (back-off after a failed attempt).
  nextRunAt: timestamp('next_run_at'),
  // Where the tests are in the book, kept so a retry extracts the same tests.
  plan: text('plan'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('mock_imports_tenant_idx').on(t.tenantId),
  queueIdx: index('mock_imports_queue_idx').on(t.queue, t.status, t.createdAt),
}));

// Daily counters of what a student has used of the AI (kind: PRACTICE = AI
// practice sets). One row per student, kind and local day; the limit is
// enforced by a single conditional UPDATE, so parallel requests cannot go
// over it.
export const aiUsage = pgTable('ai_usage', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  day: text('day').notNull(), // "2026-10-01" in the center's time zone
  used: integer('used').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.studentId, t.kind, t.day] }),
  tenantIdx: index('ai_usage_tenant_idx').on(t.tenantId),
}));

// One student's sitting of a mock test. JSON columns: answers per section,
// when each section started/finished, and results (bands, AI feedback).
export const mockAttempts = pgTable('mock_attempts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  testId: text('test_id').notNull().references(() => mockTests.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('IN_PROGRESS'), // IN_PROGRESS | COMPLETED
  answers: text('answers').notNull().default('{}'),
  sectionStarted: text('section_started').notNull().default('{}'),
  sectionDone: text('section_done').notNull().default('{}'),
  results: text('results').notNull().default('{}'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (t) => ({
  tenantIdx: index('mock_attempts_tenant_idx').on(t.tenantId),
  testStudentIdx: index('mock_attempts_test_student_idx').on(t.testId, t.studentId),
}));

// Rooms / Classrooms (CRMAPP Master Spec Section 17)
export const rooms = pgTable('rooms', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull().default(20),
  color: text('color').notNull().default('#4F46E5'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('rooms_tenant_idx').on(t.tenantId),
}));

// Schedules / Lessons (CRMAPP Master Spec Section 17)
export const schedules = pgTable('schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').references(() => teachers.id, { onDelete: 'set null' }),
  roomId: text('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  dayOfWeek: integer('day_of_week'), // 1 (Mon) to 7 (Sun)
  date: text('date'), // YYYY-MM-DD for one-time lessons
  startTime: text('start_time').notNull(), // "09:00"
  endTime: text('end_time').notNull(), // "10:30"
  isRecurring: boolean('is_recurring').notNull().default(true),
  onlineMeetingUrl: text('online_meeting_url'),
  status: text('status').notNull().default('SCHEDULED'), // 'SCHEDULED' | 'CANCELLED' | 'COMPLETED'
  topic: text('topic'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('schedules_tenant_idx').on(t.tenantId),
  groupIdx: index('schedules_group_idx').on(t.groupId),
  teacherIdx: index('schedules_teacher_idx').on(t.teacherId),
  roomIdx: index('schedules_room_idx').on(t.roomId),
}));

// Expenses (CRMAPP Master Spec Section 24)
export const expenses = pgTable('expenses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  category: expenseCategoryEnum('category').notNull().default('OTHER'),
  amount: integer('amount').notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull().default('CASH'),
  date: text('date').notNull(), // "YYYY-MM-DD"
  notes: text('notes'),
  recordedById: text('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('expenses_tenant_idx').on(t.tenantId),
  dateIdx: index('expenses_date_idx').on(t.date),
}));

// Multi-Channel Notifications (CRMAPP Master Spec Section 30)
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  studentId: text('student_id').references(() => students.id, { onDelete: 'set null' }),
  channel: notificationChannelEnum('channel').notNull(),
  event: notificationEventEnum('event').notNull().default('MANUAL'),
  status: notificationStatusEnum('status').notNull().default('QUEUED'),
  recipient: text('recipient').notNull(),
  title: text('title'),
  content: text('content').notNull(),
  errorMessage: text('error_message'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('notifications_tenant_idx').on(t.tenantId),
  recipientIdx: index('notifications_recipient_idx').on(t.recipient),
  createdAtIdx: index('notifications_created_at_idx').on(t.createdAt),
  eventIdx: index('notifications_event_idx').on(t.event),
}));

// ---- relations ----
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  organizationMemberships: many(organizationMemberships),
  invitations: many(invitations),
  subjects: many(subjects),
  courses: many(courses),
  groups: many(groups),
  students: many(students),
  teachers: many(teachers),
  payments: many(payments),
  attendance: many(attendance),
  branches: many(branches),
  homework: many(homework),
  auditLogs: many(auditLogs),
  platformSubscriptions: many(platformSubscriptions),
  leads: many(leads),
  certificates: many(certificates),
  announcements: many(announcements),
  examQuestions: many(examQuestions),
  examAttempts: many(examAttempts),
  notifications: many(notifications),
  rooms: many(rooms),
  schedules: many(schedules),
  expenses: many(expenses),
  studentGuardians: many(studentGuardians),
  enrollments: many(enrollments),
  invoices: many(invoices),
  paymentAllocations: many(paymentAllocations),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leads.tenantId], references: [tenants.id] }),
  preferredBranch: one(branches, { fields: [leads.preferredBranchId], references: [branches.id] }),
  desiredSubject: one(subjects, { fields: [leads.desiredSubjectId], references: [subjects.id] }),
  desiredCourse: one(courses, { fields: [leads.desiredCourseId], references: [courses.id] }),
  assignedManager: one(users, { fields: [leads.assignedManagerUserId], references: [users.id] }),
  convertedStudent: one(students, { fields: [leads.convertedStudentId], references: [students.id] }),
  activities: many(leadActivities),
  trials: many(leadTrials),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, { fields: [leadActivities.leadId], references: [leads.id] }),
  actor: one(users, { fields: [leadActivities.actorUserId], references: [users.id] }),
}));

export const leadTrialsRelations = relations(leadTrials, ({ one }) => ({
  lead: one(leads, { fields: [leadTrials.leadId], references: [leads.id] }),
  branch: one(branches, { fields: [leadTrials.branchId], references: [branches.id] }),
  subject: one(subjects, { fields: [leadTrials.subjectId], references: [subjects.id] }),
  course: one(courses, { fields: [leadTrials.courseId], references: [courses.id] }),
  teacher: one(teachers, { fields: [leadTrials.teacherId], references: [teachers.id] }),
  group: one(groups, { fields: [leadTrials.groupId], references: [groups.id] }),
  room: one(rooms, { fields: [leadTrials.roomId], references: [rooms.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  organizationMemberships: many(organizationMemberships),
  sessions: many(sessions),
  announcements: many(announcements),
  expenses: many(expenses),
  guardianships: many(studentGuardians),
}));

export const organizationMembershipsRelations = relations(organizationMemberships, ({ one }) => ({
  user: one(users, { fields: [organizationMemberships.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [organizationMemberships.tenantId], references: [tenants.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  invitedBy: one(users, { fields: [invitations.invitedByUserId], references: [users.id] }),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  tenant: one(tenants, { fields: [subjects.tenantId], references: [tenants.id] }),
  courses: many(courses),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [courses.tenantId], references: [tenants.id] }),
  subject: one(subjects, { fields: [courses.subjectId], references: [subjects.id] }),
  groups: many(groups),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [exams.tenantId], references: [tenants.id] }),
  group: one(groups, { fields: [exams.groupId], references: [groups.id] }),
  results: many(examResults),
  questions: many(examQuestions),
  attempts: many(examAttempts),
}));

export const examResultsRelations = relations(examResults, ({ one }) => ({
  exam: one(exams, { fields: [examResults.examId], references: [exams.id] }),
  student: one(students, { fields: [examResults.studentId], references: [students.id] }),
}));

export const examQuestionsRelations = relations(examQuestions, ({ one }) => ({
  tenant: one(tenants, { fields: [examQuestions.tenantId], references: [tenants.id] }),
  exam: one(exams, { fields: [examQuestions.examId], references: [exams.id] }),
}));

export const examAttemptsRelations = relations(examAttempts, ({ one }) => ({
  tenant: one(tenants, { fields: [examAttempts.tenantId], references: [tenants.id] }),
  exam: one(exams, { fields: [examAttempts.examId], references: [exams.id] }),
  student: one(students, { fields: [examAttempts.studentId], references: [students.id] }),
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
  schedules: many(schedules),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [groups.tenantId], references: [tenants.id] }),
  teacher: one(teachers, { fields: [groups.teacherId], references: [teachers.id] }),
  branch: one(branches, { fields: [groups.branchId], references: [branches.id] }),
  course: one(courses, { fields: [groups.courseId], references: [courses.id] }),
  enrollments: many(enrollments),
  attendance: many(attendance),
  homework: many(homework),
  certificates: many(certificates),
  announcements: many(announcements),
  schedules: many(schedules),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  tenant: one(tenants, { fields: [branches.tenantId], references: [tenants.id] }),
  groups: many(groups),
  rooms: many(rooms),
  schedules: many(schedules),
  expenses: many(expenses),
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
  branch: one(branches, { fields: [students.branchId], references: [branches.id] }),
  enrollments: many(enrollments),
  payments: many(payments),
  invoices: many(invoices),
  attendance: many(attendance),
  certificates: many(certificates),
  attempts: many(examAttempts),
  guardians: many(studentGuardians),
}));

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [enrollments.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [enrollments.studentId], references: [students.id] }),
  group: one(groups, { fields: [enrollments.groupId], references: [groups.id] }),
  invoices: many(invoices),
}));

export const studentGuardiansRelations = relations(studentGuardians, ({ one }) => ({
  tenant: one(tenants, { fields: [studentGuardians.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [studentGuardians.studentId], references: [students.id] }),
  user: one(users, { fields: [studentGuardians.userId], references: [users.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  tenant: one(tenants, { fields: [invoices.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [invoices.studentId], references: [students.id] }),
  enrollment: one(enrollments, { fields: [invoices.enrollmentId], references: [enrollments.id] }),
  allocations: many(paymentAllocations),
  payments: many(payments),
  billingTransactions: many(billingTransactions),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  tenant: one(tenants, { fields: [paymentAllocations.tenantId], references: [tenants.id] }),
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(invoices, { fields: [paymentAllocations.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [payments.studentId], references: [students.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  allocations: many(paymentAllocations),
  billingTransactions: many(billingTransactions),
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
  invoice: one(invoices, { fields: [billingTransactions.invoiceId], references: [invoices.id] }),
}));

export const telegramLinkTokensRelations = relations(telegramLinkTokens, ({ one }) => ({
  tenant: one(tenants, { fields: [telegramLinkTokens.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [telegramLinkTokens.studentId], references: [students.id] }),
  user: one(users, { fields: [telegramLinkTokens.userId], references: [users.id] }),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
  tenant: one(tenants, { fields: [certificates.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [certificates.studentId], references: [students.id] }),
  group: one(groups, { fields: [certificates.groupId], references: [groups.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  tenant: one(tenants, { fields: [announcements.tenantId], references: [tenants.id] }),
  author: one(users, { fields: [announcements.authorId], references: [users.id] }),
  targetGroup: one(groups, { fields: [announcements.targetGroupId], references: [groups.id] }),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  tenant: one(tenants, { fields: [rooms.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [rooms.branchId], references: [branches.id] }),
  schedules: many(schedules),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  tenant: one(tenants, { fields: [schedules.tenantId], references: [tenants.id] }),
  group: one(groups, { fields: [schedules.groupId], references: [groups.id] }),
  teacher: one(teachers, { fields: [schedules.teacherId], references: [teachers.id] }),
  room: one(rooms, { fields: [schedules.roomId], references: [rooms.id] }),
  branch: one(branches, { fields: [schedules.branchId], references: [branches.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  tenant: one(tenants, { fields: [expenses.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [expenses.branchId], references: [branches.id] }),
  recordedBy: one(users, { fields: [expenses.recordedById], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  tenant: one(tenants, { fields: [notifications.tenantId], references: [tenants.id] }),
  student: one(students, { fields: [notifications.studentId], references: [students.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));




