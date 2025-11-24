// hooks/usePlanCheck.ts
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase'; 
import { useAuth } from '@/context/AuthContext'; 

export const usePlanCheck = (redirectOnNoPlan: boolean = true) => {
  const { user } = useAuth();
  const router = useRouter();
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkUserPlan() {
      if (!user?.uid) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          setHasPlan(userData.hasAccess || false);
        } else {
          setHasPlan(false);
        }
      } catch (error) {
        console.error("Error checking user plan:", error);
        setHasPlan(false);
      } finally {
        setLoading(false);
      }
    }

    checkUserPlan();
  }, [user]);

  useEffect(() => {
    if (redirectOnNoPlan && hasPlan === false) {
      router.push('/pricing');
    }
  }, [hasPlan, redirectOnNoPlan, router]);

  return {
    hasPlan,
    loading,
    refreshPlanStatus: async () => {
      if (!user?.uid) return;
      
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          setHasPlan(userData.hasAccess || false);
        } else {
          setHasPlan(false);
        }
      } catch (error) {
        console.error("Error refreshing user plan:", error);
      }
    }
  };
};