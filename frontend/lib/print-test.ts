import { headerChanges, type TestQuestion } from "./tests";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Opens a printable paper copy of a test, with the answer key on its own
// page at the end.
export function printTest(
  title: string,
  questions: TestQuestion[],
  labels: { name: string; date: string; key: string; tf: Record<string, string> },
) {
  const w = window.open("", "_blank");
  if (!w) return;
  const line = `<p class="line">_____________________________________________</p>`;
  const items = questions
    .map((q, i) => {
      const h = headerChanges(questions, i);
      let head = "";
      if (h.section) head += `<h2>${esc(h.section)}</h2>`;
      if (h.instruction) head += `<p class="ins">${esc(h.instruction)}</p>`;
      if (h.passage) head += `<div class="passage">${esc(h.passage)}</div>`;
      let body = "";
      if (q.type === "MCQ") body = `<ol type="A">${(q.options ?? []).map((o) => `<li>${esc(o.text)}</li>`).join("")}</ol>`;
      else if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") body = `<p class="opts">${(q.options ?? []).map((o) => `☐ ${esc(labels.tf[o.id] ?? o.text)}`).join(" &nbsp; ")}</p>`;
      else if (q.type === "MATCHING") {
        const rights = [...new Set((q.pairs ?? []).map((p) => p.right))].sort();
        body = `<table class="match"><tr><td>${(q.pairs ?? []).map((p, j) => `${j + 1}) ${esc(p.left)} ____`).join("<br>")}</td><td>${rights.map((r, j) => `${String.fromCharCode(97 + j)}) ${esc(r)}`).join("<br>")}</td></tr></table>`;
      } else if (q.type === "WORD_ORDER") body = `<p class="opts">${esc((q.words ?? []).join(" / "))}</p>${line}`;
      else if (q.type === "ESSAY") body = line.repeat(8);
      else body = line;
      return `${head}<div class="q"><p><b>${i + 1}.</b> ${esc(q.prompt)}${q.points > 1 ? ` <span class="pts">(${q.points})</span>` : ""}</p>${body}</div>`;
    })
    .join("");
  const key = questions
    .map((q, i) => {
      let a = "";
      if (q.type === "MCQ") a = q.correctAnswer;
      else if (q.type === "TRUE_FALSE" || q.type === "TRUE_FALSE_NG") a = labels.tf[q.correctAnswer] ?? q.correctAnswer;
      else if (q.type === "MATCHING") a = (q.pairs ?? []).map((p, j) => `${j + 1}-${p.right}`).join(", ");
      else if (q.type === "ESSAY") a = "—";
      else a = q.correctAnswer.split("|")[0];
      return `<div>${i + 1}) ${esc(a)}</div>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:system-ui,sans-serif;padding:28px;color:#181A1F;font-size:14px}h1{font-size:20px}h2{font-size:14px;text-transform:uppercase;background:#eee;padding:6px 8px;margin:22px 0 6px}
    .ins{font-weight:700;margin:4px 0}.passage{border-left:3px solid #999;padding:6px 10px;margin:6px 0;white-space:pre-wrap;line-height:1.6}.q{margin-bottom:12px;break-inside:avoid}.q p{margin:4px 0}
    ol[type=A]{margin:4px 0}.line{color:#999}.pts{color:#777;font-size:12px}.opts{color:#333}.match td{vertical-align:top;padding-right:40px;line-height:1.8}
    .key{page-break-before:always;font-size:12px;columns:3}</style></head><body>
    <h1>${esc(title)}</h1><p>${esc(labels.name)}: ______________________ &nbsp; ${esc(labels.date)}: ____________</p>
    ${items}<div class="key"><b>${esc(labels.key)}</b>${key}</div></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
