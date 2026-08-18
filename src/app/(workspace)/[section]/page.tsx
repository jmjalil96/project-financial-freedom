import { CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const sections = {
  budgets: {
    title: "Budgets",
    description: "Simple monthly category targets will live here without rollover.",
    phase: "Phase 7",
  },
  "net-worth": {
    title: "Net worth",
    description: "Tracked balances and dated manual valuations will meet here.",
    phase: "Phase 6",
  },
  "month-close": {
    title: "Monthly close",
    description: "Coverage, reconciliation, and final month approval will happen here.",
    phase: "Phase 7",
  },
} as const;

type SectionKey = keyof typeof sections;

type SectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

function isSectionKey(section: string): section is SectionKey {
  return Object.hasOwn(sections, section);
}

export async function generateMetadata({
  params,
}: SectionPageProps): Promise<Metadata> {
  const { section } = await params;

  return isSectionKey(section)
    ? { title: sections[section].title }
    : { title: "Not found" };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;

  if (!isSectionKey(section)) {
    notFound();
  }

  const definition = sections[section];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
      </section>

      <section className="empty-ledger">
        <div className="empty-ledger__mark">
          <CircleDashed aria-hidden="true" size={26} />
        </div>
        <p className="card-kicker">{definition.phase}</p>
        <h2>This workspace is intentionally inactive.</h2>
        <p>
          Its foundation is visible in navigation, but its financial behavior will be
          implemented in the phase that defines it.
        </p>
      </section>
    </>
  );
}
