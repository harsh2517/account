
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LibraryBig, ArrowLeft, ArrowUp, ArrowDown, Trash2, AlertTriangle, FileDown, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp, writeBatch, doc } from "firebase/firestore";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from 'xlsx';
import { format, parse as dateFnsParse } from "date-fns";
import { Input } from "@/components/ui/input";


interface AllTransactionsLedgerItem {
  id: string;
  date: string; // Stored as "YYYY-MM-DD"
  description: string;
  source: string; // e.g., "Bank Transaction", "Sales Invoice", "Purchase Bill"
  sourceDocId: string; // ID of the original document
  customer: string | null;
  vendor: string | null;
  glAccount: string;
  debitAmount: number | null;
  creditAmount: number | null;
  createdAt: Timestamp;
}


interface SortConfig {
  key: keyof AllTransactionsLedgerItem | 'id' | null;
  direction: 'ascending' | 'descending';
}

export default function AllTransactionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [ledgerItems, setLedgerItems] = useState<AllTransactionsLedgerItem[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoading, setIsLoading] = useState(false); // For delete operations
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'descending' });
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [lastSelectedEntryId, setLastSelectedEntryId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const fetchLedgerItems = useCallback(async () => {
    if (!user) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(collection(db, "all_transactions_ledger"), where("userId", "==", user.uid));
      const querySnapshot = await getDocs(q);
      const fetchedItems: AllTransactionsLedgerItem[] = [];
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<AllTransactionsLedgerItem, 'id'>) });
      });
      setLedgerItems(fetchedItems);
    } catch (error) {
      console.error("Error fetching ledger items: ", error);
      toast({ title: "Error", description: "Could not fetch ledger items.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      fetchLedgerItems();
    } else {
        setLedgerItems([]);
    }
  }, [user, fetchLedgerItems]);

  const requestSort = (key: keyof AllTransactionsLedgerItem | 'id') => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedLedgerItems = useMemo(() => {
    let items = [...ledgerItems];

    if (searchTerm) {
        const lowerSearchTerm = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.id.toLowerCase().includes(lowerSearchTerm) ||
            item.date.toLowerCase().includes(lowerSearchTerm) ||
            item.description.toLowerCase().includes(lowerSearchTerm) ||
            item.source.toLowerCase().includes(lowerSearchTerm) ||
            item.sourceDocId.toLowerCase().includes(lowerSearchTerm) ||
            (item.customer && item.customer.toLowerCase().includes(lowerSearchTerm)) ||
            (item.vendor && item.vendor.toLowerCase().includes(lowerSearchTerm)) ||
            item.glAccount.toLowerCase().includes(lowerSearchTerm) ||
            (item.debitAmount !== null && String(item.debitAmount).includes(lowerSearchTerm)) ||
            (item.creditAmount !== null && String(item.creditAmount).includes(lowerSearchTerm))
        );
    }

    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        let valA = a[key as keyof AllTransactionsLedgerItem];
        let valB = b[key as keyof AllTransactionsLedgerItem];
        let comparison = 0;

        if (key === 'date') { 
          if (valA < valB) comparison = -1;
          if (valA > valB) comparison = 1;
          if (comparison === 0) {
              const createdAtA = a.createdAt?.toMillis() || 0;
              const createdAtB = b.createdAt?.toMillis() || 0;
              comparison = createdAtA - createdAtB;
          }
        } else if (key === 'debitAmount' || key === 'creditAmount') {
          const numA = valA === null ? -Infinity : (valA as number);
          const numB = valB === null ? -Infinity : (valB as number);
          if (numA < numB) comparison = -1;
          if (numA > numB) comparison = 1;
        } else {
          const strA = String(valA ?? '').toLowerCase();
          const strB = String(valB ?? '').toLowerCase();
          comparison = strA.localeCompare(strB);
        }
        return sortConfig.direction === 'ascending' ? comparison : -comparison;
      });
    }
    return items;
  }, [ledgerItems, sortConfig, searchTerm]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof AllTransactionsLedgerItem | 'id' }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />;
    }
    return null;
  };

  const handleToggleSelectEntry = (entryId: string, checked: boolean, isShift: boolean) => {
    setSelectedEntryIds(prevSelectedIds => {
        if (isShift && lastSelectedEntryId && lastSelectedEntryId !== entryId) {
            const currentIndex = filteredAndSortedLedgerItems.findIndex(item => item.id === entryId);
            const lastIndex = filteredAndSortedLedgerItems.findIndex(item => item.id === lastSelectedEntryId);

            if (currentIndex === -1 || lastIndex === -1) {
                return checked ? [...prevSelectedIds, entryId] : prevSelectedIds.filter(id => id !== entryId);
            }

            const start = Math.min(currentIndex, lastIndex);
            const end = Math.max(currentIndex, lastIndex);
            const idsInRange = filteredAndSortedLedgerItems.slice(start, end + 1).map(item => item.id);

            if (checked) {
                return Array.from(new Set([...prevSelectedIds, ...idsInRange]));
            } else {
                return prevSelectedIds.filter(id => !idsInRange.includes(id));
            }
        } else {
            if (!isShift) {
                setLastSelectedEntryId(entryId);
            }
            return checked ? [...prevSelectedIds, entryId] : prevSelectedIds.filter(id => id !== entryId);
        }
    });
  };

  const handleToggleSelectAllEntries = (checked: boolean) => {
    if (checked) {
      setSelectedEntryIds(filteredAndSortedLedgerItems.map(item => item.id));
    } else {
      setSelectedEntryIds([]);
    }
    setLastSelectedEntryId(null);
  };

  const handleOpenBulkDeleteDialog = () => {
    if (selectedEntryIds.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || selectedEntryIds.length === 0) return;
    setIsLoading(true);
    let unpostedSourceDocsCount = 0;
    let failedSourceDocs: string[] = [];

    try {
      const sourceDocIdsToProcess = Array.from(new Set(
        selectedEntryIds.map(selectedId => {
          const item = ledgerItems.find(it => it.id === selectedId);
          return item?.sourceDocId;
        }).filter(Boolean) as string[] // Filter out undefined/null and assert as string[]
      ));

      if (sourceDocIdsToProcess.length === 0) {
        toast({title: "No Source Documents Found", description: "Could not identify source documents for selected ledger entries.", variant: "destructive"});
        setIsLoading(false);
        return;
      }

      for (const sourceDocId of sourceDocIdsToProcess) {
        try {
          const batch = writeBatch(db);
          
          const ledgerQuery = query(
            collection(db, "all_transactions_ledger"),
            where("userId", "==", user.uid),
            where("sourceDocId", "==", sourceDocId)
          );
          const ledgerSnapshot = await getDocs(ledgerQuery);
          ledgerSnapshot.forEach(doc => batch.delete(doc.ref));

          const exampleItemForSource = ledgerItems.find(item => item.sourceDocId === sourceDocId);
          let sourceCollectionName = "transactions"; 
          
          if (exampleItemForSource?.source === "Bank Transaction") {
            sourceCollectionName = "transactions";
          }
          // TODO: Add else if blocks here for other source types if needed

          const sourceTransactionRef = doc(db, sourceCollectionName, sourceDocId);
          batch.update(sourceTransactionRef, { isLedgerApproved: false });
          
          await batch.commit();
          unpostedSourceDocsCount++;
        } catch (innerError) {
          console.error(`Error unposting source document ${sourceDocId}:`, innerError);
          failedSourceDocs.push(sourceDocId);
        }
      }

      let toastTitle = "Bulk Unpost Status";
      let toastDescription = "";
      let toastVariant: "default" | "destructive" = "default";

      if (unpostedSourceDocsCount > 0) {
        toastDescription += `Successfully unposted ${unpostedSourceDocsCount} source document(s). `;
      }
      if (failedSourceDocs.length > 0) {
        toastDescription += `Failed to unpost ${failedSourceDocs.length} source document(s): ${failedSourceDocs.slice(0,3).join(', ')}${failedSourceDocs.length > 3 ? '...' : ''}. Check console for details.`;
        toastVariant = unpostedSourceDocsCount === 0 ? "destructive" : "default"; 
        toastTitle = unpostedSourceDocsCount > 0 ? "Partial Bulk Unpost" : "Bulk Unpost Failed";
      } else if (unpostedSourceDocsCount > 0) {
        toastTitle = "Bulk Unpost Successful";
      } else {
        toastTitle = "No Changes Made";
        toastDescription = "No source documents were unposted. This might happen if selected entries were already unposted or if issues occurred.";
      }
      
      toast({
        title: toastTitle,
        description: toastDescription,
        variant: toastVariant,
        duration: failedSourceDocs.length > 0 ? 10000 : 5000,
      });

      await fetchLedgerItems(); 
      setSelectedEntryIds([]);
      setIsBulkDeleteDialogOpen(false);

    } catch (error) { 
      console.error("Error during bulk unposting process:", error);
      toast({title: "Bulk Unpost Failed", description: "An unexpected error occurred during the unposting process.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportToExcel = () => {
    if (filteredAndSortedLedgerItems.length === 0) {
      toast({ title: "No Data to Export", description: "There are no ledger entries to export.", variant: "default" });
      return;
    }

    const exportData = filteredAndSortedLedgerItems.map(item => ({
      'ID': item.id,
      'Date': item.date ? format(dateFnsParse(item.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : "",
      'Description': item.description,
      'Source': item.source,
      'Source Doc ID': item.sourceDocId,
      'Customer': item.customer || '',
      'Vendor': item.vendor || '',
      'GL Account': item.glAccount,
      'Debit Amount': item.debitAmount !== null ? item.debitAmount : '',
      'Credit Amount': item.creditAmount !== null ? item.creditAmount : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "LedgerEntries");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `all_transactions_ledger_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Ledger entries exported to Excel." });
  };


  const commonButtonDisabled = isLoading || isFetching;
  
  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedLedgerItems.length === 0) return false;
    return filteredAndSortedLedgerItems.every(item => selectedEntryIds.includes(item.id));
  }, [filteredAndSortedLedgerItems, selectedEntryIds]);


  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <LibraryBig className="mr-3 h-10 w-10 text-primary" />
              All Transactions (General Ledger)
            </h1>
            <p className="text-lg text-muted-foreground">
              A consolidated view of all financial transactions.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedLedgerItems.length === 0}>
                <FileDown className="mr-2 h-4 w-4" /> Export to Excel
            </Button>
            <Button variant="outline" asChild>
                <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
                </Link>
            </Button>
          </div>
        </header>

        <div className="mb-4 flex justify-between items-center">
            <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                    type="search"
                    placeholder="Search ledger entries..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    disabled={commonButtonDisabled}
                />
            </div>
            {selectedEntryIds.length > 0 && (
                <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between ml-4 flex-grow">
                    <span className="text-sm font-medium">{selectedEntryIds.length} entr(y/ies) selected (from {new Set(selectedEntryIds.map(id => ledgerItems.find(item => item.id === id)?.sourceDocId)).size} source document(s))</span>
                    <div className="space-x-2">
                        <Button size="sm" variant="destructive" onClick={handleOpenBulkDeleteDialog} disabled={commonButtonDisabled}>
                            <Trash2 className="mr-2 h-4 w-4" /> Unpost Selected from Ledger
                        </Button>
                    </div>
                </div>
            )}
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Ledger Details</CardTitle>
            <CardDescription>
              This table displays all recorded debit and credit entries. Dates are displayed as MM/DD/YYYY.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Loading ledger data...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={isSelectAllChecked}
                          onCheckedChange={(checked) => handleToggleSelectAllEntries(Boolean(checked))}
                          aria-label="Select all entries"
                          disabled={commonButtonDisabled || filteredAndSortedLedgerItems.length === 0}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('id')}>
                        <div className="flex items-center">ID <SortIndicator columnKey="id" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('date')}>
                        <div className="flex items-center">Date <SortIndicator columnKey="date" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('description')}>
                        <div className="flex items-center">Description <SortIndicator columnKey="description" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('source')}>
                        <div className="flex items-center">Source <SortIndicator columnKey="source" /></div>
                      </TableHead>
                       <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('sourceDocId')}>
                        <div className="flex items-center">Source Doc ID <SortIndicator columnKey="sourceDocId" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('customer')}>
                        <div className="flex items-center">Customer <SortIndicator columnKey="customer" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('vendor')}>
                        <div className="flex items-center">Vendor <SortIndicator columnKey="vendor" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('glAccount')}>
                        <div className="flex items-center">GL Account <SortIndicator columnKey="glAccount" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('debitAmount')}>
                        <div className="flex items-center justify-end">Debit <SortIndicator columnKey="debitAmount" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('creditAmount')}>
                        <div className="flex items-center justify-end">Credit <SortIndicator columnKey="creditAmount" /></div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedLedgerItems.length > 0 ? (
                      filteredAndSortedLedgerItems.map((item) => (
                        <TableRow key={item.id} data-state={selectedEntryIds.includes(item.id) ? "selected" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedEntryIds.includes(item.id)}
                              onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => setIsShiftKeyPressed(e.shiftKey)}
                              onCheckedChange={(checked) => 
                                  handleToggleSelectEntry(
                                      item.id, 
                                      Boolean(checked),
                                      isShiftKeyPressed
                                  )
                              }
                              aria-labelledby={`select-entry-${item.id}`}
                              disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell className="text-xs">{item.id}</TableCell>
                          <TableCell>{item.date ? format(dateFnsParse(item.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : ""}</TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell>{item.source}</TableCell>
                          <TableCell className="text-xs">{item.sourceDocId}</TableCell>
                          <TableCell>{item.customer || '-'}</TableCell>
                          <TableCell>{item.vendor || '-'}</TableCell>
                          <TableCell>{item.glAccount}</TableCell>
                          <TableCell className="text-right">
                            {item.debitAmount !== null ? `$${item.debitAmount.toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.creditAmount !== null ? `$${item.creditAmount.toFixed(2)}` : "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                          {searchTerm ? "No ledger entries match your search." : "No ledger entries found. Transactions from other modules will appear here."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center">
                <AlertTriangle className="mr-2 h-6 w-6 text-destructive" /> Confirm Unpost from Ledger
            </DialogTitle>
            <DialogDescription>
              You are about to remove all ledger entries associated with the source document(s) of the selected line(s).
              This will also mark the original source transaction(s) (e.g., in Bank Transactions) as 'Pending' for ledger approval.
              <br /><br />
              This action effectively 'unposts' the transaction(s) from the ledger.
              <br /><br />
              Are you sure you want to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)} disabled={isLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={isLoading}>
              {isLoading && <LoadingSpinner className="mr-2" />} Unpost from Ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}
