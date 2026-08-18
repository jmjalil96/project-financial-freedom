import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { SidebarNav } from "@/components/sidebar-nav";
import type { BaseCurrency } from "@/domain/currencies";

type AppShellProps = {
  baseCurrency: BaseCurrency;
  children: React.ReactNode;
  storageLabel: string;
};

export function AppShell({ baseCurrency, children, storageLabel }: AppShellProps) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace content
      </a>
      <aside className="sidebar">
        <Link className="sidebar__brand" href="/dashboard">
          <BrandMark />
          <span>
            <strong>Financial Freedom</strong>
            <small>Monthly ledger</small>
          </span>
        </Link>

        <div className="sidebar__index-label">Workspace index</div>
        <SidebarNav />

        <div className="sidebar__footer">
          <span className="local-status">
            <span className="local-status__dot" />
            Local only
          </span>
          <span className="currency-chip">{baseCurrency}</span>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <p>Private workspace</p>
          <div className="topbar__rule" />
          <p>{storageLabel}</p>
        </header>
        <div className="workspace" id="workspace-content" tabIndex={-1}>
          {children}
        </div>
      </main>
    </div>
  );
}
