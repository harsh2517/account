
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Banknote, CalendarIcon, Scale } from "lucide-react";
import Link from "next/link";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";

// interface ChartOfAccountItem {
//   id: string;
//   glAccount: string;
//   type: string;
// }


interface ChartOfAccountItem {
  id: string;
  companyId: string;
  createdBy: string;
  updatedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  glAccount: string;
  subType: string;
  type: string;
  accountNumber?: string;
}

export default function BankReconciliationPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetching, setIsFetching] = useState(true);

  const [selectedBankGL, setSelectedBankGL] = useState<string>("");
  const [statementDate, setStatementDate] = useState<Date | undefined>(new Date());
  const [statementEndingBalance, setStatementEndingBalance] = useState<string>("");
  const [reconciliationStarted, setReconciliationStarted] = useState(false);

  const { selectedCompanyId } = useCompany();

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const coa: ChartOfAccountItem[] = [];
      querySnapshot.forEach(doc => coa.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, 'id'>) }));
      setChartOfAccounts(coa.sort((a, b) => a.glAccount.localeCompare(b.glAccount)));
    } catch (error) {
      console.error("Error fetching chart of accounts:", error);
      toast({ title: "CoA Error", description: "Could not fetch Chart of Accounts.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, toast, selectedCompanyId]);

  useEffect(() => {
    if (user) {
      fetchChartOfAccounts();
    }
  }, [user, fetchChartOfAccounts, selectedCompanyId]);
  
  const bankGLAccounts = useMemo(() => {
    return chartOfAccounts.filter(acc => acc.type.toLowerCase().includes("asset"));
  }, [chartOfAccounts]);

  const handleStartReconciliation = () => {
    if (!selectedBankGL || !statementDate || !statementEndingBalance) {
      toast({
        title: "Missing Information",
        description: "Please select a bank account, statement date, and enter the ending balance.",
        variant: "destructive"
      });
      return;
    }
    setReconciliationStarted(true);
    // In the next step, this is where we will fetch transactions
    toast({ title: "Reconciliation Started", description: `Ready to reconcile ${selectedBankGL} as of ${format(statementDate, "MM/dd/yyyy")}.` });
  };

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <Scale className="mr-3 h-10 w-10 text-primary" />
              Bank Reconciliation
            </h1>
            <p className="text-lg text-muted-foreground">
              Match your bank statement with your books.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </header>

        <Card className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle>Reconciliation Setup</CardTitle>
            <CardDescription>
              Select the bank account and enter details from your bank statement.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label htmlFor="bank-gl-select" className="text-sm font-medium">Bank GL Account *</label>
              <Select
                value={selectedBankGL}
                onValueChange={setSelectedBankGL}
                disabled={isFetching || reconciliationStarted}
              >
                <SelectTrigger id="bank-gl-select" className="mt-1">
                  <SelectValue placeholder={isFetching ? "Loading..." : "Select a bank account"} />
                </SelectTrigger>
                <SelectContent>
                  {bankGLAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.glAccount}>{acc.glAccount}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
                <label htmlFor="statement-date" className="text-sm font-medium">Statement Date *</label>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            id="statement-date"
                            variant={"outline"}
                            className={cn("w-full justify-start text-left font-normal mt-1", !statementDate && "text-muted-foreground")}
                            disabled={reconciliationStarted}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {statementDate ? format(statementDate, "MM/dd/yyyy") : <span>Pick a date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={statementDate} onSelect={setStatementDate} initialFocus /></PopoverContent>
                </Popover>
            </div>
             <div>
                <label htmlFor="ending-balance" className="text-sm font-medium">Statement Ending Balance *</label>
                <div className="relative">
                    <Banknote className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        id="ending-balance"
                        type="number"
                        placeholder="0.00"
                        value={statementEndingBalance}
                        onChange={(e) => setStatementEndingBalance(e.target.value)}
                        className="pl-10 mt-1"
                        disabled={reconciliationStarted}
                    />
                </div>
            </div>
             <div className="flex space-x-2">
                <Button 
                    onClick={handleStartReconciliation} 
                    className="w-full"
                    disabled={reconciliationStarted || !selectedBankGL || !statementDate || !statementEndingBalance}
                >
                    Start Reconciliation
                </Button>
                {reconciliationStarted && (
                    <Button variant="outline" onClick={() => setReconciliationStarted(false)} className="w-full">
                        Reset
                    </Button>
                )}
             </div>
          </CardContent>
        </Card>

        {isFetching && (
            <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" />
                <span className="ml-3 text-muted-foreground">Loading initial data...</span>
            </div>
        )}

        {!reconciliationStarted && !isFetching && (
          <Card className="shadow-lg text-center">
            <CardContent className="py-20">
              <p className="text-muted-foreground">
                Please select a bank account, statement date, and ending balance to begin.
              </p>
            </CardContent>
          </Card>
        )}

        {reconciliationStarted && (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>Reconcile Transactions for {selectedBankGL}</CardTitle>
                    <CardDescription>Check off items that appear on your bank statement. The goal is to make the difference zero.</CardDescription>
                </CardHeader>
                <CardContent>
                    {/* The reconciliation tables and summary will be built here in the next step */}
                    <div className="text-center py-10 text-muted-foreground">
                        Reconciliation workspace will appear here.
                    </div>
                </CardContent>
            </Card>
        )}
      </div>
    </AuthGuard>
  );
}
