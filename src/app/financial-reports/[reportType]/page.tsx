
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth, parse, isValid, differenceInCalendarDays, startOfQuarter, endOfQuarter, addMonths, isBefore, isEqual, addQuarters } from "date-fns";
import { ArrowLeft, CalendarIcon, TrendingUp, Scale, AlertTriangle, FileDown, Briefcase } from "lucide-react";
import * as XLSX from 'xlsx';

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";


const TYPE_OPTIONS = [
  "Direct Income", "Indirect Income",
  "Direct Expense", "Indirect Expense",
  "Non Current Asset", "Current Asset",
  "Current Liability", "Non Current Liability",
  "Equity"
] as const;
type TypeOption = typeof TYPE_OPTIONS[number];

const FS_OPTIONS = ["Profit and Loss", "Balance Sheet"] as const;
type FSOption = typeof FS_OPTIONS[number];

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  subType: string;
  type: TypeOption;
  fs?: FSOption;
  accountNumber?: string;
  createdAt?: Timestamp;
}

interface AllTransactionsLedgerItem {
  id: string;
  date: string;
  description: string;
  source: string;
  sourceDocId: string;
  customer: string | null;
  vendor: string | null;
  glAccount: string;
  debitAmount: number | null;
  creditAmount: number | null;
  createdAt: Timestamp;
}

// --- Summary Report Types ---
interface ReportAccountSummary {
  id: string;
  glAccount: string;
  type: TypeOption;
  fs?: FSOption;
  subType: string;
  balance: number;
}

type ReportSection = {
  title: string;
  accounts: ReportAccountSummary[];
  total: number;
};

type SummaryProfitAndLossData = {
  format: "summary";
  type: "ProfitAndLoss";
  income: ReportSection;
  expenses: ReportSection;
  netProfitLoss: number;
};

type SummaryBalanceSheetData = {
  format: "summary";
  type: "BalanceSheet";
  assets: ReportSection;
  liabilities: ReportSection;
  equity: ReportSection;
  totalLiabilitiesAndEquity: number;
};

// --- Columnar Report Types ---
type Period = {
  startDate: Date;
  endDate: Date;
  label: string;
};

type ColumnarReportAccountSummary = Omit<ReportAccountSummary, 'balance'> & {
  periodBalances: number[];
  totalBalance: number;
};

type ColumnarReportSection = {
  title: string;
  accounts: ColumnarReportAccountSummary[];
  periodTotals: number[];
  total: number;
};

type ColumnarProfitAndLossData = {
  format: "columnar";
  type: "ProfitAndLoss";
  periods: Period[];
  income: ColumnarReportSection;
  expenses: ColumnarReportSection;
  netProfitLossByPeriod: number[];
  totalNetProfitLoss: number;
};

type ColumnarBalanceSheetData = {
  format: "columnar";
  type: "BalanceSheet";
  periods: Period[];
  assets: ColumnarReportSection;
  liabilities: ColumnarReportSection;
  equity: ColumnarReportSection;
  totalLiabilitiesAndEquityByPeriod: number[];
  totalLiabilitiesAndEquity: number;
};

type ReportData = SummaryProfitAndLossData | SummaryBalanceSheetData | ColumnarProfitAndLossData | ColumnarBalanceSheetData;


const MAX_DATE_RANGE_DAYS = 1096; // 3 years

const getPeriods = (start: Date, end: Date, periodType: "monthly" | "quarterly"): Period[] => {
    const periods: Period[] = [];
    let current = new Date(start);

    if (periodType === "monthly") {
        while (isBefore(current, end) || isEqual(current, end)) {
            const periodEnd = endOfMonth(current);
            periods.push({
                startDate: startOfMonth(current),
                endDate: isBefore(periodEnd, end) ? periodEnd : end,
                label: format(current, "MMM yyyy"),
            });
            current = addMonths(startOfMonth(current), 1);
        }
    } else { // quarterly
        while (isBefore(current, end) || isEqual(current, end)) {
            const periodEnd = endOfQuarter(current);
            periods.push({
                startDate: startOfQuarter(current),
                endDate: isBefore(periodEnd, end) ? periodEnd : end,
                label: `Q${format(current, "q")} ${format(current, "yyyy")}`,
            });
            current = addQuarters(startOfQuarter(current), 1);
        }
    }
    return periods;
};


export default function ReportPage() {
  
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();

  const reportType = params.reportType as string;

  const [startDate, setStartDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [startDateString, setStartDateString] = useState<string>(
    startOfMonth(new Date()) ? format(startOfMonth(new Date()), "MM/dd/yyyy") : ""
  );
  const [endDateString, setEndDateString] = useState<string>(
    endOfMonth(new Date()) ? format(endOfMonth(new Date()), "MM/dd/yyyy") : ""
  );
  const [reportFormat, setReportFormat] = useState<"summary" | "monthly" | "quarterly">("summary");

  const [ledgerEntries, setLedgerEntries] = useState<AllTransactionsLedgerItem[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [classificationErrors, setClassificationErrors] = useState<string[]>([]);

  const reportTitle = useMemo(() => {
    if (reportType === "profit-and-loss") return "Profit and Loss Statement";
    if (reportType === "balance-sheet") return "Balance Sheet";
    return "Financial Report";
  }, [reportType]);
  
  const reportIcon = useMemo(() => {
    if (reportType === "profit-and-loss") return <TrendingUp className="mr-3 h-10 w-10 text-primary" />;
    if (reportType === "balance-sheet") return <Scale className="mr-3 h-10 w-10 text-primary" />;
    return null;
  }, [reportType]);

  const { selectedCompanyId, selectedCompanyName } = useCompany();
const { logAction } = useAuditLog();

  const handleStartDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setStartDateString(value);
    const parsedDate = parse(value, "MM/dd/yyyy", new Date());
    if (isValid(parsedDate)) {
      setStartDate(parsedDate);
    } else {
      setStartDate(undefined);
    }
  };

  const handleEndDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEndDateString(value);
    const parsedDate = parse(value, "MM/dd/yyyy", new Date());
    if (isValid(parsedDate)) {
      setEndDate(parsedDate);
    } else {
      setEndDate(undefined);
    }
  };


  const fetchData = useCallback(async () => {
    if (!user || !selectedCompanyId) {
        setIsLoading(false);
        return;
    }
    if (!startDate || !endDate) {
        setIsLoading(false);
        if (user) {
            toast({
                title: "Date Range Required",
                description: "Please select both a start and end date.",
                variant: "destructive",
            });
        }
        return;
    }
    
    if (differenceInCalendarDays(endDate, startDate) > MAX_DATE_RANGE_DAYS) {
        toast({
            title: "Date Range Too Large",
            description: `Please select a date range of no more than ${MAX_DATE_RANGE_DAYS} days.`,
            variant: "destructive",
        });
        setIsLoading(false);
        return;
    }
    if (endDate < startDate) {
        toast({
            title: "Invalid Date Range",
            description: "End date cannot be before start date.",
            variant: "destructive",
        });
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    setClassificationErrors([]);
    try {
      const ledgerQuery = query(collection(db, "all_transactions_ledger"), where("companyId", "==", selectedCompanyId));
      const accountsQuery = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));

      const [ledgerSnapshot, accountsSnapshot] = await Promise.all([
        getDocs(ledgerQuery),
        getDocs(accountsQuery),
      ]);

      const fetchedLedgerItems: AllTransactionsLedgerItem[] = [];
      ledgerSnapshot.forEach(doc => fetchedLedgerItems.push({ id: doc.id, ...doc.data() } as AllTransactionsLedgerItem));
      setLedgerEntries(fetchedLedgerItems);

      const fetchedAccounts: ChartOfAccountItem[] = [];
      accountsSnapshot.forEach(doc => {
        fetchedAccounts.push({
          ...(doc.data() as Omit<ChartOfAccountItem, 'id'>),
          id: doc.id
        } as ChartOfAccountItem);
      });
      setChartOfAccounts(fetchedAccounts);

    } catch (error) {
      console.error("Error fetching report data:", error);
      toast({ title: "Error Fetching Data", description: "Could not fetch data for the report.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [user, selectedCompanyId, startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const reportOutput = useMemo<ReportData | { report: null, unclassifiedGlAccounts: any[] }>(() => {
    if (isLoading || chartOfAccounts.length === 0 || !startDate || !endDate) {
      return { report: null, unclassifiedGlAccounts: [] };
    }
    
    // --- COLUMNAR REPORT LOGIC ---
    if (reportFormat === 'monthly' || reportFormat === 'quarterly') {
        const periods = getPeriods(startDate, endDate, reportFormat);
        const localUnclassifiedGlAccounts: Array<{ name: string; reason: string }> = [];

        // For Balance Sheet, we need all entries up to the end of the last period
        const endOfLastPeriod = periods[periods.length - 1].endDate;
        const allRelevantLedgerEntries = ledgerEntries.filter(entry => entry.date <= format(endOfLastPeriod, "yyyy-MM-dd"));

        let finalReport: ColumnarProfitAndLossData | ColumnarBalanceSheetData | null = null;
        
        if (reportType === 'profit-and-loss') {
            const accountPeriodBalances = new Map<string, number[]>();

            periods.forEach((period, periodIndex) => {
                const periodStartStr = format(period.startDate, "yyyy-MM-dd");
                const periodEndStr = format(period.endDate, "yyyy-MM-dd");
                const periodLedgerEntries = ledgerEntries.filter(entry => entry.date >= periodStartStr && entry.date <= periodEndStr);

                periodLedgerEntries.forEach(entry => {
                    if (!accountPeriodBalances.has(entry.glAccount)) {
                        accountPeriodBalances.set(entry.glAccount, Array(periods.length).fill(0));
                    }
                    const balances = accountPeriodBalances.get(entry.glAccount)!;
                    if (entry.debitAmount) balances[periodIndex] += entry.debitAmount;
                    if (entry.creditAmount) balances[periodIndex] -= entry.creditAmount;
                });
            });

            const incomeAccounts: ColumnarReportAccountSummary[] = [];
            const expenseAccounts: ColumnarReportAccountSummary[] = [];

            accountPeriodBalances.forEach((periodBalances, glAccountName) => {
                const accDetails = chartOfAccounts.find(coa => coa.glAccount.trim().toLowerCase() === glAccountName.trim().toLowerCase());
                if (!accDetails) {
                    if (periodBalances.some(b => b !== 0)) localUnclassifiedGlAccounts.push({ name: glAccountName, reason: "Not found in Chart of Accounts."});
                    return;
                }
                const summary: ColumnarReportAccountSummary = { id: accDetails.id, glAccount: accDetails.glAccount, type: accDetails.type, fs: accDetails.fs, subType: accDetails.subType, periodBalances: [], totalBalance: 0 };
                
                if (accDetails.type.includes("Income")) {
                    summary.periodBalances = periodBalances.map(b => -b); // Invert for display
                    summary.totalBalance = summary.periodBalances.reduce((a, b) => a + b, 0);
                    incomeAccounts.push(summary);
                    if (summary.totalBalance !== 0 && accDetails.fs !== "Profit and Loss") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: "Type is P&L but FS mapping is not."});
                } else if (accDetails.type.includes("Expense")) {
                    summary.periodBalances = periodBalances.map(b => b);
                    summary.totalBalance = summary.periodBalances.reduce((a, b) => a + b, 0);
                    expenseAccounts.push(summary);
                    if (summary.totalBalance !== 0 && accDetails.fs !== "Profit and Loss") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: "Type is P&L but FS mapping is not."});
                } else if (periodBalances.some(b => b !== 0) && accDetails.fs === "Profit and Loss") {
                    localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `FS mapping is P&L, but type is '${accDetails.type}'.`});
                }
            });

            const incomePeriodTotals = periods.map((_, i) => incomeAccounts.reduce((sum, acc) => sum + acc.periodBalances[i], 0));
            const expensePeriodTotals = periods.map((_, i) => expenseAccounts.reduce((sum, acc) => sum + acc.periodBalances[i], 0));
            const netProfitByPeriod = periods.map((_, i) => incomePeriodTotals[i] - expensePeriodTotals[i]);
            
            finalReport = {
                format: "columnar", type: "ProfitAndLoss", periods,
                income: { title: "Income", accounts: incomeAccounts.filter(a => a.totalBalance !== 0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), periodTotals: incomePeriodTotals, total: incomePeriodTotals.reduce((a,b)=>a+b, 0) },
                expenses: { title: "Expenses", accounts: expenseAccounts.filter(a => a.totalBalance !== 0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), periodTotals: expensePeriodTotals, total: expensePeriodTotals.reduce((a,b)=>a+b, 0) },
                netProfitLossByPeriod: netProfitByPeriod,
                totalNetProfitLoss: netProfitByPeriod.reduce((a,b)=>a+b, 0),
            };

        } else if (reportType === 'balance-sheet') {
            const assetAccounts: ColumnarReportAccountSummary[] = [];
            const liabilityAccounts: ColumnarReportAccountSummary[] = [];
            const equityAccounts: ColumnarReportAccountSummary[] = [];
            const allAccountDetails: ColumnarReportAccountSummary[] = chartOfAccounts.map(coa => ({
                id: coa.id, glAccount: coa.glAccount, type: coa.type, fs: coa.fs, subType: coa.subType, 
                periodBalances: Array(periods.length).fill(0), totalBalance: 0
            }));

            periods.forEach((period, periodIndex) => {
                const periodEndStr = format(period.endDate, "yyyy-MM-dd");
                const entriesForPeriod = allRelevantLedgerEntries.filter(e => e.date <= periodEndStr);
                const cumulativeBalances = new Map<string, number>();

                entriesForPeriod.forEach(entry => {
                    const currentBalance = cumulativeBalances.get(entry.glAccount) || 0;
                    let newBalance = currentBalance;
                    if (entry.debitAmount) newBalance += entry.debitAmount;
                    if (entry.creditAmount) newBalance -= entry.creditAmount;
                    cumulativeBalances.set(entry.glAccount, newBalance);
                });

                let totalRetainedEarnings = 0;
                allAccountDetails.forEach(accSummary => {
                    const balance = cumulativeBalances.get(accSummary.glAccount) || 0;
                    if (accSummary.type.includes("Asset")) {
                        accSummary.periodBalances[periodIndex] = balance;
                        if (balance !== 0 && accSummary.fs !== "Balance Sheet") localUnclassifiedGlAccounts.push({ name: accSummary.glAccount, reason: "Type is Asset, but FS mapping is not Balance Sheet." });
                    } else if (accSummary.type.includes("Liability") || accSummary.type.includes("Equity")) {
                        accSummary.periodBalances[periodIndex] = -balance;
                        if (balance !== 0 && accSummary.fs !== "Balance Sheet") localUnclassifiedGlAccounts.push({ name: accSummary.glAccount, reason: `Type is ${accSummary.type}, but FS mapping is not Balance Sheet.` });
                    } else if (accSummary.type.includes("Income") || accSummary.type.includes("Expense")) {
                        totalRetainedEarnings += -balance;
                        if (balance !== 0 && accSummary.fs !== "Profit and Loss") localUnclassifiedGlAccounts.push({ name: accSummary.glAccount, reason: `Type is ${accSummary.type}, but FS mapping is not Profit and Loss.` });
                    }
                });

                let retainedEarningsAcc = allAccountDetails.find(a => a.glAccount === "Retained Earnings");
                if (!retainedEarningsAcc) {
                    retainedEarningsAcc = { id: 'programmatic-retained-earnings', glAccount: "Retained Earnings", type: "Equity", subType: "Retained Earnings", fs: "Balance Sheet", periodBalances: Array(periods.length).fill(0), totalBalance: 0 };
                    allAccountDetails.push(retainedEarningsAcc);
                }
                retainedEarningsAcc.periodBalances[periodIndex] = totalRetainedEarnings;
            });
            
            allAccountDetails.forEach(acc => {
                acc.totalBalance = acc.periodBalances[acc.periodBalances.length - 1]; // Total is just the last period's balance
                if (acc.type.includes("Asset")) assetAccounts.push(acc);
                else if (acc.type.includes("Liability")) liabilityAccounts.push(acc);
                else if (acc.type.includes("Equity")) equityAccounts.push(acc);
            });

            const assetPeriodTotals = periods.map((_, i) => assetAccounts.reduce((sum, acc) => sum + acc.periodBalances[i], 0));
            const liabilityPeriodTotals = periods.map((_, i) => liabilityAccounts.reduce((sum, acc) => sum + acc.periodBalances[i], 0));
            const equityPeriodTotals = periods.map((_, i) => equityAccounts.reduce((sum, acc) => sum + acc.periodBalances[i], 0));
            const totalLiabAndEquityByPeriod = periods.map((_, i) => liabilityPeriodTotals[i] + equityPeriodTotals[i]);
            
            finalReport = {
                format: "columnar", type: "BalanceSheet", periods,
                assets: { title: "Assets", accounts: assetAccounts.filter(a=>a.periodBalances.some(b=>b!==0)).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), periodTotals: assetPeriodTotals, total: assetPeriodTotals[assetPeriodTotals.length-1] },
                liabilities: { title: "Liabilities", accounts: liabilityAccounts.filter(a=>a.periodBalances.some(b=>b!==0)).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), periodTotals: liabilityPeriodTotals, total: liabilityPeriodTotals[liabilityPeriodTotals.length-1] },
                equity: { title: "Equity", accounts: equityAccounts.filter(a=>a.periodBalances.some(b=>b!==0)).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), periodTotals: equityPeriodTotals, total: equityPeriodTotals[equityPeriodTotals.length-1] },
                totalLiabilitiesAndEquityByPeriod: totalLiabAndEquityByPeriod,
                totalLiabilitiesAndEquity: totalLiabAndEquityByPeriod[totalLiabAndEquityByPeriod.length-1]
            };
        }

        return { report: finalReport, unclassifiedGlAccounts: localUnclassifiedGlAccounts };
    }

    // --- SUMMARY REPORT LOGIC ---
    let generatedReport: SummaryProfitAndLossData | SummaryBalanceSheetData | null = null;
    const localUnclassifiedGlAccounts: Array<{ name: string; reason: string }> = [];

    if (reportType === 'profit-and-loss') {
        // ... (existing summary logic)
        const accountBalances = new Map<string, number>();
        const startStr = format(startDate, "yyyy-MM-dd");
        const endStr = format(endDate, "yyyy-MM-dd");
        ledgerEntries.filter(entry => entry.date >= startStr && entry.date <= endStr).forEach(entry => {
            const currentBalance = accountBalances.get(entry.glAccount) || 0;
            accountBalances.set(entry.glAccount, currentBalance + (entry.debitAmount || 0) - (entry.creditAmount || 0));
        });

        const incomeAccounts: ReportAccountSummary[] = [];
        const expenseAccounts: ReportAccountSummary[] = [];
        accountBalances.forEach((balance, glAccountName) => {
            const accDetails = chartOfAccounts.find(coa => coa.glAccount.trim().toLowerCase() === glAccountName.trim().toLowerCase());
            if (!accDetails) {
                if (balance !== 0) localUnclassifiedGlAccounts.push({ name: glAccountName, reason: "Not found in CoA." });
                return;
            }
            if (accDetails.type.includes("Income")) {
                if (balance !== 0 && accDetails.fs !== "Profit and Loss") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `Type is P&L but FS mapping is '${accDetails.fs}'.`});
                incomeAccounts.push({ ...accDetails, balance: -balance });
            } else if (accDetails.type.includes("Expense")) {
                if (balance !== 0 && accDetails.fs !== "Profit and Loss") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `Type is P&L but FS mapping is '${accDetails.fs}'.`});
                expenseAccounts.push({ ...accDetails, balance: balance });
            } else if (balance !== 0 && accDetails.fs === "Profit and Loss") {
                localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `FS is P&L, but type is '${accDetails.type}'.`});
            }
        });
        const totalIncome = incomeAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalExpenses = expenseAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        generatedReport = { format: "summary", type: "ProfitAndLoss", income: { title: "Income", accounts: incomeAccounts.filter(a=>a.balance!==0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), total: totalIncome }, expenses: { title: "Expenses", accounts: expenseAccounts.filter(a=>a.balance!==0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), total: totalExpenses }, netProfitLoss: totalIncome - totalExpenses };

    } else if (reportType === 'balance-sheet') {
        const endStr = format(endDate, "yyyy-MM-dd");
        const cumulativeBalances = new Map<string, number>();
        ledgerEntries.filter(entry => entry.date <= endStr).forEach(entry => {
            const currentBalance = cumulativeBalances.get(entry.glAccount) || 0;
            cumulativeBalances.set(entry.glAccount, currentBalance + (entry.debitAmount || 0) - (entry.creditAmount || 0));
        });
        
        const assetAccounts: ReportAccountSummary[] = [];
        const liabilityAccounts: ReportAccountSummary[] = [];
        const equityAccounts: ReportAccountSummary[] = [];
        let totalRetainedEarnings = 0;
        
        cumulativeBalances.forEach((balance, glAccountName) => {
            const accDetails = chartOfAccounts.find(coa => coa.glAccount.trim().toLowerCase() === glAccountName.trim().toLowerCase());
            if (!accDetails) {
                if (balance !== 0) localUnclassifiedGlAccounts.push({ name: glAccountName, reason: "Not found in CoA." });
                return;
            }
            if (accDetails.type.includes("Asset")) {
                if (balance !== 0 && accDetails.fs !== "Balance Sheet") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `Type is Asset but FS mapping is '${accDetails.fs}'.`});
                assetAccounts.push({ ...accDetails, balance: balance });
            } else if (accDetails.type.includes("Liability")) {
                if (balance !== 0 && accDetails.fs !== "Balance Sheet") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `Type is Liability but FS mapping is '${accDetails.fs}'.`});
                liabilityAccounts.push({ ...accDetails, balance: -balance });
            } else if (accDetails.type.includes("Equity")) {
                if (balance !== 0 && accDetails.fs !== "Balance Sheet") localUnclassifiedGlAccounts.push({ name: accDetails.glAccount, reason: `Type is Equity but FS mapping is '${accDetails.fs}'.`});
                equityAccounts.push({ ...accDetails, balance: -balance });
            } else { // Income & Expense
                totalRetainedEarnings += -balance;
            }
        });

        equityAccounts.push({ id: 'programmatic-retained-earnings', glAccount: "Retained Earnings", balance: totalRetainedEarnings, type: "Equity", subType: "Retained Earnings", fs: "Balance Sheet" });
        const totalAssets = assetAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = liabilityAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalEquity = equityAccounts.reduce((sum, acc) => sum + acc.balance, 0);

        generatedReport = { format: "summary", type: "BalanceSheet", assets: { title: "Assets", accounts: assetAccounts.filter(a=>a.balance!==0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), total: totalAssets }, liabilities: { title: "Liabilities", accounts: liabilityAccounts.filter(a=>a.balance!==0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), total: totalLiabilities }, equity: { title: "Equity", accounts: equityAccounts.filter(a=>a.balance!==0).sort((a,b)=>a.glAccount.localeCompare(b.glAccount)), total: totalEquity }, totalLiabilitiesAndEquity: totalLiabilities + totalEquity };
    }

    return { report: generatedReport, unclassifiedGlAccounts: localUnclassifiedGlAccounts };
  }, [isLoading, chartOfAccounts, ledgerEntries, reportType, startDate, endDate, reportFormat]);


  useEffect(() => {
    if (reportOutput && reportOutput.unclassifiedGlAccounts.length > 0) {
      const errors = reportOutput.unclassifiedGlAccounts.map(
        (err) => `GL Account '${err.name}': ${err.reason}`
      );
      setClassificationErrors(errors);
    } else {
      setClassificationErrors([]);
    }
  }, [reportOutput]);

  const handleExportToExcel = () => {
    const reportData = reportOutput?.report;
    if (!reportData || !startDate || !endDate) {
      toast({ title: "No Data", description: "No report data available to export or date range not set.", variant: "destructive" });
      return;
    }

    const fileNameSafeStartDate = format(startDate, "yyyy-MM-dd");
    const fileNameSafeEndDate = format(endDate, "yyyy-MM-dd");

    if (reportData.format === 'columnar') {
        const periodLabels = reportData.periods.map(p => p.label);
        let data: any[] = [];
        let fileName = `${reportData.type}_${reportFormat}_${fileNameSafeStartDate}_to_${fileNameSafeEndDate}.xlsx`;

        if (reportData.type === "ProfitAndLoss") {
            const addSection = (section: ColumnarReportSection) => {
                data.push({ 'Account/Description': section.title.toUpperCase() });
                section.accounts.forEach(acc => {
                    const row: any = { 'Account/Description': `  ${acc.glAccount} (${acc.subType})` };
                    periodLabels.forEach((label, i) => row[label] = acc.periodBalances[i]);
                    row['Total'] = acc.totalBalance;
                    data.push(row);
                });
                const totalRow: any = { 'Account/Description': `Total ${section.title}` };
                periodLabels.forEach((label, i) => totalRow[label] = section.periodTotals[i]);
                totalRow['Total'] = section.total;
                data.push(totalRow);
                data.push({}); // Spacer
            };
            addSection(reportData.income);
            addSection(reportData.expenses);
            const netRow: any = { 'Account/Description': 'Net Profit / (Loss)' };
            periodLabels.forEach((label, i) => netRow[label] = reportData.netProfitLossByPeriod[i]);
            netRow['Total'] = reportData.totalNetProfitLoss;
            data.push(netRow);
        } else { // BalanceSheet columnar
            fileName = `BalanceSheet_${reportFormat}_as_of_${fileNameSafeEndDate}.xlsx`;
            const addSection = (section: ColumnarReportSection) => {
                data.push({ 'Account/Description': section.title.toUpperCase() });
                section.accounts.forEach(acc => {
                    const row: any = { 'Account/Description': `  ${acc.glAccount} (${acc.subType})` };
                    periodLabels.forEach((label, i) => row[label] = acc.periodBalances[i]);
                    row['Total'] = acc.totalBalance;
                    data.push(row);
                });
                const totalRow: any = { 'Account/Description': `Total ${section.title}` };
                periodLabels.forEach((label, i) => totalRow[label] = section.periodTotals[i]);
                totalRow['Total'] = section.total;
                data.push(totalRow);
                data.push({}); // Spacer
            };
            addSection(reportData.assets);
            addSection(reportData.liabilities);
            addSection(reportData.equity);
            const totalLiabEqRow: any = { 'Account/Description': 'Total Liabilities and Equity' };
            periodLabels.forEach((label, i) => totalLiabEqRow[label] = reportData.totalLiabilitiesAndEquityByPeriod[i]);
            totalLiabEqRow['Total'] = reportData.totalLiabilitiesAndEquity;
            data.push(totalLiabEqRow);
        }

        const worksheet = XLSX.utils.json_to_sheet(data, {
            header: ['Account/Description', ...periodLabels, 'Total'], skipHeader: false
        });
        worksheet['!cols'] = [{ wch: 50 }, ...periodLabels.map(() => ({ wch: 15 })), { wch: 15 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, reportData.type);
        XLSX.writeFile(workbook, fileName);

    } else { // Summary export
        const excelData: Array<{ 'Account/Description': string; 'Amount': number | string }> = [];
        let fileName = `${reportData.type}_Report_${fileNameSafeStartDate}_to_${fileNameSafeEndDate}.xlsx`;

        if (reportData.type === "ProfitAndLoss") {
            // ... (existing summary export logic)
        } else if (reportData.type === "BalanceSheet") {
           // ... (existing summary export logic)
        }

        const worksheet = XLSX.utils.json_to_sheet(excelData, { header: ['Account/Description', 'Amount'], skipHeader: false, });
        worksheet['!cols'] = [{ wch: 50 }, { wch: 15 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, reportData.type);
        XLSX.writeFile(workbook, fileName);
    }

    logAction('export_report', reportType, [
      `Exported ${reportType} report from ${format(startDate, "yyyy-MM-dd")} to ${format(endDate, "yyyy-MM-dd")}`
    ]);

    toast({ title: "Export Successful", description: `Report exported.` });
  };


  if (reportType !== "profit-and-loss" && reportType !== "balance-sheet") {
    router.push("/financial-reports");
    return <LoadingSpinner />;
  }

  const renderSummarySection = (section: ReportSection, isSubSection: boolean = false) => (
    <div key={section.title} className={cn(!isSubSection && "mb-6")}>
      <h3 className={cn("text-xl font-semibold mb-2", isSubSection ? "text-lg" : "text-xl")}>{section.title}</h3>
      <Table>
        <TableBody>
          {section.accounts.map(acc => (
            <TableRow key={acc.id}>
              <TableCell className="pl-4">{acc.glAccount} ({acc.subType})</TableCell>
              <TableCell className="text-right pr-4">{acc.balance.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end mt-2 pr-4 border-t pt-2">
        <p className="font-semibold">Total {section.title}: {section.total.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</p>
      </div>
    </div>
  );
  
  const renderColumnarSection = (section: ColumnarReportSection, periods: Period[]) => (
    <div key={section.title} className="mb-6">
        <h3 className="text-xl font-semibold mb-2">{section.title}</h3>
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[300px]">Account</TableHead>
                    {periods.map(p => <TableHead key={p.label} className="text-right">{p.label}</TableHead>)}
                    <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {section.accounts.map(acc => (
                    <TableRow key={acc.id}>
                        <TableCell className="pl-4">{acc.glAccount} ({acc.subType})</TableCell>
                        {acc.periodBalances.map((bal, i) => <TableCell key={i} className="text-right">{bal.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2})}</TableCell>)}
                        <TableCell className="text-right font-semibold">{acc.totalBalance.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2})}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        <div className="flex justify-end mt-2 pr-4 border-t pt-2 font-semibold">
            <Table>
                <TableBody>
                    <TableRow>
                         <TableCell className="w-[300px] pl-4">Total {section.title}</TableCell>
                         {section.periodTotals.map((total, i) => <TableCell key={i} className="text-right">{total.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2})}</TableCell>)}
                         <TableCell className="text-right font-bold">{section.total.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2})}</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    </div>
  );

  const actualReportData = reportOutput?.report;

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center">
             {reportIcon}
            <div>
                {selectedCompanyName && (
                  <div className="flex items-center text-xl font-semibold text-muted-foreground mb-1">
                    <Briefcase className="mr-2 h-5 w-5" />
                    {selectedCompanyName}
                  </div>
                )}
                <h1 className="text-4xl font-bold font-headline">{reportTitle}</h1>
                {startDate && endDate && isValid(startDate) && isValid(endDate) && (
                     <p className="text-sm text-muted-foreground">
                        {reportType === "profit-and-loss" || reportFormat !== 'summary' ? "For the period: " : "As of: "}
                        {format(startDate, "MMMM d, yyyy")}
                        {(reportType === "profit-and-loss" || reportFormat !== 'summary') && ` - ${format(endDate, "MMMM d, yyyy")}`}
                     </p>
                )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
                variant="outline"
                onClick={handleExportToExcel}
                disabled={isLoading || !actualReportData || !startDate || !endDate}
            >
                <FileDown className="mr-2 h-4 w-4" />
                Export to Excel
            </Button>
            <Button variant="outline" asChild>
                <Link href="/financial-reports">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Reports Menu
                </Link>
            </Button>
          </div>
        </header>

        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle>Report Options</CardTitle>
            <CardDescription>Select the date range and format for the report.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
            <div className="w-full sm:w-auto">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <div className="relative mt-1">
                      <CalendarIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        type="text" placeholder="MM/DD/YYYY" value={startDateString} onChange={handleStartDateInputChange}
                        className={cn("w-full justify-start text-left font-normal pl-10", !startDateString && "text-muted-foreground")}
                      />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={startDate} onSelect={(date) => {setStartDate(date); setStartDateString(date ? format(date, "MM/dd/yyyy") : "");}}/></PopoverContent>
                </Popover>
            </div>
             <div className="w-full sm:w-auto">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                     <div className="relative mt-1">
                      <CalendarIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        type="text" placeholder="MM/DD/YYYY" value={endDateString} onChange={handleEndDateInputChange}
                        className={cn("w-full justify-start text-left font-normal pl-10", !endDateString && "text-muted-foreground")}
                      />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={endDate} onSelect={(date) => {setEndDate(date); setEndDateString(date ? format(date, "MM/dd/yyyy") : "");}} /></PopoverContent>
                </Popover>
            </div>
            <div className="w-full sm:w-auto">
                <Label htmlFor="report-format">Report Format</Label>
                <Select value={reportFormat} onValueChange={(value: "summary" | "monthly" | "quarterly") => setReportFormat(value)}>
                    <SelectTrigger id="report-format" className="mt-1">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="summary">Summary</SelectItem>
                        <SelectItem value="monthly">By Month</SelectItem>
                        <SelectItem value="quarterly">By Quarter</SelectItem>
                    </SelectContent>
                </Select>
            </div>
             <Button onClick={fetchData} disabled={isLoading || !startDate || !endDate} className="w-full sm:w-auto">
                {isLoading ? <LoadingSpinner className="mr-2" /> : null}
                Generate Report
            </Button>
          </CardContent>
        </Card>

        {classificationErrors.length > 0 && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Report Classification Issues</AlertTitle>
            <AlertDescription>
              The following GL accounts have transactions but could not be properly classified for this report. Please review your Chart of Accounts settings (Type and FS mapping):
              <ul className="list-disc pl-5 mt-2">
                {classificationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {isLoading && (
          <div className="flex justify-center items-center py-10">
            <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Generating report data...</span>
          </div>
        )}

        {!isLoading && !actualReportData && startDate && endDate && classificationErrors.length === 0 && (
             <Card className="shadow-lg">
                <CardContent className="py-10 text-center text-muted-foreground">
                    No data available for the selected period or parameters. Ensure ledger entries and chart of accounts are set up correctly.
                </CardContent>
             </Card>
        )}
        
        <ScrollArea className="w-full whitespace-nowrap">
            {!isLoading && actualReportData && (
                <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>{reportTitle}</CardTitle>
                    {selectedCompanyName && <CardDescription>{selectedCompanyName}</CardDescription>}
                </CardHeader>
                <CardContent>
                {actualReportData.format === "summary" ? (
                    actualReportData.type === "ProfitAndLoss" ? (
                    <>
                        {renderSummarySection(actualReportData.income)}
                        {renderSummarySection(actualReportData.expenses)}
                        <hr className="my-4" />
                        <div className="flex justify-end mt-4 pr-4 text-lg font-bold">
                            Net Profit / (Loss): {actualReportData.netProfitLoss.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        </div>
                    </>
                    ) : ( // Summary Balance Sheet
                    <>
                        {renderSummarySection(actualReportData.assets)}
                        <hr className="my-4" />
                        {renderSummarySection(actualReportData.liabilities)}
                        {renderSummarySection(actualReportData.equity)}
                        <hr className="my-4" />
                        <div className="flex justify-end mt-4 pr-4 text-lg font-bold">
                            Total Liabilities and Equity: {actualReportData.totalLiabilitiesAndEquity.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        </div>
                        {Math.abs(actualReportData.assets.total - actualReportData.totalLiabilitiesAndEquity) > 0.01 && (
                            <p className="text-destructive text-right mt-2 pr-4 text-sm font-semibold">
                                Assets and Liabilities + Equity do not balance. Difference: ${(actualReportData.assets.total - actualReportData.totalLiabilitiesAndEquity).toFixed(2)}
                            </p>
                        )}
                    </>
                    )
                ) : ( // Columnar Reports
                    actualReportData.type === "ProfitAndLoss" ? (
                    <>
                        {renderColumnarSection(actualReportData.income, actualReportData.periods)}
                        {renderColumnarSection(actualReportData.expenses, actualReportData.periods)}
                        <hr className="my-4" />
                        <div className="flex justify-end mt-4 pr-4 font-bold text-lg">
                           <Table><TableBody><TableRow>
                            <TableCell className="w-[300px] pl-4">Net Profit / (Loss)</TableCell>
                             {actualReportData.netProfitLossByPeriod.map((total, i) => <TableCell key={i} className="text-right">{total.toLocaleString(undefined, {style: 'currency', currency: 'USD'})}</TableCell>)}
                             <TableCell className="text-right">{actualReportData.totalNetProfitLoss.toLocaleString(undefined, {style: 'currency', currency: 'USD'})}</TableCell>
                           </TableRow></TableBody></Table>
                        </div>
                    </>
                    ) : ( // Columnar Balance Sheet
                    <>
                        {renderColumnarSection(actualReportData.assets, actualReportData.periods)}
                        <hr className="my-4" />
                        {renderColumnarSection(actualReportData.liabilities, actualReportData.periods)}
                        {renderColumnarSection(actualReportData.equity, actualReportData.periods)}
                        <hr className="my-4" />
                         <div className="flex justify-end mt-4 pr-4 font-bold text-lg">
                           <Table><TableBody><TableRow>
                            <TableCell className="w-[300px] pl-4">Total Liabilities &amp; Equity</TableCell>
                             {actualReportData.totalLiabilitiesAndEquityByPeriod.map((total, i) => <TableCell key={i} className="text-right">{total.toLocaleString(undefined, {style: 'currency', currency: 'USD'})}</TableCell>)}
                             <TableCell className="text-right">{actualReportData.totalLiabilitiesAndEquity.toLocaleString(undefined, {style: 'currency', currency: 'USD'})}</TableCell>
                           </TableRow></TableBody></Table>
                        </div>
                    </>
                    )
                )}
                </CardContent>
                </Card>
            )}
             <ScrollBar orientation="horizontal" />
        </ScrollArea>

      </div>
    </AuthGuard>
  );
}
