
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { format, parseISO, isPast } from "date-fns";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DollarSign, CreditCard, TrendingUp, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, doc } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DashboardData {
  revenue: number;
  expenses: number;
  netIncome: number;
  overdueAmount: number;
  overdueCount: number;
}

export default function DashboardPage() {
  const { user, authStatus } = useAuth();
  const router = useRouter();
  const [isFetching, setIsFetching] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    revenue: 0,
    expenses: 0,
    netIncome: 0,
    overdueAmount: 0,
    overdueCount: 0,
  });

  const fetchDashboardData = useCallback(async () => {
    if (!user) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    
    try {
      const userProfileRef = doc(db, "userProfiles", user.uid);
      
      const accountsQuery = query(collection(userProfileRef, "chartOfAccounts"));
      const ledgerQuery = query(collection(userProfileRef, "all_transactions_ledger"));
      const invoicesQuery = query(collection(userProfileRef, "sales_invoices"), where("paymentStatus", "==", "Unpaid"));

      const [accountsSnapshot, ledgerSnapshot, invoicesSnapshot] = await Promise.all([
        getDocs(accountsQuery),
        getDocs(ledgerQuery),
        getDocs(invoicesQuery),
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
  }, [user]);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      fetchDashboardData();
    }
  }, [authStatus, fetchDashboardData]);

  if (authStatus !== 'authenticated') {
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
                {user?.displayName ? `${user.displayName}'s Dashboard` : "Company Dashboard"}
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
                    <CardTitle>Recent Activity</CardTitle>
                    <CardDescription>Placeholder for recent transactions or activities.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-center py-8">Activity feed coming soon...</p>
                </CardContent>
            </Card>
          </div>
        </main>
    </AuthGuard>
  );
}
