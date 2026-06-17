import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ToolTrace",
  description: "Local-first trace console for AI agents"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
