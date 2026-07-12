import type { ReactNode } from "react";
import Link from "next/link";

interface LegalPageProps {
  title: string;
  /** Human-readable last-updated date, e.g. "July 13, 2026". */
  updated: string;
  children: ReactNode;
}

/**
 * Shared shell for the public legal/compliance pages (privacy, terms, data
 * deletion). Public — no auth — so Meta App Review (and users) can reach these
 * at stable URLs. Descendant prose is styled via arbitrary variants so each page
 * can be written as plain semantic HTML.
 */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <main id="main-content" className="min-h-dvh bg-background px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-fg">
            ← BrandPilot
          </Link>
          <span className="text-xs text-subtle">Last updated: {updated}</span>
        </div>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">{title}</h1>

        <div
          className={[
            "mt-6 pb-16",
            "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground",
            "[&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground",
            "[&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted",
            "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
            "[&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-muted",
            "[&_a]:font-medium [&_a]:text-brand-600 hover:[&_a]:underline dark:[&_a]:text-brand-fg",
            "[&_strong]:font-semibold [&_strong]:text-foreground",
          ].join(" ")}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
