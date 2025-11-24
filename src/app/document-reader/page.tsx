

"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileScan, ArrowLeft, UploadCloud, FileDown, AlertTriangle, Send, Download, DollarSign, PlusCircle, Trash2, Repeat, CalendarDays, ChevronsUpDown, Info, Sparkles, ScanText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useCallback, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ExtractTabularDataInput, ExtractTabularDataOutput } from "@/ai/flows/extract-tabular-data-flow";
import { extractDataFromDocument } from "@/ai/flows/extract-tabular-data-flow";
import type { ReconcileStatementInput } from "@/ai/flows/reconcile-bank-statement-flow";
import { reconcileBankStatement } from "@/ai/flows/reconcile-bank-statement-flow";
import * as XLSX from 'xlsx';
import { useAuth } from "@/context/AuthContext";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, doc, writeBatch, query, where, getDocs, Timestamp } from "firebase/firestore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parse as dateFnsParse, isValid as isDateValid, setYear } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Progress } from "@/components/ui/progress";
import * as pdfjs from 'pdfjs-dist';
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import Tesseract from 'tesseract.js';
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;


const DOCUMENT_COLUMNS_DEFINITION = {
  bankStatement: ["Date", "Description", "Amount Paid", "Amount Received", "Balance", "Calculated Balance"],
  vendorBill: ["Date", "Vendor Name", "Customer Name", "Bill Number", "Description", "Unit Price", "Quantity", "Amount", "Total GST", "Total Amount"],
  check: ["Date", "Check Number", "Payee", "Payer", "Amount", "Memo/Narration"],
  creditCard: ["Transaction Date", "Description", "Amount"],
};


type DocumentType = "bankStatement" | "vendorBill" | "check" | "creditCard";

interface TransactionData {
  companyId: string;
  createdBy: string;
  updatedBy: string;
  date: string;
  description: string;
  bankName: string;
  vendor: string;
  glAccount: string;
  amountPaid: number | null;
  amountReceived: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isLedgerApproved: boolean;
}

interface SkippedRowData {
  originalRow: string[];
  reason: string;
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

interface ChartOfAccountItem {
  id: string;
  userId?: string;
  glAccount: string;
  subType: string;
  type: TypeOption;
  fs?: FSOption;
  accountNumber?: string;
  createdAt?: Timestamp;
}

interface FinancialSummary {
  openingBalance: number;
  statementClosingBalance: number;
  totalPaid: number;
  totalReceived: number;
  calculatedClosingBalance: number;
  difference: number;
}

const DATE_FORMAT_OPTIONS = [
  { value: "MM/dd/yyyy", label: "MM/DD/YYYY" },
  { value: "dd/MM/yyyy", label: "DD/MM/YYYY" },
  { value: "yyyy-MM-dd", label: "YYYY-MM-DD" },
  { value: "MM-dd-yyyy", label: "MM-DD-YYYY" },
  { value: "M/d/yy", label: "M/D/YY" },
  { value: "dd-MMM-yy", label: "DD-MMM-YY (e.g., 25-Jul-23)" },
];


const cleanAmountString = (s: string | number): string => {
  if (typeof s !== 'string') s = String(s ?? '');
  const cleaned = s.replace(/[^0-9.-]+/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? "0.00" : num.toFixed(2);
};

const parseAndFormatDateToYYYYMMDD = (dateStr: string, userFormat?: string, statementYear?: number): string => {
  if (!dateStr || String(dateStr).trim() === "") return "";
  const trimmedDateStr = String(dateStr).trim();

  // If a year is provided, use it for parsing dates that might not have a year
  const referenceDate = statementYear ? new Date(statementYear, 0, 1) : new Date();

  // Try parsing with user-provided format first
  if (userFormat) {
    try {
      let parsed = dateFnsParse(trimmedDateStr, userFormat, referenceDate);
      if (isDateValid(parsed)) {
        if (!/y/i.test(userFormat)) { // If user format doesn't contain a year
          parsed = setYear(parsed, referenceDate.getFullYear());
        }
        return format(parsed, "yyyy-MM-dd");
      }
    } catch (e) { /* ignore */ }
  }

  // Common formats, prioritized by likelihood
  const commonFormats = [
    "MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "MM-dd-yyyy", 
    "M/d/yy", "MM/dd/yy", "dd/MM/yy", "yy/MM/dd",
    "M/d/yyyy", "d/M/yyyy", "yyyy/MM/dd", "yyyy.MM.dd",
    "dd-MMM-yy", "dd-MMM-yyyy", "MMM d, yyyy", "d MMM yyyy",
    "MM/dd", "M/d", "MMM-dd", "dd-MMM" // Year-less formats
  ];

  for (const fmt of commonFormats) {
    try {
      let parsed = dateFnsParse(trimmedDateStr, fmt, referenceDate);
      if (isDateValid(parsed)) {
        // If the format doesn't include a year, explicitly set it
        if (!/y/i.test(fmt)) {
          parsed = setYear(parsed, referenceDate.getFullYear());
        }
        return format(parsed, "yyyy-MM-dd");
      }
    } catch (e) { /* ignore */ }
  }

  // Final fallback using native Date parser
  try {
    const genericParsed = new Date(trimmedDateStr);
    if (isDateValid(genericParsed)) {
      if (String(dateStr).match(/\d{4}/)) { // Contains a 4-digit year
        return format(genericParsed, "yyyy-MM-dd");
      }
      // If no year, set it
      return format(setYear(genericParsed, referenceDate.getFullYear()), "yyyy-MM-dd");
    }
  } catch(e) { /* ignore */ }

  console.warn(`Could not parse date string: "${trimmedDateStr}" into YYYY-MM-DD. Returning original.`);
  return trimmedDateStr;
};


export default function DocumentReaderPage() {
  const { user } = useAuth();
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<DocumentType | null>(null);
  const [selectedDateFormat, setSelectedDateFormat] = useState<string | undefined>(undefined);
  const [statementYear, setStatementYear] = useState<string>("");
  const [editableTableData, setEditableTableData] = useState<string[][] | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [isSendingToBank, setIsSendingToBank] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [conversionMessage, setConversionMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const [bankGlAccountToApply, setBankGlAccountToApply] = useState<string>("");
  const [isBankGlAccountDialogOpen, setIsBankGlAccountDialogOpen] = useState<boolean>(false);

  const [isSendSummaryDialogOpen, setIsSendSummaryDialogOpen] = useState<boolean>(false);
  const [sendSummaryData, setSendSummaryData] = useState<{ sentCount: number; skippedCount: number } | null>(null);
  const [skippedRowsForDownload, setSkippedRowsForDownload] = useState<SkippedRowData[]>([]);
  
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true);

  const [openingBalanceInput, setOpeningBalanceInput] = useState<string>("");
  const [closingBalanceInput, setClosingBalanceInput] = useState<string>("");
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);

  const [isYearUpdateDialogOpen, setIsYearUpdateDialogOpen] = useState(false);
  const [yearToUpdate, setYearToUpdate] = useState<string>("");
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [lastSelectedRowIndex, setLastSelectedRowIndex] = useState<number | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);


  const { selectedCompanyId } = useCompany();
  const { logAction } = useAuditLog();

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetchingChartOfAccounts(false);
      return;
    }
    setIsFetchingChartOfAccounts(true);
    try {
      const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const fetchedItems: ChartOfAccountItem[] = [];
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, 'id'>) });
      });
      fetchedItems.sort((a, b) => a.glAccount.localeCompare(b.glAccount));
      setChartOfAccounts(fetchedItems);
    } catch (error) {
      console.error("Error fetching chart of accounts:", error);
      toast({ title: "Error", description: "Could not fetch chart of accounts.", variant: "destructive" });
    } finally {
      setIsFetchingChartOfAccounts(false);
    }
  }, [user, selectedCompanyId, toast]);

  useEffect(() => {
    if (user) {
      fetchChartOfAccounts();
    }
  }, [user, fetchChartOfAccounts]);
  
  const displayHeaders = useMemo(() => {
    if (!selectedFileType) return [];
    return DOCUMENT_COLUMNS_DEFINITION[selectedFileType];
  }, [selectedFileType]);

  const dataRowsForRendering = useMemo(() => {
    if (!editableTableData || editableTableData.length === 0) return [];
    
    const firstRow = editableTableData[0];
    const headersToUse = displayHeaders;

    // A more robust check to see if the first row is likely a header
    const firstRowIsHeader = headersToUse.some((header, index) => 
        String(firstRow[index] || '').trim().toLowerCase().includes(header.toLowerCase())
    );

    if (firstRowIsHeader) {
        return editableTableData.slice(1);
    }
    
    return editableTableData;
  }, [editableTableData, displayHeaders]);


  useEffect(() => {
    if ((selectedFileType === "bankStatement" || selectedFileType === "creditCard") && editableTableData && editableTableData.length >= 0) {
      const openingBal = parseFloat(openingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
      const closingBal = parseFloat(closingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
      let totalPaid = 0;
      let totalReceived = 0;
      let totalPurchases = 0;
      let totalPayments = 0;
  
      if (selectedFileType === "bankStatement") {
        const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid");
        const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received");
  
        dataRowsForRendering.forEach(row => { 
          const paidVal = parseFloat(String(row[paidColIndex] || "0").replace(/[^0-9.-]/g, ""));
          const receivedVal = parseFloat(String(row[receivedColIndex] || "0").replace(/[^0-9.-]/g, ""));
          if (!isNaN(paidVal)) totalPaid += paidVal;
          if (!isNaN(receivedVal)) totalReceived += receivedVal;
        });
        const calculatedClosing = openingBal + totalReceived - totalPaid;
        
        setFinancialSummary({
          openingBalance: openingBal,
          statementClosingBalance: closingBal,
          totalPaid: totalPaid,
          totalReceived: totalReceived,
          calculatedClosingBalance: calculatedClosing,
          difference: calculatedClosing - closingBal,
        });
      } else if (selectedFileType === "creditCard") {
          const amountColIndex = DOCUMENT_COLUMNS_DEFINITION.creditCard.indexOf("Amount");
          dataRowsForRendering.forEach(row => {
            const amountVal = parseFloat(String(row[amountColIndex] || "0").replace(/[^0-9.-]/g, ""));
            if (!isNaN(amountVal)) {
              if (amountVal > 0) totalPurchases += amountVal;
              else totalPayments += -amountVal; // Payments are negative
            }
          });
          const calculatedClosing = openingBal + totalPurchases - totalPayments;
          setFinancialSummary({
            openingBalance: openingBal, // 'openingBalanceInput' now serves as 'Previous Balance'
            statementClosingBalance: closingBal, // 'closingBalanceInput' now serves as 'New Balance'
            totalPaid: totalPurchases,
            totalReceived: totalPayments,
            calculatedClosingBalance: calculatedClosing,
            difference: calculatedClosing - closingBal,
          });
      }
    } else if (selectedFileType === "bankStatement" || selectedFileType === "creditCard") {
        const openingBal = parseFloat(openingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
        const closingBal = parseFloat(closingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
        setFinancialSummary({
            openingBalance: openingBal,
            statementClosingBalance: closingBal,
            totalPaid: 0,
            totalReceived: 0,
            calculatedClosingBalance: openingBal,
            difference: openingBal - closingBal,
        });
    } else {
      setFinancialSummary(null); 
    }
  }, [editableTableData, dataRowsForRendering, openingBalanceInput, closingBalanceInput, selectedFileType]);

  const correctBankStatementColumns = (aiExtractedTable: string[][], userDateFormat?: string): string[][] => {
    if (!aiExtractedTable || aiExtractedTable.length === 0) return [];

    const firstRowIsHeader = aiExtractedTable[0].some(cell => {
      if (typeof cell !== 'string') return false;
      const cellTrimmed = cell.trim();
      return isNaN(parseFloat(cellTrimmed.replace(/[^0-9.-]/g, ""))) && !/^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(cellTrimmed) && !/^\d{1,2}$/.test(cellTrimmed);
    });

    const dataRowsOnly = firstRowIsHeader ? aiExtractedTable.slice(1) : aiExtractedTable;
    const processedRows: string[][] = [];

    const parsedStatementYear = statementYear ? parseInt(statementYear, 10) : undefined;

    for (const row of dataRowsOnly) {
      if (row.length < 2) { continue; } 

      const originalAiDate = String(row[0] || "").trim();
      const formattedDate = parseAndFormatDateToYYYYMMDD(originalAiDate, userDateFormat, parsedStatementYear);
      const aiDescription = String(row[1] || "").trim();
      let aiPaidStr = String(row[2] || "0").trim();
      let aiReceivedStr = String(row[3] || "0").trim();
      const aiBalanceStr = String(row[4] || "0").trim();
      let finalPaid = "0.00";
      let finalReceived = "0.00";
      const paidNumeric = parseFloat(aiPaidStr.replace(/[^0-9.-]/g, ""));
      const receivedNumeric = parseFloat(aiReceivedStr.replace(/[^0-9.-]/g, ""));
      const paidHasDr = aiPaidStr.toUpperCase().includes("DR");
      const paidHasCr = aiPaidStr.toUpperCase().includes("CR");
      const receivedHasDr = aiReceivedStr.toUpperCase().includes("DR");
      const receivedHasCr = aiReceivedStr.toUpperCase().includes("CR");

      if (paidHasDr) {
          finalPaid = cleanAmountString(aiPaidStr);
          finalReceived = "0.00";
      } else if (paidHasCr) {
          finalReceived = cleanAmountString(aiPaidStr);
          finalPaid = "0.00";
      } else if (receivedHasDr) {
          finalPaid = cleanAmountString(aiReceivedStr);
          finalReceived = "0.00";
      } else if (receivedHasCr) {
          finalReceived = cleanAmountString(aiReceivedStr);
          finalPaid = "0.00";
      } else { 
          if (!isNaN(paidNumeric) && paidNumeric !== 0) {
              finalPaid = cleanAmountString(aiPaidStr);
              if (!isNaN(receivedNumeric) && receivedNumeric !== 0) {
                   if (paidNumeric < 0) {
                      finalReceived = cleanAmountString(String(-paidNumeric));
                      finalPaid = "0.00";
                   } else if (receivedNumeric < 0){
                      finalPaid = cleanAmountString(String(-receivedNumeric));
                      finalReceived = "0.00";
                   } else {
                      finalReceived = "0.00"; 
                   }
              } else {
                finalReceived = "0.00";
              }
          } else if (!isNaN(receivedNumeric) && receivedNumeric !== 0) {
              finalReceived = cleanAmountString(aiReceivedStr);
              finalPaid = "0.00";
          }
      }
      if (parseFloat(finalPaid) > 0 && parseFloat(finalReceived) > 0) {
          if (aiPaidStr && aiPaidStr !== "0" && aiPaidStr !== "0.00") {
              finalReceived = "0.00";
          } else {
              finalPaid = "0.00";
          }
      }
      processedRows.push([ formattedDate, aiDescription, finalPaid, finalReceived, cleanAmountString(aiBalanceStr) ]);
    }
    return firstRowIsHeader && aiExtractedTable[0] ? [aiExtractedTable[0], ...processedRows] : processedRows;
  };


  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: `Please select a PDF, JPEG, or PNG file.`,
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
      setDocumentText(null); 
      setEditableTableData(null); 
      setConversionMessage(null);
      setSkippedRowsForDownload([]); 
      setFinancialSummary(null);
      setConversionProgress(0);
      setSelectedRows([]);
    } else {
      setSelectedFile(null);
    }
  };

  const handleFileTypeChange = (value: DocumentType) => {
    setSelectedFileType(value);
    setEditableTableData(null); 
    setConversionMessage(null);
    setSkippedRowsForDownload([]);
    setFinancialSummary(null);
    setSelectedDateFormat(undefined);
    setSelectedRows([]);
    if (value !== "bankStatement" && value !== "creditCard") {
        setOpeningBalanceInput(""); 
        setClosingBalanceInput("");
    }
  };

  const processFile = useCallback(async () => {
    if (!selectedFile || !selectedFileType) {
        toast({ title: "Missing Inputs", description: "Please select a file and document type.", variant: "destructive" });
        return;
    }
    if ((selectedFileType === "bankStatement" || selectedFileType === "creditCard") && (openingBalanceInput.trim() === "" || closingBalanceInput.trim() === "")) {
        toast({ title: "Balance Required", description: "Please enter opening/previous and closing/new balances.", variant: "destructive" });
        return;
    }

    setIsConverting(true);
    setEditableTableData(null);
    setConversionMessage(`Preparing ${selectedFile.name}...`);
    setConversionProgress(0);

    const fileAsDataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(selectedFile);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });

    try {
        let allExtractedRows: string[][] = [];

        if (selectedFileType === "vendorBill" || selectedFileType === "check") {
            setConversionMessage("Sending document to AI for processing...");
            setConversionProgress(50);
            const input: ExtractTabularDataInput = {
                documentDataUri: fileAsDataUri,
                rawText: null,
                mimeType: selectedFile.type,
                documentType: selectedFileType,
                statementYear: statementYear,
            };
            const result: ExtractTabularDataOutput = await extractDataFromDocument(input);
            if (result.extractedTable && result.extractedTable.length > 0) {
                allExtractedRows.push(...result.extractedTable);
            }
            setConversionProgress(100);
        } else if (selectedFile.type === 'application/pdf') {
            const pdf = await pdfjs.getDocument(fileAsDataUri).promise;
            const numPages = pdf.numPages;

            for (let i = 1; i <= numPages; i++) {
                setConversionMessage(`AI is processing page ${i} of ${numPages}...`);
                const page = await pdf.getPage(i);

                const canvas = document.createElement("canvas");
                const viewport = page.getViewport({ scale: 2 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                const canvasContext = canvas.getContext("2d");

                if (canvasContext) {
                    await page.render({ canvasContext, viewport }).promise;
                    const pageDataUri = canvas.toDataURL('image/jpeg');

                    const input: ExtractTabularDataInput = {
                        documentDataUri: pageDataUri,
                        rawText: null, // We are not using OCR text first for PDFs
                        mimeType: 'image/jpeg',
                        documentType: selectedFileType,
                        statementYear: statementYear,
                    };
                    const result: ExtractTabularDataOutput = await extractDataFromDocument(input);
                    if (result.extractedTable && result.extractedTable.length > 0) {
                        const dataToAdd = allExtractedRows.length === 0 ? result.extractedTable : result.extractedTable.slice(1);
                        allExtractedRows.push(...dataToAdd);
                    }
                }
                setConversionProgress((i / numPages) * 100);
            }
        } else { // Single Image File for Bank Statement / Credit Card
            setConversionMessage("Sending document to AI for processing...");
            setConversionProgress(50);
            const input: ExtractTabularDataInput = {
                documentDataUri: fileAsDataUri,
                rawText: null,
                mimeType: selectedFile.type,
                documentType: selectedFileType,
                statementYear: statementYear,
            };
            const result: ExtractTabularDataOutput = await extractDataFromDocument(input);
            if (result.extractedTable && result.extractedTable.length > 0) {
                allExtractedRows.push(...result.extractedTable);
            }
            setConversionProgress(100);
        }

        if (allExtractedRows.length > 0) {
            let processedData = allExtractedRows;
            if (selectedFileType === "bankStatement") {
                processedData = correctBankStatementColumns(processedData, selectedDateFormat);
            }
            setEditableTableData(processedData);
            setConversionMessage(`Successfully processed ${selectedFile.name}.`);
        } else {
            setEditableTableData([]);
            setConversionMessage(`No table found in ${selectedFile.name}.`);
        }
    } catch (error) {
        console.error(`Error processing ${selectedFile.name}:`, error);
        setConversionMessage(`Error processing ${selectedFile.name}. ${error instanceof Error ? error.message : "An unexpected error."}`);
        setEditableTableData(null);
        setFinancialSummary(null);
        toast({ title: "Processing Error", description: `Could not process the document. Please try again.`, variant: "destructive" });
    } finally {
        setIsConverting(false);
    }
  }, [selectedFile, selectedFileType, openingBalanceInput, closingBalanceInput, selectedDateFormat, statementYear, toast]);

  const handleAiReconcile = async () => {
    if (!selectedFile || !editableTableData || !financialSummary) {
      toast({ title: "Missing Data", description: "Cannot reconcile without the original document and extracted data.", variant: "destructive" });
      return;
    }
    
    setIsReconciling(true);
    toast({ title: "AI Reconciliation Started", description: "The AI is analyzing the statement to find discrepancies. This may take a moment." });

    try {
      const fileAsDataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(selectedFile);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (error) => reject(error);
      });

      const input: ReconcileStatementInput = {
        documentDataUri: fileAsDataUri,
        rawText: documentText,
        currentTransactions: editableTableData,
        openingBalance: financialSummary.openingBalance,
        closingBalance: financialSummary.statementClosingBalance,
        discrepancyAmount: financialSummary.difference,
      };

      const result = await reconcileBankStatement(input);

      if (result.correctedTransactions && result.correctedTransactions.length > 0) {
        // The AI now returns only the core transaction columns. We need to merge this with the original balance data.
        const originalBalanceData = dataRowsForRendering.map(row => row[DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Balance")]);

        const mergedTable = result.correctedTransactions.map((newRow, index) => {
            const originalBalance = originalBalanceData[index] || '';
            // New row structure from AI is: [Date, Description, Paid, Received]
            // We insert the original balance back into its correct position
            return [newRow[0], newRow[1], newRow[2], newRow[3], originalBalance];
        });

        const headerRow = editableTableData.length > 0 ? editableTableData[0] : DOCUMENT_COLUMNS_DEFINITION.bankStatement.slice(0, -1);
        setEditableTableData([headerRow, ...mergedTable]);
        toast({ title: "AI Reconciliation Complete", description: result.explanation || "The transaction table has been updated with AI corrections." });
      } else {
        toast({ title: "AI Reconciliation", description: "The AI could not find any corrections or failed to process the request.", variant: "destructive" });
      }
    } catch (error) {
      console.error("AI Reconciliation Error:", error);
      toast({ title: "AI Error", description: "An error occurred during AI reconciliation.", variant: "destructive" });
    } finally {
      setIsReconciling(false);
    }
  };


  const handleCellChange = (rowIndex: number, cellIndex: number, value: string) => {
    setEditableTableData(prevData => {
        if (!prevData) return null;
        const newData = prevData.map(row => [...row]); 

        const firstRow = newData[0];
        const headersToUse = displayHeaders;
        const firstRowIsHeader = headersToUse.some((header, index) => 
            String(firstRow[index] || '').trim().toLowerCase().includes(header.toLowerCase())
        );
        
        const targetRowIndexInEditableTable = firstRowIsHeader ? rowIndex + 1 : rowIndex;

        if (newData[targetRowIndexInEditableTable]) {
            newData[targetRowIndexInEditableTable][cellIndex] = value;
        }
        return newData;
    });
  };

  const handleAddRow = () => {
    setEditableTableData(prevData => {
        if (!selectedFileType) return prevData;
        const headers = displayHeaders;
        const numCols = headers.length - (selectedFileType === "bankStatement" ? 1 : 0);
        const newRow = Array(numCols).fill("");
        
        if (!prevData || prevData.length === 0) {
             return [headers.slice(0, numCols), newRow]; 
        }

        return [...prevData, newRow];
    });
  };


  const handleDeleteSelectedRows = () => {
    if (selectedRows.length === 0) {
      toast({ title: "No Rows Selected", description: "Please select rows to delete.", variant: "destructive" });
      return;
    }
  
    setEditableTableData(prevData => {
      if (!prevData) return null;
      
      const firstRowIsHeader = prevData.length > 0 && displayHeaders.some((header, index) =>
        String(prevData[0][index] || '').trim().toLowerCase().includes(header.toLowerCase())
      );
  
      const newData = prevData.filter((_, index) => {
        const dataRowIndex = firstRowIsHeader ? index - 1 : index;
        if (index === 0 && firstRowIsHeader) return true; // always keep header
        return !selectedRows.includes(dataRowIndex);
      });
      
      return newData;
    });
  
    toast({ title: "Rows Deleted", description: `${selectedRows.length} row(s) have been deleted.` });
    setSelectedRows([]); // Clear selection after deleting
  };

  const handleDeleteRow = (rowIndexToDelete: number) => {
    setEditableTableData(prevData => {
        if (!prevData) return null;

        const firstRow = prevData[0];
        const headersToUse = displayHeaders;
        const firstRowIsHeader = headersToUse.some((header, index) => 
            String(firstRow[index] || '').trim().toLowerCase().includes(header.toLowerCase())
        );

        const actualRowIndexToDeleteInPrevData = firstRowIsHeader ? rowIndexToDelete + 1 : rowIndexToDelete;
        
        return prevData.filter((_, index) => index !== actualRowIndexToDeleteInPrevData);
    });
  };

  const handleExportToExcel = () => {
    if (!editableTableData || !selectedFileType) {
      toast({ title: "No Data to Export", description: "No table data available or document type not set.", variant: "default" });
      return;
    }
    
    let headersToUse = displayHeaders; 
    const dataRowsToExport = [...dataRowsForRendering]; 

    if (dataRowsToExport.length === 0 && headersToUse.length === 0) {
        toast({ title: "No Data Rows", description: "The table has no data rows to export.", variant: "default" });
        return;
    }
    
    const sheetData = [];
    let runningBalanceForExport = financialSummary?.openingBalance || 0; 
    const parsedStatementYear = statementYear ? parseInt(statementYear, 10) : undefined;

    if (selectedFileType === "bankStatement") {
      const paidColIdx = headersToUse.indexOf("Amount Paid");
      const receivedColIdx = headersToUse.indexOf("Amount Received");
      const dateColIdx = headersToUse.indexOf("Date");

      for (const row of dataRowsToExport) {
          const rowObject: { [key: string]: string } = {};
          headersToUse.forEach((header, index) => {
              let cellValue = String(row[index] || "");
              if (index === dateColIdx && cellValue) { // Assuming date is in YYYY-MM-DD
                  try {
                    const dateObj = dateFnsParse(cellValue, "yyyy-MM-dd", new Date());
                    if (isDateValid(dateObj)) {
                        cellValue = format(dateObj, "MM/dd/yyyy"); 
                    }
                  } catch (e) { /* ignore error, use original value */ }
              }
              if (header !== "Calculated Balance") { 
                rowObject[header] = cellValue;
              }
          });

          const paid = parseFloat(String(row[paidColIdx] || "0").replace(/[^0-9.-]/g, ""));
          const received = parseFloat(String(row[receivedColIdx] || "0").replace(/[^0-9.-]/g, ""));
          runningBalanceForExport = runningBalanceForExport - paid + received;
          rowObject["Calculated Balance"] = runningBalanceForExport.toFixed(2); 
          sheetData.push(rowObject);
      }
    } else { 
      const dateColIdx = headersToUse.indexOf("Date");
      for (const row of dataRowsToExport) {
        const rowObject: { [key: string]: string } = {};
        headersToUse.forEach((header, index) => {
          let cellValue = String(row[index] || "");
          if (index === dateColIdx && cellValue) { 
              try {
                const dateObj = dateFnsParse(cellValue, 'yyyy-MM-dd', new Date()); 
                if (isDateValid(dateObj)) {
                    cellValue = format(dateObj, "MM/dd/yyyy"); 
                }
              } catch(e) { /* ignore */ }
          }
          rowObject[header] = cellValue;
        });
        sheetData.push(rowObject);
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(sheetData, {header: headersToUse});
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, selectedFileType.charAt(0).toUpperCase() + selectedFileType.slice(1) + "Data");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `${selectedFileType}_data_${today}.xlsx`);
    toast({ title: "Export Successful", description: `Data exported to ${selectedFileType}_data_${today}.xlsx` });
  };

  const handleOpenBankGlAccountDialog = () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    if (!dataRowsForRendering || dataRowsForRendering.length === 0 || !selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check" && selectedFileType !== "creditCard")) {
      toast({ title: "Invalid Action", description: "No data to send or incorrect document type.", variant: "destructive" });
      return;
    }
    setBankGlAccountToApply("");
    setIsBankGlAccountDialogOpen(true);
  };

  const handleConfirmSendWithBankGlAccount = async () => {
    if (!user || !selectedCompanyId) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    const dataToSend = dataRowsForRendering; 
    if (!dataToSend || dataToSend.length === 0 || !selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check" && selectedFileType !== "creditCard")) {
      toast({ title: "Invalid Action", description: "No data found or incorrect document type.", variant: "destructive" });
      return;
    }
    if (!bankGlAccountToApply.trim()) {
      toast({ title: "Bank GL Account Required", description: "Please select the Bank GL Account.", variant: "destructive" });
      return;
    }

    setIsSendingToBank(true);
    setIsBankGlAccountDialogOpen(false);
    let sentCount = 0;
    const localSkippedRows: SkippedRowData[] = [];
    const parsedStatementYear = statementYear ? parseInt(statementYear, 10) : undefined;

    try {
      const batch = writeBatch(db);

      if (selectedFileType === "bankStatement" || selectedFileType === "creditCard") {
        const dateColIndex = DOCUMENT_COLUMNS_DEFINITION[selectedFileType].indexOf("Date");
        const descColIndex = DOCUMENT_COLUMNS_DEFINITION[selectedFileType].indexOf("Description");
        const paidColIndex = DOCUMENT_COLUMNS_DEFINITION[selectedFileType].indexOf("Amount Paid");
        const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION[selectedFileType].indexOf("Amount Received");
        const amountColIndex = DOCUMENT_COLUMNS_DEFINITION[selectedFileType].indexOf("Amount");


        dataToSend.forEach(row => {
          const dateStrRaw = String(row[dateColIndex] || "").trim(); 
          const dateStr = parseAndFormatDateToYYYYMMDD(dateStrRaw, selectedDateFormat, parsedStatementYear);
          const description = String(row[descColIndex] || "").trim();
          let skipReason = "";

          if (!dateStr || !isDateValid(dateFnsParse(dateStr, "yyyy-MM-dd", new Date()))) {
              skipReason = `Invalid or missing date: "${dateStrRaw}". Parsed as: "${dateStr}". Expected YYYY-MM-DD.`;
          }
          if (!description && !skipReason) {
              skipReason = "Missing transaction description.";
          }

          let amountPaidNum = 0;
          let amountReceivedNum = 0;

          if (selectedFileType === "bankStatement") {
            const amountPaidStr = String(row[paidColIndex] || "0");
            const amountReceivedStr = String(row[receivedColIndex] || "0");
            amountPaidNum = parseFloat(cleanAmountString(amountPaidStr)); 
            amountReceivedNum = parseFloat(cleanAmountString(amountReceivedStr));
          } else { // creditCard
            const amountStr = String(row[amountColIndex] || "0");
            const amount = parseFloat(cleanAmountString(amountStr));
            if (amount > 0) amountPaidNum = amount;
            else amountReceivedNum = -amount;
          }

          if ( (isNaN(amountPaidNum) || amountPaidNum === 0) && (isNaN(amountReceivedNum) || amountReceivedNum === 0) && !skipReason) {
              skipReason = "Both Amount Paid and Amount Received are zero or invalid.";
          }
          
          if (skipReason) {
              localSkippedRows.push({ originalRow: row, reason: skipReason });
              return;
          }

          const newTx: Omit<TransactionData, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> = {
            companyId: selectedCompanyId,
            createdBy: user.uid,
            date: dateStr, 
            description: description,
            bankName: bankGlAccountToApply.trim(),
            vendor: "-", 
            glAccount: "-", 
            amountPaid: amountPaidNum > 0 ? amountPaidNum : null,
            amountReceived: amountReceivedNum > 0 ? amountReceivedNum : null,
            isLedgerApproved: false,
          };
          if (newTx.amountPaid && newTx.amountPaid > 0 && newTx.amountReceived && newTx.amountReceived > 0) {
              newTx.amountReceived = null; 
          }
          const newTransactionDocRef = doc(collection(db, "transactions"));
          batch.set(newTransactionDocRef, {...newTx, createdAt: serverTimestamp()});
          sentCount++;
        });
        await logAction(
          "export_transactions", 
          "document_reader",
          ["documentType"],
        );
      } else if (selectedFileType === "check") {
        const headers = displayHeaders;
        const dateColIndex = headers.indexOf("Date");
        const checkNumColIndex = headers.indexOf("Check Number");
        const vendorColIndex = headers.indexOf("Payee");
        const amountColIndex = headers.indexOf("Amount");
        const memoColIndex = headers.indexOf("Memo/Narration");

        dataToSend.forEach(row => {
            const dateStrRaw = String(row[dateColIndex] || "").trim();
            const dateStr = parseAndFormatDateToYYYYMMDD(dateStrRaw, selectedDateFormat, parsedStatementYear);
            const checkNum = String(row[checkNumColIndex] || "").trim();
            const vendor = String(row[vendorColIndex] || "").trim();
            const amountStr = String(row[amountColIndex] || "0");
            const memo = String(row[memoColIndex] || "").trim();
            let skipReason = "";

            if (!dateStr || !isDateValid(dateFnsParse(dateStr, "yyyy-MM-dd", new Date()))) {
                skipReason = `Invalid or missing date: "${dateStrRaw}". Parsed as: "${dateStr}". Ensure YYYY-MM-DD.`;
            }
            const amountNum = parseFloat(cleanAmountString(amountStr));
            if (isNaN(amountNum) || amountNum <= 0) {
                if (!skipReason) skipReason = `Invalid or zero amount: "${amountStr}".`;
            }
            if (!vendor && !skipReason) {
                if (!skipReason) skipReason = "Missing Vendor/Payee for the check.";
            }

            if (skipReason) {
                localSkippedRows.push({ originalRow: row, reason: skipReason });
                return;
            }

            let txDescription = "";
            if (checkNum && memo) txDescription = `${checkNum} - ${memo}`;
            else if (checkNum) txDescription = checkNum;
            else if (memo) txDescription = memo;
            else txDescription = `Check to ${vendor || "Unknown Vendor"}`;


            const newTx: Omit<TransactionData, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> = {
                companyId: selectedCompanyId,
                createdBy: user.uid,
                date: dateStr,
                description: txDescription,
                bankName: bankGlAccountToApply.trim(),
                vendor: vendor,
                glAccount: "-", 
                amountPaid: amountNum,
                amountReceived: null,
                isLedgerApproved: false,
            };
            const newTransactionDocRef = doc(collection(db, "transactions"));
            batch.set(newTransactionDocRef, {...newTx, createdAt: serverTimestamp()});
            sentCount++;
        });
      }


       if (sentCount > 0) {
      await batch.commit();
      await logAction(
        "import_transactions", 
        "document_reader",
        ["bankName", "amountPaid", "amountReceived"],
      );
    }
      
      setSendSummaryData({ sentCount, skippedCount: localSkippedRows.length });
      setSkippedRowsForDownload(localSkippedRows);
      setIsSendSummaryDialogOpen(true);
      if (sentCount > 0 && localSkippedRows.length === 0) { 
        setEditableTableData(null); 
        if (selectedFileType === "bankStatement" || selectedFileType === "creditCard") {
            setOpeningBalanceInput("");
            setClosingBalanceInput("");
        }
        setSelectedFile(null);
        setDocumentText(null);
        setSelectedDateFormat(undefined);
        setStatementYear("");
        const fileInput = document.getElementById('document-file') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }

    } catch (error) {
      console.error("Error sending transactions:", error);
      toast({ title: "Send Error", description: "Could not send. " + (error instanceof Error ? error.message : ""), variant: "destructive" });
      setSendSummaryData({ sentCount: 0, skippedCount: dataToSend.length }); 
      setSkippedRowsForDownload(dataToSend.map(row => ({ originalRow: row, reason: "Error during Firestore commit." })));
      setIsSendSummaryDialogOpen(true);
    } finally {
      setIsSendingToBank(false);
      setBankGlAccountToApply("");
    }
  };

  const handleDownloadSkippedBankTransactions = () => {
    if (!skippedRowsForDownload || skippedRowsForDownload.length === 0 || !selectedFileType) {
      toast({ title: "No Skipped Data", description: "No skipped transactions to download.", variant: "default" });
      return;
    }
    let headersForExport = displayHeaders;
    if (!headersForExport || headersForExport.length === 0) {
        if(selectedFileType === 'vendorBill') {
            headersForExport = DOCUMENT_COLUMNS_DEFINITION.vendorBill;
        } else {
            headersForExport = DOCUMENT_COLUMNS_DEFINITION[selectedFileType];
        }
    }
    if(selectedFileType === "bankStatement") {
        headersForExport = headersForExport.filter(h => h !== "Calculated Balance");
    }

    const dataToExport = skippedRowsForDownload.map(skippedItem => {
        const rowDataWithReason = [...skippedItem.originalRow];
        while (rowDataWithReason.length < headersForExport.length) {
            rowDataWithReason.push(""); 
        }
        rowDataWithReason.length = headersForExport.length; 
        rowDataWithReason.push(skippedItem.reason);
        return rowDataWithReason;
    });

    const finalHeaders = [...headersForExport, "Reason for Skipping"];

    const worksheet = XLSX.utils.aoa_to_sheet([finalHeaders, ...dataToExport]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Skipped_${selectedFileType}`);
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `skipped_${selectedFileType}_${today}.xlsx`);
    toast({ title: "Download Successful", description: `Skipped ${selectedFileType} data exported.` });
  };

  const handleOpenYearUpdateDialog = () => {
    if (!selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check" && selectedFileType !== "creditCard") || selectedRows.length === 0) {
      toast({ title: "No Rows Selected", description: "Please select rows to update the year for.", variant: "destructive"});
      return;
    }
    setYearToUpdate(new Date().getFullYear().toString()); 
    setIsYearUpdateDialogOpen(true);
  };
  
  const handleToggleSelectRow = (rowIndex: number, checked: boolean) => {
    setSelectedRows(prevSelected => {
      const newSelectedRows = new Set(prevSelected);
      
      if (isShiftKeyPressed && lastSelectedRowIndex !== null) {
        const start = Math.min(lastSelectedRowIndex, rowIndex);
        const end = Math.max(lastSelectedRowIndex, rowIndex);
        for (let i = start; i <= end; i++) {
          if (checked) {
            newSelectedRows.add(i);
          } else {
            newSelectedRows.delete(i);
          }
        }
      } else {
        if (checked) {
          newSelectedRows.add(rowIndex);
        } else {
          newSelectedRows.delete(rowIndex);
        }
      }
      
      setLastSelectedRowIndex(rowIndex);
      return Array.from(newSelectedRows);
    });
  };

  const handleConfirmYearUpdate = () => {
    if (!editableTableData || !selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check" && selectedFileType !== "creditCard") || !yearToUpdate.trim()) {
      toast({ title: "Invalid Action", description: "No data to update or year not specified.", variant: "destructive"});
      return;
    }
    if (selectedRows.length === 0) {
      toast({ title: "No Rows Selected", description: "Please select one or more rows to update.", variant: "destructive" });
      return;
    }
    const newYear = parseInt(yearToUpdate, 10);
    if (isNaN(newYear) || yearToUpdate.trim().length !== 4) {
      toast({ title: "Invalid Year", description: "Please enter a valid 4-digit year.", variant: "destructive"});
      return;
    }

    const headers = displayHeaders;
    const dateColIndex = headers.indexOf("Date");
    if (dateColIndex === -1) {
        toast({ title: "Configuration Error", description: "Date column not found for this document type.", variant: "destructive"});
        return;
    }
    
    setEditableTableData(prevData => {
        if (!prevData) return null;
        const newData = prevData.map(row => [...row]); 
        
        const firstRowIsHeader = headers.some((h, i) => String(newData[0][i] || '').toLowerCase().includes(h.toLowerCase()));
        
        selectedRows.forEach(rowIndex => {
            const actualRowIndex = firstRowIsHeader ? rowIndex + 1 : rowIndex;
            if(newData[actualRowIndex]){
              const newRow = [...newData[actualRowIndex]];
              const currentDateStrRaw = newRow[dateColIndex];
              if (currentDateStrRaw) {
                  try {
                      const parsedDateInternal = parseAndFormatDateToYYYYMMDD(currentDateStrRaw, selectedDateFormat);
                      const dateObj = dateFnsParse(parsedDateInternal, "yyyy-MM-dd", new Date());

                      if (isDateValid(dateObj)) {
                          const updatedDate = setYear(dateObj, newYear);
                          newRow[dateColIndex] = format(updatedDate, "yyyy-MM-dd");
                      }
                  } catch (e) {
                      console.warn(`Could not parse date for year update: ${currentDateStrRaw}`, e);
                  }
              }
              newData[actualRowIndex] = newRow;
            }
        });
        return newData;
    });

    toast({ title: "Year Updated", description: `Year updated to ${newYear} for ${selectedRows.length} selected rows.`});
    setIsYearUpdateDialogOpen(false);
    setSelectedRows([]);
  };

  const handleSwapAmounts = () => {
    if (!editableTableData || selectedFileType !== "bankStatement") return;

    const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid");
    const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received");
    
    const updatedTableData = editableTableData.map((row, rIndex) => {
       const firstRowIsHeader = rIndex === 0 && row.some(cell => typeof cell === 'string' && isNaN(parseFloat(cell.replace(/[^0-9.-]/g, ""))) && !/^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(cell.trim()));
       if (firstRowIsHeader) return row;

      const newRow = [...row];
      const paidAmount = newRow[paidColIndex];
      const receivedAmount = newRow[receivedColIndex];
      newRow[paidColIndex] = receivedAmount;
      newRow[receivedColIndex] = paidAmount;
      return newRow;
    });

    setEditableTableData(updatedTableData);
    toast({ title: "Amounts Swapped", description: "'Amount Paid' and 'Amount Received' columns have been swapped." });
  };


  const commonButtonDisabled = isConverting || isSendingToBank || isBankGlAccountDialogOpen || isSendSummaryDialogOpen || isFetchingChartOfAccounts || isYearUpdateDialogOpen || isReconciling;
  const canSendToBank = (selectedFileType === "bankStatement" || selectedFileType === "check" || selectedFileType === "creditCard") && dataRowsForRendering && dataRowsForRendering.length > 0 && chartOfAccounts.length > 0 && (selectedFileType === "bankStatement" || selectedFileType === "creditCard" ? financialSummary !== null : true);
  const canBulkUpdateYear = (selectedFileType === "bankStatement" || selectedFileType === "check" || selectedFileType === "creditCard") && editableTableData && dataRowsForRendering.length > 0;

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <FileScan className="mr-3 h-10 w-10 text-primary" />
              Document Reader
            </h1>
            <p className="text-lg text-muted-foreground">
              Upload a PDF, JPEG, or PNG. Select type, convert, edit, and process. Dates display as MM/DD/YYYY.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </header>

        <Card className="shadow-lg mb-8">
          <CardHeader>
            <CardTitle>1. Upload Document & Specify Type/Format</CardTitle>
            <CardDescription>Select a single file, its document type, and optionally the date format and year.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div>
                    <Label htmlFor="document-file">Document File</Label>
                    <Input
                        id="document-file"
                        type="file"
                        accept=".pdf,.jpeg,.jpg,.png"
                        onChange={handleFileChange}
                        disabled={commonButtonDisabled}
                        className="mt-1"
                    />
                    {selectedFile && (
                        <p className="text-sm text-muted-foreground mt-1">
                        Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                        </p>
                    )}
                </div>
                <div>
                    <Label>Document Type</Label>
                    <RadioGroup
                        value={selectedFileType || ""}
                        onValueChange={(value) => handleFileTypeChange(value as DocumentType)}
                        disabled={commonButtonDisabled}
                        className="flex flex-wrap gap-x-4 gap-y-2 mt-1"
                    >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="bankStatement" id="type-bank" />
                          <Label htmlFor="type-bank">Bank Statement</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="creditCard" id="type-credit" />
                          <Label htmlFor="type-credit">Credit Card</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="vendorBill" id="type-vendor" />
                          <Label htmlFor="type-vendor">Vendor Bill</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="check" id="type-check" />
                          <Label htmlFor="type-check">Check</Label>
                        </div>
                    </RadioGroup>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                {(selectedFileType === "bankStatement" || selectedFileType === "creditCard") && (
                <>
                  <div>
                      <Label htmlFor="opening-balance">{selectedFileType === "creditCard" ? "Previous Balance *" : "Opening Balance *"}</Label>
                      <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                          id="opening-balance" type="number" step="0.01" value={openingBalanceInput}
                          onChange={(e) => setOpeningBalanceInput(e.target.value)}
                          placeholder="Statement opening balance" disabled={commonButtonDisabled} className="pl-10 mt-1"
                          />
                      </div>
                  </div>
                   <div>
                      <Label htmlFor="closing-balance">{selectedFileType === "creditCard" ? "New Balance *" : "Closing Balance *"}</Label>
                      <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                          id="closing-balance" type="number" step="0.01" value={closingBalanceInput}
                          onChange={(e) => setClosingBalanceInput(e.target.value)}
                          placeholder="Statement closing balance" disabled={commonButtonDisabled} className="pl-10 mt-1"
                          />
                      </div>
                  </div>
                </>
                )}
                <div className={(selectedFileType === "bankStatement" || selectedFileType === "creditCard") ? "lg:col-span-1" : "md:col-start-1 lg:col-span-1"}>
                    <Label htmlFor="statement-year">Statement Year (Optional)</Label>
                    <Input
                        id="statement-year"
                        type="number"
                        value={statementYear}
                        onChange={(e) => setStatementYear(e.target.value)}
                        placeholder="e.g., 2024"
                        className="mt-1"
                        disabled={commonButtonDisabled || !selectedFile || !selectedFileType}
                        maxLength={4}
                    />
                </div>
                <div className="lg:col-span-1">
                     <Label htmlFor="date-format-select">
                        Date Format in Document
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 p-0 align-middle">
                                        <Info className="h-3 w-3 text-muted-foreground"/>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">Select the primary date format if the AI struggles with parsing (e.g., MM/DD vs DD/MM).</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </Label>
                    <Select
                        value={selectedDateFormat}
                        onValueChange={setSelectedDateFormat}
                        disabled={commonButtonDisabled || !selectedFile || !selectedFileType}
                    >
                        <SelectTrigger id="date-format-select" className="mt-1">
                            <SelectValue placeholder="Auto-detect (or select format)" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={undefined}>Auto-detect / Best Guess</SelectItem>
                            {DATE_FORMAT_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
          </CardContent>
        </Card>

        <div className="mb-8 flex flex-wrap gap-2">
          <Button
            onClick={() => processFile()}
            disabled={!selectedFile || !selectedFileType || commonButtonDisabled || ((selectedFileType === "bankStatement" || selectedFileType === "creditCard") && (openingBalanceInput.trim() === "" || closingBalanceInput.trim() === ""))}
            className="w-full sm:w-auto"
          >
            {isConverting ? <LoadingSpinner className="mr-2" /> : <ScanText className="mr-2 h-5 w-5" />}
            {isConverting ? "Converting..." : "Convert"}
          </Button>
          {isConverting && <Progress value={conversionProgress} className="w-full h-2 mt-2" />}
        </div>
        
        {financialSummary && (selectedFileType === 'bankStatement' || selectedFileType === 'creditCard') && editableTableData && (
             <Card className="shadow-lg mb-8">
                <CardHeader>
                    <CardTitle>{selectedFileType === 'creditCard' ? 'Credit Card Summary' : 'Bank Statement Summary'}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm items-center">
                    <div>
                        <p className="text-muted-foreground">{selectedFileType === 'creditCard' ? 'Previous Balance' : 'Opening Balance'}</p>
                        <p className="font-semibold text-lg">{financialSummary.openingBalance.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">{selectedFileType === 'creditCard' ? 'Purchases' : 'Total Paid Out'}</p>
                        <p className="font-semibold text-lg text-red-600">{financialSummary.totalPaid.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                    </div>
                     <div>
                        <p className="text-muted-foreground">{selectedFileType === 'creditCard' ? 'Payments & Credits' : 'Total Received In'}</p>
                        <p className="font-semibold text-lg text-green-600">{financialSummary.totalReceived.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">{selectedFileType === 'creditCard' ? 'New Balance' : 'Statement Closing Balance'}</p>
                        <p className="font-semibold text-lg">{financialSummary.statementClosingBalance.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                    </div>
                    <div className={cn("p-3 rounded-md", financialSummary.difference === 0 ? "bg-green-100 dark:bg-green-900/50" : "bg-red-100 dark:bg-red-900/50")}>
                        <p className="text-muted-foreground">Difference</p>
                        <p className={cn("font-bold text-xl", financialSummary.difference === 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300")}>{financialSummary.difference.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                    </div>
                    
                </CardContent>
                {financialSummary.difference !== 0 && (
                    <CardFooter>
                        <Button
                            onClick={handleAiReconcile}
                            disabled={commonButtonDisabled}
                        >
                            {isReconciling ? <LoadingSpinner className="mr-2" /> : <Sparkles className="mr-2 h-4 w-4" />}
                            Find Discrepancy (AI)
                        </Button>
                    </CardFooter>
                )}
             </Card>
        )}

        {(isConverting || isReconciling) && (
          <Card className="mt-8 shadow-lg">
            <CardHeader> <CardTitle>{isReconciling ? "Reconciling with AI..." : "Processing Document"}</CardTitle> </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-muted-foreground">{isReconciling ? "AI is analyzing discrepancies..." : conversionMessage}</p>
            </CardContent>
          </Card>
        )}

        {!isConverting && !isReconciling && editableTableData && (
          <Card className="mt-8 shadow-lg">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <CardTitle>Extracted & Editable Table Data</CardTitle>
                    {conversionMessage && ( <CardDescription className="mt-1">{conversionMessage}</CardDescription> )}
                    {(!dataRowsForRendering || dataRowsForRendering.length === 0) && selectedFileType && editableTableData.length > 0 && !isConverting && (
                         <CardDescription className="text-orange-600 flex items-center mt-2">
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            AI extracted data, but it might not perfectly match expected format or be empty post-processing. Review carefully.
                        </CardDescription>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto flex-wrap justify-end">
                    <Button
                        onClick={() => processFile()}
                        disabled={commonButtonDisabled}
                        variant="outline"
                        className="w-full sm:w-auto"
                        title="Re-run extraction on the document"
                    >
                      <Repeat className="mr-2 h-4 w-4" /> Reprocess
                    </Button>
                    <Button
                        onClick={handleAddRow}
                        disabled={commonButtonDisabled || !selectedFileType}
                        variant="outline"
                        className="w-full sm:w-auto"
                    >
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Row
                    </Button>
                    {canBulkUpdateYear && (
                        <Button
                            onClick={handleOpenYearUpdateDialog}
                            disabled={!canBulkUpdateYear || commonButtonDisabled || selectedRows.length === 0}
                            variant="outline"
                            className="w-full sm:w-auto"
                        >
                            <CalendarDays className="mr-2 h-4 w-4" /> Update Year for Selected
                        </Button>
                    )}
                    {selectedRows.length > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleDeleteSelectedRows}
                          disabled={commonButtonDisabled}
                          className="w-full sm:w-auto"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Selected
                        </Button>
                    )}
                    {selectedFileType === "bankStatement" && (
                        <Button
                            onClick={handleSwapAmounts}
                            disabled={commonButtonDisabled || !editableTableData || dataRowsForRendering.length === 0}
                            variant="outline"
                            className="w-full sm:w-auto"
                        >
                            <ChevronsUpDown className="mr-2 h-4 w-4" /> Swap Paid/Received
                        </Button>
                    )}
                    <Button
                        onClick={handleExportToExcel}
                        disabled={!editableTableData || dataRowsForRendering.length === 0 || !selectedFileType || commonButtonDisabled}
                        variant="outline"
                        className="w-full sm:w-auto"
                    >
                        <FileDown className="mr-2 h-4 w-4" /> Export to Excel
                    </Button>
                    {canSendToBank && (
                        <Button
                            onClick={handleOpenBankGlAccountDialog}
                            disabled={commonButtonDisabled || !canSendToBank}
                            variant="default"
                            className="w-full sm:w-auto"
                            title={chartOfAccounts.length === 0 ? "Please set up Chart of Accounts first" : ""}
                        >
                            <Send className="mr-2 h-4 w-4" />
                            Send to Bank Transactions
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
              {(dataRowsForRendering.length > 0 && displayHeaders.length > 0) ? (
                <ScrollArea className="h-[400px] w-full border rounded-md">
                  <Table>
                    <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <Checkbox 
                              checked={selectedRows.length === dataRowsForRendering.length && dataRowsForRendering.length > 0}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedRows(dataRowsForRendering.map((_, index) => index));
                                } else {
                                  setSelectedRows([]);
                                }
                                setLastSelectedRowIndex(null);
                              }}
                            />
                          </TableHead>
                          {displayHeaders.map((header, index) => ( <TableHead key={`header-${index}`}>{header}</TableHead> ))}
                          <TableHead className="w-[50px]">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        let currentCalculatedBalance = financialSummary?.openingBalance || 0;
                        const parsedStatementYear = statementYear ? parseInt(statementYear, 10) : undefined;
                        const dateColIndex = displayHeaders.indexOf("Date");
                        const paidColIdx = selectedFileType === "bankStatement" ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid") : -1;
                        const receivedColIdx = selectedFileType === "bankStatement" ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received") : -1;

                        return dataRowsForRendering.map((row, rowIndex) => {
                          if (selectedFileType === "bankStatement") {
                            const paid = parseFloat(String(row[paidColIdx] || "0").replace(/[^0-9.-]/g, ""));
                            const received = parseFloat(String(row[receivedColIdx] || "0").replace(/[^0-9.-]/g, ""));
                            if (!isNaN(paid) && !isNaN(received)) {
                                currentCalculatedBalance = currentCalculatedBalance - paid + received;
                            }
                          }
                          const dateStr = row[dateColIndex] || "";
                          let displayDate = dateStr;
                          try {
                              const parsed = dateFnsParse(dateStr, 'yyyy-MM-dd', new Date());
                              if (isDateValid(parsed)) {
                                  displayDate = format(parsed, 'MM/dd/yyyy');
                              }
                          } catch (e) {
                              // If parsing fails, display the original string
                          }

                          return (
                            <TableRow key={`row-${rowIndex}`} data-state={selectedRows.includes(rowIndex) ? 'selected' : 'unselected'}>
                              <TableCell>
                                <Checkbox
                                    checked={selectedRows.includes(rowIndex)}
                                    onPointerDown={(e) => setIsShiftKeyPressed(e.shiftKey)}
                                    onCheckedChange={(checked) => handleToggleSelectRow(rowIndex, Boolean(checked))}
                                />
                              </TableCell>
                              {displayHeaders.map((header, cellIndex) => {
                                if (selectedFileType === "bankStatement" && header === "Calculated Balance") {
                                  return (
                                    <TableCell key={`cell-${rowIndex}-${cellIndex}`} className="text-right">
                                      {currentCalculatedBalance.toFixed(2)}
                                    </TableCell>
                                  );
                                }
                                let cellValue = row[cellIndex] ?? "";
                                if (cellIndex === dateColIndex) {
                                  try {
                                    const parsedDate = dateFnsParse(cellValue, 'yyyy-MM-dd', new Date());
                                    if(isDateValid(parsedDate)){
                                        cellValue = format(parsedDate, 'MM/dd/yyyy');
                                    }
                                  } catch (e) { /* Display original value if parsing fails */ }
                                }

                                return (
                                    <TableCell key={`cell-${rowIndex}-${cellIndex}`}>
                                        <Input
                                            type={header.toLowerCase().includes("amount") || header.toLowerCase().includes("price") || header.toLowerCase().includes("gst") || header.toLowerCase().includes("total") || header.toLowerCase().includes("balance") ? "number" : "text"}
                                            value={cellValue}
                                            onChange={(e) => {
                                                const newValue = cellIndex === dateColIndex ? parseAndFormatDateToYYYYMMDD(e.target.value, selectedDateFormat, parsedStatementYear) : e.target.value;
                                                handleCellChange(rowIndex, cellIndex, newValue);
                                            }}
                                            className="h-8 text-sm"
                                            disabled={commonButtonDisabled}
                                        />
                                    </TableCell>
                                );
                              })}
                              <TableCell>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteRow(rowIndex)}
                                    disabled={commonButtonDisabled}
                                    aria-label="Delete row"
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <p className="text-muted-foreground py-4">
                  {conversionMessage && editableTableData && editableTableData.length === 0 ? conversionMessage : "No tabular data was extracted, or the table is empty. Try adding rows manually if needed."}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isBankGlAccountDialogOpen} onOpenChange={(isOpen) => {
          setIsBankGlAccountDialogOpen(isOpen);
          if (!isOpen) setBankGlAccountToApply("");
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Select Bank GL Account</DialogTitle>
            <DialogDescription>
              Please select the Bank GL Account from your Chart of Accounts to associate with these transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bank-gl-account-select" className="text-right col-span-1">
                Bank GL
              </Label>
              <Select
                value={bankGlAccountToApply}
                onValueChange={setBankGlAccountToApply}
                disabled={isFetchingChartOfAccounts || chartOfAccounts.length === 0}
              >
                <SelectTrigger id="bank-gl-account-select" className="col-span-3">
                  <SelectValue placeholder={
                    isFetchingChartOfAccounts 
                      ? "Loading accounts..." 
                      : chartOfAccounts.length === 0 
                      ? "No GL accounts found" 
                      : "Select GL Account"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {chartOfAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.glAccount}>
                      {acc.glAccount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsBankGlAccountDialogOpen(false); setBankGlAccountToApply(""); }} disabled={isSendingToBank}>Cancel</Button>
            <Button onClick={handleConfirmSendWithBankGlAccount} disabled={isSendingToBank || !bankGlAccountToApply.trim() || isFetchingChartOfAccounts || chartOfAccounts.length === 0}>
              {isSendingToBank ? <LoadingSpinner className="mr-2" /> : "Confirm & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSendSummaryDialogOpen} onOpenChange={(isOpen) => {
        setIsSendSummaryDialogOpen(isOpen);
        if (!isOpen) {
          setSendSummaryData(null);
          setSkippedRowsForDownload([]);
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Send to Bank Transactions Summary</DialogTitle>
            {sendSummaryData && (
              <DialogDescription>
                Process complete. Review the summary below.
              </DialogDescription>
            )}
          </DialogHeader>
          {sendSummaryData && (
            <div className="py-4 space-y-3">
              <p>Transactions successfully sent: <span className="font-semibold">{sendSummaryData.sentCount}</span></p>
              <p>Transactions skipped: <span className="font-semibold">{sendSummaryData.skippedCount}</span></p>
              {sendSummaryData.skippedCount > 0 && skippedRowsForDownload.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Skipped transactions had issues like invalid dates, missing descriptions or zero amounts. You can download a list of these.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="sm:justify-between mt-2">
             {sendSummaryData && sendSummaryData.skippedCount > 0 && skippedRowsForDownload.length > 0 ? (
              <Button variant="outline" onClick={handleDownloadSkippedBankTransactions}>
                <Download className="mr-2 h-4 w-4" /> Download Skipped Rows
              </Button>
            ) : (
              <div></div> 
            )}
            <Button onClick={() => {
              setIsSendSummaryDialogOpen(false);
              setSendSummaryData(null);
              setSkippedRowsForDownload([]);
            }}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       <Dialog open={isYearUpdateDialogOpen} onOpenChange={setIsYearUpdateDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-headline">Bulk Update Year</DialogTitle>
            <DialogDescription>
              Enter the 4-digit year to apply to the {selectedRows.length} selected transaction date(s). Month and day will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              id="year-to-update"
              type="number"
              placeholder="YYYY"
              value={yearToUpdate}
              onChange={(e) => setYearToUpdate(e.target.value)}
              maxLength={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsYearUpdateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmYearUpdate} disabled={!yearToUpdate.trim()}>Update Year</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}
