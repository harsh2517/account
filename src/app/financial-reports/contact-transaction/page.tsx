
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { format, startOfMonth, endOfMonth, parse, isValid, differenceInCalendarDays } from "date-fns";
import { ArrowLeft, CalendarIcon, UserSquare, FileDown } from "lucide-react";
import * as XLSX from 'xlsx';

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";

interface PageContactItem {
  id: string;
  name: string;
  type: "Customer" | "Vendor";
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

const MAX_DATE_RANGE_DAYS = 1096; // 3 years

export default function ContactTransactionReportPage() {
  const { user } = useAuth();
  const { selectedCompanyId, selectedCompanyName } = useCompany();
  const { toast } = useToast();
  const { logAction } = useAuditLog();

  const [startDate, setStartDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [selectedContact, setSelectedContact] = useState<string>("");

  const [ledgerEntries, setLedgerEntries] = useState<AllTransactionsLedgerItem[]>([]);
  const [contacts, setContacts] = useState<PageContactItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingInitialData, setIsFetchingInitialData] = useState(true);

  const fetchInitialData = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetchingInitialData(false);
      return;
    }
    setIsFetchingInitialData(true);
    try {
      const contactsQuery = query(collection(db, "contacts"), where("companyId", "==", selectedCompanyId));
      const contactsSnapshot = await getDocs(contactsQuery);
      const fetchedContacts: PageContactItem[] = [];
      contactsSnapshot.forEach(doc => {
        fetchedContacts.push({
          id: doc.id,
          name: doc.data().name,
          type: doc.data().type,
        });
      });
      setContacts(fetchedContacts.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Error fetching initial data:", error);
      toast({ title: "Error Fetching Data", description: "Could not fetch contacts.", variant: "destructive" });
    } finally {
      setIsFetchingInitialData(false);
    }
  }, [user, selectedCompanyId, toast]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleGenerateReport = useCallback(async () => {
    if (!user || !selectedCompanyId) return;
    if (!startDate || !endDate || !selectedContact) {
      toast({ title: "Missing Information", description: "Please select a contact and a valid date range.", variant: "destructive" });
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
    setLedgerEntries([]);
    const contactInfo = contacts.find(c => c.name === selectedContact);
    if (!contactInfo) {
        toast({ title: "Error", description: "Selected contact not found.", variant: "destructive" });
        setIsLoading(false);
        return;
    }
    
    const filterField = contactInfo.type === "Customer" ? "customer" : "vendor";

    try {
      const ledgerQuery = query(
        collection(db, "all_transactions_ledger"),
        where("companyId", "==", selectedCompanyId),
        where(filterField, "==", selectedContact),
        where("date", ">=", format(startDate, "yyyy-MM-dd")),
        where("date", "<=", format(endDate, "yyyy-MM-dd"))
      );

      const ledgerSnapshot = await getDocs(ledgerQuery);
      const fetchedLedgerItems: AllTransactionsLedgerItem[] = [];
      ledgerSnapshot.forEach(doc => fetchedLedgerItems.push({ id: doc.id, ...doc.data() } as AllTransactionsLedgerItem));
      
      fetchedLedgerItems.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.toMillis() - b.createdAt.toMillis());
      
      setLedgerEntries(fetchedLedgerItems);

      if(fetchedLedgerItems.length === 0) {
        toast({ title: "No Transactions Found", description: "No transactions were found for this contact in the selected period.", variant: "default" });
      } else {
        logAction("generate_report", "Contact Transaction Report", [`Contact: ${selectedContact}`]);
      }
    } catch (error) {
      console.error("Error generating report:", error);
      toast({ title: "Report Error", description: "Could not generate the transaction report.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [user, selectedCompanyId, startDate, endDate, selectedContact, contacts, toast, logAction]);
  
  const reportWithBalance = useMemo(() => {
    let runningBalance = 0;
    return ledgerEntries.map(entry => {
        const balanceChange = (entry.debitAmount || 0) - (entry.creditAmount || 0);
        runningBalance += balanceChange;
        return { ...entry, balance: runningBalance };
    });
  }, [ledgerEntries]);

  const handleExportToExcel = () => {
    if (reportWithBalance.length === 0) {
      toast({ title: "No Data to Export", description: "There is no report data to export.", variant: "default" });
      return;
    }
    const exportData = reportWithBalance.map(item => ({
      'Date': item.date ? format(dateFnsParse(item.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : "",
      'Description': item.description,
      'Source': item.source,
      'GL Account': item.glAccount,
      'Debit': item.debitAmount,
      'Credit': item.creditAmount,
      'Balance': item.balance
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Contact_Transactions");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `contact_transaction_report_${selectedContact.replace(/ /g, '_')}_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Report exported to Excel." });
    logAction("export_report", "Contact Transaction Report", [`Contact: ${selectedContact}`]);
  };

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center">
            <UserSquare className="mr-3 h-10 w-10 text-primary" />
            <div>
              <h1 className="text-4xl font-bold font-headline">Contact Transaction Report</h1>
              <p className="text-lg text-muted-foreground">View all transactions for a specific customer or vendor.</p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/financial-reports"><ArrowLeft className="mr-2 h-4 w-4" />Back to Reports Menu</Link>
          </Button>
        </header>

        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle>Report Options</CardTitle>
            <CardDescription>Select the contact and date range for the report.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
            <div className="w-full sm:w-auto sm:flex-grow">
              <Label htmlFor="contact-select">Customer/Vendor *</Label>
              <Select value={selectedContact} onValueChange={setSelectedContact} disabled={isFetchingInitialData || contacts.length === 0}>
                <SelectTrigger id="contact-select" className="mt-1">
                  <SelectValue placeholder={isFetchingInitialData ? "Loading..." : (contacts.length === 0 ? "No contacts found" : "Select a contact")} />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map(contact => <SelectItem key={contact.id} value={contact.name}>{contact.name} ({contact.type})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-auto">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "MM/dd/yyyy") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={startDate} onSelect={setStartDate} /></PopoverContent>
              </Popover>
            </div>
            <div className="w-full sm:w-auto">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !endDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "MM/dd/yyyy") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={endDate} onSelect={setEndDate} /></PopoverContent>
              </Popover>
            </div>
            <Button onClick={handleGenerateReport} disabled={isLoading || isFetchingInitialData || !selectedContact} className="w-full sm:w-auto">
              {isLoading ? <LoadingSpinner className="mr-2" /> : null}
              Generate Report
            </Button>
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex justify-center items-center py-10">
            <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Generating report...</span>
          </div>
        )}

        {!isLoading && reportWithBalance.length > 0 && (
          <Card className="shadow-lg">
            <CardHeader className="flex flex-row justify-between items-center">
              <div>
                <CardTitle>{selectedContact}</CardTitle>
                <CardDescription>Transactions from {format(startDate!, 'MM/dd/yyyy')} to {format(endDate!, 'MM/dd/yyyy')}</CardDescription>
              </div>
              <Button variant="outline" onClick={handleExportToExcel}><FileDown className="mr-2 h-4 w-4" /> Export to Excel</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>GL Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportWithBalance.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell>{format(dateFnsParse(entry.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy")}</TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>{entry.source}</TableCell>
                      <TableCell>{entry.glAccount}</TableCell>
                      <TableCell className="text-right">{entry.debitAmount?.toLocaleString('en-US', {style:'currency', currency:'USD'}) || '-'}</TableCell>
                      <TableCell className="text-right">{entry.creditAmount?.toLocaleString('en-US', {style:'currency', currency:'USD'}) || '-'}</TableCell>
                      <TableCell className="text-right font-medium">{entry.balance.toLocaleString('en-US', {style:'currency', currency:'USD'})}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AuthGuard>
  );
}
