"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  onboardingApi,
  subjectsApi,
  invitationsApi,
  Role,
  ApiError,
} from "@/lib/api";

const ACCENT = "#4F46E5";

const TEACHING_CATEGORIES = [
  { id: "languages", label: "Languages", desc: "English, Russian, German, Korean, Arabic, etc.", icon: "🌐" },
  { id: "mathematics", label: "Mathematics", desc: "General Math, Algebra, Geometry, Mental Math", icon: "📐" },
  { id: "it", label: "IT & Programming", desc: "Web Development, Python, Robotics, Design", icon: "💻" },
  { id: "science", label: "Science", desc: "Physics, Chemistry, Biology", icon: "🔬" },
  { id: "school", label: "School Subjects", desc: "History, Mother Tongue, Literature", icon: "📚" },
  { id: "test_prep", label: "Test Preparation", desc: "IELTS, SAT, CEFR, DTM", icon: "🎯" },
  { id: "other", label: "Other", desc: "Arts, Music, Chess, Professional Skills", icon: "✨" },
];

const DEFAULT_CATEGORY_SUBJECTS: Record<string, string[]> = {
  languages: ["Ingliz tili (English)", "Rus tili", "Koreys tili", "Nemis tili", "Arab tili"],
  mathematics: ["Matematika", "Algebra", "Mental Arifmetika"],
  it: ["Frontend Development", "Python Dasturlash", "Grafik Dizayn"],
  science: ["Fizika", "Kimyo", "Biologiya"],
  school: ["Ona tili va adabiyot", "Tarix"],
  test_prep: ["IELTS", "SAT", "CEFR B2/C1", "DTM Davlat Testi"],
  other: ["Shaxmat", "Notiqlik san'ati"],
};

const SUGGESTED_COURSES: Record<string, string[]> = {
  "Ingliz tili (English)": ["General English", "Beginner (A1)", "Elementary (A2)", "Pre-Intermediate (B1)", "Speaking Club"],
  "IELTS": ["IELTS Foundation (5.0 - 6.0)", "IELTS Graduation (6.5 - 7.5)", "IELTS Intensive", "Mock Exam Program"],
  "Matematika": ["Asosiy Matematika", "Maktab kursi (5-11 sinf)", "Olimpiada matematikasi"],
  "SAT": ["SAT Math", "SAT Digital Prep", "SAT Verbal"],
  "Frontend Development": ["HTML, CSS & JavaScript", "React & Next.js", "Fullstack Web"],
  "Python Dasturlash": ["Python asoslari", "Telegram bot yaratish", "Django Web"],
};

const STEPS = [
  { id: "PROFILE", label: "Center Profile" },
  { id: "CATEGORIES", label: "What You Teach" },
  { id: "SUBJECTS", label: "Subjects" },
  { id: "COURSES", label: "Courses" },
  { id: "WORKSPACE", label: "Workspace URL" },
  { id: "BRANCH", label: "First Branch" },
  { id: "TEAM", label: "Team" },
  { id: "STUDENTS", label: "Students" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, refreshMe } = useAuth();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant state
  const [tenantName, setTenantName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("UZ");
  const [timezone, setTimezone] = useState("Asia/Tashkent");
  const [currency, setCurrency] = useState("UZS");

  // Step 2: Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["languages", "mathematics"]);

  // Step 3: Subjects
  const [subjectsList, setSubjectsList] = useState<string[]>(["Ingliz tili (English)", "Matematika"]);
  const [newSubjectInput, setNewSubjectInput] = useState("");

  // Step 4: Courses
  const [coursesMap, setCoursesMap] = useState<Record<string, string[]>>({
    "Ingliz tili (English)": ["General English", "IELTS Foundation"],
    "Matematika": ["Asosiy Matematika"],
  });
  const [newCourseInputs, setNewCourseInputs] = useState<Record<string, string>>({});

  // Step 5: Workspace URL
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugMessage, setSlugMessage] = useState<string | null>(null);

  // Step 6: Branch
  const [branchName, setBranchName] = useState("Asosiy filial");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchPhone, setBranchPhone] = useState("");

  // Step 7: Team
  const [invitedTeam, setInvitedTeam] = useState<{ role: Role; target: string }[]>([]);
  const [teamRole, setTeamRole] = useState<Role>("TEACHER");
  const [teamInput, setTeamInput] = useState("");

  // Step 8: Students
  const [studentMode, setStudentMode] = useState<"MANUAL" | "EXCEL" | "LATER">("LATER");
  const [manualStudentName, setManualStudentName] = useState("");
  const [manualStudentPhone, setManualStudentPhone] = useState("");
  const [manualStudentsList, setManualStudentsList] = useState<{ name: string; phone: string }[]>([]);

  // Completion
  const [isCompleted, setIsCompleted] = useState(false);
  const [finalWorkspaceUrl, setFinalWorkspaceUrl] = useState("");

  useEffect(() => {
    async function loadState() {
      try {
        const state = await onboardingApi.getState();
        const t = state.tenant;
        setTenantName(t.name || "");
        setPhone(t.phone || "");
        setCountry(t.country || "UZ");
        setTimezone(t.timezone || "Asia/Tashkent");
        setCurrency(t.currency || "UZS");
        setWorkspaceSlug(t.subdomain || "");

        if (t.teachingCategories && t.teachingCategories.length > 0) {
          setSelectedCategories(t.teachingCategories);
        }

        // Determine step index based on backend state
        const stepName = t.onboardingStep || "PROFILE";
        if (stepName === "COMPLETED") {
          setIsCompleted(true);
          setFinalWorkspaceUrl(`${t.subdomain}.crmapp.com`);
        } else {
          const idx = STEPS.findIndex((s) => s.id === stepName);
          if (idx >= 0) setCurrentStepIndex(idx);
        }
      } catch (err) {
        // If not authenticated or error, redirect to login
        router.push("/login");
      } finally {
        setInitialLoading(false);
      }
    }
    loadState();
  }, [router]);

  // Check workspace slug availability
  useEffect(() => {
    if (!workspaceSlug || workspaceSlug.length < 3) {
      setSlugAvailable(null);
      setSlugMessage(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSlugChecking(true);
      try {
        const res = await onboardingApi.checkSubdomain(workspaceSlug);
        setSlugAvailable(res.available);
        setSlugMessage(res.available ? "Ushbu nom bo'sh va mavjud!" : (res.reason || "Ushbu nom band"));
      } catch {
        setSlugAvailable(false);
        setSlugMessage("Tekshirishda xatolik yuz berdi");
      } finally {
        setSlugChecking(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [workspaceSlug]);

  function toggleCategory(catId: string) {
    if (selectedCategories.includes(catId)) {
      if (selectedCategories.length === 1) return; // keep at least 1
      setSelectedCategories(selectedCategories.filter((c) => c !== catId));
    } else {
      setSelectedCategories([...selectedCategories, catId]);
    }
  }

  function addSubject(name: string) {
    const trimmed = name.trim();
    if (!trimmed || subjectsList.includes(trimmed)) return;
    setSubjectsList([...subjectsList, trimmed]);
    setNewSubjectInput("");
    if (!coursesMap[trimmed]) {
      setCoursesMap({ ...coursesMap, [trimmed]: [] });
    }
  }

  function removeSubject(name: string) {
    if (subjectsList.length === 1) return;
    setSubjectsList(subjectsList.filter((s) => s !== name));
    const nextMap = { ...coursesMap };
    delete nextMap[name];
    setCoursesMap(nextMap);
  }

  function addCourseToSubject(subject: string, courseName: string) {
    const trimmed = courseName.trim();
    if (!trimmed) return;
    const existing = coursesMap[subject] || [];
    if (existing.includes(trimmed)) return;
    setCoursesMap({
      ...coursesMap,
      [subject]: [...existing, trimmed],
    });
    setNewCourseInputs({ ...newCourseInputs, [subject]: "" });
  }

  function removeCourseFromSubject(subject: string, courseName: string) {
    const existing = coursesMap[subject] || [];
    setCoursesMap({
      ...coursesMap,
      [subject]: existing.filter((c) => c !== courseName),
    });
  }

  async function handleStep1Profile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.updateProfile({
        name: tenantName,
        phone,
        country,
        timezone,
        currency,
      });
      setCurrentStepIndex(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep2Categories() {
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.updateCategories(selectedCategories);
      // Auto-populate subjects from chosen categories if empty
      const suggestions: string[] = [];
      selectedCategories.forEach((cat) => {
        const list = DEFAULT_CATEGORY_SUBJECTS[cat] || [];
        list.forEach((item) => {
          if (!suggestions.includes(item)) suggestions.push(item);
        });
      });
      if (subjectsList.length === 0 && suggestions.length > 0) {
        setSubjectsList(suggestions.slice(0, 3));
      }
      setCurrentStepIndex(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep3Subjects() {
    if (subjectsList.length === 0) {
      setError("Kamida bitta fan qo'shishingiz lozim.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.advance("COURSES");
      setCurrentStepIndex(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep4Courses() {
    setError(null);
    setSubmitting(true);
    try {
      // Bulk create real domain subjects and courses in backend
      const bulkPayload = subjectsList.map((subj) => ({
        name: subj,
        courses: coursesMap[subj] || [],
      }));
      await subjectsApi.bulk(bulkPayload);
      await onboardingApi.advance("WORKSPACE");
      setCurrentStepIndex(4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep5Workspace(e: React.FormEvent) {
    e.preventDefault();
    if (!slugAvailable) {
      setError("Iltimos, mavjud va yaroqli Workspace URL tanlang.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.updateWorkspace(workspaceSlug);
      setCurrentStepIndex(5);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep6Branch(skip: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      if (skip) {
        await onboardingApi.skip("BRANCH");
      } else {
        await onboardingApi.addBranch({
          name: branchName,
          address: branchAddress,
          phone: branchPhone,
        });
      }
      setCurrentStepIndex(6);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInviteMember() {
    const trimmed = teamInput.trim();
    if (!trimmed) return;
    setError(null);
    setSubmitting(true);
    try {
      const isEmail = trimmed.includes("@");
      await invitationsApi.create({
        role: teamRole,
        email: isEmail ? trimmed : undefined,
        phone: !isEmail ? trimmed : undefined,
      });
      setInvitedTeam([...invitedTeam, { role: teamRole, target: trimmed }]);
      setTeamInput("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Taklifnoma yuborishda xatolik");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep7Team(skip: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      if (skip) {
        await onboardingApi.skip("TEAM");
      } else {
        await onboardingApi.advance("STUDENTS");
      }
      setCurrentStepIndex(7);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStep8Students() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await onboardingApi.complete();
      setIsCompleted(true);
      setFinalWorkspaceUrl(res.workspaceUrl);
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSubmitting(false);
    }
  }

  if (initialLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={ACCENT} strokeWidth="4" strokeDasharray="30 60" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#6B7280" }}>
            Workspace ma&apos;lumotlari yuklanmoqda...
          </div>
        </div>
      </div>
    );
  }

  // Final Completion Screen
  if (isCompleted) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", padding: 24 }}>
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            background: "#FFFFFF",
            borderRadius: 24,
            padding: "48px 36px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "#ECFDF5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
            }}
          >
            🎉
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: "#111827", letterSpacing: "-0.03em" }}>
              Your center is ready
            </h1>
            <p style={{ fontSize: 15, color: "#6B7280", maxWidth: 400, lineHeight: 1.5 }}>
              Tabriklaymiz! O&apos;quv markazingiz to&apos;liq sozlandi va faoliyatini boshlashga tayyor.
            </p>
          </div>

          <div
            style={{
              width: "100%",
              background: "#F8FAFC",
              border: "1.5px solid #E2E8F0",
              borderRadius: 14,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Workspace URL
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: ACCENT }}>
                {finalWorkspaceUrl || `${workspaceSlug}.crmapp.com`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`https://${finalWorkspaceUrl || `${workspaceSlug}.crmapp.com`}`);
                alert("URL nusxalandi!");
              }}
              style={{
                background: "#EEF2FF",
                border: "none",
                color: ACCENT,
                fontSize: 12.5,
                fontWeight: 700,
                padding: "8px 14px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Nusxa olish
            </button>
          </div>

          <button
            id="open-dashboard-btn"
            type="button"
            onClick={() => router.push("/dashboard")}
            style={{
              width: "100%",
              height: 50,
              background: ACCENT,
              color: "#FFFFFF",
              fontSize: 15.5,
              fontWeight: 700,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(79, 70, 229, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
            <span>Open dashboard</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F7F7F5", display: "flex", flexDirection: "column" }}>
      {/* Top Bar with Center Name & Step indicator */}
      <header
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #EAE8E2",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 15,
            }}
          >
            C
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>
            CRMAPP Onboarding
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#4B5563" }}>
            Step {currentStepIndex + 1} of {STEPS.length}:
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>
            {STEPS[currentStepIndex].label}
          </span>
        </div>
      </header>

      {/* Stepper Progress Bar */}
      <div style={{ width: "100%", height: 4, background: "#E5E7EB" }}>
        <div
          style={{
            height: "100%",
            width: `${((currentStepIndex + 1) / STEPS.length) * 100}%`,
            background: ACCENT,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          maxWidth: 720,
          width: "100%",
          margin: "32px auto",
          padding: "0 24px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Step Card Container */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "36px 32px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {error && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FEE2E2",
                color: "#B91C1C",
                fontSize: 13.5,
                fontWeight: 600,
                padding: "12px 16px",
                borderRadius: 12,
              }}
            >
              {error}
            </div>
          )}

          {/* STEP 1: Center profile */}
          {currentStepIndex === 0 && (
            <form onSubmit={handleStep1Profile} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 1
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Welcome to CRMAPP
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Let&apos;s set up your learning center profile and defaults.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                    Center name
                  </label>
                  <input
                    required
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="Bilimdon Learning Center"
                    style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                    Phone number
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+998 90 123 45 67"
                    style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                      Country
                    </label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      style={{ width: "100%", height: 44, padding: "0 10px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14 }}
                    >
                      <option value="UZ">Uzbekistan</option>
                      <option value="KZ">Kazakhstan</option>
                      <option value="KG">Kyrgyzstan</option>
                      <option value="TJ">Tajikistan</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                      Timezone
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      style={{ width: "100%", height: 44, padding: "0 10px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14 }}
                    >
                      <option value="Asia/Tashkent">Tashkent (UTC+5)</option>
                      <option value="Asia/Samarkand">Samarkand (UTC+5)</option>
                      <option value="Asia/Almaty">Almaty (UTC+5)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                      Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      style={{ width: "100%", height: 44, padding: "0 10px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14 }}
                    >
                      <option value="UZS">UZS (so&apos;m)</option>
                      <option value="USD">USD ($)</option>
                      <option value="RUB">RUB (₽)</option>
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  height: 48,
                  background: ACCENT,
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  borderRadius: 11,
                  border: "none",
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                {submitting ? "Saqlanmoqda..." : "Continue to Categories"}
              </button>
            </form>
          )}

          {/* STEP 2: What do you teach? */}
          {currentStepIndex === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 2
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  What do you teach?
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Select all that apply. One center can teach multiple directions simultaneously.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {TEACHING_CATEGORIES.map((cat) => {
                  const isSelected = selectedCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      style={{
                        padding: "16px 18px",
                        borderRadius: 14,
                        border: isSelected ? `2px solid ${ACCENT}` : "1.5px solid #E5E7EB",
                        background: isSelected ? "#EEF2FF" : "#FFFFFF",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        textAlign: "left",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span style={{ fontSize: 24 }}>{cat.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: isSelected ? ACCENT : "#111827" }}>
                          {cat.label}
                        </div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2, lineHeight: 1.35 }}>
                          {cat.desc}
                        </div>
                      </div>
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          border: isSelected ? `2px solid ${ACCENT}` : "2px solid #D1D5DB",
                          background: isSelected ? ACCENT : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                        }}
                      >
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(0)}
                  style={{ background: "transparent", border: "none", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleStep2Categories}
                  disabled={submitting || selectedCategories.length === 0}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Saqlanmoqda..." : "Continue to Subjects"}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Subjects */}
          {currentStepIndex === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 3
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Add your subjects
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Create the subjects your teachers teach (e.g. English, Mathematics, Programming).
                </p>
              </div>

              {/* Add custom subject */}
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={newSubjectInput}
                  onChange={(e) => setNewSubjectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSubject(newSubjectInput);
                    }
                  }}
                  placeholder="Yangi fan nomi (masalan, Fizika yoki SAT)"
                  style={{ flex: 1, height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                />
                <button
                  type="button"
                  onClick={() => addSubject(newSubjectInput)}
                  style={{
                    padding: "0 18px",
                    background: "#EEF2FF",
                    color: ACCENT,
                    fontWeight: 700,
                    fontSize: 14,
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  + Add subject
                </button>
              </div>

              {/* Active subjects list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4B5563" }}>
                  Tanlangan fanlar ({subjectsList.length}):
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {subjectsList.map((subj) => (
                    <div
                      key={subj}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        background: "#F3F4F6",
                        border: "1px solid #E5E7EB",
                        padding: "8px 14px",
                        borderRadius: 10,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#1F2937",
                      }}
                    >
                      <span>{subj}</span>
                      <button
                        type="button"
                        onClick={() => removeSubject(subj)}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "#9CA3AF", padding: 0 }}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggestions */}
              <div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6B7280" }}>
                  Tavsiya etilgan fanlar (bosing va qo&apos;shing):
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {["IELTS", "General English", "Matematika", "SAT", "Python", "Frontend", "Fizika", "Kimyo", "Nemis tili"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={subjectsList.includes(s)}
                      onClick={() => addSubject(s)}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 8,
                        border: "1px dashed #D1D5DB",
                        background: subjectsList.includes(s) ? "#F9FAFB" : "#FFFFFF",
                        color: subjectsList.includes(s) ? "#9CA3AF" : "#4B5563",
                        fontSize: 12.5,
                        cursor: subjectsList.includes(s) ? "default" : "pointer",
                      }}
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(1)}
                  style={{ background: "transparent", border: "none", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleStep3Subjects}
                  disabled={submitting}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Continue to Courses
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Courses / Programs */}
          {currentStepIndex === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 4
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Configure courses &amp; programs
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Har bir fanning o&apos;z kurslarini (masalan, IELTS, General English, SAT Math) belgilang.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {subjectsList.map((subj) => {
                  const courses = coursesMap[subj] || [];
                  const inputVal = newCourseInputs[subj] || "";
                  const popular = SUGGESTED_COURSES[subj] || [];

                  return (
                    <div
                      key={subj}
                      style={{
                        background: "#F8FAFC",
                        border: "1.5px solid #E2E8F0",
                        borderRadius: 14,
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>
                          📚 {subj}
                        </span>
                        <span style={{ fontSize: 12, color: "#64748B" }}>
                          {courses.length} ta kurs
                        </span>
                      </div>

                      {/* Course tags */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {courses.map((courseName) => (
                          <div
                            key={courseName}
                            style={{
                              background: "#FFFFFF",
                              border: "1px solid #CBD5E1",
                              borderRadius: 8,
                              padding: "4px 10px",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#334155",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span>{courseName}</span>
                            <button
                              type="button"
                              onClick={() => removeCourseFromSubject(subj, courseName)}
                              style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", padding: 0 }}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add custom course input */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={inputVal}
                          onChange={(e) => setNewCourseInputs({ ...newCourseInputs, [subj]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCourseToSubject(subj, inputVal);
                            }
                          }}
                          placeholder={`+ ${subj} uchun yangi kurs...`}
                          style={{
                            flex: 1,
                            height: 36,
                            padding: "0 12px",
                            borderRadius: 8,
                            border: "1px solid #CBD5E1",
                            fontSize: 13,
                            background: "#FFFFFF",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => addCourseToSubject(subj, inputVal)}
                          style={{
                            padding: "0 12px",
                            background: "#EEF2FF",
                            color: ACCENT,
                            borderRadius: 8,
                            border: "none",
                            fontWeight: 700,
                            fontSize: 12.5,
                            cursor: "pointer",
                          }}
                        >
                          Qo&apos;shish
                        </button>
                      </div>

                      {/* Popular suggestions */}
                      {popular.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 11.5, color: "#64748B" }}>Tavsiya:</span>
                          {popular.map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={courses.includes(p)}
                              onClick={() => addCourseToSubject(subj, p)}
                              style={{
                                fontSize: 11.5,
                                padding: "2px 8px",
                                borderRadius: 6,
                                border: "1px dashed #94A3B8",
                                background: courses.includes(p) ? "#E2E8F0" : "#FFFFFF",
                                color: courses.includes(p) ? "#94A3B8" : "#475569",
                                cursor: courses.includes(p) ? "default" : "pointer",
                              }}
                            >
                              + {p}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(2)}
                  style={{ background: "transparent", border: "none", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleStep4Courses}
                  disabled={submitting}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Saqlanmoqda..." : "Continue to Workspace URL"}
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Workspace URL */}
          {currentStepIndex === 4 && (
            <form onSubmit={handleStep5Workspace} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 5
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Choose your Workspace URL
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Bu sizning markazingizning tizimdagi doimiy internet manzili bo&apos;ladi.
                </p>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Center URL / Workspace URL
                </label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    border: slugAvailable === false ? "1.5px solid #EF4444" : slugAvailable === true ? "1.5px solid #10B981" : "1.5px solid #E5E7EB",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#FFFFFF",
                  }}
                >
                  <input
                    required
                    pattern="[a-z0-9\-]{3,40}"
                    title="3 tadan 40 tagacha kichik harf va raqamlar"
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="bilimdon"
                    style={{
                      flex: 1,
                      height: 46,
                      padding: "0 14px",
                      border: "none",
                      outline: "none",
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  />
                  <span
                    style={{
                      padding: "12px 16px",
                      background: "#F8FAFC",
                      borderLeft: "1px solid #E2E8F0",
                      color: "#64748B",
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    .crmapp.com
                  </span>
                </div>

                {/* Status indicator */}
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  {slugChecking && (
                    <span style={{ color: "#6B7280" }}>Mavjudligi tekshirilmoqda...</span>
                  )}
                  {!slugChecking && slugAvailable === true && (
                    <span style={{ color: "#059669", fontWeight: 600 }}>✓ {slugMessage}</span>
                  )}
                  {!slugChecking && slugAvailable === false && (
                    <span style={{ color: "#DC2626", fontWeight: 600 }}>✗ {slugMessage}</span>
                  )}
                </div>
              </div>

              {/* Preview card */}
              <div
                style={{
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 12,
                  padding: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 20 }}>🌐</div>
                <div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>Ko&apos;rinish manzili:</div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: ACCENT }}>
                    {workspaceSlug || "bilimdon"}.crmapp.com
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(3)}
                  style={{ background: "transparent", border: "none", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting || !slugAvailable}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Saqlanmoqda..." : "Continue to First Branch"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 6: First Branch */}
          {currentStepIndex === 5 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 6 (Optional)
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Add your first branch
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  Markazingizning jismoniy filiali manzilini kiriting yoki keyinroq qo&apos;shing.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                    Branch name
                  </label>
                  <input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="Masalan: Bosh filial, Chilonzor filiali"
                    style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                    Physical address
                  </label>
                  <input
                    value={branchAddress}
                    onChange={(e) => setBranchAddress(e.target.value)}
                    placeholder="Toshkent sh., Yunusobod t., Amir Temur ko'chasi 45"
                    style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                    Branch phone
                  </label>
                  <input
                    value={branchPhone}
                    onChange={(e) => setBranchPhone(e.target.value)}
                    placeholder="+998 71 200 00 00"
                    style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => handleStep6Branch(true)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#6B7280",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Do this later
                </button>
                <button
                  type="button"
                  onClick={() => handleStep6Branch(false)}
                  disabled={submitting}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Saqlanmoqda..." : "Add branch & Continue"}
                </button>
              </div>
            </div>
          )}

          {/* STEP 7: Team */}
          {currentStepIndex === 6 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 7 (Optional)
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Invite your team
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  O&apos;qituvchilar, menejerlar va administratorlarni xavfsiz taklifnoma orqali biriktiring.
                </p>
              </div>

              {/* Add team invitation */}
              <div style={{ display: "flex", gap: 10 }}>
                <select
                  value={teamRole}
                  onChange={(e) => setTeamRole(e.target.value as Role)}
                  style={{ width: 140, height: 44, padding: "0 10px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14 }}
                >
                  <option value="TEACHER">O&apos;qituvchi</option>
                  <option value="MANAGER">Menejer</option>
                  <option value="ADMIN">Administrator</option>
                  <option value="ACCOUNTANT">Hisobchi</option>
                  <option value="RECEPTIONIST">Reception</option>
                </select>

                <input
                  value={teamInput}
                  onChange={(e) => setTeamInput(e.target.value)}
                  placeholder="Email yoki telefon raqami"
                  style={{ flex: 1, height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid #E5E7EB", fontSize: 14.5 }}
                />

                <button
                  type="button"
                  onClick={handleInviteMember}
                  disabled={submitting || !teamInput.trim()}
                  style={{
                    padding: "0 20px",
                    background: "#EEF2FF",
                    color: ACCENT,
                    fontWeight: 700,
                    fontSize: 14,
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Invite
                </button>
              </div>

              {/* List of invited members */}
              {invitedTeam.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#4B5563" }}>
                    Yuborilgan taklifnomalar:
                  </span>
                  {invitedTeam.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 14px",
                        background: "#F8FAFC",
                        border: "1px solid #E2E8F0",
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 13.5,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#1E293B" }}>{item.target}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, background: "#EEF2FF", padding: "3px 8px", borderRadius: 6 }}>
                        {item.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => handleStep7Team(true)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#6B7280",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => handleStep7Team(false)}
                  disabled={submitting}
                  style={{
                    height: 46,
                    padding: "0 28px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Saqlanmoqda..." : "Continue to Students"}
                </button>
              </div>
            </div>
          )}

          {/* STEP 8: Students */}
          {currentStepIndex === 7 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Step 8 (Final)
                </span>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 4 }}>
                  Add your students
                </h2>
                <p style={{ fontSize: 14.5, color: "#6B7280", marginTop: 2 }}>
                  O&apos;quvchilarni hozir qo&apos;shishingiz yoki keyinroq dashboard orqali import qilishingiz mumkin.
                </p>
              </div>

              {/* 3 Choice options */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { id: "MANUAL", title: "Add manually", desc: "Birma-bir qo'lda kiritish", icon: "✍️" },
                  { id: "EXCEL", title: "Import Excel", desc: "Jadvaldan import qilish", icon: "📊" },
                  { id: "LATER", title: "Do this later", desc: "Dashboarddan kiritish", icon: "⏭️" },
                ].map((opt) => {
                  const isSelected = studentMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStudentMode(opt.id as any)}
                      style={{
                        padding: "16px 14px",
                        borderRadius: 14,
                        border: isSelected ? `2px solid ${ACCENT}` : "1.5px solid #E5E7EB",
                        background: isSelected ? "#EEF2FF" : "#FFFFFF",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                        gap: 8,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 26 }}>{opt.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isSelected ? ACCENT : "#111827" }}>
                        {opt.title}
                      </span>
                      <span style={{ fontSize: 11.5, color: "#6B7280" }}>{opt.desc}</span>
                    </button>
                  );
                })}
              </div>

              {/* Manual input subview */}
              {studentMode === "MANUAL" && (
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      value={manualStudentName}
                      onChange={(e) => setManualStudentName(e.target.value)}
                      placeholder="O'quvchi F.I.SH."
                      style={{ flex: 1, height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13.5 }}
                    />
                    <input
                      value={manualStudentPhone}
                      onChange={(e) => setManualStudentPhone(e.target.value)}
                      placeholder="+998 90 000 00 00"
                      style={{ flex: 1, height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 13.5 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (manualStudentName.trim()) {
                          setManualStudentsList([...manualStudentsList, { name: manualStudentName, phone: manualStudentPhone }]);
                          setManualStudentName("");
                          setManualStudentPhone("");
                        }
                      }}
                      style={{
                        padding: "0 14px",
                        background: ACCENT,
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 13,
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Qo&apos;shish
                    </button>
                  </div>

                  {manualStudentsList.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {manualStudentsList.map((st, i) => (
                        <span key={i} style={{ background: "#EEF2FF", color: ACCENT, padding: "4px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {st.name} {st.phone && `(${st.phone})`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Excel subview */}
              {studentMode === "EXCEL" && (
                <div style={{ background: "#F8FAFC", border: "1.5px dashed #CBD5E1", borderRadius: 14, padding: "24px", textAlign: "center" }}>
                  <div style={{ fontSize: 32 }}>📁</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginTop: 6 }}>
                    Excel yoki CSV faylni yuklang
                  </div>
                  <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 4 }}>
                    Siz buni keyinroq &quot;O&apos;quvchilar&quot; bo&apos;limidan istalgan vaqtda yuklashingiz mumkin.
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(6)}
                  style={{ background: "transparent", border: "none", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Back
                </button>
                <button
                  id="finish-onboarding-btn"
                  type="button"
                  onClick={handleStep8Students}
                  disabled={submitting}
                  style={{
                    height: 48,
                    padding: "0 32px",
                    background: ACCENT,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 11,
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(79, 70, 229, 0.3)",
                  }}
                >
                  {submitting ? "Tugatilmoqda..." : "Finish Setup 🎉"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
