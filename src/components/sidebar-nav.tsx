"use client";

import {
  CalendarCheck2,
  ChartNoAxesCombined,
  FileUp,
  Landmark,
  LayoutDashboard,
  ListTree,
  Settings,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/transactions", label: "Transactions", icon: ListTree },
  { href: "/budgets", label: "Budgets", icon: Tags },
  { href: "/net-worth", label: "Net worth", icon: ChartNoAxesCombined },
  { href: "/month-close", label: "Monthly close", icon: CalendarCheck2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Primary navigation">
      {navigation.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href;

        return (
          <Link
            className="sidebar-nav__link"
            data-active={isActive}
            href={href}
            key={href}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
