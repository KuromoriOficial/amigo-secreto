import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amigo Secreto 2026",
  description: "Descubra quem você tirou e marque os dias em que você não pode participar do encontro.",
  icons: { icon: "/presente.svg" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
