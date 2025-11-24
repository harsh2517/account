
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, ArrowLeft, Upload, Trash2, FileDown, Edit, Check, X, Sparkles, Edit3, AlertTriangle, ArrowUp, ArrowDown, SearchCheck, CheckCircle2, AlertCircle, Library, PlusCircle, Search, Filter } from "lucide-react"; // Added Filter
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useEffect, useCallback, useMemo } from "react";
import * as XLSX from 'xlsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { db, serverTimestamp, FieldValue } from "@/lib/firebase";
import { collection, addDoc, query, where, getDocs, doc, deleteDoc, Timestamp, writeBatch, updateDoc, WriteBatch, runTransaction } from "firebase/firestore";
import type { CategorizeTransactionsInput, CategorizeTransactionsOutput, HistoricalReferenceItem as FlowHistoricalReferenceItem, Transaction as FlowTransaction } from "@/ai/flows/categorize-transactions-flow";
import { categorizeUserTransactions } from "@/ai/flows/categorize-transactions-flow";
import type { CategorizeUnmatchedTransactionsInput, CategorizeUnmatchedTransactionsOutput, Transaction as AiFlowTransaction } from "@/ai/flows/categorize-unmatched-transactions-flow";
import { categorizeUnmatchedUserTransactions } from "@/ai/flows/categorize-unmatched-transactions-flow";
import { Badge } from "@/components/ui/badge";
import { format, parse as dateFnsParse, isValid as isDateValid } from "date-fns";

import { useCompany } from "@/context/CompanyContext";


interface Transaction {
  id: string; 
  userId: string; 
  date: string; 
  description: string;
  bankName: string; 
  vendor: string;
  glAccount: string;
  amountPaid: number | null;
  amountReceived: number | null;
  createdAt?: Timestamp; 
  isLedgerApproved?: boolean; 
}

interface PageHistoricalReferenceItem {
  id: string;
  userId: string;
  keyword: string;
  vendorCustomerName: string;
  glAccount: string;
  createdAt?: Timestamp;
}

const FS_OPTIONS = ["Profit and Loss", "Balance Sheet"] as const;
type FSOption = typeof FS_OPTIONS[number];

const TYPE_OPTIONS = [
  "Direct Income", "Indirect Income",
  "Direct Expense", "Indirect Expense",
  "Non Current Asset", "Current Asset",
  "Current Liability", "Non Current Liability",
  "Equity"
] as const;
type TypeOption = typeof TYPE_OPTIONS[number];

interface PageChartOfAccountItem {
  id: string;
  userId: string;
  glAccount: string;
  subType: string;
  type: TypeOption;
  fs?: FSOption; 
  accountNumber?: string; 
  createdAt?: Timestamp;
}

interface PageContactItem {
  id: string;
  name: string;
  type: "Customer" | "Vendor";
}

interface ModifiableAiTransaction extends AiFlowTransaction {
  isApproved: boolean;
  confidenceScore?: number;
}

interface SortConfig {
  key: keyof Transaction | 'ledgerStatus' | null;
  direction: 'ascending' | 'descending';
}


interface ColumnMapping {
  date: string;
  description: string;
  bankName: string; 
  vendor: string;
  glAccount: string;
  amountPaid: string;
  amountReceived: string;
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


const SKIP_COLUMN_VALUE = "__SKIP__";
const CLEAR_SELECTION_VALUE = "__CLEAR__";
const ASK_MY_ACCOUNTANT = "Ask My Accountant";
const CLEAR_FS_VALUE = "__CLEAR_FS__";


interface MissingCoaDialogItem {
  aiSuggestedGl: string;
  relatedTransactionIds: string[]; 
  chosenAction: 'createNew' | 'mapToExisting' | 'usePlaceholder' | null;
  newAccountSubType: string;
  newAccountType: TypeOption | ''; 
  newAccountFs?: FSOption | '';
  mapToExistingGl: string;
}


const normalizeStringForDescriptionMatch = (str: string): string => {
  return str.toLowerCase().replace(/[^\w\s]/gi, '').trim();
};

const getWordsForDescriptionMatch = (str: string): string[] => {
  return normalizeStringForDescriptionMatch(str).split(/\s+/).filter(Boolean);
};

const isFuzzyMatch = (description: string, keyword: string, threshold: number = 0.7): boolean => {
  const normalizedDesc = normalizeStringForDescriptionMatch(description);
  const normalizedKeyword = normalizeStringForDescriptionMatch(keyword);

  if (!normalizedDesc || !normalizedKeyword) return false;

  if (normalizedDesc.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedDesc)) {
    return true;
  }

  const descWords = getWordsForDescriptionMatch(description);
  const keywordWords = getWordsForDescriptionMatch(keyword);

  if (keywordWords.length === 0) return false;

  const [shorterWords, longerWordsSet] = descWords.length < keywordWords.length
    ? [descWords, new Set(keywordWords)]
    : [keywordWords, new Set(descWords)];

  let matchCount = 0;
  for (const word of shorterWords) {
    if (longerWordsSet.has(word)) {
      matchCount++;
    }
  }

  if (keywordWords.length === 1 && shorterWords.length === 1) { 
      return longerWordsSet.has(keywordWords[0]);
  }
  if (descWords.length === 1 && longerWordsSet.has(descWords[0])) { 
      return true;
  }

  if (keywordWords.length > 0) {
      const overlapRatio = matchCount / keywordWords.length;
      return overlapRatio >= threshold;
  }
  
  return false;
};


const normalizeGlForMatching = (gl: string): string => {
  return gl.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); 
};

const getGlWordsSet = (gl: string): Set<string> => {
  return new Set(normalizeGlForMatching(gl).split(/\s+/).filter(Boolean));
};

const findFuzzyMatchedGlAccount = (
  suggestedGl: string,
  availableCoaNames: string[], 
  minScoreThreshold: number = 0.6 
): string | null => {
  if (!suggestedGl || availableCoaNames.length === 0) return null;

  const normalizedSuggestedLower = suggestedGl.toLowerCase().trim();

  
  for (const coaName of availableCoaNames) {
    if (coaName.toLowerCase().trim() === normalizedSuggestedLower) {
      return coaName; 
    }
  }

  
  const suggestedWords = getGlWordsSet(suggestedGl);
  if (suggestedWords.size === 0) return null;

  let bestMatch: string | null = null;
  let highestScore = 0;

  for (const coaName of availableCoaNames) {
    const coaWords = getGlWordsSet(coaName);
    if (coaWords.size === 0) continue;

    const intersection = new Set([...suggestedWords].filter(word => coaWords.has(word)));
    const union = new Set([...suggestedWords, ...coaWords]);
    const score = union.size > 0 ? intersection.size / union.size : 0;

    if (score > highestScore) {
      highestScore = score;
      bestMatch = coaName;
    }
  }

  if (bestMatch && highestScore >= minScoreThreshold) {
    return bestMatch; 
  }

  return null; 
};


const addBankTransactionToLedger = (
    batch: WriteBatch,
    userId: string,
    transaction: Pick<Transaction, 'id' | 'date' | 'description' | 'bankName' | 'vendor' | 'glAccount' | 'amountPaid' | 'amountReceived'>
) => {
    let bankLedgerGLAccount = transaction.bankName;
    if (!transaction.bankName.toLowerCase().trim().startsWith("bank - ")) {
        bankLedgerGLAccount = `Bank - ${transaction.bankName.trim()}`;
    }

    const ledgerRef = collection(db, "all_transactions_ledger");

    const commonLedgerData = {
        userId: userId,
        date: transaction.date, 
        description: transaction.description,
        source: "Bank Transaction",
        sourceDocId: transaction.id,
        customer: null,
        vendor: transaction.vendor || null,
        createdAt: serverTimestamp(),
    };
    
    let finalVendor = transaction.vendor || null;
    let finalCustomer = null;

    if (transaction.vendor && transaction.vendor !== '-' && transaction.vendor !== ASK_MY_ACCOUNTANT) {
        if (transaction.amountReceived && transaction.amountReceived > 0) {
            finalCustomer = transaction.vendor;
            finalVendor = null;
        }
    }
    
    const ledgerBase = { ...commonLedgerData, customer: finalCustomer, vendor: finalVendor };

    if (transaction.amountPaid && transaction.amountPaid > 0) {
        const debitEntry: AllTransactionsLedgerItemNoId = {
            ...ledgerBase,
            glAccount: transaction.glAccount,
            debitAmount: transaction.amountPaid,
            creditAmount: null,
        };
        batch.set(doc(ledgerRef), debitEntry);

        const creditEntry: AllTransactionsLedgerItemNoId = {
            ...ledgerBase,
            glAccount: bankLedgerGLAccount,
            debitAmount: null,
            creditAmount: transaction.amountPaid,
        };
        batch.set(doc(ledgerRef), creditEntry);
    } else if (transaction.amountReceived && transaction.amountReceived > 0) {
        const debitEntry: AllTransactionsLedgerItemNoId = {
            ...ledgerBase,
            glAccount: bankLedgerGLAccount,
            debitAmount: transaction.amountReceived,
            creditAmount: null,
        };
        batch.set(doc(ledgerRef), debitEntry);

        const creditEntry: AllTransactionsLedgerItemNoId = {
            ...ledgerBase,
            glAccount: transaction.glAccount,
            debitAmount: null,
            creditAmount: transaction.amountReceived,
        };
        batch.set(doc(ledgerRef), creditEntry);
    }
};

const deleteBankTransactionFromLedger = async (userId: string, transactionId: string, batch?: WriteBatch) => {
    const ledgerRef = collection(db, "all_transactions_ledger");
    const ledgerQuery = query(
        ledgerRef,
        where("userId", "==", userId),
        where("source", "==", "Bank Transaction"),
        where("sourceDocId", "==", transactionId)
    );
    const ledgerSnapshot = await getDocs(ledgerQuery);
    
    const localBatch = batch || writeBatch(db);
    ledgerSnapshot.forEach(doc => localBatch.delete(doc.ref));
    
    if (!batch) {
        await localBatch.commit();
    }
};

async function ensureContactExistsAndAddToBatch(
  userId: string,
  contactName: string,
  potentialType: "Customer" | "Vendor",
  existingContacts: PageContactItem[],
  batch: WriteBatch
): Promise<boolean> {
  if (!contactName || contactName === "-" || contactName === ASK_MY_ACCOUNTANT) {
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


export default function BankTransactionsPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({
    date: '',
    description: '',
    bankName: '', 
    vendor: '',
    glAccount: '',
    amountPaid: '',
    amountReceived: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isAiCategorizing, setIsAiCategorizing] = useState(false);
  const [isLocalCategorizing, setIsLocalCategorizing] = useState(false);
  const { toast } = useToast();

  const [chartOfAccounts, setChartOfAccounts] = useState<PageChartOfAccountItem[]>([]);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true);

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [inlineEditVendor, setInlineEditVendor] = useState("");
  const [inlineEditGlAccount, setInlineEditGlAccount] = useState("");
  
  const [isAiConfirmDialogOpen, setIsAiConfirmDialogOpen] = useState(false);
  const [transactionsForAiConfirmation, setTransactionsForAiConfirmation] = useState<ModifiableAiTransaction[]>([]);
  const [selectAllAiConfirmations, setSelectAllAiConfirmations] = useState(true);

  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isBulkEditDialogOpen, setIsBulkEditDialogOpen] = useState(false);
  const [bulkEditVendor, setBulkEditVendor] = useState("");
  const [bulkEditGlAccount, setBulkEditGlAccount] = useState("");
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'descending' });


  const [isResolveMissingCoaDialogOpen, setIsResolveMissingCoaDialogOpen] = useState(false);
  const [missingCoaSuggestionsForDialog, setMissingCoaSuggestionsForDialog] = useState<MissingCoaDialogItem[]>([]);
  const [pendingCategorizationsAfterCoaResolution, setPendingCategorizationsAfterCoaResolution] = useState<ModifiableAiTransaction[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved">("all");
  const [lastSelectedTransactionId, setLastSelectedTransactionId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const { selectedCompanyId } = useCompany();


  const fetchTransactions = useCallback(async () => {
    if (!user) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      // const q = query(collection(db, "transactions"), where("userId", "==", user.uid));
      const q = query(collection(db, "transactions"),where("companyId", "==", selectedCompanyId));
      
      const querySnapshot = await getDocs(q);
      const fetchedTransactions: Transaction[] = [];
      querySnapshot.forEach((doc) => {
        fetchedTransactions.push({ id: doc.id, ...(doc.data() as Omit<Transaction, 'id'>) });
      });
      
      fetchedTransactions.sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        const createdAtA = a.createdAt?.toMillis() || 0;
        const createdAtB = b.createdAt?.toMillis() || 0;
        return createdAtB - createdAtA;
      });
      setTransactions(fetchedTransactions);
    } catch (error) {
      console.error("Error fetching transactions: ", error);
      toast({ title: "Error", description: "Could not fetch transactions from database.", variant: "destructive" });
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
      // const q = query(collection(db, "chartOfAccounts"), where("userId", "==", user.uid));
      const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const fetchedItems: PageChartOfAccountItem[] = [];
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<PageChartOfAccountItem, 'id'>) });
      });
      fetchedItems.sort((a, b) => a.glAccount.localeCompare(b.glAccount));
      setChartOfAccounts(fetchedItems);
    } catch (error) {
      console.error("Error fetching chart of accounts: ", error);
      toast({ title: "Error", description: "Could not fetch chart of accounts.", variant: "destructive" });
    } finally {
      setIsFetchingChartOfAccounts(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
        fetchTransactions();
        fetchChartOfAccounts();
    }
  }, [user, fetchTransactions, fetchChartOfAccounts]);

  useEffect(() => {
    if (transactionsForAiConfirmation.length > 0) {
      setSelectAllAiConfirmations(transactionsForAiConfirmation.every(tx => tx.isApproved));
    } else {
      setSelectAllAiConfirmations(true);
    }
  }, [transactionsForAiConfirmation]);

  const requestSort = (key: keyof Transaction | 'ledgerStatus') => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedTransactions = useMemo(() => {
    let items = [...transactions];

    if (statusFilter !== "all") {
      items = items.filter(tx => {
        if (statusFilter === "pending") return !tx.isLedgerApproved;
        if (statusFilter === "approved") return tx.isLedgerApproved;
        return true;
      });
    }

    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      items = items.filter(tx => 
        tx.description.toLowerCase().includes(lowerSearchTerm) ||
        tx.bankName.toLowerCase().includes(lowerSearchTerm) ||
        tx.vendor.toLowerCase().includes(lowerSearchTerm) ||
        tx.glAccount.toLowerCase().includes(lowerSearchTerm) ||
        (tx.amountPaid !== null && String(tx.amountPaid).includes(lowerSearchTerm)) ||
        (tx.amountReceived !== null && String(tx.amountReceived).includes(lowerSearchTerm))
      );
    }

    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        let valA = key === 'ledgerStatus' ? (a.isLedgerApproved ? 'Approved' : 'Pending') : a[key as keyof Transaction];
        let valB = key === 'ledgerStatus' ? (b.isLedgerApproved ? 'Approved' : 'Pending') : b[key as keyof Transaction];
        let comparison = 0;

        if (key === 'date') { 
          if (valA < valB) comparison = -1;
          if (valA > valB) comparison = 1;
          if (comparison === 0) {
            const createdAtA = a.createdAt?.toMillis() || 0;
            const createdAtB = b.createdAt?.toMillis() || 0;
            comparison = createdAtA - createdAtB;
          }
        } else if (key === 'amountPaid' || key === 'amountReceived') {
          const numA = valA === null ? -Infinity : (valA as number);
          const numB = valB === null ? -Infinity : (valB as number);
          if (numA < numB) comparison = -1;
          if (numA > numB) comparison = 1;
        } else { 
          const strA = String(valA === '-' || valA === null || valA === undefined ? '' : valA).toLowerCase();
          const strB = String(valB === '-' || valB === null || valB === undefined ? '' : valB).toLowerCase();
          comparison = strA.localeCompare(strB);
        }
        return sortConfig.direction === 'ascending' ? comparison : -comparison;
      });
    }
    return items;
  }, [transactions, sortConfig, searchTerm, statusFilter]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof Transaction | 'ledgerStatus' }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />;
    }
    return null;
  };


  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });

          if (jsonData.length > 0 && jsonData[0].length > 0) {
            setExcelHeaders(jsonData[0] as string[]);
            setExcelData(jsonData.slice(1));
          } else {
            setExcelHeaders([]);
            setExcelData([]);
            toast({ title: "Empty File", description: "The selected Excel file is empty or has no headers.", variant: "destructive" });
          }
        } catch (error) {
          console.error("Error parsing Excel file:", error);
          toast({ title: "Parsing Error", description: "Could not parse the Excel file. Please ensure it's a valid .xlsx or .csv file.", variant: "destructive" });
          setExcelHeaders([]);
          setExcelData([]);
        } finally {
          setIsLoading(false);
        }
      };
      reader.onerror = () => {
        setIsLoading(false);
        toast({ title: "File Read Error", description: "Could not read the selected file.", variant: "destructive" });
      }
      reader.readAsArrayBuffer(file);
    }
  };

  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    setColumnMappings(prev => ({ ...prev, [field]: value === SKIP_COLUMN_VALUE ? '' : value }));
  };

  const handleImportData = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to import transactions.", variant: "destructive" });
      return;
    }

    const { date: dateCol, description: descCol, bankName: bankNameCol, amountPaid: paidCol, amountReceived: receivedCol } = columnMappings;

    if (!dateCol || !descCol || !bankNameCol) {
      toast({
        title: "Mapping Incomplete",
        description: "Please ensure 'Date', 'Description', and 'Name of the Bank' columns are mapped.",
        variant: "destructive",
      });
      return;
    }

    if (!paidCol && !receivedCol) {
      toast({
        title: "Mapping Incomplete",
        description: "Please map at least 'Amount Paid' or 'Amount Received'.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    let importedCount = 0;
    const tempTransactionHolder: Array<Omit<Transaction, 'id' | 'createdAt' | 'isLedgerApproved'> & { tempId: string }> = [];


    excelData.forEach((row, index) => {
      const dateValue = row[excelHeaders.indexOf(columnMappings.date)];
      let formattedDateForStorage = ''; 

      if (dateValue instanceof Date && isDateValid(dateValue)) {
        formattedDateForStorage = format(dateValue, "yyyy-MM-dd");
      } else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
        let parsedJsDate: Date | null = null;
        if (typeof dateValue === 'string') {
            let d = dateFnsParse(dateValue, "MM/dd/yyyy", new Date());
            if (isDateValid(d)) parsedJsDate = d;
            else { 
                d = dateFnsParse(dateValue, "yyyy-MM-dd", new Date());
                if (isDateValid(d)) parsedJsDate = d;
                else { 
                    d = new Date(dateValue); 
                    if(isDateValid(d)) parsedJsDate = d;
                }
            }
        } else if (typeof dateValue === 'number' && dateValue > 0) { 
          const excelEpoch = new Date(1899, 11, 30);
          const d = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
          if (isDateValid(d)) parsedJsDate = d;
        }
        
        if (parsedJsDate) {
            formattedDateForStorage = format(parsedJsDate, "yyyy-MM-dd");
        } else {
            formattedDateForStorage = String(dateValue); 
        }
      }


      const amountPaidRaw = columnMappings.amountPaid && columnMappings.amountPaid !== SKIP_COLUMN_VALUE ? row[excelHeaders.indexOf(columnMappings.amountPaid)] : null;
      const amountReceivedRaw = columnMappings.amountReceived && columnMappings.amountReceived !== SKIP_COLUMN_VALUE ? row[excelHeaders.indexOf(columnMappings.amountReceived)] : null;

      const descriptionValue = String(row[excelHeaders.indexOf(columnMappings.description)] || '').trim();
      const bankNameValue = String(row[excelHeaders.indexOf(columnMappings.bankName)] || '').trim();
      
      if (!formattedDateForStorage || !descriptionValue || !bankNameValue || !isDateValid(dateFnsParse(formattedDateForStorage, "yyyy-MM-dd", new Date()))) {
          console.warn("Skipping row due to missing or invalid essential data:", {date: formattedDateForStorage, desc: descriptionValue, bank: bankNameValue, originalDate: dateValue});
          return; 
      }

      const newTx: Omit<Transaction, 'id' | 'createdAt'| 'isLedgerApproved'> & { tempId: string } = {
        tempId: `temp_${Date.now()}_${index}`,
        userId: user.uid,
        date: formattedDateForStorage, 
        description: descriptionValue,
        bankName: bankNameValue,
        vendor: String(columnMappings.vendor && columnMappings.vendor !== SKIP_COLUMN_VALUE ? row[excelHeaders.indexOf(columnMappings.vendor)] : '-' || '-'),
        glAccount: String(columnMappings.glAccount && columnMappings.glAccount !== SKIP_COLUMN_VALUE ? row[excelHeaders.indexOf(columnMappings.glAccount)] : '-' || '-'),
        amountPaid: amountPaidRaw !== null && String(amountPaidRaw).trim() !== '' ? parseFloat(String(amountPaidRaw)) : null,
        amountReceived: amountReceivedRaw !== null && String(amountReceivedRaw).trim() !== '' ? parseFloat(String(amountReceivedRaw)) : null,
      };
      tempTransactionHolder.push(newTx);
    });

    if (tempTransactionHolder.length === 0) {
        toast({ title: "No Data to Import", description: "No valid transactions found in the file after mapping and validation.", variant: "default" });
        setIsLoading(false);
        return;
    }

    try {
      const batch = writeBatch(db);
      const transactionsRef = collection(db, "transactions");
      for (const txData of tempTransactionHolder) {
        const newDocRef = doc(transactionsRef);
        const { tempId, ...finalTxData } = txData; 
        batch.set(newDocRef, { ...finalTxData, 
          companyId: selectedCompanyId,
          createdBy: user.uid,
          createdAt: serverTimestamp(), isLedgerApproved: false });
        importedCount++;
      }
      await batch.commit();
      await fetchTransactions();
      toast({ title: "Import Successful", description: `${importedCount} transactions imported and are pending ledger posting.` });
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      setExcelHeaders([]);
      setExcelData([]);
      setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: ''});
    } catch (error) {
      console.error("Error saving transactions to Firestore:", error);
      toast({ title: "Database Error", description: "Could not save transactions to the database.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: ''});
  }, [excelHeaders]);

  const handleDeleteTransaction = async (transactionId: string) => {
    if(!user) return;
    setIsLoading(true);
    try {
      const transactionToDelete = transactions.find(tx => tx.id === transactionId);
      const batch = writeBatch(db);
      
      const txRef = doc(db, "transactions", transactionId);
      batch.delete(txRef);
      if (transactionToDelete?.isLedgerApproved) {
        await deleteBankTransactionFromLedger(user.uid, transactionId, batch);
      }
      await batch.commit();

      setTransactions(prevTransactions => prevTransactions.filter(t => t.id !== transactionId));
      toast({ title: "Transaction Deleted", description: "The transaction has been removed." });
    } catch (error) {
      console.error("Error deleting transaction: ", error);
      toast({ title: "Delete Error", description: "Could not delete the transaction.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartInlineEdit = (transaction: Transaction) => {
    setEditingRowId(transaction.id);
    setInlineEditVendor(transaction.vendor || "");
    setInlineEditGlAccount(transaction.glAccount || "");
  };

  const handleCancelInlineEdit = () => {
    setEditingRowId(null);
  };

  const handleSaveInlineEdit = async () => {
    if (!editingRowId || !user) return;
    
    const originalTransaction = transactions.find(tx => tx.id === editingRowId);
    if (!originalTransaction) {
        toast({ title: "Error", description: "Original transaction not found.", variant: "destructive" });
        return;
    }

    const vendorChanged = inlineEditVendor !== originalTransaction.vendor;
    const glAccountChanged = inlineEditGlAccount !== originalTransaction.glAccount;
    const needsLedgerReset = (vendorChanged || glAccountChanged) && originalTransaction.isLedgerApproved;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      const txDocRef = doc(db, "transactions", editingRowId);
      
      const updateData: any = {
        vendor: inlineEditVendor,
        glAccount: inlineEditGlAccount,
      };

      if (needsLedgerReset) {
        await deleteBankTransactionFromLedger(user.uid, editingRowId, batch);
        updateData.isLedgerApproved = false;
      }
      batch.update(txDocRef, updateData);
      await batch.commit();
      
      await fetchTransactions(); 
      toast({ title: "Transaction Updated", description: `Your changes have been saved. ${needsLedgerReset ? 'Ledger posting reset due to changes.' : ''}` });
      setEditingRowId(null);
    } catch (error) {
      console.error("Error updating transaction:", error);
      toast({ title: "Update Failed", description: "Could not save your changes.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };


  const handleExportToExcel = () => {
    if (filteredAndSortedTransactions.length === 0) {
      toast({ title: "No Data to Export", description: "There are no transactions to export (check filters).", variant: "default" });
      return;
    }

    const exportData = filteredAndSortedTransactions.map(t => ({
      Date: t.date ? format(dateFnsParse(t.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : "",
      Description: t.description,
      'Bank Name': t.bankName, 
      Vendor: t.vendor || '',
      'GL Account': t.glAccount || '',
      'Amount Paid': t.amountPaid !== null ? t.amountPaid : '',
      'Amount Received': t.amountReceived !== null ? t.amountReceived : '',
      'Ledger Status': t.isLedgerApproved ? 'Approved' : 'Pending',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `transactions_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Transactions exported to Excel." });
  };
  
  const isEffectivelyEmpty = (val: string | null | undefined) => !val || val.trim() === '' || val.trim() === '-';


  const handleAiCategorizeTransactions = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
     if (transactions.length === 0) {
      toast({ title: "No Transactions", description: "There are no transactions to categorize.", variant: "default" });
      return;
    }
    if (chartOfAccounts.length === 0) {
      toast({ title: "Chart of Accounts Needed", description: "Please add some Chart of Accounts data first. The AI uses this to suggest GL accounts.", variant: "default" });
      return;
    }

    setIsAiCategorizing(true);
    try {
      
      const transactionsEligibleForAICategorization = transactions.filter(tx =>
        !tx.isLedgerApproved && (
          tx.vendor === ASK_MY_ACCOUNTANT ||
          tx.glAccount === ASK_MY_ACCOUNTANT ||
          (isEffectivelyEmpty(tx.vendor) && isEffectivelyEmpty(tx.glAccount))
        )
      );
      
      if (transactionsEligibleForAICategorization.length === 0) {
        toast({ title: "AI Categorization", description: "No transactions currently require AI categorization (e.g., those with empty vendor & GL, or marked 'Ask My Accountant', and not yet ledger approved).", variant: "default" });
        setIsAiCategorizing(false);
        return;
      }
      
      const uniqueDescriptionMap = new Map<string, Transaction>();
      transactionsEligibleForAICategorization.forEach(tx => {
        if (!uniqueDescriptionMap.has(tx.description)) {
          uniqueDescriptionMap.set(tx.description, tx);
        }
      });

      const representativeTransactionsForAI: Omit<AiFlowTransaction, 'confidenceScore'>[] =
        Array.from(uniqueDescriptionMap.values()).map(tx => ({
          id: tx.id, 
          userId: tx.userId,
          date: tx.date,
          description: tx.description,
          bankName: tx.bankName,
          vendor: tx.vendor, 
          glAccount: tx.glAccount, 
          amountPaid: tx.amountPaid,
          amountReceived: tx.amountReceived,
          createdAt: tx.createdAt ? { seconds: tx.createdAt.seconds, nanoseconds: tx.createdAt.nanoseconds } : undefined,
        }));

      if (representativeTransactionsForAI.length === 0) {
        toast({ title: "AI Categorization", description: "No unique transactions identified for AI categorization after filtering.", variant: "default" });
        setIsAiCategorizing(false);
        return;
      }
      
      const availableGlAccountNames = chartOfAccounts.map(acc => acc.glAccount);
      const flowInput: CategorizeUnmatchedTransactionsInput = {
        transactionsToCategorize: representativeTransactionsForAI,
        availableGlAccounts: availableGlAccountNames,
      };

      const result: CategorizeUnmatchedTransactionsOutput = await categorizeUnmatchedUserTransactions(flowInput);

      if (result.aiCategorizedTransactions && result.aiCategorizedTransactions.length > 0) {
        const aiSuggestionsByDescription = new Map<string, { suggestedVendor: string; suggestedGlAccount: string; confidenceScore?: number }>();
        result.aiCategorizedTransactions.forEach(aiTxOutput => {
          const representativeTxInput = representativeTransactionsForAI.find(rt => rt.id === aiTxOutput.id);
          if (representativeTxInput) {
            aiSuggestionsByDescription.set(representativeTxInput.description, {
              suggestedVendor: aiTxOutput.vendor,
              suggestedGlAccount: aiTxOutput.glAccount,
              confidenceScore: aiTxOutput.confidenceScore,
            });
          }
        });

        const chartOfAccountNamesOriginalCasing = chartOfAccounts.map(coa => coa.glAccount);
        const modifiableTxsFromAI: ModifiableAiTransaction[] = [];
        const unresolvedSuggestionsMap = new Map<string, { aiSuggestedGl: string, originalTransactionIds: string[] }>();

        transactionsEligibleForAICategorization.forEach(originalTx => {
          const suggestion = aiSuggestionsByDescription.get(originalTx.description);
          if (suggestion) {
            let finalGlAccount = suggestion.suggestedGlAccount;
            let currentConfidence = suggestion.confidenceScore ?? 0.0;
            let isResolved = false;

            const fuzzyMatchedCoAGl = findFuzzyMatchedGlAccount(suggestion.suggestedGlAccount, chartOfAccountNamesOriginalCasing);

            if (fuzzyMatchedCoAGl) {
              finalGlAccount = fuzzyMatchedCoAGl;
              isResolved = true;
            } else if (suggestion.suggestedGlAccount && suggestion.suggestedGlAccount !== '-' && suggestion.suggestedGlAccount !== ASK_MY_ACCOUNTANT) {
              const existingEntry = unresolvedSuggestionsMap.get(suggestion.suggestedGlAccount);
              if (existingEntry) {
                existingEntry.originalTransactionIds.push(originalTx.id);
              } else {
                unresolvedSuggestionsMap.set(suggestion.suggestedGlAccount, { aiSuggestedGl: suggestion.suggestedGlAccount, originalTransactionIds: [originalTx.id] });
              }
            } else {
              isResolved = true; 
            }
            
            const finalIsApproved = currentConfidence >= 0.5 && isResolved;

            modifiableTxsFromAI.push({
              id: originalTx.id,
              userId: originalTx.userId,
              date: originalTx.date,
              description: originalTx.description,
              bankName: originalTx.bankName,
              vendor: suggestion.suggestedVendor,
              glAccount: finalGlAccount,
              amountPaid: originalTx.amountPaid,
              amountReceived: originalTx.amountReceived,
              createdAt: originalTx.createdAt ? { seconds: originalTx.createdAt.seconds, nanoseconds: originalTx.createdAt.nanoseconds } : undefined,
              confidenceScore: currentConfidence,
              isApproved: finalIsApproved,
            });
          } else {
             modifiableTxsFromAI.push({
              ...originalTx,
              createdAt: originalTx.createdAt ? { seconds: originalTx.createdAt.seconds, nanoseconds: originalTx.createdAt.nanoseconds } : undefined,
              confidenceScore: 0.0,
              isApproved: false,
            });
          }
        });


        const initialMissingCoaItems: MissingCoaDialogItem[] = Array.from(unresolvedSuggestionsMap.values()).map(entry => ({
            aiSuggestedGl: entry.aiSuggestedGl,
            relatedTransactionIds: entry.originalTransactionIds,
            chosenAction: 'createNew', 
            newAccountSubType: '',
            newAccountType: '',
            newAccountFs: '',
            mapToExistingGl: '',
        }));

        if (initialMissingCoaItems.length > 0) {
            setMissingCoaSuggestionsForDialog(initialMissingCoaItems);
            setPendingCategorizationsAfterCoaResolution(modifiableTxsFromAI);
            setIsResolveMissingCoaDialogOpen(true);
        } else {
            const originalTxDetailsMap = new Map(transactionsEligibleForAICategorization.map(tx => [tx.id, {vendor: tx.vendor, glAccount: tx.glAccount, isLedgerApproved: tx.isLedgerApproved}]));
            const transactionsActuallyModifiedOrLowConfidence = modifiableTxsFromAI.filter(tx => {
                const originalDetails = originalTxDetailsMap.get(tx.id);
                const confidence = tx.confidenceScore ?? 1.0;
                if (confidence < 0.5 && tx.glAccount !== ASK_MY_ACCOUNTANT && tx.glAccount !== '-') return true;
                if (!originalDetails) { 
                    return (tx.vendor && tx.vendor !== '-' && tx.vendor !== ASK_MY_ACCOUNTANT) || 
                           (tx.glAccount && tx.glAccount !== '-' && tx.glAccount !== ASK_MY_ACCOUNTANT);
                }
                const vendorChanged = tx.vendor !== originalDetails.vendor;
                const glAccountChanged = tx.glAccount !== originalDetails.glAccount;
                return vendorChanged || glAccountChanged || !originalDetails.isLedgerApproved;
            });

            if (transactionsActuallyModifiedOrLowConfidence.length > 0) {
                setTransactionsForAiConfirmation(transactionsActuallyModifiedOrLowConfidence);
                setSelectAllAiConfirmations(transactionsActuallyModifiedOrLowConfidence.every(tx => tx.isApproved));
                setIsAiConfirmDialogOpen(true);
            } else {
                toast({ title: "AI Categorization", description: "AI did not suggest any new valid categorizations for the remaining transactions after validation.", variant: "default" });
            }
        }
      } else {
        toast({ title: "AI Categorization", description: "AI could not categorize any transactions or returned no results.", variant: "default" });
      }
    } catch (error) {
      console.error("Error AI-categorizing transactions:", error);
      toast({ title: "AI Categorization Failed", description: "An error occurred during AI-powered categorization.", variant: "destructive" });
    } finally {
      setIsAiCategorizing(false);
    }
  };

  const handleLocalCategorizeTransactions = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    if (transactions.length === 0) {
      toast({ title: "No Transactions", description: "There are no transactions to categorize.", variant: "default" });
      return;
    }
    if (chartOfAccounts.length === 0) {
      toast({ title: "Chart of Accounts Needed", description: "Please add Chart of Accounts data for validation.", variant: "default" });
      return;
    }

    setIsLocalCategorizing(true);
    try {
      // const historicalRefQuery = query(collection(db, "historicalReferenceData"), where("userId", "==", user.uid));
      const historicalRefQuery = query(collection(db, "historicalReferenceData"), where("companyId", "==", selectedCompanyId));

      const historicalRefSnapshot = await getDocs(historicalRefQuery);
      const referenceDataFromDB: PageHistoricalReferenceItem[] = [];
      historicalRefSnapshot.forEach((doc) => {
        referenceDataFromDB.push({ id: doc.id, ...(doc.data() as Omit<PageHistoricalReferenceItem, 'id'>) });
      });

      if (referenceDataFromDB.length === 0) {
        toast({ title: "No Reference Data", description: "Please add some historical reference data first for local categorization.", variant: "default" });
        setIsLocalCategorizing(false);
        return;
      }
      
      const chartOfAccountNamesOriginalCasing = chartOfAccounts.map(coa => coa.glAccount);

      const transactionsToConsider = transactions.filter(tx =>
        (!tx.vendor || tx.vendor === '-') || 
        (!tx.glAccount || tx.glAccount === '-') ||
        !tx.isLedgerApproved 
      );

      if (transactionsToConsider.length === 0) {
        toast({ title: "All Categorized or Approved", description: "All transactions already seem to have a vendor/GL and are ledger approved.", variant: "default" });
        setIsLocalCategorizing(false);
        return;
      }

      let updatedCount = 0;
      const batch = writeBatch(db);

      for (const tx of transactionsToConsider) {
        for (const refItem of referenceDataFromDB) {
          if (isFuzzyMatch(tx.description, refItem.keyword)) {
            const fuzzyMatchedHistoricalGl = findFuzzyMatchedGlAccount(refItem.glAccount, chartOfAccountNamesOriginalCasing);
            
            const vendorChanged = tx.vendor !== refItem.vendorCustomerName;
            const glChanged = fuzzyMatchedHistoricalGl && tx.glAccount !== fuzzyMatchedHistoricalGl;

            if(vendorChanged || glChanged) {
                const txDocRef = doc(db, "transactions", tx.id);
                const updatePayload: any = {};

                if (vendorChanged) {
                    updatePayload.vendor = refItem.vendorCustomerName;
                }
                if (glChanged && fuzzyMatchedHistoricalGl) { 
                    updatePayload.glAccount = fuzzyMatchedHistoricalGl;
                } else if (glChanged && !fuzzyMatchedHistoricalGl) {
                }
                
                if (Object.keys(updatePayload).length > 0) { 
                    if (tx.isLedgerApproved && (updatePayload.vendor || updatePayload.glAccount)) { 
                        await deleteBankTransactionFromLedger(user.uid, tx.id, batch);
                        updatePayload.isLedgerApproved = false;
                    }
                    batch.update(txDocRef, updatePayload);
                    updatedCount++;
                }
            }
            break; 
          }
        }
      }
      
      if (updatedCount > 0) {
        await batch.commit();
        toast({ title: "Local Categorization Complete", description: `${updatedCount} transaction(s) updated. ${updatedCount > 0 ? 'Ledger postings reset where applicable.' : ''}` });
        await fetchTransactions(); 
      } else {
        toast({ title: "Local Categorization", description: "No transactions were updated based on historical data and Chart of Accounts validation." });
      }

    } catch (error) {
      console.error("Error local-categorizing transactions:", error);
      toast({ title: "Local Categorization Failed", description: "An error occurred during local categorization.", variant: "destructive" });
    } finally {
      setIsLocalCategorizing(false);
    }
  };

  const handleAiConfirmationChange = (txId: string, field: keyof ModifiableAiTransaction, value: string | boolean) => {
    setTransactionsForAiConfirmation(prev =>
        prev.map(tx => tx.id === txId ? {...tx, [field]: value} : tx)
    );
  };

  const handleToggleAllAiConfirmations = (checked: boolean) => {
    setSelectAllAiConfirmations(checked);
    setTransactionsForAiConfirmation(prev => prev.map(tx => ({...tx, isApproved: checked})));
  };

  const handleProcessAiConfirmedCategorizations = async () => {
    if(!user) return;
    setIsLoading(true);
    setIsAiConfirmDialogOpen(false);
    try {
      const approvedTransactionsFromDialog = transactionsForAiConfirmation.filter(tx => tx.isApproved);
      if (approvedTransactionsFromDialog.length === 0) {
        toast({ title: "No Transactions Approved", description: "No changes were saved.", variant: "default" });
        setIsLoading(false);
        setTransactionsForAiConfirmation([]);
        return;
      }
      
      const batch = writeBatch(db);
      let updatedCount = 0;
      let ledgerResets = 0;


      for (const dialogTx of approvedTransactionsFromDialog) {
        const originalTx = transactions.find(t => t.id === dialogTx.id);
        if (!originalTx) continue;
        
        const txDocRef = doc(db, "transactions", originalTx.id);

        const updatePayload: any = {
          vendor: dialogTx.vendor,
          glAccount: dialogTx.glAccount,
        };

        if (originalTx.isLedgerApproved) {
          await deleteBankTransactionFromLedger(user.uid, originalTx.id, batch);
          updatePayload.isLedgerApproved = false;
          ledgerResets++;
        } else {
          updatePayload.isLedgerApproved = false; 
        }
        
        batch.update(txDocRef, updatePayload);
        updatedCount++;
      }

      if (updatedCount > 0) {
         await batch.commit();
      }

      let toastMessage = "";
      if (updatedCount > 0) toastMessage += `${updatedCount} transaction(s) updated from AI suggestions. `;
      if (ledgerResets > 0) toastMessage += `${ledgerResets} ledger posting(s) reset. `;
      if (!toastMessage) toastMessage = "No changes were applied from AI suggestions.";
      
      toast({ title: "AI Categorization Applied", description: toastMessage });
      await fetchTransactions();
    } catch (error) {
      console.error("Error processing confirmed AI categorizations:", error);
      toast({ title: "Save Error", description: "Could not save AI categorized transactions.", variant: "destructive" });
    } finally {
      setTransactionsForAiConfirmation([]);
      setIsLoading(false);
    }
  };

  const handleToggleSelectTransaction = (transactionId: string, checked: boolean, isShiftEvent: boolean) => {
    setSelectedTransactionIds(prevSelectedIds => {
      if (isShiftEvent && lastSelectedTransactionId && lastSelectedTransactionId !== transactionId) {
        const currentIndex = filteredAndSortedTransactions.findIndex(tx => tx.id === transactionId);
        const lastIndex = filteredAndSortedTransactions.findIndex(tx => tx.id === lastSelectedTransactionId);

        if (currentIndex === -1 || lastIndex === -1) { 
          return checked ? [...prevSelectedIds, transactionId] : prevSelectedIds.filter(id => id !== transactionId);
        }

        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const idsInRange = filteredAndSortedTransactions.slice(start, end + 1).map(tx => tx.id);

        if (checked) { 
          return Array.from(new Set([...prevSelectedIds, ...idsInRange]));
        } else { 
          return prevSelectedIds.filter(id => !idsInRange.includes(id));
        }
      } else { 
        if (!isShiftEvent) {
             setLastSelectedTransactionId(transactionId); 
        }
        return checked ? [...prevSelectedIds, transactionId] : prevSelectedIds.filter(id => id !== transactionId);
      }
    });
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTransactionIds(filteredAndSortedTransactions.map(tx => tx.id));
    } else {
      setSelectedTransactionIds([]);
    }
    setLastSelectedTransactionId(null);
  };

  const handleOpenBulkEditDialog = () => {
    if (selectedTransactionIds.length === 0) return;
    setBulkEditVendor("");
    setBulkEditGlAccount("");
    setIsBulkEditDialogOpen(true);
  };

  const handleSaveBulkEdit = async () => {
    if (!user || selectedTransactionIds.length === 0 || (!bulkEditVendor && !bulkEditGlAccount)) {
      toast({title: "No Changes Specified", description: "Please provide a vendor or GL account to update.", variant: "destructive"});
      return;
    }
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      let ledgerResets = 0;

      for (const id of selectedTransactionIds) {
        const originalTx = transactions.find(t => t.id === id);
        if (!originalTx) continue;

        const txDocRef = doc(db, "transactions", id);
        const updates: any = {};
        if (bulkEditVendor) updates.vendor = bulkEditVendor;
        if (bulkEditGlAccount) updates.glAccount = bulkEditGlAccount;

        if (originalTx.isLedgerApproved && ( (bulkEditVendor && originalTx.vendor !== bulkEditVendor) || (bulkEditGlAccount && originalTx.glAccount !== bulkEditGlAccount) )) {
            await deleteBankTransactionFromLedger(user.uid, id, batch);
            updates.isLedgerApproved = false;
            ledgerResets++;
        }
        
        batch.update(txDocRef, updates);
      }
      await batch.commit();
      toast({title: "Bulk Edit Successful", description: `${selectedTransactionIds.length} transactions updated. ${ledgerResets > 0 ? `${ledgerResets} ledger posting(s) reset.` : ''}`});
      await fetchTransactions();
      setSelectedTransactionIds([]);
      setIsBulkEditDialogOpen(false);
    } catch (error) {
      console.error("Error bulk editing transactions:", error);
      toast({title: "Bulk Edit Failed", description: "Could not update transactions.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenBulkDeleteDialog = () => {
    if (selectedTransactionIds.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || selectedTransactionIds.length === 0) return;
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      for (const id of selectedTransactionIds) {
        const originalTx = transactions.find(t => t.id === id);
        const txRef = doc(db, "transactions", id);
        batch.delete(txRef);
        if (originalTx?.isLedgerApproved) {
            await deleteBankTransactionFromLedger(user.uid, id, batch);
        }
      }
      await batch.commit();
      toast({title: "Bulk Delete Successful", description: `${selectedTransactionIds.length} transactions deleted.`});
      await fetchTransactions(); 
      setSelectedTransactionIds([]);
      setIsBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error bulk deleting transactions:", error);
      toast({title: "Bulk Delete Failed", description: "Could not delete transactions.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const handlePostSelectedToLedger = async () => {
    if (!user || selectedTransactionIds.length === 0) {
      toast({ title: "No Transactions Selected", description: "Please select transactions to post.", variant: "default" });
      return;
    }
     if (chartOfAccounts.length === 0) {
      toast({ title: "Chart of Accounts Missing", description: "Please add accounts to your Chart of Accounts before posting.", variant: "destructive" });
      return;
    }

    const transactionsToAttemptPosting = transactions.filter(
      tx => selectedTransactionIds.includes(tx.id) && !tx.isLedgerApproved
    );

    if (transactionsToAttemptPosting.length === 0) {
      toast({ title: "No Action Needed", description: "Selected transactions are already posted or none were selected for posting.", variant: "default" });
      return;
    }
    
    setIsLoading(true);
    const chartOfAccountNamesLower = chartOfAccounts.map(coa => coa.glAccount.toLowerCase().trim());
    const successfullyPostedIds: string[] = [];
    const failedPostingReasons: React.ReactNode[] = [];
    let learnedCount = 0;
    let contactsCreatedCount = 0;
    const batch = writeBatch(db);
    
    // const historicalRefQuery = query(collection(db, "historicalReferenceData"), where("userId", "==", user.uid));
    const historicalRefQuery = query(collection(db, "historicalReferenceData"), where("companyId", "==", selectedCompanyId));

    const historicalRefSnapshot = await getDocs(historicalRefQuery);
    const currentHistoricalData: PageHistoricalReferenceItem[] = [];
    historicalRefSnapshot.forEach((docSnap) => {
      currentHistoricalData.push({ id: docSnap.id, ...(docSnap.data() as Omit<PageHistoricalReferenceItem, 'id'>) });
    });

    // const contactsQuery = query(collection(db, "contacts"), where("userId", "==", user.uid));
    const contactsQuery = query(collection(db, "contacts"), where("companyId", "==", selectedCompanyId));

    const contactsSnapshot = await getDocs(contactsQuery);
    const currentContacts: PageContactItem[] = [];
    contactsSnapshot.forEach((docSnap) => {
        currentContacts.push({ id: docSnap.id, ...(docSnap.data() as Omit<PageContactItem, 'id'>) });
    });


    for (const tx of transactionsToAttemptPosting) {
        let bankLedgerGLAccount = tx.bankName;
        if (!tx.bankName.toLowerCase().trim().startsWith("bank - ")) {
            bankLedgerGLAccount = `Bank - ${tx.bankName.trim()}`;
        }
        const bankLedgerGLAccountLower = bankLedgerGLAccount.toLowerCase().trim();
        const txGlAccountLower = tx.glAccount.toLowerCase().trim();

        let canPost = true;
        let failureReasonElements: React.ReactNode[] = [];

        if (!tx.glAccount || tx.glAccount === '-' || tx.glAccount === ASK_MY_ACCOUNTANT) {
            canPost = false;
            failureReasonElements.push(
              <span key={`${tx.id}-reason-1`}>
                Transaction "{tx.description.substring(0,20)}..." (ID: {tx.id.substring(0,5)}...) has an unspecified or placeholder GL account.
              </span>
            );
        } else if (!chartOfAccountNamesLower.includes(txGlAccountLower)) {
            canPost = false;
            failureReasonElements.push(
              <span key={`${tx.id}-reason-2`}>
                GL Account "{tx.glAccount}" for transaction "{tx.description.substring(0,20)}..." (ID: {tx.id.substring(0,5)}...) is not in Chart of Accounts.
              </span>
            );
        }
        
        if (canPost && !chartOfAccountNamesLower.includes(bankLedgerGLAccountLower)) {
            canPost = false;
            const systemSearchedFor = bankLedgerGLAccount; 
            console.error(
                `Ledger Posting Failure for Transaction ID: ${tx.id}.\n` +
                `Transaction Bank Name: "${tx.bankName}"\n` +
                `System constructed/used Bank GL Account: "${systemSearchedFor}" (case-insensitive, trimmed).\n` +
                `This EXACT name (after normalization) was NOT FOUND in your Chart of Accounts.\n` +
                `Available CoA GLs (normalized for system check): ${chartOfAccountNamesLower.map(name => `"${name}"`).join(", ")}`
            );
            failureReasonElements.push(
               <span key={`${tx.id}-reason-3`}>
                For transaction '{tx.description.substring(0, 20)}...' (ID: {tx.id.substring(0,5)}..., Bank: '{tx.bankName}'), the system requires a GL Account named EXACTLY: <strong>"{systemSearchedFor}"</strong>. This account was NOT FOUND in your Chart of Accounts. Please ADD or RENAME an account in your Chart of Accounts to match this EXACT name. It should typically be an Asset type (e.g., Current Asset, SubType: Bank).
              </span>
            );
        }

        if (canPost) {
            if (tx.vendor && tx.vendor !== '-' && tx.vendor !== ASK_MY_ACCOUNTANT) {
                let contactType: "Customer" | "Vendor" = "Vendor"; // Default
                if (tx.amountReceived && tx.amountReceived > 0) {
                    contactType = "Customer";
                } else if (tx.amountPaid && tx.amountPaid > 0) {
                    contactType = "Vendor";
                }
                const newContactCreated = await ensureContactExistsAndAddToBatch(
                    user.uid,
                    tx.vendor,
                    contactType,
                    currentContacts,
                    batch
                );
                if (newContactCreated) contactsCreatedCount++;
            }


            addBankTransactionToLedger(batch, user.uid, tx);
            batch.update(doc(db, "transactions", tx.id), { isLedgerApproved: true });
            successfullyPostedIds.push(tx.id);

            const newRefKeyword = tx.description;
            const newRefVendor = tx.vendor;
            const newRefGL = tx.glAccount;

            if (newRefVendor && newRefVendor !== '-' && newRefVendor !== ASK_MY_ACCOUNTANT && 
                newRefGL && newRefGL !== '-' && newRefGL !== ASK_MY_ACCOUNTANT) {
              const alreadyExists = currentHistoricalData.some(ref =>
                ref.keyword.toLowerCase() === newRefKeyword.toLowerCase() &&
                ref.vendorCustomerName === newRefVendor &&
                ref.glAccount === newRefGL
              );

              if (!alreadyExists) {
                const newHistoricalRefDoc = doc(collection(db, "historicalReferenceData"));
                batch.set(newHistoricalRefDoc, {
                  userId: user.uid,
                  keyword: newRefKeyword,
                  vendorCustomerName: newRefVendor,
                  glAccount: newRefGL,
                  createdAt: serverTimestamp()
                });
                learnedCount++;
                currentHistoricalData.push({ 
                  id: newHistoricalRefDoc.id, 
                  userId: user.uid,
                  keyword: newRefKeyword,
                  vendorCustomerName: newRefVendor,
                  glAccount: newRefGL,
                });
              }
            }

        } else {
            failedPostingReasons.push(React.createElement('div', {key: tx.id, className: "mb-1"}, ...failureReasonElements));
        }
    }

    try {
        let toastTitle = "Ledger Posting Processed";
        let toastDescriptionParts: React.ReactNode[] = [];
        let toastVariant: "default" | "destructive" = "default";

        if (successfullyPostedIds.length > 0) {
            if(!batch.empty) await batch.commit(); 
            let successMsg = `${successfullyPostedIds.length} transaction(s) posted to the ledger.`;
            if (learnedCount > 0) {
                successMsg += ` ${learnedCount} new historical reference(s) learned.`;
            }
            if (contactsCreatedCount > 0) {
                successMsg += ` ${contactsCreatedCount} new contact(s) auto-created.`;
            }
            toastDescriptionParts.push(React.createElement('p', { key: 'success-msg' }, successMsg));
        }
        
        if (failedPostingReasons.length > 0) {
            toastTitle = successfullyPostedIds.length === 0 ? "Ledger Posting Failed" : "Partial Ledger Posting";
            toastVariant = "destructive";

            const failureDetailsElement = React.createElement('div', { key: 'failure-details', className: "mt-2" },
                React.createElement('p', { className: "font-semibold" }, "Posting failed for some transactions:"),
                React.createElement('div', { className: "list-disc list-inside mt-1 text-xs max-h-40 overflow-y-auto" }, 
                    failedPostingReasons.slice(0, 10) 
                ),
                failedPostingReasons.length > 10 && React.createElement('p', { className: "text-xs mt-1" }, `And ${failedPostingReasons.length - 10} more issues...`),
                React.createElement('p', { className: "text-xs mt-2" }, "Please correct these issues (e.g., add missing GL accounts to Chart of Accounts with the correct 'Bank - ' prefix if needed, assign valid GLs to transactions) and try again.")
            );
            toastDescriptionParts.push(failureDetailsElement);
        }
        
        const finalToastDescription = toastDescriptionParts.length > 0 
            ? React.createElement(React.Fragment, null, ...toastDescriptionParts)
            : (transactionsToAttemptPosting.length > 0 ? "No transactions were posted. Check for issues listed or ensure selection." : "No transactions were eligible for posting.");

        if (toastDescriptionParts.length > 0 || (failedPostingReasons.length > 0 && successfullyPostedIds.length === 0) || (transactionsToAttemptPosting.length > 0 && successfullyPostedIds.length === 0)) {
           toast({
                title: toastTitle,
                description: finalToastDescription,
                variant: toastVariant,
                duration: failedPostingReasons.length > 0 ? 20000 : 10000,
            });
        }
        
        await fetchTransactions();
        if (contactsCreatedCount > 0) {
        }
        setSelectedTransactionIds([]);
    } catch (error) {
        console.error("Error during ledger posting batch commit:", error);
        toast({ title: "Ledger Posting Failed", description: "An error occurred while committing ledger posts.", variant: "destructive" });
    } finally {
        setIsLoading(false);
    }
  };

  const handleMissingCoaItemChange = (index: number, field: keyof MissingCoaDialogItem, value: any) => {
    setMissingCoaSuggestionsForDialog(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleApplyCoaResolutions = async () => {
    if (!user) return;
    setIsLoading(true);

    const batch = writeBatch(db);
    const newCoaItemsAddedToDb: PageChartOfAccountItem[] = [];
    const glMapping: Record<string, string> = {}; 

    for (const item of missingCoaSuggestionsForDialog) {
      if (item.chosenAction === 'createNew') {
        if (!item.newAccountSubType || !item.newAccountType) {
          toast({ title: "Validation Error", description: `SubType and Type are required for creating new GL Account: ${item.aiSuggestedGl}`, variant: "destructive" });
          setIsLoading(false);
          return;
        }
        const newCoaData: Omit<PageChartOfAccountItem, 'id' | 'createdAt' | 'userId'> = {
          userId: user.uid,
          glAccount: item.aiSuggestedGl, 
          subType: item.newAccountSubType,
          type: item.newAccountType as TypeOption, 
          fs: item.newAccountFs && item.newAccountFs !== CLEAR_FS_VALUE ? item.newAccountFs as FSOption : undefined,
        };
        const newCoaDocRef = doc(collection(db, "chartOfAccounts"));
        
        batch.set(newCoaDocRef, { ...newCoaData, createdAt: serverTimestamp() });
        newCoaItemsAddedToDb.push({ ...newCoaData, id: newCoaDocRef.id, createdAt: Timestamp.now(), userId: user.uid });
        glMapping[item.aiSuggestedGl] = item.aiSuggestedGl; 
      } else if (item.chosenAction === 'mapToExisting') {
        if (!item.mapToExistingGl || item.mapToExistingGl === CLEAR_SELECTION_VALUE) {
          toast({ title: "Validation Error", description: `Please select an existing GL Account to map for: ${item.aiSuggestedGl}`, variant: "destructive" });
          setIsLoading(false);
          return;
        }
        glMapping[item.aiSuggestedGl] = item.mapToExistingGl;
      } else if (item.chosenAction === 'usePlaceholder') {
        glMapping[item.aiSuggestedGl] = ASK_MY_ACCOUNTANT; 
      } else {
        glMapping[item.aiSuggestedGl] = ASK_MY_ACCOUNTANT;
      }
    }

    try {
      await batch.commit();
      if (newCoaItemsAddedToDb.length > 0) {
        setChartOfAccounts(prevCoa => [...prevCoa, ...newCoaItemsAddedToDb].sort((a, b) => a.glAccount.localeCompare(b.glAccount)));
        toast({ title: "Chart of Accounts Updated", description: `${newCoaItemsAddedToDb.length} new GL account(s) created.` });
      }

      const updatedCategorizations = pendingCategorizationsAfterCoaResolution.map(tx => {
        if (glMapping[tx.glAccount]) { 
          return { ...tx, glAccount: glMapping[tx.glAccount] };
        }
        return tx; 
      });
      
      
      const originalTxMapForFinalFilter = new Map(transactions.map(tx => [tx.id, {vendor: tx.vendor, glAccount: tx.glAccount, bankName: tx.bankName, isLedgerApproved: tx.isLedgerApproved}]));
      const transactionsActuallyModifiedOrLowConfidence = updatedCategorizations.filter(tx => {
          const originalDetails = originalTxMapForFinalFilter.get(tx.id);
          const confidence = tx.confidenceScore ?? 1.0;
          
          if (tx.glAccount === ASK_MY_ACCOUNTANT && confidence < 0.9) return true; 
          if (confidence < 0.5) return true;

          if (!originalDetails) {
            return (tx.vendor && tx.vendor !== '-' && tx.vendor !== ASK_MY_ACCOUNTANT) || 
                   (tx.glAccount && tx.glAccount !== '-' && tx.glAccount !== ASK_MY_ACCOUNTANT);
          }
          const vendorChanged = tx.vendor !== originalDetails.vendor;
          const glAccountChanged = tx.glAccount !== originalDetails.glAccount;
          return vendorChanged || glAccountChanged || !originalDetails.isLedgerApproved;
      });


      if (transactionsActuallyModifiedOrLowConfidence.length > 0) {
        setTransactionsForAiConfirmation(transactionsActuallyModifiedOrLowConfidence);
        setSelectAllAiConfirmations(transactionsActuallyModifiedOrLowConfidence.every(t => t.isApproved));
        setIsAiConfirmDialogOpen(true);
      } else {
        toast({ title: "AI Categorization", description: "No further review needed or AI did not suggest changes after CoA resolution.", variant: "default" });
      }

    } catch (error) {
      console.error("Error applying CoA resolutions:", error);
      toast({ title: "Error Saving CoA Changes", description: "Could not save new/mapped GL accounts.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsResolveMissingCoaDialogOpen(false);
      setMissingCoaSuggestionsForDialog([]);
      setPendingCategorizationsAfterCoaResolution([]);
    }
  };


  const targetColumns: Array<{ key: keyof ColumnMapping; label: string; isOptional?: boolean }> = [
    { key: "date", label: "Date *" },
    { key: "description", label: "Description *" },
    { key: "bankName", label: "Name of the Bank *" }, 
    { key: "vendor", label: "Vendor (Optional)", isOptional: true },
    { key: "glAccount", label: "GL Account (Optional)", isOptional: true },
    { key: "amountPaid", label: "Amount Paid (Map one)" },
    { key: "amountReceived", label: "Amount Received (Map one)" },
  ];

  const commonButtonDisabled = isLoading || isAiCategorizing || isLocalCategorizing || isFetching || !!editingRowId || isAiConfirmDialogOpen || isBulkEditDialogOpen || isBulkDeleteDialogOpen || isResolveMissingCoaDialogOpen;
  const noTransactionsSelected = selectedTransactionIds.length === 0;
  const canPostToLedger = useMemo(() => {
    return selectedTransactionIds.some(id => {
        const tx = transactions.find(t => t.id === id);
        return tx && !tx.isLedgerApproved;
    });
  }, [selectedTransactionIds, transactions]);

  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedTransactions.length === 0) return false;
    return filteredAndSortedTransactions.every(tx => selectedTransactionIds.includes(tx.id));
  }, [filteredAndSortedTransactions, selectedTransactionIds]);

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline">
              Bank Transactions
            </h1>
            <p className="text-lg text-muted-foreground">
              Human + AI = Magic
            </p>
          </div>
          <div className="flex items-center space-x-2">
             <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => {
                setIsImportDialogOpen(isOpen);
                if (!isOpen) {
                    setSelectedFile(null);
                    setExcelHeaders([]);
                    setExcelData([]);
                    setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: ''});
                }
             }}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={commonButtonDisabled}>
                  <Upload className="mr-2 h-4 w-4" /> Import Transactions
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                  <DialogTitle className="font-headline">Import Transactions from Excel</DialogTitle>
                  <DialogDescription>
                    Select an Excel file (.xlsx, .xls, .csv) and map the columns.
                    Dates should preferably be in MM/DD/YYYY or YYYY-MM-DD format for best results.
                    Fields marked with * are mandatory. Map at least one "Amount" column.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="excel-file" className="text-right">
                      Excel File
                    </Label>
                    <Input id="excel-file" type="file" accept=".xlsx, .xls, .csv" onChange={handleFileChange} className="col-span-3" />
                  </div>
                  {selectedFile ? (
                    <p className="text-xs text-muted-foreground col-span-3 col-start-2">
                      Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                    </p>
                  ) : null}
                  {isLoading && selectedFile && excelHeaders.length === 0 && (
                     <div className="flex justify-center items-center col-span-4 py-4">
                        <LoadingSpinner /> <span className="ml-2">Parsing file...</span>
                     </div>
                  )}
                  {excelHeaders.length > 0 && !isLoading && (
                    <>
                      <p className="col-span-4 text-sm text-muted-foreground">Map your Excel columns to the target fields:</p>
                      {targetColumns.map(targetCol => (
                        <div key={targetCol.key} className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor={`map-${targetCol.key}`} className="text-right">
                            {targetCol.label}
                          </Label>
                          <Select
                            value={columnMappings[targetCol.key] || SKIP_COLUMN_VALUE}
                            onValueChange={(value) => handleMappingChange(targetCol.key, value)}
                          >
                            <SelectTrigger className="col-span-3">
                              <SelectValue placeholder={targetCol.isOptional ? "Select Column (Optional)" : "Select Column"} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP_COLUMN_VALUE}><em>Skip this column</em></SelectItem>
                              {excelHeaders.map(header => (
                                <SelectItem key={header} value={header}>{header}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                       {excelData.length > 0 && (
                        <div className="col-span-4 mt-2">
                            <p className="text-sm font-medium mb-1">Data Preview (first 3 rows):</p>
                            <div className="border rounded-md p-2 max-h-40 overflow-auto text-xs bg-muted/50">
                                <pre>{JSON.stringify(excelData.slice(0,3).map(row => {
                                    const previewRow: any = {};
                                    excelHeaders.forEach((header, index) => {
                                        previewRow[header] = row[index];
                                    });
                                    return previewRow;
                                }), null, 2)}</pre>
                            </div>
                        </div>
                       )}
                    </>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleImportData} disabled={excelHeaders.length === 0 || isLoading}>
                    {isLoading && <LoadingSpinner className="mr-2"/>}
                    Import Data
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={handleLocalCategorizeTransactions} disabled={commonButtonDisabled || transactions.length === 0 || chartOfAccounts.length === 0}>
              {isLocalCategorizing ? <LoadingSpinner className="mr-2 h-4 w-4"/> : <SearchCheck className="mr-2 h-4 w-4" />}
              Categorize (history)
            </Button>
             <Button variant="outline" onClick={handleAiCategorizeTransactions} disabled={commonButtonDisabled || transactions.length === 0 || chartOfAccounts.length === 0}>
              {isAiCategorizing ? <LoadingSpinner className="mr-2 h-4 w-4"/> : <Sparkles className="mr-2 h-4 w-4" />}
              Categorize(AI)
            </Button>
            <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedTransactions.length === 0}>
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

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input 
                        type="search"
                        placeholder="Search transactions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                        disabled={commonButtonDisabled}
                    />
                </div>
                <div className="relative w-full sm:max-w-xs">
                    <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Select
                        value={statusFilter}
                        onValueChange={(value: "all" | "pending" | "approved") => setStatusFilter(value)}
                        disabled={commonButtonDisabled}
                    >
                        <SelectTrigger className="pl-10">
                            <SelectValue placeholder="Filter by status..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            {selectedTransactionIds.length > 0 && (
                <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between mt-4 sm:mt-0 sm:ml-4 flex-grow w-full sm:w-auto">
                    <span className="text-sm font-medium">{selectedTransactionIds.length} transaction(s) selected</span>
                    <div className="space-x-2">
                        <Button size="sm" variant="outline" onClick={handleOpenBulkEditDialog} disabled={commonButtonDisabled}>
                            <Edit3 className="mr-2 h-4 w-4" /> Bulk Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleOpenBulkDeleteDialog} disabled={commonButtonDisabled}>
                            <Trash2 className="mr-2 h-4 w-4" /> Bulk Delete
                        </Button>
                        <Button size="sm" variant="default" onClick={handlePostSelectedToLedger} disabled={commonButtonDisabled || !canPostToLedger}>
                            <Library className="mr-2 h-4 w-4" /> Post to Ledger
                        </Button>
                    </div>
                </div>
            )}
        </div>


        <Card className="shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-2xl font-medium font-headline">
              <Landmark className="inline-block mr-3 h-7 w-7 text-primary" />
              List of Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching || isFetchingChartOfAccounts ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Loading data...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={isSelectAllChecked}
                          onCheckedChange={(checked) => handleToggleSelectAll(Boolean(checked))}
                          aria-label="Select all transactions"
                          disabled={commonButtonDisabled || filteredAndSortedTransactions.length === 0}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('date')}>
                        <div className="flex items-center">Date <SortIndicator columnKey="date" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('description')}>
                        <div className="flex items-center">Description <SortIndicator columnKey="description" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('bankName')}>
                        <div className="flex items-center">Bank Name <SortIndicator columnKey="bankName" /></div>
                      </TableHead>
                      <TableHead className="min-w-[200px] cursor-pointer hover:bg-muted/50" onClick={() => requestSort('vendor')}>
                        <div className="flex items-center">Vendor <SortIndicator columnKey="vendor" /></div>
                      </TableHead>
                      <TableHead className="min-w-[250px] cursor-pointer hover:bg-muted/50" onClick={() => requestSort('glAccount')}>
                        <div className="flex items-center">GL Account <SortIndicator columnKey="glAccount" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('amountPaid')}>
                        <div className="flex items-center justify-end">Amount Paid <SortIndicator columnKey="amountPaid" /></div>
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => requestSort('amountReceived')}>
                        <div className="flex items-center justify-end">Amount Received <SortIndicator columnKey="amountReceived" /></div>
                      </TableHead>
                      <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => requestSort('ledgerStatus')}>
                        <div className="flex items-center justify-center">Ledger Status <SortIndicator columnKey="ledgerStatus" /></div>
                      </TableHead>
                      <TableHead className="text-center w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedTransactions.length > 0 ? (
                      filteredAndSortedTransactions.map((transaction) => (
                        <TableRow
                            key={transaction.id}
                            data-state={selectedTransactionIds.includes(transaction.id) ? "selected" : ""}
                            className={selectedTransactionIds.includes(transaction.id) ? "bg-muted" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedTransactionIds.includes(transaction.id)}
                              onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => setIsShiftKeyPressed(e.shiftKey)}
                              onCheckedChange={(checked, event) => 
                                handleToggleSelectTransaction(
                                    transaction.id, 
                                    Boolean(checked), 
                                    isShiftKeyPressed || (event as unknown as React.MouseEvent<HTMLButtonElement>)?.nativeEvent?.shiftKey
                                )
                              }
                              aria-labelledby={`select-transaction-${transaction.id}`}
                              disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell>{transaction.date ? format(dateFnsParse(transaction.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : ""}</TableCell>
                          <TableCell>{transaction.description}</TableCell>
                          <TableCell>{transaction.bankName}</TableCell>
                          <TableCell>
                            {editingRowId === transaction.id ? (
                              <Input
                                value={inlineEditVendor}
                                onChange={(e) => setInlineEditVendor(e.target.value)}
                                className="h-8"
                                disabled={isLoading}
                              />
                            ) : (
                              transaction.vendor || '-'
                            )}
                          </TableCell>
                          <TableCell>
                            {editingRowId === transaction.id ? (
                              <Select
                                value={inlineEditGlAccount || CLEAR_SELECTION_VALUE}
                                onValueChange={(selectedValue) => {
                                  if (selectedValue === CLEAR_SELECTION_VALUE) {
                                    setInlineEditGlAccount("");
                                  } else {
                                    setInlineEditGlAccount(selectedValue);
                                  }
                                }}
                                disabled={isLoading}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Select GL Account" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={CLEAR_SELECTION_VALUE}><em>(Clear Selection)</em></SelectItem>
                                  {chartOfAccounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.glAccount}>
                                      {acc.glAccount} - {acc.type}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              transaction.glAccount || '-'
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {transaction.amountPaid !== null ? `$${transaction.amountPaid.toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {transaction.amountReceived !== null ? `$${transaction.amountReceived.toFixed(2)}` : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            {transaction.isLedgerApproved ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300">
                                    <CheckCircle2 className="mr-1 h-3 w-3" /> Approved
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                                    <AlertCircle className="mr-1 h-3 w-3" /> Pending
                                </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center space-x-1">
                            {editingRowId === transaction.id ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleSaveInlineEdit}
                                  aria-label="Save changes"
                                  disabled={isLoading}
                                >
                                  <Check className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleCancelInlineEdit}
                                  aria-label="Cancel edit"
                                  disabled={isLoading}
                                >
                                  <X className="h-4 w-4 text-red-600" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleStartInlineEdit(transaction)}
                                  aria-label="Edit transaction"
                                  id={`select-transaction-${transaction.id}`}
                                  disabled={commonButtonDisabled || selectedTransactionIds.length > 0}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteTransaction(transaction.id)}
                                  aria-label="Delete transaction"
                                  disabled={commonButtonDisabled || selectedTransactionIds.length > 0}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                          {searchTerm || statusFilter !== "all" ? "No transactions match your filters." : "No transactions found. Try importing some."}
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

      {/* Resolve Missing CoA Dialog */}
      <Dialog open={isResolveMissingCoaDialogOpen} onOpenChange={(isOpen) => {
        if (!isOpen) {
            setMissingCoaSuggestionsForDialog([]);
            setPendingCategorizationsAfterCoaResolution([]);
        }
        setIsResolveMissingCoaDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle className="font-headline text-2xl">Resolve Missing GL Accounts</DialogTitle>
            <DialogDescription>
              The AI suggested some GL accounts that are not in your Chart of Accounts.
              For each, choose to create a new account, map to an existing one, or use a placeholder.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-grow overflow-hidden px-2">
            <ScrollArea className="h-full p-4">
              <div className="space-y-6">
                {missingCoaSuggestionsForDialog.map((item, index) => (
                  <Card key={index} className="shadow">
                    <CardHeader>
                      <CardTitle className="text-lg">AI Suggestion: <span className="font-mono text-primary">{item.aiSuggestedGl}</span></CardTitle>
                      <CardDescription>
                        Affects {item.relatedTransactionIds.length} transaction(s).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label>Action:</Label>
                        <Select
                          value={item.chosenAction || ""}
                          onValueChange={(value) => handleMissingCoaItemChange(index, 'chosenAction', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select action..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="createNew">Create New Account in CoA</SelectItem>
                            <SelectItem value="mapToExisting">Map to Existing CoA Account</SelectItem>
                            <SelectItem value="usePlaceholder">Use Placeholder ("{ASK_MY_ACCOUNTANT}")</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {item.chosenAction === 'createNew' && (
                        <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                          <h4 className="font-medium text-sm">New Account Details for "{item.aiSuggestedGl}"</h4>
                          <div>
                            <Label htmlFor={`newSubType-${index}`}>Sub Type *</Label>
                            <Input
                              id={`newSubType-${index}`}
                              value={item.newAccountSubType}
                              onChange={(e) => handleMissingCoaItemChange(index, 'newAccountSubType', e.target.value)}
                              placeholder="E.g., Software Subscription"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`newType-${index}`}>Type *</Label>
                            <Select
                              value={item.newAccountType}
                              onValueChange={(value) => handleMissingCoaItemChange(index, 'newAccountType', value)}
                            >
                              <SelectTrigger id={`newType-${index}`}>
                                <SelectValue placeholder="Select account type" />
                              </SelectTrigger>
                              <SelectContent>
                                {TYPE_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`newFs-${index}`}>Financial Statement (Optional)</Label>
                            <Select
                              value={item.newAccountFs || CLEAR_FS_VALUE}
                              onValueChange={(value) => handleMissingCoaItemChange(index, 'newAccountFs', value === CLEAR_FS_VALUE ? '' : value)}
                            >
                              <SelectTrigger id={`newFs-${index}`}>
                                <SelectValue placeholder="Select FS mapping" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={CLEAR_FS_VALUE}><em>(None)</em></SelectItem>
                                {FS_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {item.chosenAction === 'mapToExisting' && (
                        <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                           <h4 className="font-medium text-sm">Map "{item.aiSuggestedGl}" to:</h4>
                          <Select
                            value={item.mapToExistingGl || CLEAR_SELECTION_VALUE}
                            onValueChange={(value) => handleMissingCoaItemChange(index, 'mapToExistingGl', value === CLEAR_SELECTION_VALUE ? '' : value)}
                            disabled={chartOfAccounts.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={chartOfAccounts.length > 0 ? "Select existing GL Account" : "No CoA entries available"} />
                            </SelectTrigger>
                            <SelectContent>
                               <SelectItem value={CLEAR_SELECTION_VALUE}><em>(Clear Selection)</em></SelectItem>
                              {chartOfAccounts.map(coa => (
                                <SelectItem key={coa.id} value={coa.glAccount}>{coa.glAccount} ({coa.type})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter className="p-6 pt-4 border-t">
            <Button variant="outline" onClick={() => { setIsResolveMissingCoaDialogOpen(false); setMissingCoaSuggestionsForDialog([]); setPendingCategorizationsAfterCoaResolution([]); }} disabled={isLoading}>Cancel</Button>
            <Button onClick={handleApplyCoaResolutions} disabled={isLoading || missingCoaSuggestionsForDialog.some(item => !item.chosenAction)}>
              {isLoading ? <LoadingSpinner className="mr-2"/> : <PlusCircle className="mr-2 h-4 w-4" />}
              Apply Resolutions & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={isAiConfirmDialogOpen} onOpenChange={(isOpen) => {
        setIsAiConfirmDialogOpen(isOpen);
        if (!isOpen) {
            setTransactionsForAiConfirmation([]);
        }
      }}>
        <DialogContent className="sm:max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="font-headline text-2xl">Confirm AI Categorizations</DialogTitle>
            <DialogDescription>
              Review the AI's suggestions. Edit as needed and approve transactions to save their vendor/GL.
              Transactions with confidence below 50% are initially unapproved for review. Saved changes will mark transactions as pending ledger approval.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-2 flex items-center border-b">
            <Checkbox
                id="selectAllAi"
                checked={selectAllAiConfirmations}
                onCheckedChange={(checked) => handleToggleAllAiConfirmations(Boolean(checked))}
                className="mr-2"
            />
            <Label htmlFor="selectAllAi" className="text-sm font-medium">Select/Deselect All Approved</Label>
          </div>
          <div className="flex-grow overflow-hidden px-6">
            <ScrollArea className="h-full">
              <Table className="relative">
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[80px]">Approve</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead className="w-[120px]">Bank Name</TableHead>
                    <TableHead className="w-[150px] text-right">Amount</TableHead>
                    <TableHead className="min-w-[200px]">Suggested Vendor</TableHead>
                    <TableHead className="min-w-[250px]">Suggested GL Account</TableHead>
                    <TableHead className="w-[100px] text-center">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactionsForAiConfirmation.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>
                        <Checkbox
                          checked={tx.isApproved}
                          onCheckedChange={(checked) => handleAiConfirmationChange(tx.id, 'isApproved', Boolean(checked))}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{tx.description}</TableCell>
                      <TableCell className="text-xs">{tx.date ? format(dateFnsParse(tx.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : ""}</TableCell>
                      <TableCell className="text-xs">{tx.bankName}</TableCell>
                      <TableCell className="text-xs text-right">
                        {tx.amountPaid !== null ? `$${tx.amountPaid.toFixed(2)} (Paid)` : tx.amountReceived !== null ? `$${tx.amountReceived.toFixed(2)} (Received)`: "-"}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={tx.vendor}
                          onChange={(e) => handleAiConfirmationChange(tx.id, 'vendor', e.target.value)}
                          className="h-8 text-xs"
                          disabled={isLoading}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={tx.glAccount === ASK_MY_ACCOUNTANT ? ASK_MY_ACCOUNTANT : (tx.glAccount || CLEAR_SELECTION_VALUE)}
                          onValueChange={(val) => handleAiConfirmationChange(tx.id, 'glAccount', val === CLEAR_SELECTION_VALUE ? "" : val)}
                          disabled={isLoading}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select GL Account" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={CLEAR_SELECTION_VALUE}><em>(Clear Selection)</em></SelectItem>
                             <SelectItem value={ASK_MY_ACCOUNTANT}><em>{ASK_MY_ACCOUNTANT}</em></SelectItem>
                            {chartOfAccounts.map(acc => (
                              <SelectItem key={acc.id} value={acc.glAccount} className="text-xs">
                                {acc.glAccount} - {acc.type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-center">
                        {tx.confidenceScore !== undefined ? `${(tx.confidenceScore * 100).toFixed(0)}%` : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
          <DialogFooter className="p-6 pt-4 border-t">
            <Button variant="outline" onClick={() => {setIsAiConfirmDialogOpen(false); setTransactionsForAiConfirmation([]);}} disabled={isLoading}>Cancel</Button>
            <Button onClick={handleProcessAiConfirmedCategorizations} disabled={isLoading || transactionsForAiConfirmation.filter(tx => tx.isApproved).length === 0}>
              {isLoading ? <LoadingSpinner className="mr-2"/> : "Confirm & Save Approved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Bulk Edit Transactions</DialogTitle>
            <DialogDescription>
              Update vendor and/or GL account for {selectedTransactionIds.length} selected transaction(s).
              This will reset their ledger approval status to 'Pending'.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-vendor" className="text-right">Vendor</Label>
              <Input
                id="bulk-vendor"
                value={bulkEditVendor}
                onChange={(e) => setBulkEditVendor(e.target.value)}
                className="col-span-3"
                placeholder="New vendor name (optional)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-glAccount" className="text-right">GL Account</Label>
              <Select
                value={bulkEditGlAccount || CLEAR_SELECTION_VALUE}
                onValueChange={(val) => setBulkEditGlAccount(val === CLEAR_SELECTION_VALUE ? "" : val)}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select new GL Account (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLEAR_SELECTION_VALUE}><em>(Clear Selection / No Change)</em></SelectItem>
                  {chartOfAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.glAccount}>
                      {acc.glAccount} - {acc.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveBulkEdit} disabled={isLoading || (!bulkEditVendor && !bulkEditGlAccount)}>
              {isLoading && <LoadingSpinner className="mr-2" />} Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center">
                <AlertTriangle className="mr-2 h-6 w-6 text-destructive" /> Confirm Bulk Delete
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete {selectedTransactionIds.length} selected transaction(s) and their associated ledger entries (if any)? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)} disabled={isLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={isLoading}>
              {isLoading && <LoadingSpinner className="mr-2" />} Delete Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}
