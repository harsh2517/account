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
  useSidebar
} from "@/components/ui/sidebar";
import { 
  Landmark, 
  BookText, 
  FileScan, 
  FileText, 
  ReceiptText, 
  FilePlus2, 
  LibraryBig, 
  FileSpreadsheet, 
  Users, 
  Scale, 
  FilePieChart,
  Settings,
  LayoutDashboard,
  PanelLeft,
  GripVertical,
  LogOut,
  ListChecks,
  UserPlus,
  Building2
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
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

const defaultNavItems = [
    { id: 'dashboard', title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { id: 'bank-transactions', title: 'Bank Transactions', href: '/bank-transactions', icon: Landmark },
    { id: 'sales-invoices', title: 'Sales Invoices', href: '/sales-invoices', icon: FileText },
    { id: 'purchases-bills', title: 'Purchases/Bills', href: '/purchases-bills', icon: ReceiptText },
    { id: 'contacts', title: 'Customers & Vendors', href: '/contacts', icon: Users },
    { id: 'journal-entry', title: 'Journal Entry', href: '/journal-entry', icon: FilePlus2 },
    { id: 'chart-of-accounts', title: 'Chart of Accounts', href: '/chart-of-accounts', icon: ListChecks },
    { id: 'document-reader', title: 'Document Reader', href: '/document-reader', icon: FileScan },
    { id: 'historical-reference-data', title: 'Historical Reference', href: '/historical-reference-data', icon: BookText },
    { id: 'all-transactions-ledger', title: 'General Ledger', href: '/all-transactions', icon: LibraryBig },
    { id: 'bank-reconciliation', title: 'Bank Reconciliation', href: '/bank-reconciliation', icon: Scale },
    { id: 'financial-reports', title: 'Financial Reports', href: '/financial-reports', icon: FileSpreadsheet },
    { id: 'management-reports', title: 'Management Reports', href: '/management-reports', icon: FilePieChart },
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
  
    if (!user) {
      return <Skeleton className="h-10 w-full" />;
    }
  
    return (
      <div className="w-full h-auto text-center font-semibold text-base py-2 px-2 flex flex-col items-center justify-center gap-2">
        {selectedCompanyName && (
          <span className="truncate max-w-[150px]">
            {selectedCompanyName}
          </span>
        )}
        <InviteToCompanyModal />
      </div>
    );
};

const defaultAllowedPages = [
  "dashboard",
  "sales-invoices",
  "bank-transactions",
  "all-transactions-ledger",
  "chart-of-accounts",
  "purchases-bills",
  "contacts",
  "journal-entry",
  "document-reader",
  "historical-reference-data",
  "bank-reconciliation",
  "financial-reports",
  "management-reports"
];

export const InviteToCompanyModal = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isCheckingOwner, setIsCheckingOwner] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { user } = useAuth();

  useEffect(() => {
    const checkOwnerStatus = async () => {
      if (!selectedCompanyId || !user?.uid) {
        setIsOwner(false);
        setIsCheckingOwner(false);
        return;
      }

      try {
        const companyRef = doc(db, "companies", selectedCompanyId);
        const companySnap = await getDoc(companyRef);
        
        setIsOwner(companySnap.exists() && companySnap.data()?.createdBy === user.uid);
      } catch (error) {
        console.error("Error checking owner status:", error);
        setIsOwner(false);
      } finally {
        setIsCheckingOwner(false);
      }
    };

    checkOwnerStatus();
  }, [selectedCompanyId, user]);

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
      // 1. Verify current user is company owner
      const companyRef = doc(db, "companies", selectedCompanyId);
      const companySnap = await getDoc(companyRef);
  
      if (!companySnap.exists() || companySnap.data()?.createdBy !== user.uid) {
        throw new Error("Only company owners can invite members");
      }
  
      // 2. Find invited user
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email), limit(1));
      const querySnapshot = await getDocs(q);
  
      if (querySnapshot.empty) {
        throw new Error("User not found");
      }
  
      const userData = querySnapshot.docs[0].data();
      const userId = userData.userId;
  
      // 3. Create member document with ALL required fields
      const memberId = `${selectedCompanyId}_${userId}`;
      await setDoc(doc(db, "companyMembers", memberId), {
        addedBy: user.uid, // MUST match current user
        allowedPages: selectedPages,
        companyId: selectedCompanyId, // MUST match the company being modified
        userId: userId,
        createdAt: serverTimestamp(),
        email: email
      });
      toast({
              title: "Invitation sent",
              description: `${email} has been added to your company.`,
            });
        
            // Reset form
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
        <Button variant="ghost" className="w-full justify-start">
          <UserPlus className="mr-2 h-4 w-4" />
          Invite to Company
        </Button>
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
      </DialogContent>
    </Dialog>
  );
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { hasAccess, checking } = usePagePermissionGuard();
    const { user, signOut } = useAuth();
    const [navItems, setNavItems] = useState(defaultNavItems);
    const [isBrowser, setIsBrowser] = useState(false);
    const { selectedCompanyId } = useCompany();

    useEffect(() => {
      async function filterSidebarItems() {
        setIsBrowser(true);
        if (!user?.uid || !selectedCompanyId) return;
    
        try {
          let filteredNavItems = defaultNavItems;
    
          // 1️⃣ First check if user is the company owner
          const companyDocRef = doc(db, "companies", selectedCompanyId);
          const companySnap = await getDoc(companyDocRef);
    
          const isOwner = companySnap.exists() && companySnap.data()?.createdBy === user.uid;
    
          if (!isOwner) {
            // 2️⃣ If not owner, check companyMembers for permissions
            const memberDocRef = doc(db, "companyMembers", `${selectedCompanyId}_${user.uid}`);
            const memberSnap = await getDoc(memberDocRef);
    
            if (memberSnap.exists()) {
              const allowedPages: string[] = memberSnap.data().allowedPages || [];
              filteredNavItems = defaultNavItems.filter(item => 
                allowedPages.includes(item.id)
              );
            } else {
              // 3️⃣ If not owner and not member, show nothing (or handle as you prefer)
              filteredNavItems = [];
            }
          }
    
          // 4️⃣ Apply user's sidebar order preferences
          const userDocRef = doc(db, "userDisplayPreferences", user.uid);
          const userSnap = await getDoc(userDocRef);
    
          if (userSnap.exists()) {
            const savedOrder = userSnap.data().sidebarOrder;
            if (Array.isArray(savedOrder)) {
              const itemMap = new Map(filteredNavItems.map(i => [i.id, i]));
              const ordered = savedOrder.map(id => itemMap.get(id)).filter(Boolean) as typeof defaultNavItems;
              const unordered = filteredNavItems.filter(item => !savedOrder.includes(item.id));
              filteredNavItems = [...ordered, ...unordered];
            }
          }
    
          setNavItems(filteredNavItems);
        } catch (error) {
          console.error("Error filtering sidebar items:", error);
          // Fallback to empty or default items if needed
          setNavItems([]);
        }
      }
    
      filterSidebarItems();
    }, [user, selectedCompanyId]);
    const handleOnDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const items = Array.from(navItems);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setNavItems(items);
        if (user) {
            const userDocRef = doc(db, "userDisplayPreferences", user.uid);
            const newOrderIds = items.map(item => item.id);
            setDoc(userDocRef, { sidebarOrder: newOrderIds }, { merge: true });
        }
    };

    
  if (checking) {
    return <LoadingSpinner />
  }

  if (!hasAccess) {
    return null; 
  }

    const handleSignOut = async () => {
        await signOut();
    };

    const renderStaticMenu = () => (
      <SidebarMenu>
          {navItems.map((item) => (
              <SidebarMenuItem key={item.id}>
                  <Link href={item.href}>
                      <SidebarMenuButton tooltip={item.title}>
                          <item.icon/>
                          <span>{item.title}</span>
                      </SidebarMenuButton>
                  </Link>
              </SidebarMenuItem>
          ))}
      </SidebarMenu>
    );

    const renderDraggableMenu = () => (
      <DragDropContext onDragEnd={handleOnDragEnd}>
        <Droppable droppableId="sidebar-nav">
          {(provided) => (
            <SidebarMenu ref={provided.innerRef} {...provided.droppableProps}>
              {navItems.map((item, index) => (
                <Draggable key={item.id} draggableId={item.id} index={index}>
                  {(provided) => (
                    <SidebarMenuItem
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className="flex items-center group/menu-item"
                    >
                      <span {...provided.dragHandleProps} className="cursor-grab p-2 text-muted-foreground/60 hover:text-muted-foreground transition-colors group-data-[collapsible=icon]:hidden">
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <Link href={item.href} className="flex-grow min-w-0">
                        <SidebarMenuButton tooltip={item.title}>
                          <item.icon/>
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </Link>
                    </SidebarMenuItem>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </SidebarMenu>
          )}
        </Droppable>
      </DragDropContext>
    );

    return (
        <SidebarProvider>
            <div className="flex min-h-screen">
                <Sidebar side="left" collapsible="icon">
                    <SidebarHeader>
                        <UserHeader />
                    </SidebarHeader>
                    <SidebarContent>
                        {isBrowser ? renderDraggableMenu() : renderStaticMenu()}
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
                                <Link href="/profile">
                                  <SidebarMenuButton tooltip="Profile Settings">
                                      <Settings/>
                                      <span>Profile Settings</span>
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