"use client";

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext'; 
import { useCompany } from "@/context/CompanyContext";

export const useCompanyOwnerStatus = () => {
  const { selectedCompanyId} = useCompany();
  const [isCheckingOwner, setIsCheckingOwner] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const checkOwnerStatus = async () => {
      if (!selectedCompanyId || !user?.uid) {
        setIsOwner(false);
        setIsCheckingOwner(false);
        return;
      }

      try {
        const companyRef = doc(db, 'companies', selectedCompanyId);
        const companySnap = await getDoc(companyRef);
        
        setIsOwner(companySnap.exists() && companySnap.data()?.createdBy === user.uid);
      } catch (error) {
        console.error('Error checking owner status:', error);
        setIsOwner(false);
      } finally {
        setIsCheckingOwner(false);
      }
    };

    checkOwnerStatus();
  }, [selectedCompanyId, user?.uid]);

  return { isCheckingOwner, isOwner };
};