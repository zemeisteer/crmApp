import type { Lang } from "./i18n";

// Turns an audit log entry's JSON "meta" into a short human sentence in the
// viewer's language, instead of showing raw JSON.

type Meta = Record<string, unknown>;
type Tpl = Record<Lang, string>;

const T = {
  newStudent: { UZ: "Yangi o'quvchi: {name}", RU: "Новый ученик: {name}", EN: "New student: {name}" },
  newTeacher: { UZ: "Yangi o'qituvchi: {name}", RU: "Новый учитель: {name}", EN: "New teacher: {name}" },
  newGroup: { UZ: "Yangi guruh: {name}", RU: "Новая группа: {name}", EN: "New group: {name}" },
  changed: { UZ: "O'zgartirildi: {fields}", RU: "Изменено: {fields}", EN: "Changed: {fields}" },
  statusSet: { UZ: "Holati: {status}", RU: "Статус: {status}", EN: "Status: {status}" },
  payment: { UZ: "{amount} so'm · {method}{receipt}", RU: "{amount} сум · {method}{receipt}", EN: "{amount} sum · {method}{receipt}" },
  receipt: { UZ: " · chek {no}", RU: " · чек {no}", EN: " · receipt {no}" },
  invoice: { UZ: "{amount} so'm · {month} oyi uchun", RU: "{amount} сум · за {month}", EN: "{amount} sum · for {month}" },
  invoiceBatch: { UZ: "{count} ta hisob-faktura · {month}", RU: "{count} счетов · {month}", EN: "{count} invoices · {month}" },
  gatewayPaid: { UZ: "{provider} orqali {amount} so'm to'landi", RU: "Оплачено {amount} сум через {provider}", EN: "{amount} sum paid via {provider}" },
  gatewayCancel: { UZ: "{provider} to'lovi bekor qilindi", RU: "Платёж {provider} отменён", EN: "{provider} payment cancelled" },
  converted: { UZ: "O'quvchiga aylantirildi (yangi o'quvchi)", RU: "Переведён в ученики (новый ученик)", EN: "Converted to a new student" },
  convertedLinked: { UZ: "Mavjud o'quvchiga bog'landi", RU: "Связан с существующим учеником", EN: "Linked to an existing student" },
  reason: { UZ: "Sabab: {reason}", RU: "Причина: {reason}", EN: "Reason: {reason}" },
  duplicate: { UZ: "Dublikat sifatida yaratildi · {reason}", RU: "Создан как дубликат · {reason}", EN: "Created as a duplicate · {reason}" },
  assigned: { UZ: "Mas'ul xodim biriktirildi", RU: "Назначен ответственный", EN: "Owner assigned" },
  unassigned: { UZ: "Mas'ul olib tashlandi", RU: "Ответственный снят", EN: "Owner removed" },
  reopened: { UZ: "Lid qayta ochildi", RU: "Лид открыт заново", EN: "Lead reopened" },
  exported: { UZ: "{rows} ta lid eksport qilindi", RU: "Экспортировано лидов: {rows}", EN: "{rows} leads exported" },
  trialMoved: { UZ: "Sinov darsi ko'chirildi", RU: "Пробный урок перенесён", EN: "Trial lesson rescheduled" },
} satisfies Record<string, Tpl>;

const FIELD_LABELS: Record<string, Tpl> = {
  fullName: { UZ: "ism", RU: "имя", EN: "name" },
  name: { UZ: "nomi", RU: "название", EN: "name" },
  phone: { UZ: "telefon", RU: "телефон", EN: "phone" },
  parentPhone: { UZ: "ota-ona telefoni", RU: "телефон родителя", EN: "parent phone" },
  status: { UZ: "holat", RU: "статус", EN: "status" },
  teacherId: { UZ: "o'qituvchi", RU: "учитель", EN: "teacher" },
  branchId: { UZ: "filial", RU: "филиал", EN: "branch" },
  monthlyPrice: { UZ: "oylik narx", RU: "цена", EN: "monthly price" },
  scheduleDays: { UZ: "dars kunlari", RU: "дни занятий", EN: "lesson days" },
  startTime: { UZ: "dars vaqti", RU: "время", EN: "lesson time" },
  maxStudents: { UZ: "sig'im", RU: "вместимость", EN: "capacity" },
  subject: { UZ: "yo'nalish", RU: "направление", EN: "subject" },
};

const METHODS: Record<string, Tpl> = {
  CASH: { UZ: "naqd", RU: "наличные", EN: "cash" },
  CLICK: { UZ: "Click", RU: "Click", EN: "Click" },
  PAYME: { UZ: "Payme", RU: "Payme", EN: "Payme" },
  BANK_TRANSFER: { UZ: "bank o'tkazmasi", RU: "банковский перевод", EN: "bank transfer" },
};

function fill(tpl: Tpl, lang: Lang, vars: Record<string, string | number> = {}) {
  return tpl[lang].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const money = (n: unknown) => new Intl.NumberFormat("uz-UZ").format(Number(n) || 0);

export function describeAudit(entry: { action: string; entityType: string; meta: string | null }, lang: Lang): string {
  let meta: Meta = {};
  if (entry.meta) {
    try {
      meta = JSON.parse(entry.meta) as Meta;
    } catch {
      return entry.meta;
    }
  }
  const s = (k: string) => (meta[k] === undefined || meta[k] === null ? "" : String(meta[k]));
  const key = `${entry.entityType}.${entry.action}`;

  switch (key) {
    case "student.create":
      return meta.fullName ? fill(T.newStudent, lang, { name: s("fullName") }) : "—";
    case "teacher.create":
      return meta.fullName ? fill(T.newTeacher, lang, { name: s("fullName") }) : "—";
    case "group.create":
      return meta.name ? fill(T.newGroup, lang, { name: s("name") }) : "—";
    case "payment.create":
      return fill(T.payment, lang, {
        amount: money(meta.amount),
        method: METHODS[s("method")]?.[lang] ?? s("method"),
        receipt: meta.receiptNumber ? fill(T.receipt, lang, { no: s("receiptNumber") }) : "",
      });
    case "invoice.create":
      return fill(T.invoice, lang, { amount: money(meta.amount), month: s("forMonth") });
    case "invoices_batch.create":
      return fill(T.invoiceBatch, lang, { count: s("count"), month: s("forMonth") });
    case "gateway_transaction.complete":
      return fill(T.gatewayPaid, lang, { provider: s("provider"), amount: money(meta.amount) });
    case "gateway_transaction.cancel":
      return fill(T.gatewayCancel, lang, { provider: s("provider") });
    case "lead.convert":
      return meta.studentCreated === false ? T.convertedLinked[lang] : T.converted[lang];
    case "lead.archive":
      return meta.reason ? fill(T.reason, lang, { reason: s("reason") }) : "—";
    case "lead.duplicate_override":
      return fill(T.duplicate, lang, { reason: s("reason") });
    case "lead.assign":
    case "lead.reassign":
      return meta.toUserId ? T.assigned[lang] : T.unassigned[lang];
    case "lead.reopen":
      return T.reopened[lang];
    case "lead.export":
      return fill(T.exported, lang, { rows: s("rows") });
    case "lead_trial.trial_reschedule":
      return T.trialMoved[lang];
  }

  if (entry.action === "update") {
    if (Object.keys(meta).length === 1 && meta.status) return fill(T.statusSet, lang, { status: s("status") });
    const fields = Object.keys(meta).map((f) => FIELD_LABELS[f]?.[lang] ?? f);
    return fields.length ? fill(T.changed, lang, { fields: fields.join(", ") }) : "—";
  }
  if (meta.reason) return fill(T.reason, lang, { reason: s("reason") });
  return "—";
}
