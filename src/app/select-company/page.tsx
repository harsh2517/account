
"use client"

import { Users, Pencil, Trash2, Plus, Search } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
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
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/context/AuthContext"
import { useCompany } from "@/context/CompanyContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useForm } from "react-hook-form"
import { useToast } from "@/hooks/use-toast"
import Sidebar from "@/components/global/sidebar"

type Company = {
  id: string
  name: string
  createdBy: string
  createdAt?: any
}

type MemberPermission = {
  companyId: string
  allowedPages: string[]
}

export default function Home() {
  const [ownedCompanies, setOwnedCompanies] = useState<Company[]>([])
  const [sharedCompanies, setSharedCompanies] = useState<Company[]>([])
  const [memberPermissions, setMemberPermissions] = useState<MemberPermission[]>([])
  const [companyView, setCompanyView] = useState<"my" | "shared">("my")
  const [open, setOpen] = useState(false)
  const [editingCompany, setEditingCompany] = useState<{ id: string; name: string } | null>(null)
  const [editName, setEditName] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  const { user } = useAuth()
  const { setSelectedCompany } = useCompany()
  const router = useRouter()
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<{ name: string }>()
  const { toast } = useToast()

  useEffect(() => {
    if (user?.uid) {
      fetchCompanies()
    }
  }, [user])

  const fetchCompanies = async () => {
    if (!user?.uid) return

    const companiesRef = collection(db, "companies")

    // Fetch Owned Companies
    const ownedQuery = query(companiesRef, where("createdBy", "==", user.uid))
    const ownedSnap = await getDocs(ownedQuery)
    const owned = ownedSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Company[]
    setOwnedCompanies(owned)

    // Fetch Shared Companies via companyMembers
    const membersRef = collection(db, "companyMembers")
    const memberQuery = query(membersRef, where("userId", "==", user.uid))
    const memberSnap = await getDocs(memberQuery)
    const companyIds = memberSnap.docs.map((doc) => doc.data().companyId)

    const permissions: MemberPermission[] = memberSnap.docs.map((doc) => ({
      companyId: doc.data().companyId,
      allowedPages: doc.data().allowedPages || [],
    }))
    setMemberPermissions(permissions)

    // Fetch company data for each shared company
    const shared: Company[] = []
    for (const companyId of companyIds) {
      const companyDoc = await getDoc(doc(db, "companies", companyId))
      if (companyDoc.exists()) {
        shared.push({ id: companyDoc.id, ...companyDoc.data() } as Company)
      }
    }
    setSharedCompanies(shared)
  }

  const handleSelect = (companyId: string, companyName: string) => {
    setSelectedCompany(companyId, companyName)
    const isOwner = ownedCompanies.some((c) => c.id === companyId)
    if (isOwner) {
      router.push("/dashboard")
      return
    }

    const permission = memberPermissions.find((p) => p.companyId === companyId)
    if (permission && permission.allowedPages.length > 0) {
      if (permission.allowedPages.find((page) => page === "dashboard")) {
        router.push("/dashboard")
      } else {
        router.push(`/${permission.allowedPages[0]}`)
      }
    } else {
      router.push("/select-company")
      toast({
        title: "No Access",
        description: "You don't have access to any pages in this company",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (companyId: string) => {
    const confirmDelete = confirm("Are you sure you want to delete this company?")
    if (!confirmDelete) return

    try {
      await deleteDoc(doc(db, "companies", companyId))
      await fetchCompanies()
      toast({
        title: "Success",
        description: "Company deleted successfully",
      })
    } catch (error) {
      console.error("Error deleting company:", error)
      toast({
        title: "Error",
        description: "Failed to delete company",
        variant: "destructive",
      })
    }
  }

  const handleUpdateCompany = async () => {
    if (!editingCompany || !editName.trim()) return

    try {
      await updateDoc(doc(db, "companies", editingCompany.id), {
        name: editName,
      })
      await fetchCompanies()
      setEditingCompany(null)
      toast({
        title: "Success",
        description: "Company name updated successfully",
      })
    } catch (error) {
      console.error("Error updating company:", error)
      toast({
        title: "Error",
        description: "Failed to update company name",
        variant: "destructive",
      })
    }
  }

  const onCreateCompany = async (formData: { name: string }) => {
    if (!user?.uid) return

    try {
      const companiesRef = collection(db, "companies")
      await addDoc(companiesRef, {
        name: formData.name,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      })

      await fetchCompanies()
      reset()
      setOpen(false)
      toast({
        title: "Success",
        description: "Company created successfully",
      })
    } catch (error) {
      console.error("Error creating company:", error)
      toast({
        title: "Error",
        description: "Failed to create company",
        variant: "destructive",
      })
    }
  }

  const displayedCompanies = useMemo(() => {
    const companies = companyView === "my" ? ownedCompanies : sharedCompanies
    if (!searchTerm) return companies
    return companies.filter(company => company.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [companyView, ownedCompanies, sharedCompanies, searchTerm])

  return (
    <div className="w-dvw h-dvh">
      <div className="flex h-full">
        <Sidebar />
        <div className="p-6 w-full overflow-y-auto flex flex-col gap-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-3xl font-semibold mr-8">Select a company</h2>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Company
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a new company</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onCreateCompany)} className="space-y-4">
                  <Input type="text" placeholder="Company name" {...register("name", { required: true })} />
                  <DialogFooter>
                    <Button type="submit" disabled={isSubmitting}>
                      Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="mb-4">
            <div className="flex border-b">
              <button
                className={`p-3 px-4 text-sm font-medium transition-colors ${
                  companyView === "my"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-primary"
                }`}
                onClick={() => setCompanyView("my")}
              >
                My Companies
              </button>
              <button
                className={`p-3 px-4 text-sm font-medium transition-colors ${
                  companyView === "shared"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-primary"
                }`}
                onClick={() => setCompanyView("shared")}
              >
                Shared With Me
              </button>
            </div>
          </div>

          <div className="relative w-full max-w-lg mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="Search companies..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            {displayedCompanies.map((company) => (
              <div
                key={company.id}
                className="group flex items-center justify-between border rounded-lg p-2 hover:bg-muted/50 transition-colors"
              >
                {editingCompany?.id === company.id ? (
                  <div className="flex-1 flex gap-2 items-center">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 h-8"
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === "Enter") handleUpdateCompany()
                        else if (e.key === "Escape") setEditingCompany(null)
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
                  <>
                    <div className="flex-1 cursor-pointer" onClick={() => handleSelect(company.id, company.name)}>
                      <h3 className="text-md font-semibold">{company.name}</h3>
                    </div>
                    {companyView === "my" && (
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => {
                            setEditingCompany({ id: company.id, name: company.name })
                            setEditName(company.name)
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => handleDelete(company.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
