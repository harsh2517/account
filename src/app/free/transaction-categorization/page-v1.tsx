"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, ArrowLeft, Upload, Trash2, FileDown, Edit3, AlertTriangle, ArrowUp, ArrowDown, Search, Filter, Sparkles, SearchCheck, Library, PlusCircle, Info, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useEffect, useCallback, useMemo } from "react";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
    categorizeUnmatchedUserTransactions,
    type Transaction as AiFlowTransaction,
     CategorizeUnmatchedTransactionsInput,
     CategorizeUnmatchedTransactionsOutput 
  } from "@/ai/flows/free-categorize-transactions-flow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { format, parse as dateFnsParse, isValid as isDateValid } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";



interface Transaction {
  id: string;
  date: string;
  description: string;
  bankName: string;
  vendor: string;
  glAccount: string;
  amountPaid: number | null;
  amountReceived: number | null;
  isLedgerApproved?: boolean;
  createdAt?: string;
}

interface HistoricalReferenceItem {
  id: string;
  keyword: string;
  vendorCustomerName: string;
  glAccount: string;
}

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  subType: string;
  type: string;
  fs?: string;
  accountNumber?: string;
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

interface SortConfig {
  key: keyof Transaction | 'ledgerStatus' | null;
  direction: 'ascending' | 'descending';
}

interface ModifiableAiTransaction extends AiFlowTransaction {
  isApproved: boolean;
  confidenceScore?: number;
}

interface MissingCoaDialogItem {
  aiSuggestedGl: string;
  relatedTransactionIds: string[];
  chosenAction: 'createNew' | 'mapToExisting' | 'usePlaceholder' | null;
  newAccountSubType: string;
  newAccountType: string;
  newAccountFs?: string;
  mapToExistingGl: string;
}

const SKIP_COLUMN_VALUE = "__SKIP__";
const CLEAR_SELECTION_VALUE = "__CLEAR__";
const ASK_MY_ACCOUNTANT = "Ask My Accountant";
const CLEAR_FS_VALUE = "__CLEAR_FS__";

// Local storage keys
const TRANSACTIONS_STORAGE_KEY = 'accountooze_free_transactions';
const HISTORICAL_REF_STORAGE_KEY = 'accountooze_free_historical_references';
const CHART_OF_ACCOUNTS_STORAGE_KEY = 'accountooze_free_chart_of_accounts';

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

const isEffectivelyEmpty = (val: string | null | undefined) => !val || val.trim() === '' || val.trim() === '-';

export default function BankTransactionsPage() {
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
  const [isAiCategorizing, setIsAiCategorizing] = useState(false);
  const [isLocalCategorizing, setIsLocalCategorizing] = useState(false);
  const { toast } = useToast();

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [historicalReferences, setHistoricalReferences] = useState<HistoricalReferenceItem[]>([]);

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

  const [isHowItWorksDialogOpen, setIsHowItWorksDialogOpen] = useState(false);
  const [isUploadHistoricalRefDialogOpen, setIsUploadHistoricalRefDialogOpen] = useState(false);
  const [isUploadCoaDialogOpen, setIsUploadCoaDialogOpen] = useState(false);

  // Load data from localStorage on component mount
  useEffect(() => {
    const loadDataFromStorage = () => {
      try {
        const storedTransactions = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
        if (storedTransactions) {
          setTransactions(JSON.parse(storedTransactions));
        }

        const storedHistoricalRefs = localStorage.getItem(HISTORICAL_REF_STORAGE_KEY);
        if (storedHistoricalRefs) {
          setHistoricalReferences(JSON.parse(storedHistoricalRefs));
        }

        const storedChartOfAccounts = localStorage.getItem(CHART_OF_ACCOUNTS_STORAGE_KEY);
        if (storedChartOfAccounts) {
          setChartOfAccounts(JSON.parse(storedChartOfAccounts));
        }
      } catch (error) {
        console.error("Error loading data from localStorage:", error);
        toast({
          title: "Error Loading Data",
          description: "Could not load data from browser storage.",
          variant: "destructive"
        });
      }
    };

    loadDataFromStorage();
  }, [toast]);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(HISTORICAL_REF_STORAGE_KEY, JSON.stringify(historicalReferences));
  }, [historicalReferences]);

  useEffect(() => {
    localStorage.setItem(CHART_OF_ACCOUNTS_STORAGE_KEY, JSON.stringify(chartOfAccounts));
  }, [chartOfAccounts]);

  const displayHeaders = useMemo(() => {
    return ["Date", "Description", "Bank Name", "Vendor", "GL Account", "Amount Paid", "Amount Received", "Ledger Status"];
  }, []);

  const dataRowsForRendering = useMemo(() => {
    return transactions;
  }, [transactions]);

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
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    setColumnMappings(prev => ({
      ...prev,
      [field]: value === SKIP_COLUMN_VALUE ? '' : value
    }));
  };

  const handleImportData = async () => {
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
    const tempTransactionHolder: Transaction[] = [];

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
              if (isDateValid(d)) parsedJsDate = d;
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
        console.warn("Skipping row due to missing or invalid essential data:", { date: formattedDateForStorage, desc: descriptionValue, bank: bankNameValue, originalDate: dateValue });
        return;
      }

      const newTx: Transaction = {
        id: `temp_${Date.now()}_${index}`,
        date: formattedDateForStorage,
        description: descriptionValue,
        bankName: bankNameValue,
        vendor: String(columnMappings.vendor && columnMappings.vendor !== SKIP_COLUMN_VALUE ?
          row[excelHeaders.indexOf(columnMappings.vendor)] : '-' || '-'),
        glAccount: String(columnMappings.glAccount && columnMappings.glAccount !== SKIP_COLUMN_VALUE ?
          row[excelHeaders.indexOf(columnMappings.glAccount)] : '-' || '-'),
        amountPaid: amountPaidRaw !== null && String(amountPaidRaw).trim() !== '' ?
          parseFloat(String(amountPaidRaw)) : null,
        amountReceived: amountReceivedRaw !== null && String(amountReceivedRaw).trim() !== '' ?
          parseFloat(String(amountReceivedRaw)) : null,
        isLedgerApproved: false,
        createdAt: new Date().toISOString()
      };
      tempTransactionHolder.push(newTx);
    });

    if (tempTransactionHolder.length === 0) {
      toast({ title: "No Data to Import", description: "No valid transactions found in the file after mapping and validation.", variant: "default" });
      setIsLoading(false);
      return;
    }

    try {
      setTransactions(prev => [...prev, ...tempTransactionHolder]);
      toast({ title: "Import Successful", description: `${tempTransactionHolder.length} transactions imported and are pending ledger posting.` });
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      setExcelHeaders([]);
      setExcelData([]);
      setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: '' });
    } catch (error) {
      console.error("Error saving transactions:", error);
      toast({ title: "Error", description: "Could not save transactions.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: '' });
  }, [excelHeaders]);

  const handleDeleteTransaction = async (transactionId: string) => {
    setIsLoading(true);
    try {
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
    if (!editingRowId) return;

    setIsLoading(true);
    try {
      setTransactions(prev => prev.map(tx => {
        if (tx.id === editingRowId) {
          return {
            ...tx,
            vendor: inlineEditVendor,
            glAccount: inlineEditGlAccount,
            isLedgerApproved: false 
          };
        }
        return tx;
      }));

      toast({ title: "Transaction Updated", description: "Your changes have been saved. Ledger posting reset due to changes." });
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

  const handleAiCategorizeTransactions = async () => {
    // Check if Gemini API key is available
    const geminiApiKey = localStorage.getItem('accountooze_free_gemini_key');
    if (!geminiApiKey) {
      toast({
        title: "Gemini API Key Required",
        description: "Please set your Gemini API key in the settings to use this feature.",
        variant: "destructive"
      });
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
          date: tx.date,
          description: tx.description,
          bankName: tx.bankName,
          vendor: tx.vendor,
          glAccount: tx.glAccount,
          amountPaid: tx.amountPaid,
          amountReceived: tx.amountReceived,
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
        geminiApiKey
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
              date: originalTx.date,
              description: originalTx.description,
              bankName: originalTx.bankName,
              vendor: suggestion.suggestedVendor,
              glAccount: finalGlAccount,
              amountPaid: originalTx.amountPaid,
              amountReceived: originalTx.amountReceived,
              confidenceScore: currentConfidence,
              isApproved: finalIsApproved,
            });
          } else {
            modifiableTxsFromAI.push({
              id: originalTx.id,
              date: originalTx.date,
              description: originalTx.description,
              bankName: originalTx.bankName,
              vendor: originalTx.vendor,
              glAccount: originalTx.glAccount,
              amountPaid: originalTx.amountPaid,
              amountReceived: originalTx.amountReceived,
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
          const originalTxDetailsMap = new Map(transactionsEligibleForAICategorization.map(tx => [tx.id, { vendor: tx.vendor, glAccount: tx.glAccount, isLedgerApproved: tx.isLedgerApproved }]));
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
    if (transactions.length === 0) {
      toast({ title: "No Transactions", description: "There are no transactions to categorize.", variant: "default" });
      return;
    }
    if (chartOfAccounts.length === 0) {
      toast({ title: "Chart of Accounts Needed", description: "Please add Chart of Accounts data for validation.", variant: "default" });
      return;
    }
    if (historicalReferences.length === 0) {
      toast({ title: "No Reference Data", description: "Please add some historical reference data first for local categorization.", variant: "default" });
      return;
    }

    setIsLocalCategorizing(true);
    try {
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
      const updatedTransactions = [...transactions];

      for (const tx of transactionsToConsider) {
        for (const refItem of historicalReferences) {
          if (isFuzzyMatch(tx.description, refItem.keyword)) {
            const fuzzyMatchedHistoricalGl = findFuzzyMatchedGlAccount(refItem.glAccount, chartOfAccounts.map(coa => coa.glAccount));

            const vendorChanged = tx.vendor !== refItem.vendorCustomerName;
            const glChanged = fuzzyMatchedHistoricalGl && tx.glAccount !== fuzzyMatchedHistoricalGl;

            if (vendorChanged || glChanged) {
              const txIndex = updatedTransactions.findIndex(t => t.id === tx.id);
              if (txIndex !== -1) {
                if (vendorChanged) {
                  updatedTransactions[txIndex].vendor = refItem.vendorCustomerName;
                }
                if (glChanged && fuzzyMatchedHistoricalGl) {
                  updatedTransactions[txIndex].glAccount = fuzzyMatchedHistoricalGl;
                }
                if (updatedTransactions[txIndex].isLedgerApproved && (vendorChanged || glChanged)) {
                  updatedTransactions[txIndex].isLedgerApproved = false;
                }
                updatedCount++;
              }
            }
            break;
          }
        }
      }

      if (updatedCount > 0) {
        setTransactions(updatedTransactions);
        toast({ title: "Local Categorization Complete", description: `${updatedCount} transaction(s) updated. ${updatedCount > 0 ? 'Ledger postings reset where applicable.' : ''}` });
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
      prev.map(tx => tx.id === txId ? { ...tx, [field]: value } : tx)
    );
  };

  const handleToggleAllAiConfirmations = (checked: boolean) => {
    setSelectAllAiConfirmations(checked);
    setTransactionsForAiConfirmation(prev => prev.map(tx => ({ ...tx, isApproved: checked })));
  };

  const handleProcessAiConfirmedCategorizations = async () => {
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

      setTransactions(prev => prev.map(tx => {
        const approvedTx = approvedTransactionsFromDialog.find(atx => atx.id === tx.id);
        if (approvedTx) {
          return {
            ...tx,
            vendor: approvedTx.vendor,
            glAccount: approvedTx.glAccount,
            isLedgerApproved: false // Reset approval status when changes are made
          };
        }
        return tx;
      }));

      toast({ title: "AI Categorization Applied", description: `${approvedTransactionsFromDialog.length} transaction(s) updated from AI suggestions.` });
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
    if (selectedTransactionIds.length === 0 || (!bulkEditVendor && !bulkEditGlAccount)) {
      toast({ title: "No Changes Specified", description: "Please provide a vendor or GL account to update.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      setTransactions(prev => prev.map(tx => {
        if (selectedTransactionIds.includes(tx.id)) {
          const updates: Partial<Transaction> = {};
          if (bulkEditVendor) updates.vendor = bulkEditVendor;
          if (bulkEditGlAccount) updates.glAccount = bulkEditGlAccount;
          if (Object.keys(updates).length > 0 && tx.isLedgerApproved) {
            updates.isLedgerApproved = false;
          }
          return { ...tx, ...updates };
        }
        return tx;
      }));

      toast({ title: "Bulk Edit Successful", description: `${selectedTransactionIds.length} transactions updated.` });
      setSelectedTransactionIds([]);
      setIsBulkEditDialogOpen(false);
    } catch (error) {
      console.error("Error bulk editing transactions:", error);
      toast({ title: "Bulk Edit Failed", description: "Could not update transactions.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenBulkDeleteDialog = () => {
    if (selectedTransactionIds.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedTransactionIds.length === 0) return;
    setIsLoading(true);
    try {
      setTransactions(prev => prev.filter(tx => !selectedTransactionIds.includes(tx.id)));
      toast({ title: "Bulk Delete Successful", description: `${selectedTransactionIds.length} transactions deleted.` });
      setSelectedTransactionIds([]);
      setIsBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error bulk deleting transactions:", error);
      toast({ title: "Bulk Delete Failed", description: "Could not delete transactions.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadHistoricalReferences = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', defval: "" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });

          if (jsonData.length > 1) {
            const headers = jsonData[0] as string[];
            const keywordIndex = headers.findIndex(h => h.toLowerCase().includes('keyword'));
            const vendorIndex = headers.findIndex(h => h.toLowerCase().includes('vendor') || h.toLowerCase().includes('customer'));
            const glIndex = headers.findIndex(h => h.toLowerCase().includes('gl') || h.toLowerCase().includes('account'));

            if (keywordIndex === -1 || vendorIndex === -1 || glIndex === -1) {
              toast({ title: "Invalid Format", description: "CSV must contain 'Keyword', 'Vendor/Customer Name', and 'GL Account' columns.", variant: "destructive" });
              return;
            }

            const newReferences: HistoricalReferenceItem[] = [];
            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (row[keywordIndex] && row[vendorIndex] && row[glIndex]) {
                newReferences.push({
                  id: `hr_${Date.now()}_${i}`,
                  keyword: String(row[keywordIndex]).trim(),
                  vendorCustomerName: String(row[vendorIndex]).trim(),
                  glAccount: String(row[glIndex]).trim()
                });
              }
            }

            if (newReferences.length > 0) {
              setHistoricalReferences(prev => [...prev, ...newReferences]);
              toast({ title: "Historical References Imported", description: `${newReferences.length} reference items imported.` });
            } else {
              toast({ title: "No Valid Data", description: "No valid historical reference data found in the file.", variant: "default" });
            }
          } else {
            toast({ title: "Empty File", description: "The selected file is empty or has no data.", variant: "destructive" });
          }
        } catch (error) {
          console.error("Error parsing historical references file:", error);
          toast({ title: "Parsing Error", description: "Could not parse the file.", variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsUploadHistoricalRefDialogOpen(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleUploadChartOfAccounts = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', defval: "" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });

          if (jsonData.length > 1) {
            const headers = jsonData[0] as string[];
            const glAccountIndex = headers.findIndex(h => h.toLowerCase().includes('gl') || h.toLowerCase().includes('account'));
            const subTypeIndex = headers.findIndex(h => h.toLowerCase().includes('sub') || h.toLowerCase().includes('type'));
            const typeIndex = headers.findIndex(h => h.toLowerCase().includes('type') && !h.toLowerCase().includes('sub'));
            const fsIndex = headers.findIndex(h => h.toLowerCase().includes('fs') || h.toLowerCase().includes('financial'));

            if (glAccountIndex === -1) {
              toast({ title: "Invalid Format", description: "CSV must contain at least a 'GL Account' column.", variant: "destructive" });
              return;
            }

            const newAccounts: ChartOfAccountItem[] = [];
            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (row[glAccountIndex]) {
                newAccounts.push({
                  id: `coa_${Date.now()}_${i}`,
                  glAccount: String(row[glAccountIndex]).trim(),
                  subType: subTypeIndex !== -1 && row[subTypeIndex] ? String(row[subTypeIndex]).trim() : "",
                  type: typeIndex !== -1 && row[typeIndex] ? String(row[typeIndex]).trim() : "",
                  fs: fsIndex !== -1 && row[fsIndex] ? String(row[fsIndex]).trim() : undefined,
                  accountNumber: ""
                });
              }
            }

            if (newAccounts.length > 0) {
              setChartOfAccounts(prev => [...prev, ...newAccounts]);
              toast({ title: "Chart of Accounts Imported", description: `${newAccounts.length} accounts imported.` });
            } else {
              toast({ title: "No Valid Data", description: "No valid chart of accounts data found in the file.", variant: "default" });
            }
          } else {
            toast({ title: "Empty File", description: "The selected file is empty or has no data.", variant: "destructive" });
          }
        } catch (error) {
          console.error("Error parsing chart of accounts file:", error);
          toast({ title: "Parsing Error", description: "Could not parse the file.", variant: "destructive" });
        } finally {
          setIsLoading(false);
          setIsUploadCoaDialogOpen(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleMissingCoaItemChange = (index: number, field: keyof MissingCoaDialogItem, value: any) => {
    setMissingCoaSuggestionsForDialog(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleApplyCoaResolutions = async () => {
    setIsLoading(true);

    const glMapping: Record<string, string> = {};
    const newCoaItems: ChartOfAccountItem[] = [];

    for (const item of missingCoaSuggestionsForDialog) {
      if (item.chosenAction === 'createNew') {
        if (!item.newAccountSubType || !item.newAccountType) {
          toast({ title: "Validation Error", description: `SubType and Type are required for creating new GL Account: ${item.aiSuggestedGl}`, variant: "destructive" });
          setIsLoading(false);
          return;
        }
        const newCoaData: ChartOfAccountItem = {
          id: `coa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          glAccount: item.aiSuggestedGl,
          subType: item.newAccountSubType,
          type: item.newAccountType,
          fs: item.newAccountFs && item.newAccountFs !== CLEAR_FS_VALUE ? item.newAccountFs : undefined,
        };
        newCoaItems.push(newCoaData);
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
      if (newCoaItems.length > 0) {
        setChartOfAccounts(prev => [...prev, ...newCoaItems]);
        toast({ title: "Chart of Accounts Updated", description: `${newCoaItems.length} new GL account(s) created.` });
      }

      const updatedCategorizations = pendingCategorizationsAfterCoaResolution.map(tx => {
        if (glMapping[tx.glAccount]) {
          return { ...tx, glAccount: glMapping[tx.glAccount] };
        }
        return tx;
      });

      const originalTxMapForFinalFilter = new Map(transactions.map(tx => [tx.id, { vendor: tx.vendor, glAccount: tx.glAccount, bankName: tx.bankName, isLedgerApproved: tx.isLedgerApproved }]));
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

  const commonButtonDisabled = isLoading || isAiCategorizing || isLocalCategorizing || !!editingRowId || isAiConfirmDialogOpen || isBulkEditDialogOpen || isBulkDeleteDialogOpen || isResolveMissingCoaDialogOpen;
  const noTransactionsSelected = selectedTransactionIds.length === 0;

  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedTransactions.length === 0) return false;
    return filteredAndSortedTransactions.every(tx => selectedTransactionIds.includes(tx.id));
  }, [filteredAndSortedTransactions, selectedTransactionIds]);

  const targetColumns: Array<{ key: keyof ColumnMapping; label: string; isOptional?: boolean }> = [
    { key: "date", label: "Date *" },
    { key: "description", label: "Description *" },
    { key: "bankName", label: "Name of the Bank *" },
    { key: "vendor", label: "Vendor (Optional)", isOptional: true },
    { key: "glAccount", label: "GL Account (Optional)", isOptional: true },
    { key: "amountPaid", label: "Amount Paid (Map one)" },
    { key: "amountReceived", label: "Amount Received (Map one)" },
  ];

  return (
    <div className="container mx-auto animate-fade-in">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2 font-headline">
            Bank Transactions (Free Version)
          </h1>
          <p className="text-lg text-muted-foreground">
            Process and categorize your bank transactions with AI assistance
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => {
            setIsImportDialogOpen(isOpen);
            if (!isOpen) {
              setSelectedFile(null);
              setExcelHeaders([]);
              setExcelData([]);
              setColumnMappings({ date: '', description: '', bankName: '', vendor: '', glAccount: '', amountPaid: '', amountReceived: '' });
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
                          <pre>{JSON.stringify(excelData.slice(0, 3).map(row => {
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
                  {isLoading && <LoadingSpinner className="mr-2" />}
                  Import Data
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isHowItWorksDialogOpen} onOpenChange={setIsHowItWorksDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Info className="mr-2 h-4 w-4" /> How This Works
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>How Bank Transactions Processing Works</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p>1. <strong>Import Transactions</strong>: Upload your bank statement in Excel or CSV format</p>
                <p>2. <strong>Upload Historical References</strong>: Provide past transaction data to help with categorization</p>
                <p>3. <strong>Upload Chart of Accounts</strong>: Add your GL accounts for proper categorization</p>
                <p>4. <strong>Categorize</strong>: Use AI or historical patterns to categorize transactions</p>
                <p>5. <strong>Review & Export</strong>: Review the categorized data and export to Excel</p>
                <p className="text-sm text-muted-foreground">Note: All data is stored locally in your browser and processed using your Gemini API key.</p>
              </div>
            </DialogContent>
          </Dialog>
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
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto mt-4 sm:mt-0">
          <Dialog open={isUploadHistoricalRefDialogOpen} onOpenChange={setIsUploadHistoricalRefDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={commonButtonDisabled}>
                <Upload className="mr-2 h-4 w-4" /> Upload Historical References
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Historical References</DialogTitle>
                <DialogDescription>
                  Upload a CSV file with historical reference data. The file should contain columns for Keyword, Vendor/Customer Name, and GL Account.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleUploadHistoricalReferences}
                  disabled={isLoading}
                />
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isUploadCoaDialogOpen} onOpenChange={setIsUploadCoaDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={commonButtonDisabled}>
                <Upload className="mr-2 h-4 w-4" /> Upload Chart of Accounts
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Chart of Accounts</DialogTitle>
                <DialogDescription>
                  Upload a CSV file with your Chart of Accounts. The file should contain at least a GL Account column.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleUploadChartOfAccounts}
                  disabled={isLoading}
                />
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={handleLocalCategorizeTransactions} disabled={commonButtonDisabled || transactions.length === 0 || chartOfAccounts.length === 0 || historicalReferences.length === 0}>
            {isLocalCategorizing ? <LoadingSpinner className="mr-2 h-4 w-4" /> : <SearchCheck className="mr-2 h-4 w-4" />}
            Categorize (history)
          </Button>

          <Button variant="outline" size="sm" onClick={handleAiCategorizeTransactions} disabled={commonButtonDisabled || transactions.length === 0 || chartOfAccounts.length === 0}>
            {isAiCategorizing ? <LoadingSpinner className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Categorize (AI)
          </Button>
{/* 
          <Dialog open={isHowItWorksDialogOpen} onOpenChange={setIsHowItWorksDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Info className="mr-2 h-4 w-4" /> How This Works
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>How Bank Transactions Processing Works</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p>1. <strong>Import Transactions</strong>: Upload your bank statement in Excel or CSV format</p>
                <p>2. <strong>Upload Historical References</strong>: Provide past transaction data to help with categorization</p>
                <p>3. <strong>Upload Chart of Accounts</strong>: Add your GL accounts for proper categorization</p>
                <p>4. <strong>Categorize</strong>: Use AI or historical patterns to categorize transactions</p>
                <p>5. <strong>Review & Export</strong>: Review the categorized data and export to Excel</p>
                <p className="text-sm text-muted-foreground">Note: All data is stored locally in your browser and processed using your Gemini API key.</p>
              </div>
            </DialogContent>
          </Dialog> */}
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
            <Button size="sm" variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled}>
              <FileDown className="mr-2 h-4 w-4" /> Export Selected
            </Button>
          </div>
        </div>
      )}

      <Card className="shadow-lg mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-2xl font-medium font-headline">
            <Landmark className="inline-block mr-3 h-7 w-7 text-primary" />
            List of Transactions
          </CardTitle>
          <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedTransactions.length === 0}>
            <FileDown className="mr-2 h-4 w-4" /> Export All to Excel
          </Button>
        </CardHeader>
        <CardContent>
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
                          onCheckedChange={(checked) =>
                            handleToggleSelectTransaction(
                              transaction.id,
                              Boolean(checked),
                              isShiftKeyPressed
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
                              <SelectItem value={ASK_MY_ACCOUNTANT}>{ASK_MY_ACCOUNTANT}</SelectItem>
                              {chartOfAccounts.map(acc => (
                                <SelectItem key={acc.id} value={acc.glAccount}>
                                  {acc.glAccount}
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
                            Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                            Pending
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
                              ✓
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={handleCancelInlineEdit}
                              aria-label="Cancel edit"
                              disabled={isLoading}
                            >
                              ✕
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
                              <Edit3 className="h-4 w-4" />
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
        </CardContent>
      </Card>

      {/* AI Confirmation Dialog */}
      <Dialog open={isAiConfirmDialogOpen} onOpenChange={(isOpen) => {
        setIsAiConfirmDialogOpen(isOpen);
        if (!isOpen) {
          setTransactionsForAiConfirmation([]);
        }
      }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Confirm AI Categorizations</DialogTitle>
            <DialogDescription>
              Review the AI's suggestions. Edit as needed and approve transactions to save their vendor/GL.
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
          <ScrollArea className="h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Approve</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Suggested Vendor</TableHead>
                  <TableHead>Suggested GL Account</TableHead>
                  <TableHead>Confidence</TableHead>
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
                        value={tx.glAccount}
                        onValueChange={(val) => handleAiConfirmationChange(tx.id, 'glAccount', val)}
                        disabled={isLoading}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select GL Account" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ASK_MY_ACCOUNTANT}>{ASK_MY_ACCOUNTANT}</SelectItem>
                          {chartOfAccounts.map(acc => (
                            <SelectItem key={acc.id} value={acc.glAccount}>
                              {acc.glAccount}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs">
                      {tx.confidenceScore !== undefined ? `${(tx.confidenceScore * 100).toFixed(0)}%` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAiConfirmDialogOpen(false); setTransactionsForAiConfirmation([]); }} disabled={isLoading}>Cancel</Button>
            <Button onClick={handleProcessAiConfirmedCategorizations} disabled={isLoading}>
              {isLoading ? <LoadingSpinner className="mr-2" /> : "Confirm & Save Approved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Dialog */}
      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Edit Transactions</DialogTitle>
            <DialogDescription>
              Update vendor and/or GL account for {selectedTransactionIds.length} selected transaction(s).
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
                  <SelectItem value={ASK_MY_ACCOUNTANT}>{ASK_MY_ACCOUNTANT}</SelectItem>
                  {chartOfAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.glAccount}>
                      {acc.glAccount}
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

      {/* Bulk Delete Dialog */}
      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <AlertTriangle className="mr-2 h-6 w-6 text-destructive" /> Confirm Bulk Delete
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete {selectedTransactionIds.length} selected transaction(s)? This action cannot be undone.
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

      {/* Missing CoA Resolution Dialog */}
      <Dialog open={isResolveMissingCoaDialogOpen} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setMissingCoaSuggestionsForDialog([]);
          setPendingCategorizationsAfterCoaResolution([]);
        }
        setIsResolveMissingCoaDialogOpen(isOpen);
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resolve Missing GL Accounts</DialogTitle>
            <DialogDescription>
              The AI suggested some GL accounts that are not in your Chart of Accounts.
              For each, choose to create a new account, map to an existing one, or use a placeholder.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <div className="space-y-4">
              {missingCoaSuggestionsForDialog.map((item, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle>AI Suggestion: <span className="text-primary">{item.aiSuggestedGl}</span></CardTitle>
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
                          <Label>Sub Type *</Label>
                          <Input
                            value={item.newAccountSubType}
                            onChange={(e) => handleMissingCoaItemChange(index, 'newAccountSubType', e.target.value)}
                            placeholder="E.g., Software Subscription"
                          />
                        </div>
                        <div>
                          <Label>Type *</Label>
                          <Input
                            value={item.newAccountType}
                            onChange={(e) => handleMissingCoaItemChange(index, 'newAccountType', e.target.value)}
                            placeholder="E.g., Expense"
                          />
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
                              <SelectItem key={coa.id} value={coa.glAccount}>{coa.glAccount}</SelectItem>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsResolveMissingCoaDialogOpen(false); setMissingCoaSuggestionsForDialog([]); setPendingCategorizationsAfterCoaResolution([]); }} disabled={isLoading}>Cancel</Button>
            <Button onClick={handleApplyCoaResolutions} disabled={isLoading || missingCoaSuggestionsForDialog.some(item => !item.chosenAction)}>
              {isLoading ? <LoadingSpinner className="mr-2" /> : <PlusCircle className="mr-2 h-4 w-4" />}
              Apply Resolutions & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}