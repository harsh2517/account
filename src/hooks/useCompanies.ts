import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
  } from 'firebase/firestore';
  import { useEffect, useState } from 'react';
  import { db } from '@/lib/firebase';
  import { getAuth } from 'firebase/auth';
  
  function useCompanies() {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const user = getAuth().currentUser;
  
    useEffect(() => {
      if (!user) return;
  
      const fetchCompanies = async () => {
        try {
          const createdByQuery = query(
            collection(db, 'companies'),
            where('createdBy', '==', user.uid)
          );
  
          const createdBySnapshot = await getDocs(createdByQuery);
          const ownedCompanies = createdBySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
          }));
  
          // Now check all companies where user is a member
          const companiesCol = await getDocs(collection(db, 'companies'));
          const memberCompanies = [];
  
          for (const companyDoc of companiesCol.docs) {
            const memberRef = doc(
              db,
              'companies',
              companyDoc.id,
              'companyMembers',
              user.uid
            );
            const memberSnap = await getDoc(memberRef);
            if (memberSnap.exists()) {
              memberCompanies.push({
                id: companyDoc.id,
                ...companyDoc.data(),
              });
            }
          }
  
          // Combine and remove duplicates (if user is both creator & member)
          const allCompanies = [
            ...ownedCompanies,
            ...memberCompanies.filter(
              mc => !ownedCompanies.some(oc => oc.id === mc.id)
            ),
          ];
  
          setCompanies(allCompanies);
        } catch (error) {
          console.error('Error fetching companies:', error);
        } finally {
          setLoading(false);
        }
      };
  
      fetchCompanies();
    }, [user]);
  
    return { companies, loading };
  }
  