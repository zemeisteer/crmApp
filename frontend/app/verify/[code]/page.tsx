"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { certificatesApi, PublicCertificate } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";

export default function VerifyCertificatePage() {
  const { t, lang } = useLanguage();
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
      .catch(() => setCert({ valid: false, message: t("ver.serverError") }))
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="min-h-screen bg-ink text-slate-100 flex flex-col justify-center items-center p-4 sm:p-8">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex justify-center items-center z-0">
        <div className="w-[600px] h-[600px] bg-primary/10 rounded-full blur-3xl -top-40 -left-40 absolute" />
        <div className="w-[500px] h-[500px] bg-warning/10 rounded-full blur-3xl -bottom-20 -right-20 absolute" />
      </div>

      <div className="relative z-10 w-full max-w-3xl">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ink border border-ink text-xs font-semibold text-primary mb-3">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {t("ver.portal")}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {t("ver.title")}
          </h1>
          <p className="text-sm text-faint mt-1">
            {t("ver.subtitle")}
          </p>
        </div>

        {loading ? (
          <div className="bg-ink/80 backdrop-blur-xl border border-ink/80 rounded-2xl p-12 text-center shadow-2xl">
            <div className="w-12 h-12 border-4 border-primary/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-300 font-medium">{t("ver.checking")}</p>
            <p className="text-xs text-muted mt-1 font-mono">{code}</p>
          </div>
        ) : !cert?.valid ? (
          <div className="bg-ink/80 backdrop-blur-xl border border-danger/30 rounded-2xl p-8 sm:p-12 text-center shadow-2xl">
            <div className="w-16 h-16 bg-danger/10 text-danger rounded-full flex items-center justify-center mx-auto mb-4 border border-danger/20">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">{t("ver.notFound")}</h2>
            <p className="text-faint text-sm max-w-md mx-auto mb-6">
              {cert?.message || t("ver.notFoundBody")}
            </p>
            <div className="inline-block bg-ink/60 border border-ink rounded-lg px-4 py-2 text-xs font-mono text-faint">
              Kiritilgan kod: <span className="text-danger font-bold">{code}</span>
            </div>
          </div>
        ) : (
          <div className="bg-ink/90 backdrop-blur-xl border-2 border-warning/30 rounded-3xl p-6 sm:p-12 shadow-2xl relative overflow-hidden">
            {/* Watermark and decorative corner borders */}
            <div className="absolute -right-12 -top-12 w-48 h-48 bg-warning/5 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-24 h-24 border-t-2 border-r-2 border-warning/40 rounded-tr-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-24 h-24 border-b-2 border-l-2 border-warning/40 rounded-bl-3xl pointer-events-none" />

            {/* Verified badge */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-ink">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-success/10 border border-success/30 text-success flex items-center justify-center shrink-0">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-success">
                      {t("ver.valid")}
                    </span>
                    <span className="text-[10px] bg-success/20 text-success font-semibold px-2 py-0.5 rounded-full">
                      VERIFIED
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-white">
                    {cert.organizationName || t("ver.center")}
                  </h2>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-xs text-faint block">{t("ver.code")}</span>
                <span className="text-sm font-mono font-bold text-warning bg-warning/10 border border-warning/20 px-2.5 py-1 rounded-md inline-block mt-0.5">
                  {cert.code}
                </span>
              </div>
            </div>

            {/* Certificate Core Information */}
            <div className="py-8 sm:py-10 text-center">
              <span className="text-xs uppercase tracking-widest text-faint font-medium">
                {t("ver.certifies")}
              </span>
              <h3 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-warning-border via-surface to-warning-soft mt-2 mb-4 tracking-tight">
                {cert.studentName}
              </h3>

              <div className="max-w-xl mx-auto">
                <p className="text-slate-300 text-base leading-relaxed">
                  {t("ver.completed")}
                </p>
                <div className="mt-3 p-4 rounded-xl bg-ink/60 border border-ink">
                  <div className="text-lg font-bold text-white">{cert.title}</div>
                  {cert.courseName && (
                    <div className="text-xs text-primary mt-1 font-medium">
                      {t("ver.course")}: {cert.courseName} {cert.subject ? `(${cert.subject})` : ""}
                    </div>
                  )}
                </div>
              </div>

              {cert.grade && (
                <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30">
                  <span className="text-xs text-slate-300">{t("ver.grade")}</span>
                  <span className="text-sm font-extrabold text-primary">{cert.grade}</span>
                </div>
              )}

              {cert.description && (
                <p className="mt-4 text-xs text-faint italic max-w-lg mx-auto">
                  "{cert.description}"
                </p>
              )}
            </div>

            {/* Certificate Footer / Signatories */}
            <div className="pt-6 border-t border-ink flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-faint">
              <div className="text-center sm:text-left">
                <span className="text-muted block">{t("ver.issued")}</span>
                <span className="font-medium text-slate-200">
                  {cert.issueDate
                    ? formatDate(cert.issueDate, lang, "long")
                    : "—"}
                </span>
              </div>

              <div className="text-center sm:text-right">
                <span className="text-muted block">{t("ver.signer")}</span>
                <span className="font-semibold text-slate-200">
                  {cert.signatoryName || t("cert.signerPh")}
                </span>
                {cert.signatoryTitle && (
                  <span className="text-faint block text-[11px]">{cert.signatoryTitle}</span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-8 pt-6 border-t border-ink/60 flex flex-wrap justify-center gap-3 print:hidden">
              <button
                onClick={() => window.print()}
                className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary text-white font-medium text-xs inline-flex items-center gap-2 shadow-lg shadow-primary/20 transition-all cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                {t("ver.print")}
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  alert(t("msg.linkCopied"));
                }}
                className="px-4 py-2.5 rounded-xl bg-ink hover:bg-slate-700 text-slate-200 font-medium text-xs inline-flex items-center gap-2 border border-line-strong transition-all cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t("ver.copyLink")}
              </button>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-muted">
          {t("ver.footer")}
        </div>
      </div>
    </div>
  );
}
