import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { db, serverTimestamp } from "@/lib/firebase";
import { addDoc, collection } from "firebase/firestore";

export const useAuditLog = () => {
  const { user } = useAuth();
  const { selectedCompanyId } = useCompany();

  const logAction = async (action: string, feature: string, changedFields: string[] = []) => {
    if (!user || !selectedCompanyId) return;
    
    try {
      await addDoc(collection(db, "auditLogs"), {
        companyId: selectedCompanyId,
        userId: user.uid,
        action,
        feature,
        changedFields,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error logging audit action:", error);
    }
  };

  return { logAction };
};