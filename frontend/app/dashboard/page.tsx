"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth-context";
import { groupsApi, studentsApi, paymentsApi, Group, Student, PaymentsSummary } from "@/lib/api";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function DashboardContent() {
  const { user, tenant } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([groupsApi.list(), studentsApi.list(), paymentsApi.summary()])
      .then(([g, s, p]) => {
        setGroups(g);
        setStudents(s);
        setSummary(p);
      })
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Xush kelibsiz, {user?.fullName?.split(" ")[0] ?? "boss"}</h1>
          <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
            {today} — {tenant?.name}
          </div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1FA463", background: "#E9F8EF", padding: "6px 14px", borderRadius: 100 }}>
          ● Barcha tizimlar ishlayapti
        </span>
      </div>

      <div style={{ padding: "26px 32px", display: "flex", flexDirection: "column", gap: 22, overflow: "auto" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label="Guruhlar soni" value={String(groups.length)} />
              <StatCard label="Faol o'quvchilar" value={String(students.length)} />
              <StatCard label="To'langan (jami)" value={`${formatMoney(summary?.totalPaid ?? 0)} so'm`} />
              <StatCard label="Kutilayotgan to'lovlar" value={String(summary?.pendingCount ?? 0)} danger={(summary?.pendingCount ?? 0) > 0} />
            </div>

            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>So&apos;nggi guruhlar</div>
              {groups.length === 0 ? (
                <div style={{ fontSize: 13.5, color: "#8A8D96" }}>Hali guruh yaratilmagan.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {groups.slice(0, 5).map((g) => (
                    <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px" }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          background: "#ECEBFB",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          color: ACCENT,
                          fontSize: 13,
                        }}
                      >
                        {g.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</div>
                        <div style={{ fontSize: 12, color: "#8A8D96" }}>
                          {g.subject} {g.schedule ? `· ${g.schedule}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: ACCENT, background: "#ECEBFB", padding: "4px 10px", borderRadius: 100 }}>
                        {g.monthlyPrice ? `${formatMoney(g.monthlyPrice)} so'm` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function StatCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      style={{
        background: danger ? "#FDEBEC" : "#fff",
        border: `1px solid ${danger ? "#F6D2D6" : "#EAE8E2"}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, color: danger ? "#B23A47" : "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: danger ? "#B23A47" : "#181A1F" }}>
        {value}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <DashboardShell>
      <DashboardContent />
    </DashboardShell>
  );
}
