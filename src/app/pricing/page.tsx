
"use client";

import Header from '@/components/layout/Header';
// import { useEffect } from 'react';
// import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/ui/loading-spinner';
import PricingCard from '@/components/ui/pricing-card';

// This page is no longer in use and redirects to the signup page.
export default function PricingPage() {
  // const router = useRouter();

  // useEffect(() => {
  //   router.replace('/signup');
  // }, [router]);

  return (
    <div>
      <Header/>
      <PricingCard/>
      <footer className="container py-8 text-center text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Accountooze.ai. All rights reserved.</p>
      </footer>
    </div>
  );
}
