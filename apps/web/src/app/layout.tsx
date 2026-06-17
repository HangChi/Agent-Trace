import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div id="main-content">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
