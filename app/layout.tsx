import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Patent Search Assistant",
  description: "Patent examiner search assistant web application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
