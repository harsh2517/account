
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileSpreadsheet, TrendingUp, Scale, ArrowRight, LibraryBig, BookOpen, UserSquare } from "lucide-react";
import Link from "next/link";
import React from "react";

export default function FinancialReportsPage() {
  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <FileSpreadsheet className="mr-3 h-10 w-10 text-primary" />
              Financial Reports
            </h1>
            <p className="text-lg text-muted-foreground">
              Select a report to generate for your business.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center space-x-3 mb-2">
                <TrendingUp className="h-8 w-8 text-primary" />
                <CardTitle className="text-2xl font-medium font-headline">
                  Profit and Loss Report
                </CardTitle>
              </div>
              <CardDescription>
                View your company's financial performance over a specific period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/financial-reports/profit-and-loss">
                  Generate P&L Report
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center space-x-3 mb-2">
                <Scale className="h-8 w-8 text-primary" />
                <CardTitle className="text-2xl font-medium font-headline">
                  Balance Sheet Report
                </CardTitle>
              </div>
              <CardDescription>
                Get a snapshot of your company's assets, liabilities, and equity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/financial-reports/balance-sheet">
                  Generate Balance Sheet
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          
          <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center space-x-3 mb-2">
                <LibraryBig className="h-8 w-8 text-primary" /> 
                <CardTitle className="text-2xl font-medium font-headline">
                  General Ledger Report
                </CardTitle>
              </div>
              <CardDescription>
                View a detailed list of all transactions posted to each account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/all-transactions">
                  View General Ledger
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center space-x-3 mb-2">
                <BookOpen className="h-8 w-8 text-primary" />
                <CardTitle className="text-2xl font-medium font-headline">
                  Account Transaction Report
                </CardTitle>
              </div>
              <CardDescription>
                View a detailed list of transactions for a specific GL account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/financial-reports/account-transaction">
                  Generate Report
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300">
            <CardHeader>
              <div className="flex items-center space-x-3 mb-2">
                <UserSquare className="h-8 w-8 text-primary" />
                <CardTitle className="text-2xl font-medium font-headline">
                  Contact Transaction Report
                </CardTitle>
              </div>
              <CardDescription>
                View a complete transaction history and balance for a specific customer or vendor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/financial-reports/contact-transaction">
                  Generate Report
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </AuthGuard>
  );
}
