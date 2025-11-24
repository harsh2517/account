"use client"
import { useState, useEffect } from "react";
import { collection, query, where, getDocs, getDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCompany } from "@/context/CompanyContext"; 

import { useToast } from "@/hooks/use-toast";

import AuthGuard from "@/components/auth/AuthGuard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Ellipsis } from 'lucide-react';
import { format } from "date-fns";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "@/components/ui/alert-dialog";
  import { defaultAllowedPages } from "@/lib/constants";

  import {
      Dialog,
      DialogTrigger,
      DialogContent,
      DialogHeader,
      DialogTitle,
    } from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Pencil, Trash2 } from 'lucide-react';
import { useAuth } from "@/context/AuthContext";
import { useCompanyOwnerStatus } from '@/hooks/useCompanyOwnerStatus';

export default function Members() {
    const { selectedCompanyId } = useCompany();
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { isOwner, isCheckingOwner} = useCompanyOwnerStatus();


    
    useEffect(() => {
      fetchMembers();
  }, [selectedCompanyId]);

    const fetchMembers = async () => {
        if (!selectedCompanyId) return;
        
        try {
            setLoading(true);
            const membersRef = collection(db, "companyMembers");
            const memberQuery = query(membersRef, where("companyId", "==", selectedCompanyId));
            const memberSnap = await getDocs(memberQuery);
            
            const membersData = memberSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() 
            }));
            
            setMembers(membersData);
            setLoading(false);
        } catch (err) {
            setError(err.message);
            setLoading(false);
            console.error("Error fetching members:", err);
        }
    };


    if (loading) {
        return (
            <AuthGuard>
                <header className="px-6 py-4 flex items-center justify-between w-full border-b">
                    <h1 className="text-2xl font-bold font-headline">Members</h1>
                    <div className="md:hidden">
                        <SidebarTrigger />
                    </div>
                </header>
                <main className="p-6">
                    <p>Loading members...</p>
                </main>
            </AuthGuard>
        );
    }

    if (error) {
        return (
            <AuthGuard>
                <header className="px-6 py-4 flex items-center justify-between w-full border-b">
                    <h1 className="text-2xl font-bold font-headline">Members</h1>
                    <div className="md:hidden">
                        <SidebarTrigger />
                    </div>
                </header>
                <main className="p-6">
                    <p className="text-red-500">Error: {error}</p>
                </main>
            </AuthGuard>
        );
    }
    if (isCheckingOwner) {
        return null; 
    }
    
    if (!isOwner) {
     return null;
    }
    return ( 
        <AuthGuard>
            <header className="px-6 py-4 flex items-center justify-between w-full border-b">
                <h1 className="text-2xl font-bold font-headline">
                    Members
                </h1>
                <div className="md:hidden">
                    <SidebarTrigger />
                </div>
            </header>
            <main className="p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 w-full gap-4 overflow-x-hidden">
                {members.length > 0 ? (
                    members.map((member) => (
                        <MemberCard key={member.id} member={member} onFetchMembers={fetchMembers} />
                    ))
                ) : (
                    <p>No members found for this company.</p>
                )}
            </main>
        </AuthGuard>
    );
}

function MemberCard({ member, onFetchMembers }) {
    const { selectedCompanyId } = useCompany();
    const { user } = useAuth();
    
    const { toast } = useToast();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
    const [selectedPages, setSelectedPages] = useState<string[]>(member.allowedPages || []);
    const [selectAll, setSelectAll] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);


    useEffect(() => {
        setSelectedPages(member.allowedPages || []);
        setSelectAll(member.allowedPages?.length === defaultAllowedPages.length);
      }, [member]);


    const handleUpdate = async () => {
    if (!member.userId || !selectedCompanyId ) return;
    
    setIsUpdating(true);
    try {
        const memberId = `${member.companyId}_${member.userId}`;
        await updateDoc(doc(db, "companyMembers", memberId), {
        allowedPages: selectedPages,
        });

        toast({
        title: "Success",
        description: `${member.displayName}'s permissions have been updated.`,
        });
        onFetchMembers?.();
        setIsUpdateDialogOpen(false);
    } catch (error) {
        console.error("Error updating member:", error);
        toast({
        title: "Error",
        description: "Failed to update member permissions",
        variant: "destructive",
        });
    } finally {
        setIsUpdating(false);
    }
    };

    const togglePage = (page: string) => {
    setSelectedPages(prev =>
        prev.includes(page)
        ? prev.filter(p => p !== page)
        : [...prev, page]
    );
    };
  
    const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    setSelectedPages(checked ? [...defaultAllowedPages] : []);
    };

    const handleDelete = async () => {
        if (!member.userId || !selectedCompanyId) {
          toast({
            title: "Error",
            description: "Missing required information",
            variant: "destructive",
          });
          return;
        }
      
        setIsDeleting(true);
        
        try {
          const memberId = `${selectedCompanyId}_${member.userId}`;
          const memberDocRef = doc(db, "companyMembers", memberId);
          await deleteDoc(memberDocRef);
          onFetchMembers?.();

          toast({
            title: "Success",
            description: `${member.displayName} has been removed.`,
          });
      
        } catch (error) {
          console.error("Detailed error:", {
            message: error?.message,
            code: error?.code, 
            stack: error?.stack
          });
      
          toast({
            title: "Error",
            description: error.message || "Failed to remove member",
            variant: "destructive",
          });
        } finally {
          setIsDeleting(false);
          setIsDeleteDialogOpen(false);
        }
      };
  
    return (
        <div className="p-4 border border-gray-400/20 rounded-sm">
        <div className="flex gap-4 items-center mb-2">
          <Avatar className="h-12 w-12">
            <AvatarFallback>
              {member.displayName?.charAt(0) || member.email?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h6 className="font-medium leading-none">{member.displayName}</h6>
            <small>{member.email}</small>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 w-7 flex justify-center items-center hover:shadow-md rounded-md">
                <Ellipsis className="h-4 w-4"/>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setIsUpdateDialogOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                <span>Update</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setIsDeleteDialogOpen(true)}
                className="text-red-600 hover:text-gray-100"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Remove</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
  
        {/* Current Allowed Pages (Tabs style) */}
        <div className="mb-2">
          <div className="text-sm font-semibold text-gray-700 mb-1">Allowed Pages</div>
          <div className="grid grid-cols-2 gap-2">
            {member.allowedPages?.map((page) => (
              <p 
                 key={page} 
                 className="bg-gray-50 text-gray-800 px-2 py-1 rounded-full text-xs font-medium text-center text-nowrap capitalize"
             >
                 {page.replace(/-/g, ' ')}
               </p>
            ))}
           </div>
        </div>
  
        <div className="text-xs text-gray-500">
          Added on: {format(member.createdAt, 'dd MMMM yyyy')}
        </div>
  
        {/* Update Permissions Dialog */}
        <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Update {member.displayName}'s Permissions</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-3 items-center gap-4">
                <div className="col-span-3">
                  <Input
                    id="email"
                    value={member.email}
                    disabled
                    className="col-span-2"
                  />
                </div>
              </div>
  
              <div className="grid grid-cols-3 items-start gap-4">
                <div className="col-span-3 space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="select-all"
                      checked={selectAll}
                      onCheckedChange={handleSelectAll}
                    />
                    <Label htmlFor="select-all">Select All Pages</Label>
                  </div>
  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {defaultAllowedPages.map((page) => (
                      <div key={page} className="flex items-center space-x-2">
                        <Checkbox
                          id={page}
                          checked={selectedPages.includes(page)}
                          onCheckedChange={() => togglePage(page)}
                        />
                        <Label htmlFor={page} className="capitalize">
                          {page.replace(/-/g, ' ')}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                onClick={() => setIsUpdateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleUpdate}
                disabled={isUpdating}
              >
                {isUpdating ? "Updating..." : "Update Permissions"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
  
        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently remove {member.displayName} from your company.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
  
      </div>
    );
  }