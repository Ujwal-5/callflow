import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallFlow — AI-Powered Cold Call Assistant",
  description: "Stay on track. Make every call count.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#0b132b] text-slate-100">{children}</body>
    </html>
  );
}

