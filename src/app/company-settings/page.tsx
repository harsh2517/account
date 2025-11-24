
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is no longer in use and redirects to the profile page.
export default function CompanySettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/profile');
  }, [router]);

  return null;
}
