
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FilePlus2, Upload, FileDown, Library, Trash2, Edit3, Search, ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, AlertCircle, PlusCircle, Calendar as CalendarIcon, Download } from "lucide-react";
import Link from "next/link";
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp, writeBatch, doc, deleteDoc, addDoc } from "firebase/firestore";
import type { WriteBatch } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogTrigger, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import * as XLSX from 'xlsx';
import { format, parse as dateFnsParse, isValid as isDateValid, parseISO } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { nanoid } from "nanoid";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";


interface JournalEntryLine {
  id: string;
  userId: string;
  journalSetId: string;
  date: string; // YYYY-MM-DD
  description: string;
  glAccount: string;
  vendorOrCustomer?: string | null;
  debitAmount: number | null;
  creditAmount: number | null;
  isLedgerApproved: boolean;
  createdAt: Timestamp;
}

interface NewJournalLineItem {
  localId: string;
  description: string;
  glAccount: string;
  vendorOrCustomer: string;
  debitAmount: string;
  creditAmount: string;
}

const FS_OPTIONS_JE = ["Profit and Loss", "Balance Sheet"] as const;
type FSOptionJE = typeof FS_OPTIONS_JE[number];

const TYPE_OPTIONS_JE = [
  "Direct Income", "Indirect Income",
  "Direct Expense", "Indirect Expense",
  "Non Current Asset", "Current Asset",
  "Current Liability", "Non Current Liability",
  "Equity"
] as const;
type TypeOptionJE = typeof TYPE_OPTIONS_JE[number];

interface ChartOfAccountItem {
  id: string;
  userId?: string;
  glAccount: string;
  subType: string;
  type: TypeOptionJE;
  fs?: FSOptionJE;
  accountNumber?: string;
  createdAt?: Timestamp;
}

interface PageContactItem {
  id: string;
  name: string;
  type: "Customer" | "Vendor";
}




interface SortConfig {
  key: keyof JournalEntryLine | 'id' | null;
  direction: 'ascending' | 'descending';
}

interface AllTransactionsLedgerItemNoId {
  userId: string;
  date: string;
  description: string;
  source: string;
  sourceDocId: string;
  customer: string | null;
  vendor: string | null;
  glAccount: string;
  debitAmount: number | null;
  creditAmount: number | null;
  createdAt: any;
}

// --- Import Dialog State & Types ---
interface ImportColumnMapping {
    date: string;
    description: string;
    glAccount: string;
    vendorOrCustomer: string;
    debitAmount: string;
    creditAmount: string;
    journalSetIdExcel: string; // Optional ID from Excel for grouping
}
const SKIP_COLUMN_VALUE_IMPORT = "__SKIP_IMPORT__";

interface SkippedImportLine {
    originalRow: any[];
    reason: string;
}


// Helper function to normalize GL account names (copied from historical-reference-data)
const enhancedNormalizeGlAccountName = (name: string): string => {
  if (!name) return "";
  let normalized = name.toLowerCase();
  normalized = normalized.trim(); // Initial trim
  normalized = normalized.replace(/&|\/|-|_/g, ' '); // Replace common separators with a space
  normalized = normalized.trim(); // Trim again after replacing separators
  normalized = normalized.replace(/\s+/g, ' ');    // Collapse multiple spaces to one
  normalized = normalized.replace(/[^a-z0-9\s]/g, ''); // Remove any remaining non-alphanumeric (except spaces)
  return normalized.trim(); // Final trim
};

const addJournalEntryLineToLedger = (
  batch: WriteBatch,
  userId: string,
  line: Pick<JournalEntryLine, 'id' | 'date' | 'description' | 'glAccount' | 'debitAmount' | 'creditAmount' | 'vendorOrCustomer'>,
  contactType?: "Customer" | "Vendor"
) => {
  let finalVendor = null;
  let finalCustomer = null;

  if (line.vendorOrCustomer) {
    if (contactType === "Customer") {
        finalCustomer = line.vendorOrCustomer;
    } else {
        finalVendor = line.vendorOrCustomer;
    }
  }
  
  const ledgerRef = collection(db, "all_transactions_ledger");

  const commonLedgerData = {
    userId: userId,
    date: line.date,
    description: line.description,
    source: "Journal Entry",
    sourceDocId: line.id,
    customer: finalCustomer,
    vendor: finalVendor,
    createdAt: serverTimestamp(),
  };

  if (line.debitAmount && line.debitAmount > 0) {
    const ledgerEntry: AllTransactionsLedgerItemNoId = {
      ...commonLedgerData,
      glAccount: line.glAccount,
      debitAmount: line.debitAmount,
      creditAmount: null,
    };
    batch.set(doc(ledgerRef), ledgerEntry);
  } else if (line.creditAmount && line.creditAmount > 0) {
    const ledgerEntry: AllTransactionsLedgerItemNoId = {
      ...commonLedgerData,
      glAccount: line.glAccount,
      debitAmount: null,
      creditAmount: line.creditAmount,
    };
    batch.set(doc(ledgerRef), ledgerEntry);
  }
};

const deleteJournalEntryLineFromLedger = async (userId: string, lineId: string, batch?: WriteBatch) => {
    const ledgerRef = collection(db, "all_transactions_ledger");
    const ledgerQuery = query(
        ledgerRef,
        where("userId", "==", userId),
        where("source", "==", "Journal Entry"),
        where("sourceDocId", "==", lineId)
    );
    const ledgerSnapshot = await getDocs(ledgerQuery);
    
    const localBatch = batch || writeBatch(db);
    ledgerSnapshot.forEach(doc => localBatch.delete(doc.ref));
    
    if (!batch) {
        await localBatch.commit();
    }
};

async function ensureContactExistsAndAddToBatchJE(
  userId: string,
  contactName: string,
  potentialType: "Customer" | "Vendor",
  existingContacts: PageContactItem[],
  batch: WriteBatch
): Promise<boolean> {
  if (!contactName || contactName === "-") {
    return false;
  }
  const trimmedContactName = contactName.trim();
  const normalizedContactName = trimmedContactName.toLowerCase();
  
  const contactExists = existingContacts.some(
    (c) => c.name.trim().toLowerCase() === normalizedContactName
  );

  if (!contactExists) {
    const newContactRef = doc(collection(db, "contacts"));
    batch.set(newContactRef, {
      userId: userId,
      name: trimmedContactName,
      type: potentialType,
      address: null,
      contactNumber: null,
      email: null,
      createdAt: serverTimestamp(),
    });
    existingContacts.push({ id: newContactRef.id, name: trimmedContactName, type: potentialType });
    return true;
  }
  return false;
}


export default function JournalEntryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [journalEntryLines, setJournalEntryLines] = useState<JournalEntryLine[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingJournalEntry, setIsSavingJournalEntry] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'descending' });
  const [selectedEntryLineIds, setSelectedEntryLineIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [lastSelectedEntryLineId, setLastSelectedEntryLineId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isBulkPostDialogOpen, setIsBulkPostDialogOpen] = useState(false);
  const [isBulkUnpostDialogOpen, setIsBulkUnpostDialogOpen] = useState(false);

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true);
  const [contacts, setContacts] = useState<PageContactItem[]>([]);
  const [isFetchingContacts, setIsFetchingContacts] = useState(true);

  const [isCreateEntryDialogOpen, setIsCreateEntryDialogOpen] = useState(false);
  const [newEntryDate, setNewEntryDate] = useState<Date | undefined>(new Date());
  const [newEntryLines, setNewEntryLines] = useState<NewJournalLineItem[]>([]);

  // --- Import Dialog State ---
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFileImport, setSelectedFileImport] = useState<File | null>(null);
  const [excelHeadersImport, setExcelHeadersImport] = useState<string[]>([]);
  const [excelDataImport, setExcelDataImport] = useState<any[][]>([]);
  const [columnMappingsImport, setColumnMappingsImport] = useState<ImportColumnMapping>({
    date: '', description: '', glAccount: '', vendorOrCustomer: '', debitAmount: '', creditAmount: '', journalSetIdExcel: ''
  });
  const [isLoadingImport, setIsLoadingImport] = useState(false);
  const [isImportSummaryDialogOpen, setIsImportSummaryDialogOpen] = useState(false);
  const [importedJournalEntriesCount, setImportedJournalEntriesCount] = useState(0);
  const [importedLinesCountState, setImportedLinesCountState] = useState(0);
  const [skippedLinesForImport, setSkippedLinesForImport] = useState<SkippedImportLine[]>([]);
  const [missingGlAccountsForImportDialog, setMissingGlAccountsForImportDialog] = useState<string[]>([]);


  const fetchJournalEntryLines = useCallback(async () => {
    if (!user) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(collection(db, "journal_entry_lines"), where("userId", "==", user.uid));
      const querySnapshot = await getDocs(q);
      const fetchedLines: JournalEntryLine[] = [];
      querySnapshot.forEach((doc) => {
        fetchedLines.push({ id: doc.id, ...(doc.data() as Omit<JournalEntryLine, 'id'>) });
      });
      fetchedLines.sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        const createdAtA = a.createdAt?.toMillis() || 0;
        const createdAtB = b.createdAt?.toMillis() || 0;
        return createdAtB - createdAtA;
      });
      setJournalEntryLines(fetchedLines);
    } catch (error) {
      console.error("Error fetching journal entry lines: ", error);
      toast({ title: "Error", description: "Could not fetch journal entry lines.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, toast]);

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user) {
        setIsFetchingChartOfAccounts(false);
        return;
    }
    setIsFetchingChartOfAccounts(true);
    try {
      const q = query(collection(db, "chartOfAccounts"), where("userId", "==", user.uid));
      const querySnapshot = await getDocs(q);
      const coa: ChartOfAccountItem[] = [];
      querySnapshot.forEach(doc => coa.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, 'id'>) }));
      coa.sort((a,b) => a.glAccount.localeCompare(b.glAccount));
      setChartOfAccounts(coa);
    } catch (error) {
      console.error("Error fetching chart of accounts for validation:", error);
      toast({ title: "CoA Error", description: "Could not fetch Chart of Accounts.", variant: "destructive" });
    } finally {
        setIsFetchingChartOfAccounts(false);
    }
  }, [user, toast]);
  
  const fetchContacts = useCallback(async () => {
    if (!user) {
        setIsFetchingContacts(false);
        return;
    }
    setIsFetchingContacts(true);
    try {
        const q = query(collection(db, "contacts"), where("userId", "==", user.uid));
        const snapshot = await getDocs(q);
        const fetchedContacts: PageContactItem[] = [];
        snapshot.forEach(docSnap => fetchedContacts.push({id: docSnap.id, name: docSnap.data().name, type: docSnap.data().type}));
        setContacts(fetchedContacts.sort((a,b) => a.name.localeCompare(b.name)));
    } catch (error) {
        console.error("Error fetching contacts:", error);
        toast({title: "Contacts Error", description: "Could not fetch contacts.", variant: "destructive"});
    } finally {
        setIsFetchingContacts(false);
    }
  }, [user, toast]);


  useEffect(() => {
    if (user) {
      fetchJournalEntryLines();
      fetchChartOfAccounts();
      fetchContacts();
    }
  }, [user, fetchJournalEntryLines, fetchChartOfAccounts, fetchContacts]);

  const requestSort = (key: keyof JournalEntryLine | 'id') => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedLines = useMemo(() => {
    let items = [...journalEntryLines];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      items = items.filter(line =>
        line.id.toLowerCase().includes(lowerSearchTerm) ||
        line.journalSetId.toLowerCase().includes(lowerSearchTerm) ||
        line.date.toLowerCase().includes(lowerSearchTerm) ||
        line.description.toLowerCase().includes(lowerSearchTerm) ||
        line.glAccount.toLowerCase().includes(lowerSearchTerm) ||
        (line.vendorOrCustomer && line.vendorOrCustomer.toLowerCase().includes(lowerSearchTerm)) ||
        (line.debitAmount !== null && String(line.debitAmount).includes(lowerSearchTerm)) ||
        (line.creditAmount !== null && String(line.creditAmount).includes(lowerSearchTerm))
      );
    }

    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        let valA = a[key as keyof JournalEntryLine];
        let valB = b[key as keyof JournalEntryLine];
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
  }, [journalEntryLines, sortConfig, searchTerm]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof JournalEntryLine | 'id' }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />;
    }
    return null;
  };

  const handleToggleSelectLine = (lineId: string, checked: boolean, isShift: boolean) => {
    setSelectedEntryLineIds(prevSelectedIds => {
      if (isShift && lastSelectedEntryLineId && lastSelectedEntryLineId !== lineId) {
        const currentIndex = filteredAndSortedLines.findIndex(line => line.id === lineId);
        const lastIndex = filteredAndSortedLines.findIndex(line => line.id === lastSelectedEntryLineId);
        if (currentIndex === -1 || lastIndex === -1) {
          return checked ? [...prevSelectedIds, lineId] : prevSelectedIds.filter(id => id !== lineId);
        }
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const idsInRange = filteredAndSortedLines.slice(start, end + 1).map(line => line.id);
        return checked ? Array.from(new Set([...prevSelectedIds, ...idsInRange])) : prevSelectedIds.filter(id => !idsInRange.includes(id));
      } else {
        if (!isShift) setLastSelectedEntryLineId(lineId);
        return checked ? [...prevSelectedIds, lineId] : prevSelectedIds.filter(id => id !== lineId);
      }
    });
  };

  const handleToggleSelectAllLines = (checked: boolean) => {
    setSelectedEntryLineIds(checked ? filteredAndSortedLines.map(line => line.id) : []);
    setLastSelectedEntryLineId(null);
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || selectedEntryLineIds.length === 0) return;
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      for (const lineId of selectedEntryLineIds) {
        const lineToDelete = journalEntryLines.find(l => l.id === lineId);
        if (lineToDelete?.isLedgerApproved) {
          await deleteJournalEntryLineFromLedger(user.uid, lineId, batch);
        }
        batch.delete(doc(db, "journal_entry_lines", lineId));
      }
      await batch.commit();
      toast({ title: "Bulk Delete Successful", description: `${selectedEntryLineIds.length} journal entry line(s) deleted.` });
      await fetchJournalEntryLines();
      setSelectedEntryLineIds([]);
    } catch (error) {
      console.error("Error bulk deleting lines:", error);
      toast({ title: "Bulk Delete Failed", description: "Could not delete selected lines.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsBulkDeleteDialogOpen(false);
    }
  };

  const handleConfirmBulkPostToLedger = async () => {
    if (!user || selectedEntryLineIds.length === 0) return;
    setIsLoading(true);

    const linesToPost = journalEntryLines.filter(line => selectedEntryLineIds.includes(line.id) && !line.isLedgerApproved);
    if (linesToPost.length === 0) {
      toast({ title: "No Action Needed", description: "Selected lines are already posted or none were selected for posting.", variant: "default" });
      setIsLoading(false);
      setIsBulkPostDialogOpen(false);
      return;
    }
    if (isFetchingChartOfAccounts || chartOfAccounts.length === 0) {
        toast({ title: "Chart of Accounts Needed", description: "Chart of Accounts data is unavailable or not loaded. Please ensure it's set up.", variant: "destructive" });
        setIsLoading(false);
        setIsBulkPostDialogOpen(false);
        return;
    }

    let postedCount = 0;
    let contactsCreatedCount = 0;
    const postingErrors: string[] = [];
    const coaGlNamesLower = chartOfAccounts.map(coa => coa.glAccount.toLowerCase().trim());
    
    const contactsQuery = query(collection(db, "contacts"), where("userId", "==", user.uid));
    const contactsSnapshot = await getDocs(contactsQuery);
    const currentContacts: PageContactItem[] = [];
    contactsSnapshot.forEach((docSnap) => {
        currentContacts.push({ id: docSnap.id, ...(docSnap.data() as Omit<PageContactItem, 'id'>) });
    });

    try {
      const batch = writeBatch(db);
      for (const line of linesToPost) {
        if (!coaGlNamesLower.includes(line.glAccount.toLowerCase().trim())) {
          postingErrors.push(`GL Account "${line.glAccount}" for entry "${line.description.substring(0,20)}..." (ID: ${line.id.substring(0,5)}) not found in Chart of Accounts.`);
          continue;
        }

        let contactTypeForLedger: "Customer" | "Vendor" | undefined = undefined;
        if (line.vendorOrCustomer && line.vendorOrCustomer.trim() !== "") {
            let potentialContactType: "Customer" | "Vendor" = "Vendor"; // Default
            if (line.creditAmount && line.creditAmount > 0) { // Simple heuristic: credit usually implies customer
                potentialContactType = "Customer";
            }
            const newContactCreated = await ensureContactExistsAndAddToBatchJE(
                user.uid,
                line.vendorOrCustomer,
                potentialContactType,
                currentContacts,
                batch
            );
            if (newContactCreated) contactsCreatedCount++;
            contactTypeForLedger = potentialContactType;
        }
        
        addJournalEntryLineToLedger(batch, user.uid, line, contactTypeForLedger);
        batch.update(doc(db, "journal_entry_lines", line.id), { isLedgerApproved: true });
        postedCount++;
      }
      if (postedCount > 0 || contactsCreatedCount > 0) {
        await batch.commit();
      }

      let toastTitle = "Ledger Posting Processed";
      let toastDescription = "";
      let toastVariant: "default" | "destructive" = "default";

      if (postedCount > 0) {
        toastDescription += `${postedCount} line(s) posted to ledger. `;
      }
      if (contactsCreatedCount > 0) {
        toastDescription += `${contactsCreatedCount} new contact(s) auto-created. `;
      }
      if (postingErrors.length > 0) {
        toastDescription += `Failed to post ${postingErrors.length} line(s). ${postingErrors.slice(0,2).join(' ')}${postingErrors.length > 2 ? '...' : ''} Check console for details.`;
        postingErrors.forEach(err => console.error("Ledger Posting Error:", err));
        toastVariant = (postedCount === 0 && contactsCreatedCount === 0) ? "destructive" : "default";
        toastTitle = (postedCount > 0 || contactsCreatedCount > 0) ? "Partial Ledger Posting" : "Ledger Posting Failed";
      } else if (postedCount === 0 && contactsCreatedCount === 0 && linesToPost.length > 0) { 
         toastDescription = "No lines were posted. Ensure GL accounts are valid and in Chart of Accounts.";
         toastVariant = "destructive";
         toastTitle = "Ledger Posting Failed";
      } else if (postedCount === 0 && contactsCreatedCount === 0 && linesToPost.length === 0) { 
         toastDescription = "No lines were eligible for posting.";
      }


      if(toastDescription) { 
        toast({ title: toastTitle, description: toastDescription, variant: toastVariant, duration: postingErrors.length > 0 ? 10000 : 5000 });
      }
      
      if (postedCount > 0 || contactsCreatedCount > 0 || postingErrors.length > 0) { 
        await fetchJournalEntryLines();
      }
      setSelectedEntryLineIds([]);
    } catch (error) {
      console.error("Error during bulk posting:", error);
      toast({ title: "Posting Error", description: "An unexpected error occurred during ledger posting.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsBulkPostDialogOpen(false);
    }
  };

  const handleConfirmBulkUnpostFromLedger = async () => {
     if (!user || selectedEntryLineIds.length === 0) return;
    setIsLoading(true);
    const linesToUnpost = journalEntryLines.filter(line => selectedEntryLineIds.includes(line.id) && line.isLedgerApproved);
    if (linesToUnpost.length === 0) {
      toast({ title: "No Action Needed", description: "Selected lines are already pending or none were selected for unposting.", variant: "default" });
      setIsLoading(false);
      setIsBulkUnpostDialogOpen(false);
      return;
    }

    try {
      const batch = writeBatch(db);
      for (const line of linesToUnpost) {
        await deleteJournalEntryLineFromLedger(user.uid, line.id, batch);
        batch.update(doc(db, "journal_entry_lines", line.id), { isLedgerApproved: false });
      }
      await batch.commit();
      toast({ title: "Bulk Unpost Successful", description: `${linesToUnpost.length} line(s) unposted from ledger.` });
      await fetchJournalEntryLines();
      setSelectedEntryLineIds([]);
    } catch (error) {
      console.error("Error during bulk unposting:", error);
      toast({ title: "Unposting Error", description: "An unexpected error occurred during ledger unposting.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsBulkUnpostDialogOpen(false);
    }
  };

  const handleExportToExcel = () => {
    if (filteredAndSortedLines.length === 0) {
      toast({ title: "No Data to Export", description: "There are no journal entry lines to export.", variant: "default" });
      return;
    }
    const exportData = filteredAndSortedLines.map(line => ({
      'Date': line.date ? format(dateFnsParse(line.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : "",
      'Description': line.description,
      'GL Account': line.glAccount,
      'Vendor/Customer': line.vendorOrCustomer || '',
      'Debit Amount': line.debitAmount !== null ? line.debitAmount : '',
      'Credit Amount': line.creditAmount !== null ? line.creditAmount : '',
      'Ledger Status': line.isLedgerApproved ? 'Approved' : 'Pending',
      'Journal Set ID': line.journalSetId,
      'Line ID': line.id,
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "JournalEntryLines");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `journal_entry_lines_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Journal entry lines exported to Excel." });
  };


  const handleAddNewEntryLine = () => {
    setNewEntryLines(prev => [...prev, {
      localId: nanoid(),
      description: "",
      glAccount: "",
      vendorOrCustomer: "",
      debitAmount: "",
      creditAmount: ""
    }]);
  };

  const handleRemoveNewEntryLine = (localId: string) => {
    setNewEntryLines(prev => prev.filter(line => line.localId !== localId));
  };

  const handleNewEntryLineChange = (localId: string, field: keyof NewJournalLineItem, value: string) => {
    setNewEntryLines(prev => prev.map(line => {
      if (line.localId === localId) {
        const updatedLine = { ...line, [field]: value };
        if (field === 'debitAmount' && parseFloat(value) > 0) {
          updatedLine.creditAmount = ""; // Clear credit if debit is entered
        } else if (field === 'creditAmount' && parseFloat(value) > 0) {
          updatedLine.debitAmount = ""; // Clear debit if credit is entered
        }
        return updatedLine;
      }
      return line;
    }));
  };

  const { totalDebits, totalCredits, difference, isBalanced } = useMemo(() => {
    let debits = 0;
    let credits = 0;
    newEntryLines.forEach(line => {
      debits += parseFloat(line.debitAmount) || 0;
      credits += parseFloat(line.creditAmount) || 0;
    });
    const diff = debits - credits;
    return {
      totalDebits: debits,
      totalCredits: credits,
      difference: diff,
      isBalanced: Math.abs(diff) < 0.001
    };
  }, [newEntryLines]);

  const isNewEntryFormValid = useMemo(() => {
    if (!newEntryDate || newEntryLines.length < 2 || !isBalanced) return false;
    return newEntryLines.every(line => {
      const debit = parseFloat(line.debitAmount) || 0;
      const credit = parseFloat(line.creditAmount) || 0;
      return line.description && line.glAccount && (debit > 0 || credit > 0) && !(debit > 0 && credit > 0);
    });
  }, [newEntryDate, newEntryLines, isBalanced]);


  const handleSaveNewJournalEntry = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive"});
      return;
    }
    if (!newEntryDate) {
      toast({ title: "Validation Error", description: "Please select an entry date.", variant: "destructive"});
      return;
    }
    if (newEntryLines.length < 2) {
      toast({ title: "Validation Error", description: "A journal entry must have at least two lines.", variant: "destructive" });
      return;
    }
    if (!isBalanced) {
      toast({ title: "Validation Error", description: "Total debits must equal total credits. The entry is not balanced.", variant: "destructive" });
      return;
    }
    for (const line of newEntryLines) {
      const debit = parseFloat(line.debitAmount) || 0;
      const credit = parseFloat(line.creditAmount) || 0;
      if (!line.description.trim()) {
        toast({ title: "Validation Error", description: `A line is missing a description.`, variant: "destructive" });
        return;
      }
      if (!line.glAccount) {
        toast({ title: "Validation Error", description: `A line (Description: "${line.description.substring(0, 20)}...") is missing a GL account.`, variant: "destructive" });
        return;
      }
      if (!(debit > 0 || credit > 0)) {
         toast({ title: "Validation Error", description: `Line "${line.description.substring(0,20)}..." must have either a debit or a credit amount greater than zero.`, variant: "destructive"});
        return;
      }
      if (debit > 0 && credit > 0) {
         toast({ title: "Validation Error", description: `Line "${line.description.substring(0,20)}..." cannot have both debit and credit amounts. One must be zero.`, variant: "destructive"});
        return;
      }
    }

    setIsSavingJournalEntry(true);
    const journalSetId = nanoid();
    const formattedDate = format(newEntryDate, "yyyy-MM-dd");
    let contactsCreatedCount = 0;
    
    const contactsQuery = query(collection(db, "contacts"), where("userId", "==", user.uid));
    const contactsSnapshot = await getDocs(contactsQuery);
    const currentContacts: PageContactItem[] = [];
    contactsSnapshot.forEach((docSnap) => {
        currentContacts.push({ id: docSnap.id, ...(docSnap.data() as Omit<PageContactItem, 'id'>) });
    });

    try {
      const batch = writeBatch(db);
      const linesCollectionRef = collection(db, "journal_entry_lines");
      for (const line of newEntryLines) {
        const debit = parseFloat(line.debitAmount) || null;
        const credit = parseFloat(line.creditAmount) || null;
        const trimmedVendorOrCustomer = line.vendorOrCustomer.trim();
        const finalVendorOrCustomer = trimmedVendorOrCustomer !== "" ? trimmedVendorOrCustomer : null;

        if (finalVendorOrCustomer) {
            let contactType: "Customer" | "Vendor" = "Vendor"; // Default
            if (credit && credit > 0) contactType = "Customer";
            const newContactCreated = await ensureContactExistsAndAddToBatchJE(
                user.uid,
                finalVendorOrCustomer,
                contactType,
                currentContacts,
                batch
            );
            if (newContactCreated) contactsCreatedCount++;
        }


        const lineData: Omit<JournalEntryLine, 'id' | 'createdAt' | 'userId'> = {
          journalSetId,
          date: formattedDate,
          description: line.description.trim(),
          glAccount: line.glAccount,
          vendorOrCustomer: finalVendorOrCustomer,
          debitAmount: debit,
          creditAmount: credit,
          isLedgerApproved: false,
        };

        batch.set(doc(linesCollectionRef), {
            ...lineData,
            userId: user.uid,
            createdAt: serverTimestamp()
        });
      }
      await batch.commit();
      let successMessage = "The new journal entry has been successfully saved.";
      if (contactsCreatedCount > 0) {
        successMessage += ` ${contactsCreatedCount} new contact(s) auto-created.`;
      }
      toast({ title: "Journal Entry Saved", description: successMessage });
      await fetchJournalEntryLines();
      if (contactsCreatedCount > 0) await fetchContacts();
      setIsCreateEntryDialogOpen(false);
      setNewEntryDate(new Date());
      setNewEntryLines([]);
    } catch (error) {
      console.error("Error saving journal entry: ", error);
      toast({ title: "Save Error", description: "Could not save the journal entry.", variant: "destructive" });
    } finally {
      setIsSavingJournalEntry(false);
    }
  };

  // --- Import Excel Logic ---
  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFileImport(file);
      setIsLoadingImport(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', cellDates: true, defval: "" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });

          if (jsonData.length > 0 && jsonData[0].length > 0) {
            setExcelHeadersImport(jsonData[0] as string[]);
            setExcelDataImport(jsonData.slice(1));
          } else {
            setExcelHeadersImport([]);
            setExcelDataImport([]);
            toast({ title: "Empty File", description: "The selected Excel file is empty or has no headers.", variant: "destructive" });
          }
        } catch (err) {
          console.error("Error parsing Excel for import:", err);
          toast({ title: "Parsing Error", description: "Could not parse the Excel file.", variant: "destructive" });
        } finally {
          setIsLoadingImport(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleImportMappingChange = (field: keyof ImportColumnMapping, value: string) => {
    setColumnMappingsImport(prev => ({ ...prev, [field]: value === SKIP_COLUMN_VALUE_IMPORT ? '' : value }));
  };

  const handleImportJournalEntries = async () => {
    if (!user || !selectedFileImport) return;
    const { date, description, glAccount, debitAmount, creditAmount, journalSetIdExcel } = columnMappingsImport;
    if (!date || !description || !glAccount || !debitAmount || !creditAmount) {
      toast({ title: "Mapping Incomplete", description: "Please map all required columns: Date, Description, GL Account, Debit, Credit.", variant: "destructive" });
      return;
    }
    if (chartOfAccounts.length === 0) {
        toast({ title: "Chart of Accounts Needed", description: "Please ensure your Chart of Accounts is set up before importing.", variant: "destructive"});
        return;
    }

    setIsLoadingImport(true);
    let currentImportedJECount = 0;
    let currentImportedLinesCount = 0;
    const localSkippedLines: SkippedImportLine[] = [];
    const localMissingGls = new Set<string>();
    const batch = writeBatch(db);
    const normalizedCoAMap = new Map(chartOfAccounts.map(coa => [enhancedNormalizeGlAccountName(coa.glAccount), coa.glAccount]));
    
    const contactsQuery = query(collection(db, "contacts"), where("userId", "==", user.uid));
    const contactsSnapshot = await getDocs(contactsQuery);
    const currentContacts: PageContactItem[] = [];
    contactsSnapshot.forEach((docSnap) => {
        currentContacts.push({ id: docSnap.id, ...(docSnap.data() as Omit<PageContactItem, 'id'>) });
    });
    let autoCreatedContactsThisImport = 0;

    const groupedRows: Record<string, any[][]> = {};
    const rowsWithoutSetId: any[][] = [];

    excelDataImport.forEach(row => {
      const excelSetIdValue = journalSetIdExcel ? String(row[excelHeadersImport.indexOf(journalSetIdExcel)] || '').trim() : '';
      if (journalSetIdExcel && excelSetIdValue) {
        if (!groupedRows[excelSetIdValue]) groupedRows[excelSetIdValue] = [];
        groupedRows[excelSetIdValue].push(row);
      } else {
        rowsWithoutSetId.push(row);
      }
    });

    const processGroup = async (rowsInGroup: any[][], groupIdentifier: string): Promise<boolean> => {
        let groupTotalDebit = 0;
        let groupTotalCredit = 0;
        const linesForThisGroup: Omit<JournalEntryLine, 'id'|'createdAt'|'journalSetId'|'userId'>[] = [];
        let groupIsValid = true;

        for (const row of rowsInGroup) {
            const dateValueRaw = row[excelHeadersImport.indexOf(date)];
            let formattedDate = "";
            if (dateValueRaw instanceof Date && isDateValid(dateValueRaw)) {
                formattedDate = format(dateValueRaw, "yyyy-MM-dd");
            } else { 
                const parsedJsDate = dateFnsParse(String(dateValueRaw), "MM/dd/yyyy", new Date()) 
                if (isDateValid(parsedJsDate)) formattedDate = format(parsedJsDate, "yyyy-MM-dd");
                else { 
                    const parsedIso = parseISO(String(dateValueRaw));
                    if (isDateValid(parsedIso)) formattedDate = format(parsedIso, "yyyy-MM-dd");
                }
            }

            const descValue = String(row[excelHeadersImport.indexOf(description)] || '').trim();
            const glValueRaw = String(row[excelHeadersImport.indexOf(glAccount)] || '').trim();
            const debitValueStr = String(row[excelHeadersImport.indexOf(debitAmount)] || '0').trim();
            const creditValueStr = String(row[excelHeadersImport.indexOf(creditAmount)] || '0').trim();
            const excelVendorCustomerTrimmed = columnMappingsImport.vendorOrCustomer ? String(row[excelHeadersImport.indexOf(columnMappingsImport.vendorOrCustomer)] || '').trim() : '';
            const finalVendorOrCustomerForImport = excelVendorCustomerTrimmed !== '' ? excelVendorCustomerTrimmed : null;


            const debitNum = parseFloat(debitValueStr) || 0;
            const creditNum = parseFloat(creditValueStr) || 0;

            let skipReason = "";
            if (!formattedDate) skipReason = "Invalid or missing date.";
            else if (!descValue) skipReason = "Missing description.";
            else if (!glValueRaw) skipReason = "Missing GL account.";
            else if (debitNum < 0 || creditNum < 0) skipReason = "Debit/Credit cannot be negative.";
            else if (debitNum > 0 && creditNum > 0) skipReason = "Cannot have both Debit and Credit on one line.";
            else if (debitNum === 0 && creditNum === 0) skipReason = "Both Debit and Credit are zero.";

            const normalizedGlFromFile = enhancedNormalizeGlAccountName(glValueRaw);
            const coaMatch = normalizedCoAMap.get(normalizedGlFromFile);
            if (!coaMatch && !skipReason) {
                skipReason = `GL Account '${glValueRaw}' not found in Chart of Accounts.`;
                localMissingGls.add(glValueRaw);
            }

            if (skipReason) {
                localSkippedLines.push({ originalRow: row, reason: `Group '${groupIdentifier}': ${skipReason}` });
                groupIsValid = false; 
                continue; 
            }
            
            if (finalVendorOrCustomerForImport) {
                 let contactType: "Customer" | "Vendor" = "Vendor";
                 if (creditNum > 0) contactType = "Customer";
                 const newContactAdded = await ensureContactExistsAndAddToBatchJE(
                    user!.uid,
                    finalVendorOrCustomerForImport,
                    contactType,
                    currentContacts,
                    batch
                 );
                 if (newContactAdded) autoCreatedContactsThisImport++;
            }


            linesForThisGroup.push({
                date: formattedDate,
                description: descValue,
                glAccount: coaMatch!, 
                vendorOrCustomer: finalVendorOrCustomerForImport,
                debitAmount: debitNum > 0 ? debitNum : null,
                creditAmount: creditNum > 0 ? creditNum : null,
                isLedgerApproved: false,
            });
            groupTotalDebit += debitNum;
            groupTotalCredit += creditNum;
        }

        if (!groupIsValid) return false; 

        if (Math.abs(groupTotalDebit - groupTotalCredit) > 0.001) {
            linesForThisGroup.forEach(lineData => { 
                 localSkippedLines.push({ originalRow: rowsInGroup.find(r => r[excelHeadersImport.indexOf(description)] === lineData.description) || [], reason: `Group '${groupIdentifier}' is unbalanced (D:${groupTotalDebit.toFixed(2)}, C:${groupTotalCredit.toFixed(2)}).` });
            });
            return false;
        }

        const systemJournalSetId = nanoid();
        const linesCollectionRef = collection(db, "journal_entry_lines");
        linesForThisGroup.forEach(lineData => {
            const newLineDocRef = doc(linesCollectionRef);
            batch.set(newLineDocRef, { ...lineData, userId: user!.uid, journalSetId: systemJournalSetId, createdAt: serverTimestamp() });
            currentImportedLinesCount++;
        });
        currentImportedJECount++;
        return true;
    };

    for (const setId in groupedRows) {
        await processGroup(groupedRows[setId], `Excel Set ID: ${setId}`);
    }
    if (rowsWithoutSetId.length > 0) {
        await processGroup(rowsWithoutSetId, "File (No Set ID)");
    }

    try {
      if (currentImportedLinesCount > 0 || autoCreatedContactsThisImport > 0) await batch.commit();
      setImportedJournalEntriesCount(currentImportedJECount);
      setImportedLinesCountState(currentImportedLinesCount);
      setSkippedLinesForImport(localSkippedLines);
      setMissingGlAccountsForImportDialog(Array.from(localMissingGls));
      setIsImportSummaryDialogOpen(true);
      if (currentImportedLinesCount > 0) await fetchJournalEntryLines();
    } catch (e) {
      console.error("Error committing JE import batch:", e);
      toast({ title: "Import Error", description: "Failed to save imported entries.", variant: "destructive" });
    } finally {
      setIsLoadingImport(false);
      setIsImportDialogOpen(false);
      setSelectedFileImport(null);
      setExcelHeadersImport([]);
      setExcelDataImport([]);
      setColumnMappingsImport({ date: '', description: '', glAccount: '', vendorOrCustomer: '', debitAmount: '', creditAmount: '', journalSetIdExcel: ''});
    }
  };

  const handleDownloadSkippedImportLines = () => {
    if (skippedLinesForImport.length === 0) {
        toast({title: "No Data", description: "No skipped lines to download."});
        return;
    }
    const dataToExport = skippedLinesForImport.map(item => [...item.originalRow, item.reason]);
    const headers = [...excelHeadersImport, "Reason for Skipping"];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataToExport]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Skipped_JE_Lines");
    XLSX.writeFile(workbook, `skipped_journal_entry_lines_${format(new Date(), "yyyyMMddHHmmss")}.xlsx`);
  };

  const importTargetColumns: Array<{ key: keyof ImportColumnMapping; label: string; isOptional?: boolean }> = [
    { key: "date", label: "Date *" },
    { key: "description", label: "Description *" },
    { key: "glAccount", label: "GL Account *" },
    { key: "debitAmount", label: "Debit Amount *" },
    { key: "creditAmount", label: "Credit Amount *" },
    { key: "vendorOrCustomer", label: "Vendor/Customer", isOptional: true },
    { key: "journalSetIdExcel", label: "Journal Set ID (Excel)", isOptional: true },
  ];


  const commonButtonDisabled = isLoading || isFetching || isFetchingChartOfAccounts || isSavingJournalEntry || isLoadingImport;
  const noLinesSelected = selectedEntryLineIds.length === 0;
  const canPostToLedger = useMemo(() => selectedEntryLineIds.some(id => journalEntryLines.find(l => l.id === id && !l.isLedgerApproved)), [selectedEntryLineIds, journalEntryLines]);
  const canUnpostFromLedger = useMemo(() => selectedEntryLineIds.some(id => journalEntryLines.find(l => l.id === id && l.isLedgerApproved)), [selectedEntryLineIds, journalEntryLines]);
  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedLines.length === 0) return false;
    return filteredAndSortedLines.every(line => selectedEntryLineIds.includes(line.id));
  }, [filteredAndSortedLines, selectedEntryLineIds]);

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <FilePlus2 className="mr-3 h-10 w-10 text-primary" />
              Journal Entries
            </h1>
            <p className="text-lg text-muted-foreground">
              Manage manual journal entries. Each row represents a line in a journal entry.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => {
                setIsImportDialogOpen(isOpen);
                if (!isOpen) { // Reset import dialog state on close
                    setSelectedFileImport(null);
                    setExcelHeadersImport([]);
                    setExcelDataImport([]);
                    setColumnMappingsImport({ date: '', description: '', glAccount: '', vendorOrCustomer: '', debitAmount: '', creditAmount: '', journalSetIdExcel: '' });
                }
            }}>
                <DialogTrigger asChild>
                    <Button variant="outline" disabled={commonButtonDisabled}>
                        <Upload className="mr-2 h-4 w-4" /> Import from Excel
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[625px]">
                    <DialogHeader>
                        <DialogTitle className="font-headline">Import Journal Entries from Excel</DialogTitle>
                        <DialogDescription>
                          Map columns. If 'Journal Set ID (Excel)' is mapped, lines with the same ID form one entry and must balance.
                          If not mapped, the entire file is one entry and must balance. GL Accounts are matched flexibly but must exist in CoA.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="excel-file-je-import" className="text-right">Excel File *</Label>
                            <Input id="excel-file-je-import" type="file" accept=".xlsx, .xls, .csv" onChange={handleImportFileChange} className="col-span-3" />
                        </div>
                        {selectedFileImport && (
                            <p className="text-xs text-muted-foreground col-span-3 col-start-2">Selected: {selectedFileImport.name}</p>
                        )}
                        {isLoadingImport && selectedFileImport && excelHeadersImport.length === 0 && (
                            <div className="flex justify-center items-center col-span-4 py-4"><LoadingSpinner /><span className="ml-2">Parsing file...</span></div>
                        )}
                        {excelHeadersImport.length > 0 && !isLoadingImport && (
                            <>
                                {importTargetColumns.map(targetCol => (
                                    <div key={targetCol.key} className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor={`map-je-${targetCol.key}`} className="text-right">{targetCol.label}</Label>
                                        <Select value={columnMappingsImport[targetCol.key] || ""} onValueChange={(val) => handleImportMappingChange(targetCol.key, val)}>
                                            <SelectTrigger className="col-span-3"><SelectValue placeholder={targetCol.isOptional ? "Select (Optional)" : "Select Column"} /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={SKIP_COLUMN_VALUE_IMPORT}><em>Skip this column</em></SelectItem>
                                                {excelHeadersImport.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                                {excelDataImport.length > 0 && (
                                    <div className="col-span-4 mt-2">
                                        <p className="text-sm font-medium mb-1">Preview (first 3 rows):</p>
                                        <ScrollArea className="border rounded-md p-2 max-h-32 overflow-auto text-xs bg-muted/50">
                                            <pre>{JSON.stringify(excelDataImport.slice(0,3).map(row => excelHeadersImport.reduce((obj, header, i) => ({...obj, [header]: row[i]}), {})), null, 2)}</pre>
                                        </ScrollArea>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleImportJournalEntries} disabled={!selectedFileImport || excelHeadersImport.length === 0 || isLoadingImport || isFetchingChartOfAccounts || chartOfAccounts.length === 0 || !columnMappingsImport.date || !columnMappingsImport.description || !columnMappingsImport.glAccount || !columnMappingsImport.debitAmount || !columnMappingsImport.creditAmount}>
                            {isLoadingImport && <LoadingSpinner className="mr-2"/>}
                            {isFetchingChartOfAccounts ? "Loading CoA..." : chartOfAccounts.length === 0 ? "Setup CoA First" : "Import"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Button variant="default" onClick={() => {
                setNewEntryDate(new Date());
                setNewEntryLines([{ localId: nanoid(), description: "", glAccount: "", vendorOrCustomer: "", debitAmount: "", creditAmount: "" }]);
                setIsCreateEntryDialogOpen(true);
             }} disabled={commonButtonDisabled}>
                <Edit3 className="mr-2 h-4 w-4" /> Create Entry
            </Button>
             <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedLines.length === 0}>
              <FileDown className="mr-2 h-4 w-4" /> Export to Excel
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard"> <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard </Link>
            </Button>
          </div>
        </header>

        <div className="mb-4 flex justify-between items-center">
            <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder="Search journal entry lines..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    disabled={commonButtonDisabled}
                />
            </div>
            {selectedEntryLineIds.length > 0 && (
                <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between ml-4 flex-grow">
                    <span className="text-sm font-medium">{selectedEntryLineIds.length} line(s) selected</span>
                    <div className="space-x-2">
                        <Button size="sm" variant="default" onClick={() => setIsBulkPostDialogOpen(true)} disabled={commonButtonDisabled || !canPostToLedger}>
                            <Library className="mr-2 h-4 w-4" /> Post Selected
                        </Button>
                         <Button size="sm" variant="outline" onClick={() => setIsBulkUnpostDialogOpen(true)} disabled={commonButtonDisabled || !canUnpostFromLedger}>
                            Unpost Selected
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setIsBulkDeleteDialogOpen(true)} disabled={commonButtonDisabled}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete Selected
                        </Button>
                    </div>
                </div>
            )}
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Journal Entry Lines</CardTitle>
            <CardDescription>List of all individual debit and credit lines for journal entries.</CardDescription>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Loading journal entries...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={isSelectAllChecked}
                          onCheckedChange={(checked) => handleToggleSelectAllLines(Boolean(checked))}
                          aria-label="Select all lines"
                          disabled={commonButtonDisabled || filteredAndSortedLines.length === 0}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('date')}>
                        <div className="flex items-center">Date <SortIndicator columnKey="date" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('description')}>
                        <div className="flex items-center">Description <SortIndicator columnKey="description" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('glAccount')}>
                        <div className="flex items-center">GL Account <SortIndicator columnKey="glAccount" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('vendorOrCustomer')}>
                        <div className="flex items-center">Vendor/Customer <SortIndicator columnKey="vendorOrCustomer" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('debitAmount')}>
                        <div className="flex items-center justify-end">Debit <SortIndicator columnKey="debitAmount" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('creditAmount')}>
                        <div className="flex items-center justify-end">Credit <SortIndicator columnKey="creditAmount" /></div>
                      </TableHead>
                      <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => requestSort('isLedgerApproved')}>
                        <div className="flex items-center justify-center">Ledger Status <SortIndicator columnKey="isLedgerApproved" /></div>
                      </TableHead>
                       <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => requestSort('journalSetId')}>
                        <div className="flex items-center justify-center">Journal Set ID <SortIndicator columnKey="journalSetId" /></div>
                      </TableHead>
                      <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => requestSort('id')}>
                        <div className="flex items-center justify-center">Line ID <SortIndicator columnKey="id" /></div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedLines.length > 0 ? (
                      filteredAndSortedLines.map((line) => (
                        <TableRow key={line.id} data-state={selectedEntryLineIds.includes(line.id) ? "selected" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedEntryLineIds.includes(line.id)}
                              onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => setIsShiftKeyPressed(e.shiftKey)}
                              onCheckedChange={(checked) => handleToggleSelectLine(line.id, Boolean(checked), isShiftKeyPressed)}
                              aria-labelledby={`select-line-${line.id}`}
                              disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell>{line.date ? format(dateFnsParse(line.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : ""}</TableCell>
                          <TableCell>{line.description}</TableCell>
                          <TableCell>{line.glAccount}</TableCell>
                          <TableCell>{line.vendorOrCustomer || '-'}</TableCell>
                          <TableCell className="text-right">{line.debitAmount !== null ? `$${line.debitAmount.toFixed(2)}` : "-"}</TableCell>
                          <TableCell className="text-right">{line.creditAmount !== null ? `$${line.creditAmount.toFixed(2)}` : "-"}</TableCell>
                          <TableCell className="text-center">
                            {line.isLedgerApproved ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300">
                                    <CheckCircle2 className="mr-1 h-3 w-3" /> Approved
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                                    <AlertCircle className="mr-1 h-3 w-3" /> Pending
                                </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-center">{line.journalSetId}</TableCell>
                          <TableCell className="text-xs text-center">{line.id}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                          {searchTerm ? "No journal entry lines match your search." : "No journal entry lines found. Create or import some."}
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

      {/* --- Dialogs for Bulk Actions --- */}
      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center"><AlertTriangle className="mr-2 h-6 w-6 text-destructive" /> Confirm Bulk Delete</DialogTitle>
            <DialogDescription>Are you sure you want to delete {selectedEntryLineIds.length} selected journal entry line(s)? This will also remove them from the ledger if posted.</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)} disabled={isLoading}>Cancel</Button><Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={isLoading}>{isLoading && <LoadingSpinner className="mr-2" />} Delete Selected</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkPostDialogOpen} onOpenChange={setIsBulkPostDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center"><Library className="mr-2 h-6 w-6 text-primary" /> Confirm Post to Ledger</DialogTitle>
            <DialogDescription>Post {selectedEntryLineIds.filter(id => !journalEntryLines.find(l => l.id === id)?.isLedgerApproved).length} selected pending line(s) to the ledger? Lines with GL accounts not in CoA will be skipped.</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setIsBulkPostDialogOpen(false)} disabled={isLoading}>Cancel</Button><Button onClick={handleConfirmBulkPostToLedger} disabled={isLoading}>{isLoading && <LoadingSpinner className="mr-2" />} Post to Ledger</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkUnpostDialogOpen} onOpenChange={setIsBulkUnpostDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center"><AlertTriangle className="mr-2 h-6 w-6 text-orange-500" /> Confirm Unpost from Ledger</DialogTitle>
            <DialogDescription>Unpost {selectedEntryLineIds.filter(id => journalEntryLines.find(l => l.id === id)?.isLedgerApproved).length} selected approved line(s) from the ledger?</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setIsBulkUnpostDialogOpen(false)} disabled={isLoading}>Cancel</Button><Button variant="destructive" onClick={handleConfirmBulkUnpostFromLedger} disabled={isLoading}>{isLoading && <LoadingSpinner className="mr-2" />} Unpost from Ledger</Button></DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={isCreateEntryDialogOpen} onOpenChange={(isOpen) => {
        setIsCreateEntryDialogOpen(isOpen);
        if (!isOpen) {
            setNewEntryDate(new Date());
            setNewEntryLines([]);
        }
      }}>
        <DialogContent className="sm:max-w-4xl md:max-w-5xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="font-headline text-2xl">Create New Journal Entry</DialogTitle>
            <DialogDescription>
              Enter the details for your journal entry. Total debits must equal total credits.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 flex-none">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div>
                    <Label htmlFor="newEntryDate">Entry Date *</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="newEntryDate"
                                variant={"outline"}
                                className={cn(
                                "w-full justify-start text-left font-normal mt-1",
                                !newEntryDate && "text-muted-foreground"
                                )}
                                disabled={isSavingJournalEntry}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {newEntryDate ? format(newEntryDate, "MM/dd/yyyy") : <span>Pick a date</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={newEntryDate}
                                onSelect={setNewEntryDate}
                                initialFocus
                                disabled={isSavingJournalEntry}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="md:col-span-2 flex md:flex-row flex-col md:items-center md:justify-end gap-2 pt-6 md:pt-0">
                    <p className={cn("text-sm font-medium", totalDebits === 0 && totalCredits === 0 ? "text-muted-foreground" : "text-foreground")}>Total Debits: ${totalDebits.toFixed(2)}</p>
                    <p className={cn("text-sm font-medium", totalDebits === 0 && totalCredits === 0 ? "text-muted-foreground" : "text-foreground")}>Total Credits: ${totalCredits.toFixed(2)}</p>
                    <p className={cn("text-sm font-bold", isBalanced ? "text-green-600" : "text-destructive")}>
                        Difference: ${difference.toFixed(2)}
                    </p>
                </div>
            </div>
          </div>

          <div className="flex-grow overflow-hidden px-2">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="space-y-3">
                {newEntryLines.map((line, index) => (
                  <Card key={line.localId} className="p-4 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                      <div className="md:col-span-3">
                        <Label htmlFor={`line-desc-${line.localId}`}>Description *</Label>
                        <Input
                          id={`line-desc-${line.localId}`}
                          value={line.description}
                          onChange={(e) => handleNewEntryLineChange(line.localId, 'description', e.target.value)}
                          placeholder="Transaction detail"
                          className="mt-1 text-sm"
                          disabled={isSavingJournalEntry}
                        />
                      </div>
                      <div className="md:col-span-3">
                        <Label htmlFor={`line-gl-${line.localId}`}>GL Account *</Label>
                        <Select
                          value={line.glAccount}
                          onValueChange={(val) => handleNewEntryLineChange(line.localId, 'glAccount', val)}
                          disabled={isSavingJournalEntry || isFetchingChartOfAccounts || chartOfAccounts.length === 0}
                        >
                          <SelectTrigger id={`line-gl-${line.localId}`} className="mt-1 text-sm">
                            <SelectValue placeholder={isFetchingChartOfAccounts ? "Loading CoA..." : chartOfAccounts.length === 0 ? "No CoA" : "Select GL Account"} />
                          </SelectTrigger>
                          <SelectContent>
                            {chartOfAccounts.map(acc => (
                              <SelectItem key={acc.id} value={acc.glAccount}>
                                {acc.glAccount} ({acc.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor={`line-vendor-${line.localId}`}>Vendor/Customer</Label>
                        <Input
                          id={`line-vendor-${line.localId}`}
                          value={line.vendorOrCustomer}
                          onChange={(e) => handleNewEntryLineChange(line.localId, 'vendorOrCustomer', e.target.value)}
                          placeholder="Optional"
                          className="mt-1 text-sm"
                          disabled={isSavingJournalEntry}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor={`line-debit-${line.localId}`}>Debit</Label>
                        <Input
                          id={`line-debit-${line.localId}`}
                          type="number"
                          value={line.debitAmount}
                          onChange={(e) => handleNewEntryLineChange(line.localId, 'debitAmount', e.target.value)}
                          placeholder="0.00"
                          className="mt-1 text-sm text-right"
                          disabled={isSavingJournalEntry || parseFloat(line.creditAmount) > 0}
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <div className="md:col-span-1">
                        <Label htmlFor={`line-credit-${line.localId}`}>Credit</Label>
                        <Input
                          id={`line-credit-${line.localId}`}
                          type="number"
                          value={line.creditAmount}
                          onChange={(e) => handleNewEntryLineChange(line.localId, 'creditAmount', e.target.value)}
                          placeholder="0.00"
                          className="mt-1 text-sm text-right"
                          disabled={isSavingJournalEntry || parseFloat(line.debitAmount) > 0}
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <div className="md:col-span-1 flex items-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveNewEntryLine(line.localId)}
                          disabled={isSavingJournalEntry || newEntryLines.length <= 1}
                          className="text-destructive hover:bg-destructive/10 w-full md:w-auto"
                          aria-label="Remove line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="p-6 pt-4 border-t flex-none">
            <Button variant="outline" onClick={handleAddNewEntryLine} disabled={isSavingJournalEntry}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Line
            </Button>
            <div className="flex-grow"></div> {/* Spacer */}
            <Button variant="ghost" onClick={() => {setIsCreateEntryDialogOpen(false); setNewEntryDate(new Date()); setNewEntryLines([]);}} disabled={isSavingJournalEntry}>
              Cancel
            </Button>
            <Button onClick={handleSaveNewJournalEntry} disabled={isSavingJournalEntry || !isNewEntryFormValid}>
              {isSavingJournalEntry ? <LoadingSpinner className="mr-2"/> : "Save Journal Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Summary Dialog */}
      <Dialog open={isImportSummaryDialogOpen} onOpenChange={(isOpen) => {
        setIsImportSummaryDialogOpen(isOpen);
        if (!isOpen) { // Reset on close
            setImportedJournalEntriesCount(0);
            setImportedLinesCountState(0);
            setSkippedLinesForImport([]);
            setMissingGlAccountsForImportDialog([]);
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Import Journal Entries Summary</DialogTitle>
            <DialogDescription>Review the results of your Excel import.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p>Journal Entries (Sets) Imported: <span className="font-semibold">{importedJournalEntriesCount}</span></p>
            <p>Total Lines Imported: <span className="font-semibold">{importedLinesCountState}</span></p>
            <p>Lines Skipped: <span className="font-semibold">{skippedLinesForImport.length}</span></p>
            {missingGlAccountsForImportDialog.length > 0 && (
              <div>
                <p className="font-semibold text-destructive">GL Accounts from your file not found in Chart of Accounts (rows using them were skipped):</p>
                <ScrollArea className="h-20 mt-1 border rounded p-2 text-xs">
                  <ul className="list-disc list-inside">
                    {missingGlAccountsForImportDialog.map(gl => <li key={gl}>{gl}</li>)}
                  </ul>
                </ScrollArea>
              </div>
            )}
            {skippedLinesForImport.length > 0 && (
              <p className="text-sm text-muted-foreground">Skipped lines/entries typically had missing required data, unbalanced totals within a set, or GL accounts not in your Chart of Accounts.</p>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
             {skippedLinesForImport.length > 0 ? (
              <Button variant="outline" onClick={handleDownloadSkippedImportLines}><Download className="mr-2 h-4 w-4" /> Download Skipped Lines</Button>
            ) : <div />}
            <Button onClick={() => setIsImportSummaryDialogOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}
