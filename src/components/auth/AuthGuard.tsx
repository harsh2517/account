"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useCompany } from "@/context/CompanyContext";
import { usePlanCheck } from "@/hooks/usePlanCheck";
import {cn} from "@/lib/utils"

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children}: AuthGuardProps) {
  const { authStatus, user } = useAuth();
  const router = useRouter();
  const { selectedCompanyId } = useCompany();
  const { hasPlan, loading: planLoading } = usePlanCheck();

  useEffect(() => {
    // If the auth check is done and there's no user, redirect to login.
    if (authStatus === 'unauthenticated') {
      router.replace("/login");
    }
  }, [authStatus, router]);

  // While checking auth status or plan status, show a loader.
  if (authStatus === 'loading' || planLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // If authenticated and has plan (or no plan check needed), show the protected content.
  if (authStatus === 'authenticated' && user) {
    // Only render children if either:
    // 1. The user has a plan (hasPlan === true)
    // 2. Or we're still waiting to determine plan status (hasPlan === null)
    // The usePlanCheck hook will handle the redirection if hasPlan becomes false
    if (hasPlan !== false) {
      return <>{children}</>;
    }
    
    // While waiting for redirection to pricing page, show loader
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Fallback loader for any brief transitional state.
  return (
    <div className={"flex h-screen w-screen items-center justify-center"}>
      <LoadingSpinner size="lg" />
    </div>
  );
}