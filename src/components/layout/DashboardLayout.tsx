
"use client";

import Link from "next/link";
import { 
  SidebarProvider, 
  Sidebar, 
  SidebarMenu, 
  SidebarMenuItem, 
  SidebarMenuButton, 
  SidebarHeader, 
  SidebarContent, 
  SidebarInset,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { 
  Settings,
  PanelLeft,
  LogOut,
  UserPlus,
  Building2,
  ChevronRight,
  Users
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, doc, getDoc, setDoc, query, getDocs, where, serverTimestamp, limit } from "firebase/firestore";
import { Skeleton } from "../ui/skeleton";
import { useRouter } from "next/navigation";
import { useCompany } from "@/context/CompanyContext";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { usePagePermissionGuard } from "@/hooks/usePagePermissionGaurd";
import LoadingSpinner from "../ui/loading-spinner";
import { usePlanCheck } from '@/hooks/usePlanCheck';
import { useCompanyOwnerStatus } from '@/hooks/useCompanyOwnerStatus';
import { defaultAllowedPages } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const defaultNavItems = [
    { id: 'dashboard', title: 'Dashboard', href: '/dashboard', icon: ChevronRight },
    { id: 'document-reader', title: 'Document Reader', href: '/document-reader', icon: ChevronRight },
    {
      id: 'transactions',
      title: 'Transactions',
      icon: ChevronRight,
      subItems: [
        { id: 'bank-transactions', title: 'Bank Transactions', href: '/bank-transactions', icon: ChevronRight },
        { id: 'sales-invoices', title: 'Sales Invoices', href: '/sales-invoices', icon: ChevronRight },
        { id: 'purchases-bills', title: 'Purchases/Bills', href: '/purchases-bills', icon: ChevronRight },
        { id: 'journal-entry', title: 'Journal Entry', href: '/journal-entry', icon: ChevronRight },
      ]
    },
    {
      id: 'setup',
      title: 'Setup',
      icon: ChevronRight,
      subItems: [
        { id: 'chart-of-accounts', title: 'Chart of Accounts', href: '/chart-of-accounts', icon: ChevronRight },
        { id: 'historical-reference-data', title: 'Historical Reference', href: '/historical-reference-data', icon: ChevronRight },
        { id: 'contacts', title: 'Customers & Vendors', href: '/contacts', icon: ChevronRight },
      ]
    },
    {
      id: 'reports',
      title: 'Reports',
      icon: ChevronRight,
      subItems: [
        { id: 'financial-reports', title: 'Financial Reports', href: '/financial-reports', icon: ChevronRight },
        { id: 'all-transactions-ledger', title: 'General Ledger', href: '/all-transactions', icon: ChevronRight },
        { id: 'management-reports', title: 'Management Reports', href: '/management-reports', icon: ChevronRight },
        { id: 'bank-reconciliation', title: 'Bank Reconciliation', href: '/bank-reconciliation', icon: ChevronRight },
      ]
    }
];

const SidebarCollapseButton = () => {
    const { toggleSidebar, state } = useSidebar();
    const tooltipText = state === 'collapsed' ? 'Expand Sidebar' : 'Collapse Sidebar';

    return (
        <SidebarMenuItem className="hidden md:block">
            <SidebarMenuButton onClick={toggleSidebar} tooltip={tooltipText}>
                <PanelLeft />
                <span>Collapse</span>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
};

const UserHeader = () => {
    const { user } = useAuth();
    const { selectedCompanyName } = useCompany();
    const { isOwner, isCheckingOwner} = useCompanyOwnerStatus();
    const { state } = useSidebar();
  
    if (!user) {
      return <Skeleton className="h-10 w-full" />;
    }
  
  const getCompanyInitials = () => {
    if (!selectedCompanyName) return "";
    return selectedCompanyName
      .split(" ")
      .map(word => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

    return (
      <div className="w-full h-auto text-center font-semibold text-base py-2 flex flex-col items-center justify-center gap-1">
        {selectedCompanyName && (
          <>
          {state === 'collapsed' ? (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium">
              {getCompanyInitials()}
            </div>
          ) : (
            <span className="truncate max-w-[150px]">
              {selectedCompanyName}
            </span>
          )}
        </>
        )}

        <div className="w-full flex flex-col items-center gap-1">
        <InviteToCompanyModal isCollapsed={state === 'collapsed'} />
        {isOwner && (
          <Link 
            className={`flex items-center gap-2 w-full text-sm font-normal h-8 hover:bg-sidebar-accent rounded-md ${state === 'collapsed' ? 'justify-center' : ''}`}  
            href="/members"
          >
             <SidebarMenuButton tooltip="Members">

            <Users className="h-4 w-4"/>
            {state !== 'collapsed' && <span>Members</span>}
             </SidebarMenuButton>
          </Link>
        )}
      </div>
      </div>
    );
};

export const InviteToCompanyModal = ({ isCollapsed }: { isCollapsed?: boolean }) => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const { selectedCompanyId, selectedCompanyName } = useCompany();

  const { user } = useAuth();
  const { isOwner, isCheckingOwner} = useCompanyOwnerStatus();

  if (isCheckingOwner) {
    return null; 
  }

  if (!isOwner) {
    return null;
  }
  
const handleSend = async () => {
  if (!email || !selectedCompanyId || !user) return;
  
  setIsLoading(true);
  try {
    const companyRef = doc(db, "companies", selectedCompanyId);
    const companySnap = await getDoc(companyRef);

    if (!companySnap.exists() || companySnap.data()?.createdBy !== user.uid) {
      throw new Error("Only company owners can invite members");
    }

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", email), limit(1));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error("User not found");
    }

    const userData = querySnapshot.docs[0].data();
    const userId = userData.userId;
    const displayName = userData.displayName;

    const memberId = `${selectedCompanyId}_${userId}`;
    await setDoc(doc(db, "companyMembers", memberId), {
      addedBy: user.uid,
      allowedPages: selectedPages,
      companyId: selectedCompanyId,
      userId: userId,
      createdAt: serverTimestamp(),
      email: email,
      displayName: displayName,
    });

    const response = await fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        companyName: selectedCompanyName || "a company",
        inviterName: user.displayName || "a colleague"
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send invitation email");
    }

    toast({
      title: "Invitation sent",
      description: `${email} has been invited to your company.`,
    });

    setEmail("");
    setSelectedPages([]);
    setSelectAll(false);
  } catch (error) {
    console.error("Invite failed:", error);
    toast({
      title: "Error",
      description: error.message || "Failed to send invitation",
      variant: "destructive",
    });
  } finally {
    setIsLoading(false);
  }
};


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend();
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

  return (
    <Dialog>
      <DialogTrigger asChild>
   
      <SidebarMenuButton tooltip="Invite to Company" className={`flex items-center gap-2 w-full  text-sm font-normal h-8 hover:bg-sidebar-accent rounded-md ${isCollapsed ? 'justify-center' : ''}`}>
          <UserPlus className="h-4 w-4" />
          {!isCollapsed && <span>Invite to Company</span>}
        </SidebarMenuButton>
      
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Invite to Company</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-3 items-center gap-4">
            <div className="col-span-3 flex gap-2">
              <Input
                id="email"
                type="email"
                placeholder="Enter email, e.g. user@example.com"
                className="col-span-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button onClick={handleSend} disabled={isLoading || !email}>
                {isLoading ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 items-start gap-4">
            <div className="col-span-3 space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="select-all"
                  checked={selectAll}
                  onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
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
      </DialogContent>
    </Dialog>
  );
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { hasAccess, checking } = usePagePermissionGuard();
    const { user, signOut } = useAuth();
    const [navItems, setNavItems] = useState(defaultNavItems);
    const { selectedCompanyId } = useCompany();
    const { hasPlan, loading: planLoading } = usePlanCheck();


    useEffect(() => {
      async function filterSidebarItems() {
        if (!user?.uid || !selectedCompanyId) return;
    
        try {
          let allowedNavItems = defaultNavItems;
    
          const companyDocRef = doc(db, "companies", selectedCompanyId);
          const companySnap = await getDoc(companyDocRef);
    
          const isOwner = companySnap.exists() && companySnap.data()?.createdBy === user.uid;
    
          if (!isOwner) {
            const memberDocRef = doc(db, "companyMembers", `${selectedCompanyId}_${user.uid}`);
            const memberSnap = await getDoc(memberDocRef);
    
            if (memberSnap.exists()) {
              const allowedPages: string[] = memberSnap.data().allowedPages || [];
              allowedNavItems = defaultNavItems.map(item => {
                if (item.subItems) {
                  const allowedSubItems = item.subItems.filter(subItem => allowedPages.includes(subItem.id));
                  if (allowedSubItems.length > 0) {
                    return { ...item, subItems: allowedSubItems };
                  }
                  return null; 
                }
                return allowedPages.includes(item.id) ? item : null;
              }).filter(Boolean) as typeof defaultNavItems;
            } else {
              allowedNavItems = [];
            }
          }
    
          setNavItems(allowedNavItems);
        } catch (error) {
          console.error("Error filtering sidebar items:", error);
          setNavItems([]);
        }
      }
    
      filterSidebarItems();
    }, [user, selectedCompanyId]);
    
  if (checking || planLoading) {
    return <LoadingSpinner />
  }

  if (!hasAccess || hasPlan === false) {
    return null; 
  }

    const handleSignOut = async () => {
        await signOut();
    };

    const renderMenu = () => (
      <Accordion type="multiple" className="w-full">
        {navItems.map((item) => {
          if (item.subItems && item.subItems.length > 0) {
            return (
              <AccordionItem value={item.id} key={item.id} className="border-none">
                 <AccordionTrigger className="py-2 hover:no-underline flex items-center gap-2 w-full text-sm font-normal h-8 hover:bg-sidebar-accent rounded-md px-2">
                    <ChevronRight className="h-4 w-4" />
                    <span>{item.title}</span>
                </AccordionTrigger>
                <AccordionContent className="pl-6">
                  <SidebarMenu>
                    {item.subItems.map(subItem => (
                      <SidebarMenuItem key={subItem.id}>
                          <Link href={subItem.href || '#'} className="w-full">
                              <SidebarMenuButton className="h-8" tooltip={subItem.title}>
                                  <subItem.icon/>
                                  <span>{subItem.title}</span>
                              </SidebarMenuButton>
                          </Link>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </AccordionContent>
              </AccordionItem>
            );
          }
          return (
            <SidebarMenuItem key={item.id}>
                <Link href={item.href || '#'} className="w-full">
                    <SidebarMenuButton tooltip={item.title}>
                        <item.icon/>
                        <span>{item.title}</span>
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
          );
        })}
      </Accordion>
    );

    return (
        <SidebarProvider>
            <div className="flex min-h-screen w-dvw">
                <Sidebar side="left" collapsible="icon">
                    <SidebarHeader>
                        <UserHeader />
                    </SidebarHeader>
                    <SidebarContent className="p-2">
                        {renderMenu()}
                    </SidebarContent>
                    <SidebarFooter>
                        <SidebarMenu>
                          <SidebarMenuItem>
                              <Link href="/select-company">
                                <SidebarMenuButton tooltip="Profile Settings">
                                  <Building2/>
                                  <span>Companies</span>
                                </SidebarMenuButton>
                              </Link>
                          </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton onClick={handleSignOut} tooltip="Log Out">
                                    <LogOut/>
                                    <span>Log Out</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarCollapseButton />
                        </SidebarMenu>
                    </SidebarFooter>
                </Sidebar>
                <SidebarInset className="flex-1 flex flex-col">
                    {children}
                </SidebarInset>
            </div>
        </SidebarProvider>
    );
}
