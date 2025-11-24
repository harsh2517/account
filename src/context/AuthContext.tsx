
"use client";

import type { User as FirebaseUser, AuthError } from "firebase/auth";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { auth, db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

interface AuthContextType {
  user: FirebaseUser | null;
  authStatus: AuthStatus;
  signOut: () => Promise<void>;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.emailVerified) {
        setUser(currentUser);
        setAuthStatus('authenticated');
      } else {
        if (currentUser && !currentUser.emailVerified) {
            // If user exists but email is not verified, sign them out
            // to prevent access to protected routes.
            await firebaseSignOut(auth);
        }
        setUser(null);
        setAuthStatus('unauthenticated');
      }
    });
    return () => unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      router.push("/");
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
    } catch (err) {
      const authError = err as Error;
      toast({ title: "Logout Error", description: authError.message, variant: "destructive" });
    }
  };
  
  return (
    <AuthContext.Provider value={{
      user,
      authStatus,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
