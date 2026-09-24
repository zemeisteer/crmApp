"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { certificatesApi, PublicCertificate } from "@/lib/api";

export default function VerifyCertificatePage() {
  const params = useParams();
  const code = (params?.code as string) || "";
  const [loading, setLoading] = useState(true);
  const [cert, setCert] = useState<PublicCertificate | null>(null);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    certificatesApi
      .verifyPublic(code)
      .then((data) => setCert(data))
      .catch(() => setCert({ valid: false, message: "Server bilan bog'lanishda xatolik yuz berdi" }))
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-8">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex justify-center items-center z-0">
        <div className="w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl -top-40 -left-40 absolute" />
        <div className="w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-3xl -bottom-20 -right-20 absolute" />
      </div>

      <div className="relative z-10 w-full max-w-3xl">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-semibold text-indigo-400 mb-3">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            CRMAPP Rasmiy Tekshiruv Portali
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Elektron Sertifikatni Tekshirish
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Yagona davlat va xalqaro standartlarga mos raqamli tekshiruv tizimi
          </p>
        </div>

        {loading ? (
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-12 text-center shadow-2xl">
            <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-300 font-medium">Sertifikat ma'lumotlari tekshirilmoqda...</p>
            <p className="text-xs text-slate-500 mt-1 font-mono">{code}</p>
          </div>
        ) : !cert?.valid ? (
          <div className="bg-slate-900/80 backdrop-blur-xl border border-red-500/30 rounded-2xl p-8 sm:p-12 text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Sertifikat Topilmadi</h2>
            <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
              {cert?.message || "Ushbu kodga mos sertifikat mavjud emas yoki amal qilish muddati bekor qilingan."}
            </p>
            <div className="inline-block bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-2 text-xs font-mono text-slate-400">
              Kiritilgan kod: <span className="text-red-400 font-bold">{code}</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/90 backdrop-blur-xl border-2 border-amber-500/30 rounded-3xl p-6 sm:p-12 shadow-2xl relative overflow-hidden">
            {/* Watermark and decorative corner borders */}
            <div className="absolute -right-12 -top-12 w-48 h-48 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-24 h-24 border-t-2 border-r-2 border-amber-400/40 rounded-tr-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-24 h-24 border-b-2 border-l-2 border-amber-400/40 rounded-bl-3xl pointer-events-none" />

            {/* Verified badge */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Haqiqiy va Tasdiqlangan
                    </span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full">
                      VERIFIED
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-white">
                    {cert.organizationName || "Ta'lim Markazi"}
                  </h2>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-xs text-slate-400 block">Sertifikat kodi:</span>
                <span className="text-sm font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md inline-block mt-0.5">
                  {cert.code}
                </span>
              </div>
            </div>

            {/* Certificate Core Information */}
            <div className="py-8 sm:py-10 text-center">
              <span className="text-xs uppercase tracking-widest text-slate-400 font-medium">
                Ushbu sertifikat tasdiqlaydi:
              </span>
              <h3 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-white to-amber-100 mt-2 mb-4 tracking-tight">
                {cert.studentName}
              </h3>

              <div className="max-w-xl mx-auto">
                <p className="text-slate-300 text-base leading-relaxed">
                  quyidagi o'quv dasturini muvaffaqiyatli tamomlaganligi uchun taqdim etiladi:
                </p>
                <div className="mt-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="text-lg font-bold text-white">{cert.title}</div>
                  {cert.courseName && (
                    <div className="text-xs text-indigo-400 mt-1 font-medium">
                      Guruh / Kurs: {cert.courseName} {cert.subject ? `(${cert.subject})` : ""}
                    </div>
                  )}
                </div>
              </div>

              {cert.grade && (
                <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30">
                  <span className="text-xs text-slate-300">O'zlashtirish bahosi:</span>
                  <span className="text-sm font-extrabold text-indigo-300">{cert.grade}</span>
                </div>
              )}

              {cert.description && (
                <p className="mt-4 text-xs text-slate-400 italic max-w-lg mx-auto">
                  "{cert.description}"
                </p>
              )}
            </div>

            {/* Certificate Footer / Signatories */}
            <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400">
              <div className="text-center sm:text-left">
                <span className="text-slate-500 block">Berilgan sana:</span>
                <span className="font-medium text-slate-200">
                  {cert.issueDate
                    ? new Date(cert.issueDate).toLocaleDateString("uz-UZ", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "—"}
                </span>
              </div>

              <div className="text-center sm:text-right">
                <span className="text-slate-500 block">Tasdiqlovchi shaxs:</span>
                <span className="font-semibold text-slate-200">
                  {cert.signatoryName || "O'quv bo'limi"}
                </span>
                {cert.signatoryTitle && (
                  <span className="text-slate-400 block text-[11px]">{cert.signatoryTitle}</span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-8 pt-6 border-t border-slate-800/60 flex flex-wrap justify-center gap-3 print:hidden">
              <button
                onClick={() => window.print()}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs inline-flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Sertifikatni Chop Etish (Print)
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  alert("Havola nusxalandi!");
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs inline-flex items-center gap-2 border border-slate-700 transition-all cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Havolani Nusxalash
              </button>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-slate-500">
          CRMAPP Digital Credentials Engine • Barcha huquqlar himoyalangan
        </div>
      </div>
    </div>
  );
}
