
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { format, startOfMonth, endOfMonth, parse, isValid, differenceInCalendarDays } from "date-fns";
import { ArrowLeft, CalendarIcon, FilePieChart, TrendingUp, Scale, Briefcase, BrainCircuit } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { generateManagementReport, type ManagementReportInput, type ManagementReportOutput } from "@/ai/flows/management-report-flow";

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  subType: string;
  type: string;
  fs: string;
}

interface AllTransactionsLedgerItem {
  id: string;
  date: string;
  glAccount: string;
  debitAmount: number | null;
  creditAmount: number | null;
}

const MAX_DATE_RANGE_DAYS = 1096; // 3 years

export default function ManagementReportPage() {
  const { user, companyName } = useAuth();
  const { toast } = useToast();

  const [startDate, setStartDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date | undefined>(endOfMonth(new Date()));
  
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<ManagementReportOutput | null>(null);

  const handleGenerateReport = async () => {
    if (!user) return;
    if (!startDate || !endDate) {
      toast({ title: "Date Range Required", description: "Please select both a start and end date.", variant: "destructive" });
      return;
    }
    if (differenceInCalendarDays(endDate, startDate) > MAX_DATE_RANGE_DAYS) {
      toast({ title: "Date Range Too Large", description: `Please select a date range of no more than ${MAX_DATE_RANGE_DAYS} days.`, variant: "destructive" });
      return;
    }
    if (endDate < startDate) {
      toast({ title: "Invalid Date Range", description: "End date cannot be before start date.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setReportData(null);

    try {
      const ledgerQuery = query(collection(db, "all_transactions_ledger"), where("userId", "==", user.uid));
      const accountsQuery = query(collection(db, "chartOfAccounts"), where("userId", "==", user.uid));
      const [ledgerSnapshot, accountsSnapshot] = await Promise.all([getDocs(ledgerQuery), getDocs(accountsQuery)]);

      if (accountsSnapshot.empty || ledgerSnapshot.empty) {
        toast({ title: "No Data Found", description: "Cannot generate report without Chart of Accounts and Ledger entries.", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      
      const ledgerEntries: AllTransactionsLedgerItem[] = [];
      ledgerSnapshot.forEach(doc => ledgerEntries.push(doc.data() as AllTransactionsLedgerItem));
      const chartOfAccounts: ChartOfAccountItem[] = [];
      accountsSnapshot.forEach(doc => chartOfAccounts.push(doc.data() as ChartOfAccountItem));

      const reportInput: ManagementReportInput = {
        profitAndLoss: { accounts: [], totalIncome: 0, totalExpenses: 0, netProfitLoss: 0 },
        balanceSheet: { assets: [], liabilities: [], equity: [], totalAssets: 0, totalLiabilities: 0, totalEquity: 0 }
      };

      const accountBalances = new Map<string, number>();
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      ledgerEntries.filter(e => e.date >= startStr && e.date <= endStr).forEach(e => {
        const currentBalance = accountBalances.get(e.glAccount) || 0;
        accountBalances.set(e.glAccount, currentBalance + (e.debitAmount || 0) - (e.creditAmount || 0));
      });

      accountBalances.forEach((balance, glName) => {
        const accDetails = chartOfAccounts.find(coa => coa.glAccount === glName);
        if (accDetails?.fs === "Profit and Loss") {
          reportInput.profitAndLoss.accounts.push({ name: glName, balance, type: accDetails.type });
        }
      });
      reportInput.profitAndLoss.totalIncome = reportInput.profitAndLoss.accounts.filter(a => a.type.includes("Income")).reduce((sum, acc) => sum - acc.balance, 0);
      reportInput.profitAndLoss.totalExpenses = reportInput.profitAndLoss.accounts.filter(a => a.type.includes("Expense")).reduce((sum, acc) => sum + acc.balance, 0);
      reportInput.profitAndLoss.netProfitLoss = reportInput.profitAndLoss.totalIncome - reportInput.profitAndLoss.totalExpenses;
      
      const cumulativeBalances = new Map<string, number>();
      ledgerEntries.filter(e => e.date <= endStr).forEach(e => {
        const currentBalance = cumulativeBalances.get(e.glAccount) || 0;
        cumulativeBalances.set(e.glAccount, currentBalance + (e.debitAmount || 0) - (e.creditAmount || 0));
      });

      let retainedEarnings = 0;
      cumulativeBalances.forEach((balance, glName) => {
        const accDetails = chartOfAccounts.find(coa => coa.glAccount === glName);
        if (accDetails?.fs === "Balance Sheet") {
          if (accDetails.type.includes("Asset")) reportInput.balanceSheet.assets.push({ name: glName, balance, type: accDetails.type });
          else if (accDetails.type.includes("Liability")) reportInput.balanceSheet.liabilities.push({ name: glName, balance: -balance, type: accDetails.type });
          else if (accDetails.type.includes("Equity")) reportInput.balanceSheet.equity.push({ name: glName, balance: -balance, type: accDetails.type });
        } else if (accDetails?.fs === "Profit and Loss") {
            retainedEarnings += -balance;
        }
      });
      reportInput.balanceSheet.equity.push({ name: "Retained Earnings", balance: retainedEarnings, type: "Equity" });

      reportInput.balanceSheet.totalAssets = reportInput.balanceSheet.assets.reduce((sum, acc) => sum + acc.balance, 0);
      reportInput.balanceSheet.totalLiabilities = reportInput.balanceSheet.liabilities.reduce((sum, acc) => sum + acc.balance, 0);
      reportInput.balanceSheet.totalEquity = reportInput.balanceSheet.equity.reduce((sum, acc) => sum + acc.balance, 0);
      
      const result = await generateManagementReport(reportInput);
      setReportData(result);

    } catch (error) {
      console.error("Error generating management report:", error);
      toast({ title: "Report Generation Failed", description: "An AI or data processing error occurred.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center">
             <FilePieChart className="mr-3 h-10 w-10 text-primary" />
            <div>
                {(companyName) && (
                  <div className="flex items-center text-xl font-semibold text-muted-foreground mb-1">
                    <Briefcase className="mr-2 h-5 w-5" />
                    {companyName}
                  </div>
                )}
                <h1 className="text-4xl font-bold font-headline">Management Report</h1>
                <p className="text-lg text-muted-foreground">AI-powered analysis of your financial performance.</p>
            </div>
          </div>
          <Button variant="outline" asChild><Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard</Link></Button>
        </header>
        
        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle>Report Period</CardTitle>
            <CardDescription>Select the date range for the financial data to be analyzed.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
            <div className="w-full sm:w-auto">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={"outline"} className={cn("w-[280px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={startDate} onSelect={setStartDate} /></PopoverContent>
                </Popover>
            </div>
            <div className="w-full sm:w-auto">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={"outline"} className={cn("w-[280px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={endDate} onSelect={setEndDate} /></PopoverContent>
                </Popover>
            </div>
             <Button onClick={handleGenerateReport} disabled={isLoading || !startDate || !endDate} className="w-full sm:w-auto">
                {isLoading ? <LoadingSpinner className="mr-2" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                Generate AI Report
            </Button>
          </CardContent>
        </Card>
        
        {isLoading && (
          <div className="text-center py-20">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-muted-foreground">The AI is analyzing your financials... This may take a moment.</p>
          </div>
        )}
        
        {!isLoading && !reportData && (
          <Card className="text-center py-20 shadow-lg">
            <CardContent>
              <p className="text-muted-foreground">Select a date range and click "Generate AI Report" to see your financial analysis.</p>
            </CardContent>
          </Card>
        )}

        {reportData && (
          <div className="space-y-6 animate-fade-in">
            <Card>
              <CardHeader><CardTitle>Executive Summary</CardTitle></CardHeader>
              <CardContent><p className="text-muted-foreground whitespace-pre-wrap">{reportData.executiveSummary}</p></CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader><CardTitle>Financial Highlights</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                        {reportData.financialHighlights.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Key Ratios</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead>Ratio</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {Object.entries(reportData.keyRatios).map(([key, value]) => (
                            <TableRow key={key}>
                                <TableCell className="font-medium">{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</TableCell>
                                <TableCell className="text-right">{value}</TableCell>
                            </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader><CardTitle>Analysis & Commentary</CardTitle></CardHeader>
                <CardContent>
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="item-1">
                            <AccordionTrigger>View Detailed Analysis</AccordionTrigger>
                            <AccordionContent><p className="text-muted-foreground whitespace-pre-wrap">{reportData.detailedAnalysis}</p></AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
            </Card>

            <Card className="border-primary">
              <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
              <CardContent>
                 <ul className="list-decimal pl-5 space-y-2 text-muted-foreground">
                    {reportData.recommendations.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
