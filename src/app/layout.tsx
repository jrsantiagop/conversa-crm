import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSnapshot } from "@/lib/snapshot";

export const metadata: Metadata = {
  title: "Conversa CRM",
  description: "CRM conversacional propio: un solo inbox para todos tus canales",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snapshot = await getSnapshot();
  return (
    <html lang="es">
      <body>
        <AppShell unread={snapshot.counts.unread}>{children}</AppShell>
      </body>
    </html>
  );
}
