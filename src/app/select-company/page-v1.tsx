"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";

type Company = {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: any;
};

type MemberPermission = {
  companyId: string;
  allowedPages: string[];
};

export default function SelectCompanyPage() {
  const [ownedCompanies, setOwnedCompanies] = useState<Company[]>([]);
  const [sharedCompanies, setSharedCompanies] = useState<Company[]>([]);
  const [memberPermissions, setMemberPermissions] = useState<MemberPermission[]>([]);
  const [open, setOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<{id: string, name: string} | null>(null);
  const [editName, setEditName] = useState("");
  const { user } = useAuth();
  const { setSelectedCompany } = useCompany();
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{ name: string }>();
  const { toast } = useToast();

  useEffect(() => {
    if (user?.uid) {
      fetchCompanies();
    }
  }, [user]);

  const fetchCompanies = async () => {
    if (!user?.uid) return;

    const companiesRef = collection(db, "companies");

    // Fetch Owned Companies
    const ownedQuery = query(companiesRef, where("createdBy", "==", user.uid));
    const ownedSnap = await getDocs(ownedQuery);
    const owned = ownedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Company[];
    setOwnedCompanies(owned);

    // Fetch Shared Companies via companyMembers
    const membersRef = collection(db, "companyMembers");
    const memberQuery = query(membersRef, where("userId", "==", user.uid));
    const memberSnap = await getDocs(memberQuery);

    const companyIds = memberSnap.docs.map(doc => doc.data().companyId);
    const permissions: MemberPermission[] = memberSnap.docs.map(doc => ({
      companyId: doc.data().companyId,
      allowedPages: doc.data().allowedPages || []
    }));
    setMemberPermissions(permissions);

    // Fetch company data for each shared company
    const shared: Company[] = [];

    for (const companyId of companyIds) {
      const companyDoc = await getDoc(doc(db, "companies", companyId));
      if (companyDoc.exists()) {
        shared.push({ id: companyDoc.id, ...companyDoc.data() } as Company);
      }
    }

    setSharedCompanies(shared);
  };

  const handleSelect = (companyId: string, companyName: string) => {
    setSelectedCompany(companyId, companyName);
    
    // Check if user is owner
    const isOwner = ownedCompanies.some(c => c.id === companyId);
    if (isOwner) {
      router.push("/dashboard");
      return;
    }

    // For members, find their permissions
    const permission = memberPermissions.find(p => p.companyId === companyId);
    if (permission && permission.allowedPages.length > 0) {
      if(permission.allowedPages.find(page=> page === "dashboard")){
        router.push("/dashboard");
      }else{
        router.push(`/${permission.allowedPages[0]}`);
      }
    } else {
      router.push("/select-company");
      toast({
        title: "No Access",
        description: "You don't have access to any pages in this company",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (companyId: string) => {
    const confirmDelete = confirm("Are you sure you want to delete this company?");
    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "companies", companyId));
      await fetchCompanies();
      toast({
        title: "Success",
        description: "Company deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting company:", error);
      toast({
        title: "Error",
        description: "Failed to delete company",
        variant: "destructive",
      });
    }
  };

  const handleUpdateCompany = async () => {
    if (!editingCompany || !editName.trim()) return;

    try {
      await updateDoc(doc(db, "companies", editingCompany.id), {
        name: editName
      });
      await fetchCompanies();
      setEditingCompany(null);
      toast({
        title: "Success",
        description: "Company name updated successfully",
      });
    } catch (error) {
      console.error("Error updating company:", error);
      toast({
        title: "Error",
        description: "Failed to update company name",
        variant: "destructive",
      });
    }
  };

  const onCreateCompany = async (formData: { name: string }) => {
    if (!user?.uid) return;

    try {
      const companiesRef = collection(db, "companies");
      await addDoc(companiesRef, {
        name: formData.name,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      await fetchCompanies();
      reset();
      setOpen(false);
      toast({
        title: "Success",
        description: "Company created successfully",
      });
    } catch (error) {
      console.error("Error creating company:", error);
      toast({
        title: "Error",
        description: "Failed to create company",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold mr-8">Select a company</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Create Company</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new company</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onCreateCompany)} className="space-y-4">
              <Input
                type="text"
                placeholder="Company name"
                {...register("name", { required: true })}
              />
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* OWNED COMPANIES */}
      <h3 className="text-xl font-semibold mb-2">Your Companies</h3>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {ownedCompanies.map((company) => (
          <li
            key={company.id}
            className="relative border rounded-xl p-4 shadow hover:bg-gray-50 group"
          >
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingCompany({id: company.id, name: company.name});
                  setEditName(company.name);
                }}
                className="text-gray-600 opacity-0 group-hover:opacity-100 transition hover:text-blue-500"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(company.id);
                }}
                className="text-red-500 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {editingCompany?.id === company.id ? (
              <div className="flex flex-col gap-2 pt-4">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      handleUpdateCompany();
                    } else if(e.key === "Escape"){
                        e.stopPropagation();
                        setEditingCompany(null);
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                <Button 
                  size="sm" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateCompany();
                  }}
                  disabled={company.name === editName}
                >
                  Save
                </Button> 
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCompany(null);
                  }}
                >
                  Cancel
                </Button> 
                </div>
              </div>
            ) : (
              <div
                className="cursor-pointer"
                onClick={() => handleSelect(company.id, company.name)}
              >
                <h3 className="text-xl font-bold">{company.name}</h3>
                <p className="text-gray-600 mt-1">Owner</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* SHARED COMPANIES */}
      {sharedCompanies.length > 0 && (
        <>
          <h3 className="text-xl font-semibold mb-2">Shared With You</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sharedCompanies.map((company) => (
              <li
                key={company.id}
                className="border rounded-xl p-4 shadow hover:bg-gray-50 cursor-pointer"
                onClick={() => handleSelect(company.id, company.name)}
              >
                <h3 className="text-xl font-bold">{company.name}</h3>
                <p className="text-gray-600 mt-1">Member</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}