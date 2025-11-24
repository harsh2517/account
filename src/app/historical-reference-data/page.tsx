
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookText, ArrowLeft, Trash2, FileDown, ArrowUp, ArrowDown, Edit3, AlertTriangle, Upload, Search, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from "react";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, query, where, getDocs, doc, deleteDoc, Timestamp, writeBatch, updateDoc, addDoc } from "firebase/firestore";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToastAction } from "@/components/ui/toast";


import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";


interface HistoricalReferenceItem {
  id: string;
  companyId: string;
  createdBy: string;
  updatedBy: string;
  keyword: string;
  vendorCustomerName: string;
  glAccount: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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
  companyId: string;
  createdBy: string;
  updatedBy: string;
  glAccount: string;
  subType: string;
  type: TypeOption;
  fs?: FSOption;
  accountNumber?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface SortConfig {
  key: keyof Omit<HistoricalReferenceItem, 'userId'> | null;
  direction: 'ascending' | 'descending';
}

interface ColumnMapping {
  keyword: string;
  vendorCustomerName: string;
  glAccount: string;
}

const SKIP_COLUMN_VALUE = "__SKIP__";

interface SkippedExportData {
  headers: string[];
  rows: any[][];
}

const enhancedNormalizeGlAccountName = (name: string): string => {
  if (!name) return "";
  let normalized = name.toLowerCase();
  normalized = normalized.trim(); // Initial trim
  normalized = normalized.replace(/&|\/|-|_/g, ' '); // Replace common separators with a space
  normalized = normalized.trim(); // Trim again after replacing separators
  normalized = normalized.replace(/\s+/g, ' ');    // Collapse multiple spaces to one
  normalized = normalized.replace(/[^a-z0-9\s]/g, ''); // Remove any remaining non-alphanumeric (except spaces)
  return normalized.trim(); // Final trim to catch any trailing spaces from the above step
};

export default function HistoricalReferenceDataPage() {
  const { user } = useAuth();
  const [historicalReferenceData, setHistoricalReferenceData] = useState<HistoricalReferenceItem[]>([]);
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true);
  const { toast } = useToast();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'keyword', direction: 'ascending' });

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isBulkEditDialogOpen, setIsBulkEditDialogOpen] = useState(false);
  const [bulkEditKeyword, setBulkEditKeyword] = useState("");
  const [bulkEditVendorCustomerName, setBulkEditVendorCustomerName] = useState("");
  const [bulkEditGlAccount, setBulkEditGlAccount] = useState("");
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [lastSelectedItemId, setLastSelectedItemId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({
    keyword: '',
    vendorCustomerName: '',
    glAccount: '',
  });
  const [dataForSkippedRowsExport, setDataForSkippedRowsExport] = useState<SkippedExportData | null>(null);

  const [isImportSummaryDialogOpen, setIsImportSummaryDialogOpen] = useState(false);
  const [importedRowsCount, setImportedRowsCount] = useState(0);
  const [skippedRowsCount, setSkippedRowsCount] = useState(0);
  const [missingGlAccountsForDialog, setMissingGlAccountsForDialog] = useState<string[]>([]);

  const { selectedCompanyId } = useCompany();
  const { logAction } = useAuditLog();

  const fetchHistoricalReferenceData = useCallback(async () => {
     if (!user || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(collection(db, "historicalReferenceData"),   where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const fetchedItems: HistoricalReferenceItem[] = [];
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<HistoricalReferenceItem, 'id'>) });
      });
      setHistoricalReferenceData(fetchedItems);
    } catch (error) {
      console.error("Error fetching historical reference data: ", error);
      toast({ title: "Error", description: "Could not fetch historical reference data.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, toast]);

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
      setChartOfAccounts(fetchedItems);
    } catch (error) {
      console.error("Error fetching chart of accounts:", error);
      toast({ title: "Error", description: "Could not fetch chart of accounts.", variant: "destructive" });
    } finally {
      setIsFetchingChartOfAccounts(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      fetchHistoricalReferenceData();
      fetchChartOfAccounts();
    }
  }, [user, fetchHistoricalReferenceData, fetchChartOfAccounts]);

  const requestSort = (key: keyof Omit<HistoricalReferenceItem, 'userId'>) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedHistoricalReferenceData = useMemo(() => {
    let items = [...historicalReferenceData];

    if (searchTerm) {
        const lowerSearchTerm = searchTerm.toLowerCase();
        items = items.filter(item =>
            item.keyword.toLowerCase().includes(lowerSearchTerm) ||
            item.vendorCustomerName.toLowerCase().includes(lowerSearchTerm) ||
            item.glAccount.toLowerCase().includes(lowerSearchTerm)
        );
    }

    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        const valA = String(a[key] ?? '').toLowerCase();
        const valB = String(b[key] ?? '').toLowerCase();
        let comparison = valA.localeCompare(valB);
        return sortConfig.direction === 'ascending' ? comparison : -comparison;
      });
    }
    return items;
  }, [historicalReferenceData, sortConfig, searchTerm]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof Omit<HistoricalReferenceItem, 'userId'> }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />;
    }
    return null;
  };

  const handleDeleteHistoricalReferenceItem = async (itemId: string) => {
    if (!user || !selectedCompanyId)  return;
    setIsLoading(true);
    try {
      await deleteDoc(doc(db, "historicalReferenceData", itemId));
      await logAction("delete", "historical_reference_data");
      setHistoricalReferenceData(prevItems => prevItems.filter(item => item.id !== itemId));
      toast({ title: "Item Deleted", description: "The reference item has been removed." });
    } catch (error) {
      console.error("Error deleting item: ", error);
      toast({ title: "Delete Error", description: "Could not delete the item.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportToExcel = () => {
    if (filteredAndSortedHistoricalReferenceData.length === 0) {
      toast({ title: "No Data to Export", description: "There are no reference items to export.", variant: "default" });
      return;
    }

    const exportData = filteredAndSortedHistoricalReferenceData.map(item => ({
      'Keyword': item.keyword,
      'Vendor/Customer Name': item.vendorCustomerName,
      'GL Account': item.glAccount,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "HistoricalReferences");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `historical_reference_data_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Historical reference data exported to Excel." });
  };

  const handleToggleSelectItem = (itemId: string, checked: boolean, isShift: boolean) => {
    setSelectedItemIds(prevSelectedIds => {
        if (isShift && lastSelectedItemId && lastSelectedItemId !== itemId) {
            const currentIndex = filteredAndSortedHistoricalReferenceData.findIndex(item => item.id === itemId);
            const lastIndex = filteredAndSortedHistoricalReferenceData.findIndex(item => item.id === lastSelectedItemId);

            if (currentIndex === -1 || lastIndex === -1) {
                return checked ? [...prevSelectedIds, itemId] : prevSelectedIds.filter(id => id !== itemId);
            }

            const start = Math.min(currentIndex, lastIndex);
            const end = Math.max(currentIndex, lastIndex);
            const idsInRange = filteredAndSortedHistoricalReferenceData.slice(start, end + 1).map(item => item.id);

            if (checked) {
                return Array.from(new Set([...prevSelectedIds, ...idsInRange]));
            } else {
                return prevSelectedIds.filter(id => !idsInRange.includes(id));
            }
        } else {
            if (!isShift) {
                setLastSelectedItemId(itemId);
            }
            return checked ? [...prevSelectedIds, itemId] : prevSelectedIds.filter(id => id !== itemId);
        }
    });
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItemIds(filteredAndSortedHistoricalReferenceData.map(item => item.id));
    } else {
      setSelectedItemIds([]);
    }
    setLastSelectedItemId(null);
  };

  const handleOpenBulkEditDialog = () => {
    if (selectedItemIds.length === 0) return;
    setBulkEditKeyword("");
    setBulkEditVendorCustomerName("");
    setBulkEditGlAccount("");
    setIsBulkEditDialogOpen(true);
  };

  const handleSaveBulkEdit = async () => {
    if (!user || !selectedCompanyId || selectedItemIds.length === 0) return;
    if (!bulkEditKeyword && !bulkEditVendorCustomerName && !bulkEditGlAccount) {
      toast({title: "No Changes Specified", description: "Please provide values for at least one field to update.", variant: "destructive"});
      return;
    }

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      // const updates: Partial<Pick<HistoricalReferenceItem, 'keyword' | 'vendorCustomerName' | 'glAccount'>> = {};
      // if (bulkEditKeyword) updates.keyword = bulkEditKeyword;
      // if (bulkEditVendorCustomerName) updates.vendorCustomerName = bulkEditVendorCustomerName;
      // if (bulkEditGlAccount) updates.glAccount = bulkEditGlAccount;

      const updates: Partial<HistoricalReferenceItem> = {
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      };
      if (bulkEditKeyword) updates.keyword = bulkEditKeyword;
      if (bulkEditVendorCustomerName) updates.vendorCustomerName = bulkEditVendorCustomerName;
      if (bulkEditGlAccount) updates.glAccount = bulkEditGlAccount;
  
      const changedFields = [];
      if (bulkEditKeyword) changedFields.push("keyword");
      if (bulkEditVendorCustomerName) changedFields.push("vendorCustomerName");
      if (bulkEditGlAccount) changedFields.push("glAccount");
  
      selectedItemIds.forEach(id => {
        const docRef = doc(db, "historicalReferenceData", id);
        batch.update(docRef, updates);
      });
      await batch.commit();
      await logAction("bulk_update", "historical_reference_data", changedFields);
      toast({title: "Bulk Edit Successful", description: `${selectedItemIds.length} items updated.`});
      await fetchHistoricalReferenceData();
      setSelectedItemIds([]);
      setIsBulkEditDialogOpen(false);
    } catch (error) {
      console.error("Error bulk editing items:", error);
      toast({title: "Bulk Edit Failed", description: "Could not update items.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenBulkDeleteDialog = () => {
    if (selectedItemIds.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || !selectedCompanyId || selectedItemIds.length === 0) return;
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        const docRef = doc(db, "historicalReferenceData", id);
        batch.delete(docRef);
      });
      await batch.commit();
      await logAction("bulk_delete", "historical_reference_data", [String(selectedItemIds.length)]);
      toast({title: "Bulk Delete Successful", description: `${selectedItemIds.length} items deleted.`});
      await fetchHistoricalReferenceData();
      setSelectedItemIds([]);
      setIsBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error bulk deleting items:", error);
      toast({title: "Bulk Delete Failed", description: "Could not delete items.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
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
          const workbook = XLSX.read(data, { type: 'array', defval: "" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });
          
          if (jsonData.length > 0 && jsonData[0].length > 0) {
            setExcelHeaders(jsonData[0] as string[]);
            setExcelData(jsonData.slice(1));
            setColumnMappings({ keyword: '', vendorCustomerName: '', glAccount: '' });
            setDataForSkippedRowsExport(null);
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

  const handleDownloadSkippedExcel = () => {
    if (!dataForSkippedRowsExport || dataForSkippedRowsExport.rows.length === 0) {
      toast({ title: "No Skipped Data", description: "There is no data from skipped rows to download.", variant: "default" });
      return;
    }
    const worksheet = XLSX.utils.aoa_to_sheet([dataForSkippedRowsExport.headers, ...dataForSkippedRowsExport.rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Skipped_Historical_Refs");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `skipped_historical_references_${today}.xlsx`);
    toast({ title: "Download Started", description: "Skipped historical reference data is being downloaded." });
  };

  const handleImportData = async () => {
    if (!user || !selectedCompanyId) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    if (!columnMappings.keyword || !columnMappings.vendorCustomerName || !columnMappings.glAccount) {
      toast({ title: "Mapping Incomplete", description: "Please map 'Keyword', 'Vendor/Customer Name', and 'GL Account' columns.", variant: "destructive" });
      return;
    }
    if (chartOfAccounts.length === 0 && !isFetchingChartOfAccounts) {
      toast({ title: "Chart of Accounts Missing", description: "Please add accounts to your Chart of Accounts before importing historical data.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setDataForSkippedRowsExport(null); 
    let processedImportedCount = 0;
    const processedSkippedRawRows: any[][] = [];
    const processedMissingGlAccountsInFile = new Set<string>();
    const batch = writeBatch(db);

    const normalizedCoAMap = new Map(
      chartOfAccounts.map(coa => [enhancedNormalizeGlAccountName(coa.glAccount), coa.glAccount])
    );

    const existingSignatures = new Set(
      historicalReferenceData.map(item =>
        `${enhancedNormalizeGlAccountName(item.keyword)}|${enhancedNormalizeGlAccountName(item.vendorCustomerName)}|${enhancedNormalizeGlAccountName(item.glAccount)}`
      )
    );
    const batchSignatures = new Set<string>();

    excelData.forEach(row => {
      const keywordFromFile = String(row[excelHeaders.indexOf(columnMappings.keyword)] || '').trim();
      const vendorCustomerNameFromFile = String(row[excelHeaders.indexOf(columnMappings.vendorCustomerName)] || '').trim();
      const glAccountFromFile = String(row[excelHeaders.indexOf(columnMappings.glAccount)] || '').trim();

      if (!keywordFromFile || !vendorCustomerNameFromFile || !glAccountFromFile) {
        processedSkippedRawRows.push(row);
        return; 
      }

      const normalizedGlAccountFromFile = enhancedNormalizeGlAccountName(glAccountFromFile);
      const originalCoAGlAccountName = normalizedCoAMap.get(normalizedGlAccountFromFile);

      if (!originalCoAGlAccountName) {
        processedMissingGlAccountsInFile.add(glAccountFromFile); // Add original value for user feedback
        processedSkippedRawRows.push(row);
        return; 
      }
      
      const currentRowSignature = `${enhancedNormalizeGlAccountName(keywordFromFile)}|${enhancedNormalizeGlAccountName(vendorCustomerNameFromFile)}|${normalizedGlAccountFromFile}`;

      if (existingSignatures.has(currentRowSignature) || batchSignatures.has(currentRowSignature)) {
        processedSkippedRawRows.push(row);
        return; 
      }

      batchSignatures.add(currentRowSignature);
      const newRefData: Omit<HistoricalReferenceItem, 'id' | 'createdAt' | 'userId'> = {
        companyId: selectedCompanyId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        keyword: keywordFromFile,
        vendorCustomerName: vendorCustomerNameFromFile,
        glAccount: originalCoAGlAccountName, // Use the name from CoA with original casing
      };


     
      const newDocRef = doc(collection(db, "historicalReferenceData"));
      // batch.set(newDocRef, { ...newRefData, userId: user.uid, createdAt: serverTimestamp() });
        batch.set(newDocRef,  newRefData);
        processedImportedCount++;
      });

    try {
      if (processedImportedCount > 0) {
        await batch.commit();
        await logAction("import", "historical_reference_data",  [String(processedImportedCount)]);
        await fetchHistoricalReferenceData(); 
      }
      
      setImportedRowsCount(processedImportedCount);
      setSkippedRowsCount(processedSkippedRawRows.length);
      setMissingGlAccountsForDialog(Array.from(processedMissingGlAccountsInFile));

      if (processedSkippedRawRows.length > 0) {
        setDataForSkippedRowsExport({ headers: [...excelHeaders], rows: processedSkippedRawRows });
      } else {
        setDataForSkippedRowsExport(null); 
      }
      
      setIsImportSummaryDialogOpen(true); // Open the summary dialog
      
      setIsImportDialogOpen(false);
      setSelectedFile(null);
      setExcelHeaders([]);
      setExcelData([]);
      setColumnMappings({ keyword: '', vendorCustomerName: '', glAccount: '' });

    } catch (error) {
      console.error("Error saving historical reference data to Firestore:", error);
      toast({ title: "Database Error", description: "Could not save reference data.", variant: "destructive" });
      setDataForSkippedRowsExport(null);
    } finally {
      setIsLoading(false);
    }
  };

  const targetColumns: Array<{ key: keyof ColumnMapping; label: string; }> = [
    { key: "keyword", label: "Keyword *" },
    { key: "vendorCustomerName", label: "Vendor/Customer Name *" },
    { key: "glAccount", label: "GL Account *" },
  ];

  const commonButtonDisabled = isLoading || isFetching || isFetchingChartOfAccounts || isBulkEditDialogOpen || isBulkDeleteDialogOpen || isImportDialogOpen || isImportSummaryDialogOpen;
  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedHistoricalReferenceData.length === 0) return false;
    return filteredAndSortedHistoricalReferenceData.every(item => selectedItemIds.includes(item.id));
  }, [filteredAndSortedHistoricalReferenceData, selectedItemIds]);

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline">
              Historical Reference Data
            </h1>
            <p className="text-lg text-muted-foreground">
              Manage your reference data for mapping. Data is saved to your account.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => {
                setIsImportDialogOpen(isOpen);
                if (!isOpen) {
                    setSelectedFile(null);
                    setExcelHeaders([]);
                    setExcelData([]);
                    setColumnMappings({ keyword: '', vendorCustomerName: '', glAccount: '' });
                    setDataForSkippedRowsExport(null);
                }
            }}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={commonButtonDisabled || selectedItemIds.length > 0}>
                  <Upload className="mr-2 h-4 w-4" /> Import Data
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                  <DialogTitle className="font-headline">Import Historical References</DialogTitle>
                  <DialogDescription>
                    Select Excel file (.xlsx, .xls, .csv). Map columns.
                    Rows with GL accounts not in Chart of Accounts (checked with flexible matching), missing required mapped data, or duplicates will be skipped.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="excel-file-hrd" className="text-right">Excel File</Label>
                    <Input id="excel-file-hrd" type="file" accept=".xlsx, .xls, .csv" onChange={handleFileChange} className="col-span-3" />
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
                      <p className="col-span-4 text-sm text-muted-foreground">Map your Excel columns to the target fields (* required):</p>
                      {targetColumns.map(targetCol => (
                        <div key={targetCol.key} className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor={`map-hrd-${targetCol.key}`} className="text-right">{targetCol.label}</Label>
                          <Select
                            value={columnMappings[targetCol.key] || ""}
                            onValueChange={(value) => handleMappingChange(targetCol.key, value)}
                          >
                            <SelectTrigger className="col-span-3">
                              <SelectValue placeholder="Select Column" />
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
                  <Button variant="outline" onClick={() => {setIsImportDialogOpen(false); setDataForSkippedRowsExport(null);}}>Cancel</Button>
                  <Button onClick={handleImportData} disabled={excelHeaders.length === 0 || isLoading || isFetchingChartOfAccounts || (chartOfAccounts.length === 0 && !isFetchingChartOfAccounts) || !columnMappings.keyword || !columnMappings.vendorCustomerName || !columnMappings.glAccount}>
                    {isLoading && <LoadingSpinner className="mr-2"/>}
                    {isFetchingChartOfAccounts ? "Loading CoA..." : (chartOfAccounts.length === 0 && !isFetchingChartOfAccounts) ? "Setup CoA First" : "Import & Save"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedHistoricalReferenceData.length === 0 || selectedItemIds.length > 0}>
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
                    placeholder="Search references..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    disabled={commonButtonDisabled}
                />
            </div>
            {selectedItemIds.length > 0 && (
                <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between ml-4 flex-grow">
                    <span className="text-sm font-medium">{selectedItemIds.length} item(s) selected</span>
                    <div className="space-x-2">
                        <Button size="sm" variant="outline" onClick={handleOpenBulkEditDialog} disabled={commonButtonDisabled}>
                            <Edit3 className="mr-2 h-4 w-4" /> Bulk Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleOpenBulkDeleteDialog} disabled={commonButtonDisabled}>
                            <Trash2 className="mr-2 h-4 w-4" /> Bulk Delete
                        </Button>
                    </div>
                </div>
            )}
        </div>

        <Card className="shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-2xl font-medium font-headline">
              <BookText className="inline-block mr-3 h-7 w-7 text-primary" />
              Reference List
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching || isFetchingChartOfAccounts ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">{isFetchingChartOfAccounts ? "Loading Chart of Accounts..." : "Loading references..."}</span>
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
                          aria-label="Select all items"
                          disabled={commonButtonDisabled || filteredAndSortedHistoricalReferenceData.length === 0}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('keyword')}>
                         <div className="flex items-center">Keyword <SortIndicator columnKey="keyword" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('vendorCustomerName')}>
                        <div className="flex items-center">Vendor/Customer Name <SortIndicator columnKey="vendorCustomerName" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('glAccount')}>
                        <div className="flex items-center">GL Account <SortIndicator columnKey="glAccount" /></div>
                      </TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedHistoricalReferenceData.length > 0 ? (
                      filteredAndSortedHistoricalReferenceData.map((item) => (
                        <TableRow key={item.id} data-state={selectedItemIds.includes(item.id) ? "selected" : ""}>
                           <TableCell>
                            <Checkbox
                              checked={selectedItemIds.includes(item.id)}
                              onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => setIsShiftKeyPressed(e.shiftKey)}
                              onCheckedChange={(checked) => 
                                  handleToggleSelectItem(
                                      item.id, 
                                      Boolean(checked),
                                      isShiftKeyPressed
                                  )
                              }
                              aria-labelledby={`select-item-${item.id}`}
                              disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell>{item.keyword}</TableCell>
                          <TableCell>{item.vendorCustomerName}</TableCell>
                          <TableCell>{item.glAccount}</TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteHistoricalReferenceItem(item.id)}
                              aria-label="Delete item"
                              id={`select-item-${item.id}`}
                              disabled={commonButtonDisabled || selectedItemIds.length > 0}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          {searchTerm ? "No reference items match your search." : "No reference items found. Try importing some."}
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

      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Bulk Edit Historical References</DialogTitle>
            <DialogDescription>
              Update fields for {selectedItemIds.length} selected item(s).
              Leave fields blank to keep original values.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-keyword" className="text-right">Keyword</Label>
              <Input
                id="bulk-keyword"
                value={bulkEditKeyword}
                onChange={(e) => setBulkEditKeyword(e.target.value)}
                className="col-span-3"
                placeholder="New Keyword (optional)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-vendorCustomerName" className="text-right">Vendor/Customer</Label>
              <Input
                id="bulk-vendorCustomerName"
                value={bulkEditVendorCustomerName}
                onChange={(e) => setBulkEditVendorCustomerName(e.target.value)}
                className="col-span-3"
                placeholder="New Name (optional)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-glAccount" className="text-right">GL Account</Label>
               <Select
                value={bulkEditGlAccount || ""}
                onValueChange={(value) => setBulkEditGlAccount(value)}
                disabled={isFetchingChartOfAccounts || chartOfAccounts.length === 0}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder={isFetchingChartOfAccounts ? "Loading CoA..." : chartOfAccounts.length === 0 ? "No CoA" : "Select new GL (optional)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=""><em>(No Change)</em></SelectItem>
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
            <Button onClick={handleSaveBulkEdit} disabled={isLoading || (!bulkEditKeyword && !bulkEditVendorCustomerName && !bulkEditGlAccount)}>
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
              Are you sure you want to permanently delete {selectedItemIds.length} selected item(s)? This action cannot be undone.
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

      <Dialog open={isImportSummaryDialogOpen} onOpenChange={(isOpen) => {
        setIsImportSummaryDialogOpen(isOpen);
        if (!isOpen) { // Reset states when dialog is closed
            setImportedRowsCount(0);
            setSkippedRowsCount(0);
            setMissingGlAccountsForDialog([]);
            setDataForSkippedRowsExport(null);
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Import Summary</DialogTitle>
            <DialogDescription>
              Review the results of your historical reference data import.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p>Successfully imported items: <span className="font-semibold">{importedRowsCount}</span></p>
            <p>Skipped items (due to missing data, GL not in CoA, or duplicate): <span className="font-semibold">{skippedRowsCount}</span></p>
            
            {missingGlAccountsForDialog.length > 0 && (
              <div>
                <p className="font-semibold text-destructive">The following GL accounts from your file were not found in your Chart of Accounts (rows using them were skipped):</p>
                <ScrollArea className="h-24 mt-2 border rounded-md p-2">
                  <ul className="list-disc list-inside text-sm">
                    {missingGlAccountsForDialog.map(gl => <li key={gl}>{gl}</li>)}
                  </ul>
                </ScrollArea>
              </div>
            )}
             {skippedRowsCount > 0 && dataForSkippedRowsExport && dataForSkippedRowsExport.rows.length > 0 && (
                <p className="text-sm text-muted-foreground">Skipped rows can be downloaded for review.</p>
            )}

          </div>
          <DialogFooter className="sm:justify-between">
             {dataForSkippedRowsExport && dataForSkippedRowsExport.rows.length > 0 ? (
                <Button variant="outline" onClick={handleDownloadSkippedExcel}>
                    <Download className="mr-2 h-4 w-4" /> Download Skipped Rows
                </Button>
                ) : (
                <div></div> 
             )}
            <Button onClick={() => setIsImportSummaryDialogOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}
