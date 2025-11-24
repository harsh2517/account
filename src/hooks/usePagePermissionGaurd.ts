"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

const PUBLIC_PAGES = ["/home", "/select-company", "/profile"];

export function usePagePermissionGuard() {
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);
  const { user } = useAuth();
  const { selectedCompanyId } = useCompany();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    async function checkPermission() {
      if (!isMounted) return;

      // 1. Check if user is authenticated
      if (!user) {
        router.replace("/");
        return;
      }

      // 2. Allow public pages
      const isPublicPage = PUBLIC_PAGES.some(
        (page) => pathname === page || pathname.startsWith(`${page}/`)
      );
      if (isPublicPage) {
        setHasAccess(true);
        setChecking(false);
        return;
      }

      // 3. If no company selected, redirect to select-company
      if (!selectedCompanyId) {
        router.replace("/select-company");
        return;
      }

      try {
        // 4. Check if user is company owner
        const companyRef = doc(db, "companies", selectedCompanyId);
        const companySnap = await getDoc(companyRef);
        const isOwner = companySnap.exists() && companySnap.data()?.createdBy === user.uid;

        if (isOwner) {
          setHasAccess(true);
          setChecking(false);
          return;
        }

        // 5. Check member permissions
        const memberId = `${selectedCompanyId}_${user.uid}`;
        const memberRef = doc(db, "companyMembers", memberId);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          const allowedPages: string[] = memberSnap.data().allowedPages || [];
          
          // Check if current path matches any allowed page or its subpages
          const isAllowed = allowedPages.some(page => 
            pathname === `/${page}` || 
            pathname.startsWith(`/${page}/`)
          );

          if (isAllowed) {
            setHasAccess(true);
          } else {
            router.replace("/select-company");
          }
        } else {
          router.replace("/select-company");
        }
      } catch (error) {
        console.error("Permission check error:", error);
        router.replace("/select-company");
      } finally {
        if (isMounted) setChecking(false);
      }
    }

    checkPermission();

    return () => {
      isMounted = false;
    };
  }, [user, selectedCompanyId, pathname, router]);

  return { hasAccess, checking };
}