import type { Metadata } from "next";
import "./globals.css";
import { CompanyProvider } from "@/context/CompanyContext";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import AiChatWidget from "@/components/ai/AiChatWidget";
import AppOrPublicLayout from "@/components/layout/AppOrPublicLayout";

export const metadata: Metadata = {
  title: "Accountooze.ai",
  description: "Personalized user experiences by Accountooze.ai",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased min-h-screen bg-background text-foreground flex flex-col">
        <AuthProvider>
        <CompanyProvider>
          <AppOrPublicLayout>{children}</AppOrPublicLayout>
          <Toaster />
          <AiChatWidget />
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
