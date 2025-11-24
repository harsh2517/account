"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { 
  FileScan, 
  ReceiptText,
  PanelLeft,
  Zap,
  X,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  BookKey,
  House,
  Landmark
} from "lucide-react";
import AdCard from "@/components/ui/adcard";
import { cn } from "@/lib/utils";

export default function FreeLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePage, setActivePage] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  const navItems = [
    { id: 'home', title: 'Home', href: '/free', icon: House },
    { id: 'document-reader', title: 'Document Reader', href: '/free/document-reader', icon: FileScan },
    { id: 'transaction-categorization', title: 'Transaction Categorization', href: '/free/transaction-categorization', icon: Landmark },
  ];

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleNavigation = (href: string, id: string) => {
    setActivePage(id);
    router.push(href);
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className={`group bg-gray-50 border-r border-gray-200 shadow-sm transition-all duration-300 ${sidebarOpen ? 'w-fit' : 'w-20'}`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between p-4 ">
            {sidebarOpen ? (
              <Link href="/" className="flex items-center gap-2">
                <img src="/my-logo.svg" alt="Accountooze AI" className="h-8 w-auto" />
                <span className="font-semibold text-gray-800 text-nowrap">Accountooze AI</span>
              </Link>
            ) : (
              <Link href="/" className="flex justify-center group-hover:hidden">
                <img src="/my-logo.svg" alt="Accountooze AI" className="h-8 w-auto" />
              </Link>
              
            )}
          <button 
               onClick={toggleSidebar}
               className="hidden group-hover:block rounded-md p-2  mx-auto hover:bg-gray-100"
               >
               <PanelLeft className={`h-5 w-5 `} />
             </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 overflow-y-auto">
            <ul className="space-y-1">
              {navItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => handleNavigation(item.href, item.id)}
                    className={cn(`w-full flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors text-gray-700 hover:bg-gray-100`, pathname === item.href? "bg-gray-100": "" )}
                  >
                    <div>

                    <item.icon className={`h-5 w-5 ${sidebarOpen ? 'mr-3' : 'mx-auto'}`} />
                    </div>
                    {sidebarOpen && <span className="text-nowrap">{item.title}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

         {sidebarOpen && <AdCard className="border-0"/>}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="w-full  bg-gray-50">
      <div className="max-w-7xl mx-auto flex flex-col gap-4 items-center sm:flex-row justify-center sm:gap-8 px-4 py-2 text-sm font-medium">
        <Link
          href="https://accountooze.com" 
          target="_blank" 
          className="hover:text-primary transition flex items-center gap-2"
        >
          <CircleGauge className="h-5 w-5 "/> Hire a Human accountant
        </Link>
        <Link
          href="/pricing" 
          className="hover:text-primary transition flex items-center gap-2"
        >
          <BookKey className="h-5 w-5 "/> 
          Unlock the full Accountooze suite
        </Link>
      </div>
    </header>
        <main className="flex-1 overflow-auto p-3 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}