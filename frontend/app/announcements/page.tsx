"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import {
  announcementsApi,
  groupsApi,
  Announcement,
  AnnouncementAudience,
  AnnouncementPriority,
  Group,
  ApiError,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

export function AnnouncementsContent() {
  const { t } = useLanguage();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetAudience, setTargetAudience] = useState<AnnouncementAudience>("ALL");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("NORMAL");
  const [sendTelegram, setSendTelegram] = useState(true);

  // Filter state
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [audienceFilter, setAudienceFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  async function loadData() {
    try {
      setLoading(true);
      const [aList, gList] = await Promise.all([
        announcementsApi.list(),
        groupsApi.list(),
      ]);
      setAnnouncements(aList);
      setGroups(gList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "E'lonlarni yuklashda xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const total = announcements.length;
    const urgent = announcements.filter((a) => a.priority === "URGENT").length;
    const high = announcements.filter((a) => a.priority === "HIGH").length;
    const telegramSent = announcements.filter((a) => a.sendTelegram).length;
    return { total, urgent, high, telegramSent };
  }, [announcements]);

  const filtered = useMemo(() => {
    return announcements.filter((a) => {
      if (priorityFilter !== "ALL" && a.priority !== priorityFilter) return false;
      if (audienceFilter !== "ALL" && a.targetAudience !== audienceFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchContent = a.content.toLowerCase().includes(q);
        const matchAuthor = a.author?.fullName?.toLowerCase().includes(q);
        const matchGroup = a.targetGroup?.name?.toLowerCase().includes(q);
        if (!matchTitle && !matchContent && !matchAuthor && !matchGroup) return false;
      }
      return true;
    });
  }, [announcements, priorityFilter, audienceFilter, search]);

  const paged = usePagedSlice(filtered, page, 8);

  function openCreateModal() {
    setTitle("");
    setContent("");
    setTargetAudience("ALL");
    setTargetGroupId("");
    setPriority("NORMAL");
    setSendTelegram(true);
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("Sarlavha va e'lon matni to'ldirilishi shart");
      return;
    }
    if (targetAudience === "GROUP" && !targetGroupId) {
      setError("Iltimos, guruhni tanlang");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await announcementsApi.create({
        title: title.trim(),
        content: content.trim(),
        targetAudience,
        targetGroupId: targetAudience === "GROUP" ? targetGroupId : undefined,
        priority,
        sendTelegram,
      });
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "E'lon berishda xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("E'lonni o'chirishni tasdiqlaysizmi?")) return;
    try {
      setDeletingId(id);
      await announcementsApi.remove(id);
      await loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "O'chirishda xatolik");
    } finally {
      setDeletingId(null);
    }
  }

  const priorityBadge = (p: AnnouncementPriority) => {
    switch (p) {
      case "URGENT":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            Shoshilinch
          </span>
        );
      case "HIGH":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Muhim
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-500/10 text-slate-300 border border-slate-500/20">
            Oddiy
          </span>
        );
    }
  };

  const audienceBadge = (audience: AnnouncementAudience, groupName?: string) => {
    switch (audience) {
      case "ALL":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            👥 Barchaga
          </span>
        );
      case "STUDENTS":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            🎓 O&apos;quvchilarga
          </span>
        );
      case "TEACHERS":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
            👨‍🏫 O&apos;qituvchilarga
          </span>
        );
      case "GROUP":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
            🏫 Guruh: {groupName || "Tanlangan guruh"}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 11 18-5v12L3 14v-3z" />
                <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
              </svg>
            </span>
            E&apos;lonlar va Xabarnomalar
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            O&apos;quv markazining barcha talaba, o&apos;qituvchi va guruhlariga e&apos;lonlar berish va Telegram orqali broadcast qilish
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-lg shadow-indigo-600/25 cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Yangi E&apos;lon Berish
        </button>
      </div>

      {/* KPI Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
          <span className="text-xs text-slate-400 font-medium">Jami e&apos;lonlar</span>
          <div className="text-2xl font-bold text-slate-100 mt-1">{stats.total}</div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
          <span className="text-xs text-rose-400 font-medium">Shoshilinch (Urgent)</span>
          <div className="text-2xl font-bold text-rose-400 mt-1">{stats.urgent}</div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
          <span className="text-xs text-amber-400 font-medium">Muhim (High)</span>
          <div className="text-2xl font-bold text-amber-400 mt-1">{stats.high}</div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 backdrop-blur">
          <span className="text-xs text-sky-400 font-medium">Telegram tarqatilgan</span>
          <div className="text-2xl font-bold text-sky-400 mt-1">{stats.telegramSent}</div>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        {/* Priority Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: "ALL", label: "Barchasi" },
            { id: "URGENT", label: "🚨 Shoshilinch" },
            { id: "HIGH", label: "⚡ Muhim" },
            { id: "NORMAL", label: "ℹ️ Oddiy" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setPriorityFilter(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                priorityFilter === tab.id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Audience Select */}
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Select
              value={audienceFilter}
              onChange={(val) => {
                setAudienceFilter(val);
                setPage(1);
              }}
              options={[
                { value: "ALL", label: "Barcha auditoriya" },
                { value: "STUDENTS", label: "O'quvchilar" },
                { value: "TEACHERS", label: "O'qituvchilar" },
                { value: "GROUP", label: "Guruhlar" },
              ]}
            />
          </div>

          <div className="relative w-full md:w-64">
            <svg
              className="absolute left-3 top-2.5 text-slate-500"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Qidirish..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Announcements List */}
      {loading ? (
        <div className="py-20 text-center text-xs text-slate-400">Yuklanmoqda...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 11 18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-200">E&apos;lonlar mavjud emas</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Hozircha hech qanday e&apos;lon berilmagan. Markaz o&apos;quvchilari yoki xodimlariga yangilik yuborish uchun yangi e&apos;lon e&apos;lon qiling.
          </p>
          <button
            onClick={openCreateModal}
            className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
          >
            Yangi e&apos;lon yaratish
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {paged.map((item) => (
            <div
              key={item.id}
              className={`relative bg-slate-900/80 border rounded-2xl p-5 transition hover:border-slate-700 shadow-sm ${
                item.priority === "URGENT"
                  ? "border-rose-500/30 bg-gradient-to-r from-rose-950/10 to-slate-900/80"
                  : item.priority === "HIGH"
                  ? "border-amber-500/30 bg-gradient-to-r from-amber-950/10 to-slate-900/80"
                  : "border-slate-800"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {priorityBadge(item.priority)}
                    {audienceBadge(item.targetAudience, item.targetGroup?.name)}
                    {item.sendTelegram && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        Telegram yuborilgan
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-semibold text-slate-100 tracking-tight">
                    {item.title}
                  </h3>

                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {item.content}
                  </p>
                </div>

                <div className="flex sm:flex-col items-end justify-between sm:justify-start gap-2 shrink-0">
                  <span className="text-[11px] text-slate-500">
                    {new Date(item.publishedAt).toLocaleString("uz-UZ", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>

                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    title="O'chirish"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              {item.author && (
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-400">
                  <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-[10px]">
                    {item.author.fullName.charAt(0)}
                  </div>
                  <span>Muallif: <strong className="text-slate-300 font-medium">{item.author.fullName}</strong></span>
                </div>
              )}
            </div>
          ))}

          {filtered.length > 8 && (
            <div className="pt-4">
              <Pagination page={page} total={filtered.length} pageSize={8} onChange={setPage} />
            </div>
          )}
        </div>
      )}

      {/* Create Announcement Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yangi E'lon Berish">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Sarlavha <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Masalan: Ertaga markazda bayram tadbiri o'tkaziladi"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Auditoriya
              </label>
              <Select
                value={targetAudience}
                onChange={(val) => setTargetAudience(val as AnnouncementAudience)}
                options={[
                  { value: "ALL", label: "👥 Barchaga (Umumiy)" },
                  { value: "STUDENTS", label: "🎓 Faqat O'quvchilarga" },
                  { value: "TEACHERS", label: "👨‍🏫 Faqat O'qituvchilarga" },
                  { value: "GROUP", label: "🏫 Muayyan Guruhga" },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Muhimlik darajasi
              </label>
              <Select
                value={priority}
                onChange={(val) => setPriority(val as AnnouncementPriority)}
                options={[
                  { value: "NORMAL", label: "ℹ️ Oddiy (Normal)" },
                  { value: "HIGH", label: "⚡ Muhim (High)" },
                  { value: "URGENT", label: "🚨 Shoshilinch (Urgent)" },
                ]}
              />
            </div>
          </div>

          {targetAudience === "GROUP" && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Guruhni tanlang <span className="text-rose-400">*</span>
              </label>
              <Select
                value={targetGroupId}
                onChange={setTargetGroupId}
                options={[
                  { value: "", label: "— Guruhni tanlang —" },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: `${g.name} (${g.subject || "Fan yo'q"})`,
                  })),
                ]}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              E&apos;lon matni <span className="text-rose-400">*</span>
            </label>
            <textarea
              required
              rows={4}
              placeholder="E'lonning to'liq tafsilotlari, sanasi, vaqti va talablari..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Telegram broadcast switch */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-200 block">Telegram orqali tarqatish</span>
                <span className="text-[11px] text-slate-400">Ulangan o&apos;quvchi va ota-onalar botiga tezkor xabar yuborish</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={sendTelegram}
              onChange={(e) => setSendTelegram(e.target.checked)}
              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              {saving ? "Yuborilmoqda..." : "E'lonni Chop Qilish"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <DashboardShell>
      <AnnouncementsContent />
    </DashboardShell>
  );
}
