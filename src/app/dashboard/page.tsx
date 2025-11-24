
"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { format, parseISO, isPast, formatDistanceToNow } from "date-fns";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DollarSign, CreditCard, TrendingUp, AlertCircle, Briefcase, History } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useRouter } from "next/navigation";

import { useCompany } from "@/context/CompanyContext";
import { Badge } from "@/components/ui/badge";

interface DashboardData {
  revenue: number;
  expenses: number;
  netIncome: number;
  overdueAmount: number;
  overdueCount: number;
}

interface AuditLog {
  id: string;
  action: string;
  feature: string;
  changedFields: string[];
  createdAt: Timestamp;
  userId: string;
}

export default function DashboardPage() {
  const { selectedCompanyId } = useCompany();

  const { user } = useAuth();
  const router = useRouter();
  const [isFetching, setIsFetching] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    revenue: 0,
    expenses: 0,
    netIncome: 0,
    overdueAmount: 0,
    overdueCount: 0,
  });

  const fetchDashboardData = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    
    try {
      const accountsQuery = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
      const ledgerQuery = query(collection(db, "all_transactions_ledger"), where("companyId", "==", selectedCompanyId));
      const invoicesQuery = query(collection(db, "sales_invoices"), where("companyId", "==", selectedCompanyId), where("paymentStatus", "==", "Unpaid"));
      const auditLogsQuery = query(
        collection(db, "auditLogs"),
        where("companyId", "==", selectedCompanyId),
        orderBy("createdAt", "desc"),
        limit(10)
      );

      const [accountsSnapshot, ledgerSnapshot, invoicesSnapshot, auditLogsSnapshot] = await Promise.all([
        getDocs(accountsQuery),
        getDocs(ledgerQuery),
        getDocs(invoicesQuery),
        getDocs(auditLogsQuery),
      ]);

      const incomeAccountNames = new Set<string>();
      const expenseAccountNames = new Set<string>();
      accountsSnapshot.forEach(doc => {
        const account = doc.data();
        if (account.type?.toLowerCase().includes("income")) {
          incomeAccountNames.add(account.glAccount);
        } else if (account.type?.toLowerCase().includes("expense")) {
          expenseAccountNames.add(account.glAccount);
        }
      });

      let totalRevenue = 0;
      let totalExpenses = 0;
      ledgerSnapshot.forEach(doc => {
        const entry = doc.data();
        if (incomeAccountNames.has(entry.glAccount)) {
          totalRevenue += entry.creditAmount || 0;
        }
        if (expenseAccountNames.has(entry.glAccount)) {
          totalExpenses += entry.debitAmount || 0;
        }
      });
      
      let overdueAmount = 0;
      let overdueCount = 0;
      invoicesSnapshot.forEach(doc => {
        const invoice = doc.data();
        if (invoice.dueDate) {
          try {
            const dueDate = parseISO(invoice.dueDate);
            if (isPast(dueDate)) {
              overdueAmount += invoice.totalAmount || 0;
              overdueCount++;
            }
          } catch(e) {
            console.warn(`Could not parse due date for invoice ${doc.id}: ${invoice.dueDate}`)
          }
        }
      });

      const fetchedLogs: AuditLog[] = [];
      auditLogsSnapshot.forEach((doc) => {
        fetchedLogs.push({ id: doc.id, ...(doc.data() as Omit<AuditLog, 'id'>) });
      });
      setAuditLogs(fetchedLogs);

      setDashboardData({
        revenue: totalRevenue,
        expenses: totalExpenses,
        netIncome: totalRevenue - totalExpenses,
        overdueAmount,
        overdueCount,
      });


    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setIsFetching(false);
    }
  }, [user, selectedCompanyId]);

  useEffect(() => {
    if (user && selectedCompanyId) {
      fetchDashboardData();
    } else if (!selectedCompanyId && user) {
        setIsFetching(false);
    }
  }, [user, selectedCompanyId, fetchDashboardData]);

  if (!user) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <AuthGuard>
        <header className="p-6 border-b flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold font-headline">
                Dashboard
              </h1>
              <p className="text-muted-foreground">Here's your financial overview for today.</p>
            </div>
            <div className="md:hidden">
                <SidebarTrigger />
            </div>
        </header>
        <main className="p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isFetching ? (
                  <LoadingSpinner size="sm" className="my-2" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">${dashboardData.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <p className="text-xs text-muted-foreground">All-time revenue</p>
                  </>
                )}
              </CardContent>
            </Card>
             <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expenses</CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isFetching ? (
                  <LoadingSpinner size="sm" className="my-2" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">${dashboardData.expenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <p className="text-xs text-muted-foreground">All-time expenses</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Income</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                 {isFetching ? (
                  <LoadingSpinner size="sm" className="my-2" />
                ) : (
                  <>
                    <div className={`text-2xl font-bold ${dashboardData.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${dashboardData.netIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground">All-time net income</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overdue Invoices</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                 {isFetching ? (
                  <LoadingSpinner size="sm" className="my-2" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-red-600">
                      ${dashboardData.overdueAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground">{dashboardData.overdueCount} invoice(s) are overdue</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="mt-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center"><History className="mr-2 h-5 w-5" />Recent Activity</CardTitle>
                    <CardDescription>A log of the most recent actions performed in this company.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isFetching ? (
                        <div className="flex justify-center items-center py-8">
                            <LoadingSpinner />
                        </div>
                    ) : auditLogs.length > 0 ? (
                        <ul className="space-y-4">
                            {auditLogs.map(log => (
                                <li key={log.id} className="flex items-center space-x-4">
                                    <div className="flex-shrink-0">
                                        <Badge variant={log.action.includes('delete') ? 'destructive' : 'secondary'}>
                                            {log.action.replace(/_/g, ' ').toUpperCase()}
                                        </Badge>
                                    </div>
                                    <div className="flex-grow">
                                        <p className="text-sm font-medium">
                                            <span className="font-semibold">{log.feature.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:</span> {log.changedFields.join(', ')}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(log.createdAt.toDate(), { addSuffix: true })}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted-foreground text-center py-8">No recent activity found.</p>
                    )}
                </CardContent>
            </Card>
          </div>
        </main>
    </AuthGuard>
  );
}
