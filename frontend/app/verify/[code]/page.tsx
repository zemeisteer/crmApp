"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { certificatesApi, PublicCertificate } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import { centerRedirectBase, certificateVerifyUrl } from "@/lib/domain";
import ThemeToggle from "@/components/ThemeToggle";

// The public check page of a certificate (the link and QR printed on it).
// A clean card on the app's tokens, readable in both themes and on paper.
// It belongs on the issuing center's address: a link opened on the main
// site (older certificates) moves there once the center is known.
export default function VerifyCertificatePage() {
  const { t, lang } = useLanguage();
  const params = useParams();
  const code = (params?.code as string) || "";
  const [loading, setLoading] = useState(true);
  const [cert, setCert] = useState<PublicCertificate | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) return;
    certificatesApi
      .verifyPublic(code)
      .then((data) => {
        const base = data.valid && data.organizationSubdomain ? centerRedirectBase(data.organizationSubdomain) : null;
        // Still "checking" while the browser moves to the center's address.
        if (base) return window.location.replace(certificateVerifyUrl(data.code ?? code, data.organizationSubdomain));
        setCert(data);
        setLoading(false);
      })
      .catch(() => {
        setCert({ valid: false, message: t("ver.serverError") });
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per code; t only changes the error text
  }, [code]);

  async function copyLink() {
    const url = certificateVerifyUrl(cert?.code ?? code, cert?.organizationSubdomain);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("ver.copyLink"), url);
    }
  }

  return (
    <div className="verify-page min-h-screen flex flex-col items-center px-4 py-8 sm:py-14 text-fg">
      <div className="w-full max-w-2xl">
        {/* Brand row */}
        <div className="flex items-center justify-between gap-3 mb-6 print:mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-[var(--radius-sm)] bg-primary text-on-ink flex items-center justify-center shrink-0" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10 12 5 2 10l10 5 10-5Z" />
                <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold tracking-tight leading-tight">TalimCRM</div>
              <div className="text-xs text-muted truncate">{t("ver.portal")}</div>
            </div>
          </div>
          <div className="print:hidden">
            <ThemeToggle />
          </div>
        </div>

        <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight">{t("ver.title")}</h1>
        <p className="text-sm text-muted mt-1 mb-6">{t("ver.subtitle")}</p>

        {loading ? (
          <div role="status" className="verify-card bg-surface border border-line rounded-card p-10 text-center shadow-[var(--shadow-card)]">
            <div className="w-10 h-10 border-4 border-line border-t-primary rounded-full animate-spin mx-auto mb-4" aria-hidden="true" />
            <p className="font-semibold">{t("ver.checking")}</p>
            <p className="text-xs text-muted mt-1 font-mono break-all">{code}</p>
          </div>
        ) : !cert?.valid ? (
          <div role="alert" className="verify-card bg-surface border border-danger-border rounded-card p-8 sm:p-10 text-center shadow-[var(--shadow-card)]">
            <div className="w-14 h-14 bg-danger-soft text-danger rounded-full flex items-center justify-center mx-auto mb-4 border border-danger-border" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2">{t("ver.notFound")}</h2>
            <p className="text-soft text-sm max-w-md mx-auto mb-6">{cert?.message || t("ver.notFoundBody")}</p>
            <div className="inline-flex flex-wrap items-center justify-center gap-2 bg-surface-muted border border-line rounded-[var(--radius-sm)] px-3.5 py-2 text-xs">
              <span className="text-muted">{t("ver.enteredCode")}:</span>
              <span className="font-mono font-bold text-fg break-all">{code}</span>
            </div>
          </div>
        ) : (
          <article className="verify-card bg-surface border border-line rounded-card shadow-[var(--shadow-card)] overflow-hidden">
            {/* Status */}
            <div className="flex items-center gap-3 px-6 sm:px-8 py-4 bg-success-soft border-b border-success-border">
              <span className="w-10 h-10 rounded-full bg-surface text-success border border-success-border flex items-center justify-center shrink-0" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold uppercase tracking-wide text-success">{t("ver.valid")}</div>
                <div className="text-xs text-soft">
                  {t("ver.issuedBy")}: <span className="font-semibold text-fg">{cert.organizationName || t("ver.center")}</span>
                </div>
              </div>
            </div>

            {/* What it certifies */}
            <div className="px-6 sm:px-8 py-8 sm:py-10 text-center">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted">{t("ver.certifies")}</div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-3 mb-3 break-words">{cert.studentName}</h2>
              <p className="text-soft text-[15px]">{t("ver.completed")}</p>
              <div className="mt-4 mx-auto max-w-lg rounded-[var(--radius-md)] bg-surface-muted border border-line px-5 py-4">
                <div className="text-lg font-bold">{cert.title}</div>
                {cert.courseName && (
                  <div className="text-sm text-soft mt-1">
                    {t("ver.course")}: <span className="font-semibold text-fg">{cert.courseName}</span>
                    {cert.subject ? ` (${cert.subject})` : ""}
                  </div>
                )}
              </div>
              {cert.grade && (
                <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-pill)] bg-primary-soft border border-primary-border">
                  <span className="text-xs text-soft">{t("ver.grade")}</span>
                  <span className="text-sm font-extrabold text-fg">{cert.grade}</span>
                </div>
              )}
              {cert.description && <p className="mt-4 text-sm text-soft italic max-w-lg mx-auto">“{cert.description}”</p>}
            </div>

            {/* Details */}
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[var(--border)] border-t border-line">
              <div className="bg-surface px-6 py-4">
                <dt className="text-xs font-semibold text-muted">{t("ver.code")}</dt>
                <dd className="mt-1.5">
                  <span className="inline-block font-mono text-sm font-bold text-fg bg-surface-muted border border-line-strong rounded-[var(--radius-xs)] px-2 py-0.5 break-all">{cert.code}</span>
                </dd>
              </div>
              <div className="bg-surface px-6 py-4">
                <dt className="text-xs font-semibold text-muted">{t("ver.issued")}</dt>
                <dd className="mt-1.5 text-sm font-semibold text-fg">{cert.issueDate ? formatDate(cert.issueDate, lang, "long") : "—"}</dd>
              </div>
              <div className="bg-surface px-6 py-4">
                <dt className="text-xs font-semibold text-muted">{t("ver.signer")}</dt>
                <dd className="mt-1.5 text-sm font-semibold text-fg">
                  {cert.signatoryName || t("cert.signerPh")}
                  {cert.signatoryTitle && <span className="block text-xs font-normal text-soft">{cert.signatoryTitle}</span>}
                </dd>
              </div>
            </dl>

            {/* Actions */}
            <div className="flex flex-wrap justify-center gap-3 px-6 py-5 border-t border-line print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2.5 rounded-[var(--radius-sm)] bg-primary hover:bg-[var(--primary-hover)] text-on-ink font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                {t("ver.print")}
              </button>
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-live="polite"
                className="px-4 py-2.5 rounded-[var(--radius-sm)] bg-surface hover:bg-surface-muted text-fg border border-line-strong font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied ? t("ver.copied") : t("ver.copyLink")}
              </button>
            </div>
          </article>
        )}

        <div className="text-center mt-6 text-xs text-muted">{t("ver.footer")}</div>
      </div>
    </div>
  );
}
