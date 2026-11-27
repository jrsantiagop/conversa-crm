"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Database, Inbox, PlugZap, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/inbox", label: "Bandeja", icon: Inbox },
  { href: "/integraciones", label: "Integraciones", icon: PlugZap },
  { href: "/conocimiento", label: "Conocimiento", icon: BookOpen },
  { href: "/crm", label: "CRM", icon: Database },
];

export function AppShell({ children, unread }: { children: React.ReactNode; unread: number }) {
  const pathname = usePathname();
  const title = NAV.find((item) => pathname.startsWith(item.href))?.label ?? "Bandeja";

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/inbox" className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">Conversa</div>
            <div className="brand-sub">CRM conversacional</div>
          </div>
        </Link>
        <nav className="nav">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn("nav-item", pathname.startsWith(href) && "active")}
            >
              <Icon size={17} />
              <span>{label}</span>
              {href === "/inbox" && unread > 0 ? (
                <span className="nav-count">{unread}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="row small">
            <Bot size={15} /> Motor conversacional
          </div>
          <div style={{ marginTop: 6, opacity: 0.75 }}>Un inbox · todos tus canales</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="spacer" />
          <span className="badge brand"><span className="dot" /> Espacio personal + empresa</span>
        </header>
        {children}
      </div>
    </div>
  );
}
