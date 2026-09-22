"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { attendanceApi, groupsApi, type Group, type QrCheckInResponse, type AttendanceStatus } from "@/lib/api";

function playChime(success = true) {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    if (success) {
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6
    } else {
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.2);
    }
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // Audio context not allowed or not supported
  }
}

export default function AttendancePage() {
  const [tab, setTab] = useState<"scanner" | "matrix">("scanner");

  // --- Scanner States ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<QrCheckInResponse | null>(null);
  const [scanHistory, setScanHistory] = useState<QrCheckInResponse[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- Matrix States ---
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [groupStudents, setGroupStudents] = useState<{ id: string; fullName: string; phone: string | null }[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [savingMatrix, setSavingMatrix] = useState(false);
  const [matrixSuccess, setMatrixSuccess] = useState(false);

  // Load groups on mount
  useEffect(() => {
    groupsApi.list().then((list) => {
      setGroups(list);
      if (list.length > 0) {
        setSelectedGroupId(list[0].id);
      }
    }).catch(console.error);
  }, []);

  // Check-In handler
  const handleCheckIn = useCallback(async (codeToScan: string) => {
    if (!codeToScan.trim() || scanning) return;
    setScanning(true);
    setErrorMessage(null);

    try {
      const res = await attendanceApi.qrCheckIn({ code: codeToScan.trim() });
      setLastResult(res);
      setScanHistory((prev) => [res, ...prev.slice(0, 19)]);
      playChime(!res.finance.hasDebt);
      setManualCode("");
    } catch (err) {
      playChime(false);
      const msg = err instanceof Error ? err.message : "QR-kodni tanib bo'lmadi yoki o'quvchi topilmadi";
      setErrorMessage(msg);
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  // Start Camera
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      setCameraError("Kamerani yoqib bo'lmadi. Ruxsat berilganini tekshiring yoki pastdagi qidiruv orqali kiriting.");
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Load group details when group or date changes in matrix tab
  useEffect(() => {
    if (!selectedGroupId) return;
    groupsApi.get(selectedGroupId).then((g) => {
      const studs = (g.enrollments || []).map((e: any) => ({
        id: e.student?.id || e.studentId,
        fullName: e.student?.fullName || "Noma'lum o'quvchi",
        phone: e.student?.phone || null,
      }));
      setGroupStudents(studs);

      // Load existing attendance
      attendanceApi.list({ groupId: selectedGroupId, date: selectedDate }).then((records) => {
        const map: Record<string, AttendanceStatus> = {};
        records.forEach((r) => {
          map[r.studentId] = r.status;
        });
        setAttendanceMap(map);
      });
    }).catch(console.error);
  }, [selectedGroupId, selectedDate]);

  // Bulk mark all PRESENT
  const markAllPresent = () => {
    const map: Record<string, AttendanceStatus> = {};
    groupStudents.forEach((s) => {
      map[s.id] = "PRESENT";
    });
    setAttendanceMap(map);
  };

  // Save matrix
  const handleSaveMatrix = async () => {
    if (!selectedGroupId) return;
    setSavingMatrix(true);
    setMatrixSuccess(false);

    try {
      const entries = Object.entries(attendanceMap).map(([studentId, status]) => ({
        studentId,
        status,
      }));
      if (entries.length > 0) {
        await attendanceApi.mark({
          groupId: selectedGroupId,
          date: selectedDate,
          entries,
        });
      }
      setMatrixSuccess(true);
      setTimeout(() => setMatrixSuccess(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Davomatni saqlab bo'lmadi");
    } finally {
      setSavingMatrix(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span>📷</span> Davomat & QR Skaner
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            O&apos;quvchilar davomatini 1 soniyada QR-kod orqali qayd etish va guruh jadvallari
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl self-start sm:self-auto border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setTab("scanner")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
              tab === "scanner"
                ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            <span>📷</span> QR Tezkor Skaner
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("matrix");
              stopCamera();
            }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
              tab === "matrix"
                ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
            }`}
          >
            <span>📋</span> Guruh Davomati
          </button>
        </div>
      </div>

      {/* TAB 1: QR SCANNER */}
      {tab === "scanner" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Camera Viewport & Manual Input */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white dark:bg-gray-850 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${cameraActive ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {cameraActive ? "Jonli Skaner (Kamera Faol)" : "QR Skaner"}
                  </h2>
                </div>
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <span>📷</span> Kamerani yoqish
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    Kamerani to&apos;xtatish
                  </button>
                )}
              </div>

              {cameraError && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs rounded-xl">
                  {cameraError}
                </div>
              )}

              {/* Viewfinder Container */}
              <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video flex items-center justify-center border-2 border-dashed border-gray-700">
                <video
                  ref={videoRef}
                  className={`w-full h-full object-cover ${cameraActive ? "block" : "hidden"}`}
                  playsInline
                  muted
                />

                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                    <div className="w-48 h-48 sm:w-56 sm:h-56 border-2 border-indigo-400 rounded-2xl relative shadow-[0_0_20px_rgba(99,102,241,0.5)]">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-indigo-400 -mt-1 -ml-1 rounded-tl" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-indigo-400 -mt-1 -mr-1 rounded-tr" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-indigo-400 -mb-1 -ml-1 rounded-bl" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-indigo-400 -mb-1 -mr-1 rounded-br" />
                      {/* Scanline animation */}
                      <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent animate-pulse top-1/2" />
                    </div>
                    <span className="mt-3 text-xs font-medium text-white/80 bg-black/50 px-2.5 py-1 rounded-full backdrop-blur-sm">
                      QR-kodni ramka ichiga keltiring
                    </span>
                  </div>
                )}

                {!cameraActive && (
                  <div className="text-center p-6 space-y-2">
                    <div className="w-14 h-14 mx-auto rounded-full bg-gray-800 flex items-center justify-center text-2xl text-gray-400">
                      📷
                    </div>
                    <p className="text-sm font-medium text-gray-300">Kamera yoqilmagan</p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      O&apos;quvchi kartasidagi QR-kodni skanerlash uchun yuqoridagi tugmani bosing yoki kodni qo&apos;lda kiriting.
                    </p>
                  </div>
                )}
              </div>

              {/* Fast Barcode / Manual Input */}
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  ⚡ O&apos;quvchi IDsi / Shtrix-skaner yoki QR matnini kiritish:
                </label>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCheckIn(manualCode);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Masalan: TALIMCRM:STUDENT:cuid... yoki ID"
                    className="flex-1 px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={scanning || !manualCode.trim()}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                  >
                    {scanning ? "Qayd etilmoqda..." : "Tasdiqlash ➔"}
                  </button>
                </form>
                {errorMessage && (
                  <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                    <span>⚠️</span> {errorMessage}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Instant Result Card & Live Scans Feed */}
          <div className="lg:col-span-5 space-y-4">
            {/* Live Result Box */}
            <div className="bg-white dark:bg-gray-850 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <span>🎯</span> Skaner Natijasi
              </h2>

              {lastResult ? (
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    lastResult.finance.hasDebt
                      ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                      : "bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span
                        className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mb-1 ${
                          lastResult.alreadyMarked
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                        }`}
                      >
                        {lastResult.alreadyMarked ? "ℹ️ ALLAQACHON QAYD ETILGAN" : "✅ DAVOMAT QAYD ETILDI"}
                      </span>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {lastResult.student.fullName}
                      </h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        👥 Guruh: <strong className="text-gray-900 dark:text-gray-200">{lastResult.group.name}</strong>
                      </p>
                    </div>
                    <span className="text-xs font-mono font-semibold bg-white dark:bg-gray-800 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                      {lastResult.attendance.time}
                    </span>
                  </div>

                  {/* Financial Debt Status Badge */}
                  <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-700/60 text-xs">
                    {lastResult.finance.hasDebt ? (
                      <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-400 font-semibold">
                        <span>⚠️</span>
                        <span>Qarzdorlik: {new Intl.NumberFormat("uz-UZ").format(lastResult.finance.monthlyPrice)} so&apos;m to&apos;lanmagan!</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                        <span>🟢</span>
                        <span>Oylik to&apos;lov holati yaxshi ({new Intl.NumberFormat("uz-UZ").format(lastResult.finance.totalPaid)} so&apos;m)</span>
                      </div>
                    )}
                  </div>

                  {/* Notification status */}
                  <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <span>✈️</span>
                    <span>
                      {lastResult.student.telegramLinked
                        ? "Ota-onaga Telegram orqali xabar yetkazildi"
                        : "Telegram ulanmagan"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-gray-400 text-xs">
                  Hali hech bir o&apos;quvchi skanerlanmadi. Skaner qilingan natija shu yerda ko&apos;rsatiladi.
                </div>
              )}
            </div>

            {/* Live Scans History */}
            <div className="bg-white dark:bg-gray-850 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center justify-between">
                <span>🕒 Bugungi Skanerlar ({scanHistory.length})</span>
                {scanHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setScanHistory([])}
                    className="text-[11px] text-gray-400 hover:text-red-500"
                  >
                    Tozalash
                  </button>
                )}
              </h3>

              {scanHistory.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Tarix bo&apos;sh</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {scanHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60 text-xs"
                    >
                      <div className="truncate pr-2">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">
                          {item.student.fullName}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {item.group.name}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-[11px] text-gray-500">{item.attendance.time}</span>
                        <div>
                          {item.finance.hasDebt ? (
                            <span className="text-[10px] text-amber-600 font-bold">Qarz</span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-medium">To&apos;langan</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GROUP ATTENDANCE MATRIX */}
      {tab === "matrix" && (
        <div className="bg-white dark:bg-gray-850 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Guruhni tanlang:</label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.subject})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Sana:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={markAllPresent}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
              >
                ✅ Barchasini keldi qilish
              </button>
              <button
                type="button"
                onClick={handleSaveMatrix}
                disabled={savingMatrix}
                className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {savingMatrix ? "Saqlanmoqda..." : "Saqlash"}
              </button>
            </div>
          </div>

          {matrixSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs rounded-xl font-medium">
              ✅ Guruh davomati muvaffaqiyatli saqlandi!
            </div>
          )}

          {/* Students Matrix Table */}
          {groupStudents.length === 0 ? (
            <p className="text-center py-10 text-gray-400 text-sm">
              Bu guruhda hali o&apos;quvchilar yo&apos;q
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">O&apos;quvchi</th>
                    <th className="py-3 px-4">Telefon</th>
                    <th className="py-3 px-4 text-center">Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {groupStudents.map((student, idx) => {
                    const status = attendanceMap[student.id] || "ABSENT";
                    return (
                      <tr key={student.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="py-3 px-4 text-xs text-gray-400">{idx + 1}</td>
                        <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">
                          {student.fullName}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">{student.phone || "—"}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAttendanceMap((prev) => ({ ...prev, [student.id]: "PRESENT" }))}
                              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                                status === "PRESENT"
                                  ? "bg-emerald-600 text-white shadow-sm"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
                              }`}
                            >
                              Keldi
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttendanceMap((prev) => ({ ...prev, [student.id]: "LATE" }))}
                              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                                status === "LATE"
                                  ? "bg-amber-500 text-white shadow-sm"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
                              }`}
                            >
                              Kechikdi
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttendanceMap((prev) => ({ ...prev, [student.id]: "ABSENT" }))}
                              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                                status === "ABSENT"
                                  ? "bg-rose-600 text-white shadow-sm"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
                              }`}
                            >
                              Kelmadi
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
