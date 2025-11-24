

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useCompany } from "@/context/CompanyContext";

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  type: string;
  subType: string;
  fs: string;
  accountNumber: string;
  companyId: string;
}

export default function ChartOfAccountsPage() {
  return (
    <div>
      <ChartOfAccountsModal />
    </div>
  );
}


function ChartOfAccountsModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
    
  const { selectedCompanyId } = useCompany();

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    
    setIsFetching(true);
    try {
      const q = query(
        collection(db, "chartOfAccounts"),
        where("companyId", "==", selectedCompanyId)
      );
      const querySnapshot = await getDocs(q);
      const accounts: ChartOfAccountItem[] = [];
      
      querySnapshot.forEach((doc) => {
        accounts.push({
          id: doc.id,
          glAccount: doc.data().glAccount,
          type: doc.data().type,
          subType: doc.data().subType,
          fs: doc.data().fs,
          accountNumber: doc.data().accountNumber,
          companyId: doc.data().companyId
        });
      });

      // Sort by account number if available, otherwise by GL account name
      accounts.sort((a, b) => {
        if (a.accountNumber && b.accountNumber) {
          return a.accountNumber.localeCompare(b.accountNumber);
        }
        return a.glAccount.localeCompare(b.glAccount);
      });

      setChartOfAccounts(accounts);
    } catch (error) {
      console.error("Error fetching chart of accounts:", error);
      toast({
        title: "Error",
        description: "Could not fetch chart of accounts",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (isOpen) {
      fetchChartOfAccounts();
    }
  }, [isOpen, fetchChartOfAccounts]);

  const filteredAccounts = chartOfAccounts.filter(account =>
    account.glAccount.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.subType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.accountNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          View Chart of Accounts
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Chart of Accounts</DialogTitle>
        </DialogHeader>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search accounts..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-auto">
          {isFetching ? (
            <div className="flex justify-center items-center h-full">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Account #</TableHead>
                  <TableHead>GL Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Sub Type</TableHead>
                  <TableHead>Financial Statement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.length > 0 ? (
                  filteredAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.accountNumber}</TableCell>
                      <TableCell>{account.glAccount}</TableCell>
                      <TableCell>{account.type}</TableCell>
                      <TableCell>{account.subType}</TableCell>
                      <TableCell>{account.fs}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      {chartOfAccounts.length === 0 
                        ? "No accounts found in your chart of accounts." 
                        : "No accounts match your search."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}