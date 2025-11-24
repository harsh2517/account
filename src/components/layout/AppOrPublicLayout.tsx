
'use client';

import { usePathname } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import AuthGuard from '@/components/auth/AuthGuard';

// Define all pages that can be accessed without logging in.
const PUBLIC_PAGES = ['/', '/forgot-password', '/login', '/signup', '/pricing', '/checkout', '/features', "/free", "/free/document-reader", "/free/transaction-categorization"];

export default function AppOrPublicLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPublicPage = PUBLIC_PAGES.includes(pathname);

    // If the current page is public, render it directly without any guards or dashboard layout.
    // This ensures pages like the landing page load instantly for all visitors.
    if (isPublicPage) {
        return <>{children}</>;
    }
    if (["/profile", "/select-company"].includes(pathname)) return (
        
        <AuthGuard>
            {children}
        </AuthGuard>
    )
    
    // For all other private routes, wrap with AuthGuard and the full DashboardLayout.
    return (
        <AuthGuard>
            <DashboardLayout>
                {children}
            </DashboardLayout>
        </AuthGuard>
    );
}
