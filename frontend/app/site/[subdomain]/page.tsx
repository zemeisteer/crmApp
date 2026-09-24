"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { tenantsApi, PublicShowcaseData, ApiError } from "@/lib/api";

function formatMoney(amount: number) {
  return new Intl.NumberFormat("uz-UZ").format(amount);
}

export default function PublicSitePage() {
  const params = useParams<{ subdomain: string }>();
  const [data, setData] = useState<PublicShowcaseData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filter state for courses
  const [selectedSubject, setSelectedSubject] = useState<string>("ALL");

  // Application form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [parentPhone, setParentPhone] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const applyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!params.subdomain) return;
    tenantsApi
      .getPublicShowcase(params.subdomain)
      .then((res) => {
        setData(res);
        if (res.subjects.length > 0) {
          setSelectedCourse(res.subjects[0].subject);
        }
        if (res.branches.length > 0) {
          setSelectedBranch(res.branches[0].id);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [params.subdomain]);

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    if (selectedSubject === "ALL") return data.groups;
    return data.groups.filter((g) => g.subject === selectedSubject);
  }, [data, selectedSubject]);

  function scrollToApply(subject?: string) {
    if (subject) setSelectedCourse(subject);
    applyRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    if (!fullName.trim() || phone.trim().length < 9) {
      setSubmitError("Iltimos, to'liq ismingiz va to'g'ri telefon raqamingizni kiriting");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await tenantsApi.publicApply(params.subdomain, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        parentPhone: parentPhone.trim() || undefined,
        subject: selectedCourse || undefined,
        branchId: selectedBranch || undefined,
        notes: notes.trim() || undefined,
      });

      setSubmitSuccess(true);
      setFullName("");
      setPhone("+998 ");
      setParentPhone("");
      setNotes("");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Ariza topshirishda xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium tracking-wide">Markaz sahifasi yuklanmoqda...</span>
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 flex-col gap-4 p-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 text-2xl font-bold">
          404
        </div>
        <h2 className="text-xl font-bold">O&apos;quv markazi topilmadi</h2>
        <p className="text-xs text-slate-400 max-w-sm">
          Ko&apos;rsatilgan manzil mavjud emas yoki noto&apos;g&apos;ri kiritilgan. Iltimos, havola to&apos;g&apos;riligini tekshiring.
        </p>
        <Link
          href="/"
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
        >
          Bosh sahifaga qaytish
        </Link>
      </div>
    );
  }

  const { tenant, stats, subjects, teachers, branches, announcements } = data;
  const accent = tenant.accentColor || "#4F46E5";

  const categoryBadgeLabel = {
    TIL_MARKAZI: "Xorijiy Tillar Markazi",
    MATEMATIKA: "Aniq Fanlar & Matematika",
    IT: "Zamonaviy IT & Dasturlash Akademiyasi",
    BOSHQA: "O'quv Markazi",
  }[tenant.category] || "O'quv Markazi";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* 1. STICKY HEADER */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              <img
                src={`/uploads/${tenant.logoUrl}`}
                alt={tenant.name}
                className="w-9 h-9 rounded-xl object-cover border border-slate-800"
              />
            ) : (
              <div
                style={{ backgroundColor: accent }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-sm shadow-md"
              >
                {tenant.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="font-extrabold text-base tracking-tight text-slate-100">
              {tenant.name}
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-300">
            <a href="#kurslar" className="hover:text-white transition">Kurslar</a>
            {teachers.length > 0 && <a href="#ustozlar" className="hover:text-white transition">Ustozlar</a>}
            {branches.length > 0 && <a href="#filiallar" className="hover:text-white transition">Filiallar</a>}
            {announcements.length > 0 && <a href="#yangiliklar" className="hover:text-white transition">E&apos;lonlar</a>}
            <a href="#ariza" className="hover:text-white transition">Ariza Topshirish</a>
          </nav>

          <div className="flex items-center gap-3">
            {tenant.phone && (
              <a
                href={`tel:${tenant.phone}`}
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {tenant.phone}
              </a>
            )}

            <Link
              href="/login"
              className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-700 hover:border-slate-500 text-slate-200 transition"
            >
              Kirish
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative overflow-hidden pt-16 pb-24 border-b border-slate-900 bg-gradient-to-b from-slate-900/40 via-slate-950 to-slate-950">
        <div className="max-w-4xl mx-auto px-4 text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            {categoryBadgeLabel}
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            {tenant.name} bilan maqsadlaringizga tezroq erishing!
          </h1>

          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Zamonaviy o&apos;qitish metodikasi, tajribali ustozlar va qulay dars jadvallari bilan bilimlaringizni eng yuqori darajaga ko&apos;taring.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => scrollToApply()}
              style={{ backgroundColor: accent }}
              className="px-6 py-3.5 rounded-xl text-white text-xs font-bold transition shadow-lg hover:opacity-95 cursor-pointer"
            >
              Bepul Sinov Darsiga Yozilish →
            </button>

            <a
              href="#kurslar"
              className="px-6 py-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-bold transition"
            >
              Kurslar bilan tanishish
            </a>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-3 pt-10 max-w-xl mx-auto">
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="text-2xl font-extrabold text-white">{stats.coursesCount || 10}+</div>
              <div className="text-xs text-slate-400 mt-0.5">O&apos;quv guruhlari</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="text-2xl font-extrabold text-white">{stats.teachersCount || 5}+</div>
              <div className="text-xs text-slate-400 mt-0.5">Malakali ustozlar</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
              <div className="text-2xl font-extrabold text-white">{stats.branchesCount || 1}</div>
              <div className="text-xs text-slate-400 mt-0.5">Shinam filial</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. COURSES & PROGRAMS SECTION */}
      <section id="kurslar" className="py-20 max-w-6xl mx-auto px-4">
        <div className="text-center space-y-2 mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Mavjud O&apos;quv Dasturlari
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
            Barcha yoshdagi o&apos;quvchilar va mutaxassislar uchun mo&apos;ljallangan maxsus bosqichli kurslar
          </p>

          {/* Subject Filter Tabs */}
          {subjects.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setSelectedSubject("ALL")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  selectedSubject === "ALL"
                    ? "bg-white text-slate-950 font-bold"
                    : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Barchasi ({data.groups.length})
              </button>
              {subjects.map((s) => (
                <button
                  key={s.subject}
                  onClick={() => setSelectedSubject(s.subject)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    selectedSubject === s.subject
                      ? "bg-white text-slate-950 font-bold"
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {s.subject} ({s.groupCount})
                </button>
              ))}
            </div>
          )}
        </div>

        {filteredGroups.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
            Hozircha ushbu yo&apos;nalishda kurslar mavjud emas.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredGroups.map((g) => (
              <div
                key={g.id}
                className="rounded-2xl p-6 bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 transition flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {g.subject}
                    </span>
                    {g.level && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-slate-300">
                        {g.level}
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-white tracking-tight">{g.name}</h3>

                  <div className="space-y-1 text-xs text-slate-400 pt-1">
                    {g.scheduleDays && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">📅 Kunlar:</span>
                        <span className="text-slate-300 font-medium">{g.scheduleDays}</span>
                      </div>
                    )}
                    {g.startTime && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">⏰ Vaqt:</span>
                        <span className="text-slate-300 font-medium">{g.startTime}</span>
                      </div>
                    )}
                    {g.teacherName && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">👨‍🏫 Ustoz:</span>
                        <span className="text-slate-300 font-medium">{g.teacherName}</span>
                      </div>
                    )}
                    {g.branchName && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">📍 Filial:</span>
                        <span className="text-slate-300 font-medium">{g.branchName}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Oylik to&apos;lov</span>
                    <span className="text-sm font-extrabold text-white">
                      {g.monthlyPrice > 0 ? `${formatMoney(g.monthlyPrice)} so'm` : "Kelishuv asosida"}
                    </span>
                  </div>

                  <button
                    onClick={() => scrollToApply(g.subject)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-200 text-slate-950 transition cursor-pointer"
                  >
                    Yozilish →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. TEACHERS SECTION */}
      {teachers.length > 0 && (
        <section id="ustozlar" className="py-20 border-t border-slate-900 bg-slate-900/30">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center space-y-2 mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Tajribali Ustozlarimiz
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                O&apos;z sohasining chuqur mutaxassislari, o&apos;quvchilarni oliy natijalarga yetaklovchi murabbiylar
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {teachers.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl p-5 bg-slate-900/60 border border-slate-800/80 text-center space-y-3"
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-600 to-sky-500 text-white font-extrabold text-xl flex items-center justify-center mx-auto shadow-md">
                    {t.fullName.slice(0, 1).toUpperCase()}
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-white">{t.fullName}</h4>
                    <span className="text-xs text-indigo-400 font-medium block mt-0.5">
                      {t.subject || "Ustoz"}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                    Oliy toifali pedagog
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 5. BRANCHES SECTION */}
      {branches.length > 0 && (
        <section id="filiallar" className="py-20 max-w-6xl mx-auto px-4">
          <div className="text-center space-y-2 mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Bizning Filiallarimiz
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
              Shahar bo&apos;ylab qulay lokatsiyalar va zamonaviy o&apos;quv xonalari
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {branches.map((b) => (
              <div
                key={b.id}
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">{b.name}</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {b.address || "Manzil ko'rsatilmagan"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. ANNOUNCEMENTS SECTION */}
      {announcements.length > 0 && (
        <section id="yangiliklar" className="py-20 border-t border-slate-900 bg-slate-900/20">
          <div className="max-w-4xl mx-auto px-4 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Markaz Yangiliklari
              </h2>
              <p className="text-xs text-slate-400">
                Eng so&apos;nggi e&apos;lonlar va tadbirlar haqida xabardor bo&apos;ling
              </p>
            </div>

            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a.id} className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-white">{a.title}</h4>
                    <span className="text-[11px] text-slate-500">
                      {new Date(a.publishedAt).toLocaleDateString("uz-UZ", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{a.content}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 7. ONLINE APPLICATION LEAD INTAKE FORM */}
      <section ref={applyRef} id="ariza" className="py-24 max-w-2xl mx-auto px-4">
        <div className="p-8 sm:p-10 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-900/90 border border-slate-800 shadow-2xl relative">
          <div className="text-center space-y-2 mb-8">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              🎁 Bepul Sinov Darsi
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Sinov Darsiga Yoziling
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Arizangizni qoldiring, administratorimiz 15 daqiqa ichida siz bilan bog&apos;lanadi.
            </p>
          </div>

          {submitSuccess ? (
            <div className="p-8 text-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center mx-auto text-2xl font-bold">
                ✓
              </div>
              <h3 className="text-base font-bold text-emerald-400">Arizangiz qabul qilindi!</h3>
              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                Tez orada markazimiz ma&apos;muriyati ko&apos;rsatilgan telefon raqami orqali siz bilan bog&apos;lanadi va dars vaqtini rejalashtiradi.
              </p>
              <button
                onClick={() => setSubmitSuccess(false)}
                className="mt-3 px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 cursor-pointer"
              >
                Yana ariza qoldirish
              </button>
            </div>
          ) : (
            <form onSubmit={handleApply} className="space-y-4">
              {submitError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  To&apos;liq Ism-sharifingiz <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Sardor Rustamov"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Telefon Raqamingiz <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+998 90 123 45 67"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Ota-ona telefoni (ixtiyoriy)
                  </label>
                  <input
                    type="tel"
                    placeholder="+998 90 987 65 43"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Qiziqtirgan kurs yoki fan
                  </label>
                  <select
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {subjects.length === 0 ? (
                      <option value="Umumiy">Umumiy ta&apos;lim</option>
                    ) : (
                      subjects.map((s) => (
                        <option key={s.subject} value={s.subject}>
                          {s.subject}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Qulay filial
                  </label>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {branches.length === 0 ? (
                      <option value="">Bosh bino</option>
                    ) : (
                      branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Qo&apos;shimcha izoh yoki qulay dars vaqtlari
                </label>
                <textarea
                  rows={3}
                  placeholder="Masalan: Tushdan keyingi vaqtlar yoki dam olish kunlari darslari ma'qul..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{ backgroundColor: accent }}
                className="w-full py-3.5 rounded-xl text-white text-xs font-bold transition hover:opacity-95 shadow-lg disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "Yuborilmoqda..." : "Arizani Yuborish (Bepul) →"}
              </button>

              <p className="text-[11px] text-slate-500 text-center pt-1">
                🔒 Shaxsiy ma&apos;lumotlaringiz xavfsizligi kafolatlanadi.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="border-t border-slate-900 bg-slate-950/60 py-12 text-slate-500 text-xs">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div>
            <span className="font-bold text-slate-300 block">{tenant.name}</span>
            <span className="text-[11px] mt-0.5 block">{tenant.address || "O'zbekiston"}</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            {tenant.telegramUsername && (
              <a
                href={`https://t.me/${tenant.telegramUsername.replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-indigo-400 transition"
              >
                Telegram: @{tenant.telegramUsername.replace(/^@/, "")}
              </a>
            )}
            {tenant.phone && (
              <a href={`tel:${tenant.phone}`} className="hover:text-white transition">
                {tenant.phone}
              </a>
            )}
          </div>

          <div className="text-[11px]">
            © {new Date().getFullYear()} {tenant.name}. CRMAPP platformasida yaratilgan.
          </div>
        </div>
      </footer>
    </div>
  );
}
