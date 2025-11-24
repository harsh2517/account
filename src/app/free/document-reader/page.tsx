"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileScan, ArrowLeft, UploadCloud, FileDown, AlertTriangle, Send, Download, DollarSign, PlusCircle, Trash2, Repeat, CalendarDays, ChevronsUpDown, Info } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useCallback, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parse as dateFnsParse, isValid as isDateValid, setYear } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import * as pdfjs from 'pdfjs-dist';
import type { ExtractTabularDataInput, ExtractTabularDataOutput } from "@/ai/flows/free-extract-tabular-data-flow";
import { extractDataFromDocument } from "@/ai/flows/free-extract-tabular-data-flow";
import AdCard from "@/components/ui/adcard";

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;


const DOCUMENT_COLUMNS_DEFINITION = {
  bankStatement: ["Date", "Description", "Amount Paid", "Amount Received", "Balance", "Calculated Balance"],
  vendorBill: ["Date", "Vendor Name", "Customer Name", "Bill Number", "Description", "Unit Price", "Quantity", "Amount", "Total GST", "Total Amount"],
  check: ["Date", "Check Number", "Payee", "Payer", "Amount", "Memo/Narration"],
};

type DocumentType = "bankStatement" | "vendorBill" | "check";

interface SkippedRowData {
  originalRow: string[];
  reason: string;
}

interface FinancialSummary {
  openingBalance: number;
  totalPaid: number;
  totalReceived: number;
  calculatedClosingBalance: number;
}

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  subType: string;
  type: string;
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

const parseAndFormatDateToYYYYMMDD = (dateStr: string, userFormat?: string): string => {
  if (!dateStr || String(dateStr).trim() === "") return "";
  const trimmedDateStr = String(dateStr).trim();

  if (userFormat) {
    try {
      const parsedWithUserFormat = dateFnsParse(trimmedDateStr, userFormat, new Date());
      if (isDateValid(parsedWithUserFormat)) {
        return format(parsedWithUserFormat, "yyyy-MM-dd");
      }
    } catch (e) { /* ignore parse error with user format, try others */ }
  }

  const commonFormats = [
    "yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy", "MM-dd-yyyy", "M/d/yy", "MM/dd/yy", "dd/MM/yy", "yy/MM/dd",
    "M/d/yyyy", "d/M/yyyy", "yyyy/MM/dd", "yyyy.MM.dd",
    "dd-MMM-yy", "dd-MMM-yyyy", "MMM d, yyyy", "d MMM yyyy"
  ];
  for (const fmt of commonFormats) {
    try {
      const parsed = dateFnsParse(trimmedDateStr, fmt, new Date());
      if (isDateValid(parsed)) {
        return format(parsed, "yyyy-MM-dd");
      }
    } catch (e) { /* ignore parse error for this format */ }
  }
  try {
    const genericParsed = new Date(trimmedDateStr);
    if (isDateValid(genericParsed)) {
       if (String(dateStr).length > 4 || genericParsed.getFullYear() > 1970) {
          return format(genericParsed, "yyyy-MM-dd");
       }
    }
  } catch(e) { /* ignore generic parse error */ }

  console.warn(`Could not parse date string: "${trimmedDateStr}" into a known YYYY-MM-DD format. Returning original.`);
  return trimmedDateStr;
};

export default function DocumentReaderPage() {

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileType, setSelectedFileType] = useState<DocumentType | null>(null);
  const [selectedDateFormat, setSelectedDateFormat] = useState<string | undefined>(undefined);
  const [editableTableData, setEditableTableData] = useState<string[][] | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [isSendingToBank, setIsSendingToBank] = useState(false);
  const [conversionMessage, setConversionMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const [isSendSummaryDialogOpen, setIsSendSummaryDialogOpen] = useState<boolean>(false);
  const [sendSummaryData, setSendSummaryData] = useState<{ sentCount: number; skippedCount: number } | null>(null);
  const [skippedRowsForDownload, setSkippedRowsForDownload] = useState<SkippedRowData[]>([]);
  
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(false);

  const [openingBalanceInput, setOpeningBalanceInput] = useState<string>("");
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);

  const [isYearUpdateDialogOpen, setIsYearUpdateDialogOpen] = useState(false);
  const [yearToUpdate, setYearToUpdate] = useState<string>("");

  const displayHeaders = useMemo(() => {
    if (!selectedFileType) return [];
    return DOCUMENT_COLUMNS_DEFINITION[selectedFileType];
  }, [selectedFileType]);

  const dataRowsForRendering = useMemo(() => {
    if (!editableTableData || editableTableData.length === 0) return [];
    
    const firstRow = editableTableData[0];
    const headersToUse = displayHeaders;

    const firstRowIsHeader = headersToUse.every((header, index) => 
        String(firstRow[index] || '').trim().toLowerCase() === header.toLowerCase()
    );

    if (firstRowIsHeader) {
       return editableTableData.slice(1);
    }
    
    return editableTableData;
  }, [editableTableData, displayHeaders]);

  useEffect(() => {
    if (selectedFileType === "bankStatement" && editableTableData && editableTableData.length >= 0) { 
      const openingBal = parseFloat(openingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
      let totalPaid = 0;
      let totalReceived = 0;

      const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid");
      const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received");

      dataRowsForRendering.forEach(row => { 
        const paidVal = parseFloat(String(row[paidColIndex] || "0").replace(/[^0-9.-]/g, ""));
        const receivedVal = parseFloat(String(row[receivedColIndex] || "0").replace(/[^0-9.-]/g, ""));
        if (!isNaN(paidVal)) totalPaid += paidVal;
        if (!isNaN(receivedVal)) totalReceived += receivedVal;
      });

      setFinancialSummary({
        openingBalance: openingBal,
        totalPaid: totalPaid,
        totalReceived: totalReceived,
        calculatedClosingBalance: openingBal + totalReceived - totalPaid,
      });
    } else if (selectedFileType === "bankStatement") {
        const openingBal = parseFloat(openingBalanceInput.replace(/[^0-9.-]/g, "")) || 0;
        setFinancialSummary({
            openingBalance: openingBal,
            totalPaid: 0,
            totalReceived: 0,
            calculatedClosingBalance: openingBal,
        });
    } else {
      setFinancialSummary(null); 
    }
  }, [editableTableData, dataRowsForRendering, openingBalanceInput, selectedFileType]);

  const correctBankStatementColumns = (aiExtractedTable: string[][], userDateFormat?: string): string[][] => {
    if (!aiExtractedTable || aiExtractedTable.length === 0) return [];

    const firstRowIsHeader = aiExtractedTable[0].some(cell => {
      if (typeof cell !== 'string') return false;
      const cellTrimmed = cell.trim();
      return isNaN(parseFloat(cellTrimmed.replace(/[^0-9.-]/g, ""))) && !/^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(cellTrimmed) && !/^\d{1,2}$/.test(cellTrimmed);
    });

    const dataRowsOnly = firstRowIsHeader ? aiExtractedTable.slice(1) : aiExtractedTable;
    const processedRows: string[][] = [];

    for (const row of dataRowsOnly) {
      if (row.length < 2) { continue; } 

      const originalAiDate = String(row[0] || "").trim();
      const formattedDate = parseAndFormatDateToYYYYMMDD(originalAiDate, userDateFormat);
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
      setEditableTableData(null); 
      setConversionMessage(null);
      setSkippedRowsForDownload([]); 
      setFinancialSummary(null);
      setConversionProgress(0);
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
    if (value !== "bankStatement") {
        setOpeningBalanceInput(""); 
    }
  };

  const handleConvertToTable = useCallback(async () => {
    if (!selectedFile) {
        toast({ title: "No File Selected", description: "Please select a file first.", variant: "destructive" });
        return;
    }
    if (!selectedFileType) {
        toast({ title: "Document Type Missing", description: "Please select the type of document.", variant: "destructive" });
        return;
    }
    if (selectedFileType === "bankStatement" && openingBalanceInput.trim() === "") {
        toast({ title: "Opening Balance Required", description: "Please enter the opening balance for the bank statement.", variant: "destructive" });
        return;
    }
  
    // Check if Gemini API key is available
    const geminiApiKey = localStorage.getItem('accountooze_free_gemini_key');
    if (!geminiApiKey) {
      toast({ 
        title: "Gemini API Key Required", 
        description: "Please set your Gemini API key in the Home to use this feature.", 
        variant: "destructive" 
      });
      return;
    }
  
    setIsConverting(true);
    setEditableTableData(null);
    setConversionMessage(`Preparing ${selectedFile.name}...`);
    setConversionProgress(0);
    
    let allExtractedRows: string[][] = [];
  
    try {
        const fileAsBuffer = await selectedFile.arrayBuffer();
  
        if (selectedFile.type === 'application/pdf') {
            const pdf = await pdfjs.getDocument(fileAsBuffer).promise;
            const numPages = pdf.numPages;
  
            for (let i = 1; i <= numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
  
                if (context) {
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    const pageDataUri = canvas.toDataURL('image/jpeg');
  
                    const input: ExtractTabularDataInput = { 
                      documentDataUri: pageDataUri, 
                      mimeType: 'image/jpeg', 
                      documentType: selectedFileType,
                      geminiApiKey 
                    };
                    const result: ExtractTabularDataOutput = await extractDataFromDocument(input);
                    
                    if (result.extractedTable && result.extractedTable.length > 0) {
                         const dataPortion = result.extractedTable.slice(allExtractedRows.length === 0 ? 0 : 1);
                         allExtractedRows.push(...dataPortion);
                    }
                }
                setConversionProgress(((i / numPages) * 100));
                setConversionMessage(`Successfully processed page ${i} of ${numPages} from ${selectedFile.name}.`);
            }
        } else {
            const dataUri = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(selectedFile);
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = (error) => reject(error);
            });
            setConversionProgress(50);
            const input: ExtractTabularDataInput = { 
              documentDataUri: dataUri, 
              mimeType: selectedFile.type, 
              documentType: selectedFileType,
              geminiApiKey 
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
            setConversionMessage(`No table found in ${selectedFile.name}. Could not find tabular data.`);
        }
    } catch (aiError) {
        console.error(`Error processing ${selectedFile.name}:`, aiError);
        setConversionMessage(`Error processing ${selectedFile.name}. ${aiError instanceof Error ? aiError.message : "An unexpected error."}`);
        setEditableTableData(null);
        setFinancialSummary(null);
        toast({ title: "Processing Error", description: `Could not process the document. Please try again.`, variant: "destructive" });
    } finally {
        setIsConverting(false);
    }
  }, [selectedFile, selectedFileType, openingBalanceInput, selectedDateFormat, toast]);


  const handleCellChange = (rowIndex: number, cellIndex: number, value: string) => {
    setEditableTableData(prevData => {
        if (!prevData) return null;
        const newData = prevData.map(row => [...row]); 
        
        const firstRow = newData[0];
        const headersToUse = displayHeaders;
        const firstRowIsHeader = headersToUse.every((header, index) => 
            String(firstRow[index] || '').trim().toLowerCase() === header.toLowerCase()
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

  const handleDeleteRow = (rowIndexToDelete: number) => {
    setEditableTableData(prevData => {
        if (!prevData) return null;

        const firstRow = prevData[0];
        const headersToUse = displayHeaders;
        const firstRowIsHeader = headersToUse.every((header, index) => 
            String(firstRow[index] || '').trim().toLowerCase() === header.toLowerCase()
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

    if (selectedFileType === "bankStatement") {
      const paidColIdx = headersToUse.indexOf("Amount Paid");
      const receivedColIdx = headersToUse.indexOf("Amount Received");
      const dateColIdx = headersToUse.indexOf("Date");

      for (const row of dataRowsToExport) {
          const rowObject: { [key: string]: string } = {};
          headersToUse.forEach((header, index) => {
              let cellValue = String(row[index] || "");
              if (index === dateColIdx && cellValue) {
                  const dateObj = dateFnsParse(cellValue, "yyyy-MM-dd", new Date());
                  if (isDateValid(dateObj)) {
                      cellValue = format(dateObj, "MM/dd/yyyy"); 
                  } else {
                      const attemptParseForDisplay = parseAndFormatDateToYYYYMMDD(String(row[index] || ""), selectedDateFormat);
                      const parsedForDisplayObj = dateFnsParse(attemptParseForDisplay, "yyyy-MM-dd", new Date());
                      if(isDateValid(parsedForDisplayObj)){
                          cellValue = format(parsedForDisplayObj, "MM/dd/yyyy");
                      } else {
                         cellValue = String(row[index] || ""); 
                      }
                  }
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
              const dateObj = dateFnsParse(cellValue, "yyyy-MM-dd", new Date()); 
              if (isDateValid(dateObj)) {
                  cellValue = format(dateObj, "MM/dd/yyyy"); 
              } else {
                  const attemptParseForDisplay = parseAndFormatDateToYYYYMMDD(String(row[index] || ""), selectedDateFormat);
                  const parsedForDisplayObj = dateFnsParse(attemptParseForDisplay, "yyyy-MM-dd", new Date());
                  if(isDateValid(parsedForDisplayObj)){
                      cellValue = format(parsedForDisplayObj, "MM/dd/yyyy");
                  } else {
                     cellValue = String(row[index] || ""); 
                  }
              }
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

  const handleOpenYearUpdateDialog = () => {
    if (!selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check")) return;
    setYearToUpdate(new Date().getFullYear().toString()); 
    setIsYearUpdateDialogOpen(true);
  };

  const handleConfirmYearUpdate = () => {
    if (!editableTableData || !selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check") || !yearToUpdate.trim()) {
      toast({ title: "Invalid Action", description: "No data to update or year not specified.", variant: "destructive"});
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
    
    const updatedTableData = editableTableData.map((row, rIndex) => {
      if (rIndex === 0 && headers.every((h, i) => String(row[i] || '').toLowerCase().includes(h.toLowerCase()))) {
        return row; 
      }
      
      const newRow = [...row];
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
      return newRow;
    });

    setEditableTableData(updatedTableData);
    toast({ title: "Year Updated", description: `Transaction dates updated to year ${newYear}. Review changes before sending.`});
    setIsYearUpdateDialogOpen(false);
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

  const commonButtonDisabled = isConverting || isSendingToBank || isFetchingChartOfAccounts || isYearUpdateDialogOpen;
  const canBulkUpdateYear = (selectedFileType === "bankStatement" || selectedFileType === "check") && editableTableData && dataRowsForRendering.length > 0;

  return (
    <div className="container mx-auto px-4 py-8 animate-fade-in">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold md:text-4xl sm:font-bold mb-2 font-headline flex items-center text-nowrap">
            <div>
            <FileScan className="mr-3 w-5 h-5 sm:h-10 sm:w-10 text-primary" />
            </div>
            Document Reader
          </h1>
          <p className="text-base md:text-lg text-muted-foreground">
            Upload a PDF, JPEG, or PNG. Select type, convert, edit, and export. Dates display as MM/DD/YYYY.
          </p>
        </div>
      </header>

      <Card className="shadow-lg mb-8">
        <CardHeader>
          <CardTitle className="text-lg font-semibold md:text-2xl">Upload Document & Specify Type/Format</CardTitle>
          <CardDescription>Select a single file, its document type, and the date format used in it.</CardDescription>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-end">
              {selectedFileType === "bankStatement" && (
              <div className="mt-0">
                  <Label htmlFor="opening-balance">Opening Balance * (for bank statements)</Label>
                  <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                      id="opening-balance"
                      type="number"
                      step="0.01"
                      value={openingBalanceInput}
                      onChange={(e) => setOpeningBalanceInput(e.target.value)}
                      placeholder="Enter statement opening balance"
                      disabled={commonButtonDisabled}
                      className="pl-10 mt-1"
                      />
                  </div>
              </div>
              )}
              <div className={selectedFileType === "bankStatement" ? "" : "md:col-start-1"}>
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
                                  <p className="text-xs">Select the primary date format used in your document (e.g., MM/DD/YYYY). This helps parse dates correctly if the AI can't standardize them.</p>
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

      <div className="mb-8">
          <Button
              onClick={handleConvertToTable}
              disabled={ !selectedFile || !selectedFileType || commonButtonDisabled || (selectedFileType === "bankStatement" && openingBalanceInput.trim() === "")}
              className="w-full sm:w-auto"
          >
              {isConverting ? ( <LoadingSpinner className="mr-2" /> ) : ( <UploadCloud className="mr-2 h-5 w-5" /> )}
              {isConverting ? "Converting..." : "Convert to Table"}
          </Button>
          {isConverting &&
          <> 

          <Progress value={conversionProgress} className="w-full h-2 mt-2" />
          
          <div className="w-full flex items-center justify-center">

            <AdCard className="w-fit px-8 py-4 mt-4"/>
            </div>
          </>}
      </div>
      
      {selectedFileType === "bankStatement" && financialSummary && editableTableData && (
           <Card className="shadow-lg mb-8">
              <CardHeader>
                  <CardTitle>Bank Statement Summary (for currently displayed file)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                      <p className="text-muted-foreground">Opening Balance</p>
                      <p className="font-semibold text-lg">{financialSummary.openingBalance.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                  </div>
                  <div>
                      <p className="text-muted-foreground">Total Paid Out</p>
                      <p className="font-semibold text-lg text-red-600">{financialSummary.totalPaid.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                  </div>
                  <div>
                      <p className="text-muted-foreground">Total Received In</p>
                      <p className="font-semibold text-lg text-green-600">{financialSummary.totalReceived.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                  </div>
                  <div>
                      <p className="text-muted-foreground">Calculated Closing Balance</p>
                      <p className="font-semibold text-lg">{financialSummary.calculatedClosingBalance.toLocaleString(undefined, {style:'currency', currency:'USD'})}</p>
                  </div>
              </CardContent>
           </Card>
      )}

      {isConverting && conversionProgress > 0 && (
        <Card className="mt-8 shadow-lg">
          <CardHeader> <CardTitle>Processing Document</CardTitle> </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-muted-foreground">{conversionMessage}</p>
          </CardContent>
        </Card>
      )}

      {!isConverting && editableTableData && (
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
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto mt-4 sm:mt-0 flex-wrap justify-end">
                  <Button
                      onClick={handleConvertToTable}
                      disabled={commonButtonDisabled}
                      variant="outline"
                      className="w-full sm:w-auto"
                      title="Re-run AI extraction on the document"
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
                  {(selectedFileType === "bankStatement" || selectedFileType === "check") && (
                      <Button
                          onClick={handleOpenYearUpdateDialog}
                          disabled={!canBulkUpdateYear || commonButtonDisabled}
                          variant="outline"
                          className="w-full sm:w-auto"
                      >
                          <CalendarDays className="mr-2 h-4 w-4" /> Bulk Update Year
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
              </div>
          </CardHeader>
          <CardContent>
            {(dataRowsForRendering.length > 0 && displayHeaders.length > 0) ? (
              <ScrollArea className="h-[400px] w-full border rounded-md">
                <Table>
                  <TableHeader>
                      <TableRow>
                        {displayHeaders.map((header, index) => ( <TableHead key={`header-${index}`}>{header}</TableHead> ))}
                        <TableHead className="w-[50px]">Action</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      let currentCalculatedBalance = financialSummary?.openingBalance || 0;
                      const paidColIndex = selectedFileType === "bankStatement" ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid") : -1;
                      const receivedColIndex = selectedFileType === "bankStatement" ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received") : -1;

                      return dataRowsForRendering.map((row, rowIndex) => {
                        if (selectedFileType === "bankStatement") {
                          const paid = parseFloat(String(row[paidColIndex] || "0").replace(/[^0-9.-]/g, ""));
                          const received = parseFloat(String(row[receivedColIndex] || "0").replace(/[^0-9.-]/g, ""));
                          if (!isNaN(paid) && !isNaN(received)) {
                              currentCalculatedBalance = currentCalculatedBalance - paid + received;
                          }
                        }
                        return (
                          <TableRow key={`row-${rowIndex}`}>
                            {displayHeaders.map((header, cellIndex) => {
                              if (selectedFileType === "bankStatement" && header === "Calculated Balance") {
                                return (
                                  <TableCell key={`cell-${rowIndex}-${cellIndex}`} className="text-right">
                                    {currentCalculatedBalance.toFixed(2)}
                                  </TableCell>
                                );
                              }
                              return (
                                  <TableCell key={`cell-${rowIndex}-${cellIndex}`}>
                                      <Input
                                          type={header.toLowerCase().includes("amount") || header.toLowerCase().includes("price") || header.toLowerCase().includes("gst") || header.toLowerCase().includes("total") || header.toLowerCase().includes("balance") ? "number" : "text"}
                                          value={row[cellIndex] || ""}
                                          onChange={(e) => handleCellChange(rowIndex, cellIndex, e.target.value)}
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

      <Dialog open={isYearUpdateDialogOpen} onOpenChange={setIsYearUpdateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Bulk Update Year</DialogTitle>
            <DialogDescription>
              Enter the 4-digit year to apply to all transaction dates. Month and day will be preserved.
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
          <AdCard className="w-full"/>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsYearUpdateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmYearUpdate} disabled={!yearToUpdate.trim()}>Update Year</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}