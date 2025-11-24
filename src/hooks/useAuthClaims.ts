import { useEffect, useState } from 'react';
import { getAuth, getIdTokenResult, onAuthStateChanged } from 'firebase/auth';

export function useAuthClaims() {
  const [claims, setClaims] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await getIdTokenResult(user, true);
        setClaims(tokenResult.claims);
      } else {
        setClaims(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { claims, loading };
}