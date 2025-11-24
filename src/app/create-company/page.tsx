
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page is no longer in use and redirects to the dashboard.
// The default chart of accounts is now created during sign up.
export default function CreateCompanyPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
