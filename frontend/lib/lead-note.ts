// What the person wrote when applying. Older website leads stored it with a
// generated prefix (or only a generated sentence); show just their words.
const GENERATED = /^(Saytdan onlayn ariza:\s*|Markaz veb-saytidan onlayn ariza topshirildi\.?\s*$|Onlayn daraja testini topshirdi\.?\s*$)/;

export function leadNote(notes?: string | null): string {
  const text = (notes ?? "").trim();
  return text.replace(GENERATED, "").trim();
}
