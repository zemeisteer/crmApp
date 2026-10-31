import type { ReactNode } from "react";

/**
 * The top of a page: a small eyebrow (greeting, context), a large title and,
 * on the right, actions or a KPI strip. Wraps under the title on phones.
 */
export default function PageHeader({ eyebrow, title, actions, children }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-title rise-in">
        {eyebrow && <div className="ui-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {children && <div className="ui-page-header-kpis">{children}</div>}
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  );
}
