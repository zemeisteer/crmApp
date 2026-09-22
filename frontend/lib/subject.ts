/**
 * Smart subject / direction matching utility for CRMAPP.
 * Handles subcategories, hierarchical directions, multi-subject teachers,
 * and fuzzy parent-child subject matches.
 *
 * Examples:
 *   matchesSubject("Matematika (Milliy sertifikat)", "Matematika") -> true
 *   matchesSubject("Ingliz tili (IELTS)", "Ingliz tili") -> true
 *   matchesSubject("Ingliz tili, Matematika", "Matematika") -> true
 *   matchesSubject("Matematika", "Ingliz tili") -> false
 */

export function matchesSubject(candidateSubject?: string | null, targetDirection?: string | null): boolean {
  if (!targetDirection || targetDirection.trim() === "") return true;
  if (!candidateSubject || candidateSubject.trim() === "") return false;

  const target = targetDirection.trim().toLowerCase();
  const candidate = candidateSubject.trim().toLowerCase();

  if (candidate === target) return true;

  // Split multi-subject entries (e.g. "Matematika, Ingliz tili" or "IELTS / CEFR")
  const parts = candidate
    .split(/[,/;|&]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  for (const part of parts) {
    if (part === target) return true;
    if (part.startsWith(target)) return true;
    if (target.startsWith(part)) return true;
    if (part.includes(target) || target.includes(part)) return true;
  }

  // Also check top-level containment
  return candidate.includes(target) || target.includes(candidate);
}

export function extractUniqueSubjects(items: Array<{ subject?: string | null }>): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (!item.subject) continue;
    const parts = item.subject.split(/[,/;|&]+/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      set.add(p);
    }
  }
  return Array.from(set).sort();
}
