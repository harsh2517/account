
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListChecks, ArrowLeft, Upload, Trash2, FileDown, ArrowUp, ArrowDown, Edit3, AlertTriangle, PlusCircle, Search, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useEffect, useCallback, useMemo } from "react";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, addDoc, query, where, getDocs, doc, deleteDoc, Timestamp, writeBatch, updateDoc } from "firebase/firestore";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";


import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";

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

const DEFAULT_CHART_OF_ACCOUNTS = [
    // Assets
    { glAccount: "Accounts Receivable", subType: "Trade Debtors", type: "Current Asset", fs: "Balance Sheet" },
    { glAccount: "Bank - Main Checking", subType: "Bank", type: "Current Asset", fs: "Balance Sheet" },
    { glAccount: "Office Equipment", subType: "Fixed Assets", type: "Non Current Asset", fs: "Balance Sheet" },
    // Liabilities
    { glAccount: "Accounts Payable", subType: "Trade Creditors", type: "Current Liability", fs: "Balance Sheet" },
    { glAccount: "Credit Card Payable", subType: "Credit Card", type: "Current Liability", fs: "Balance Sheet" },
    // Equity
    { glAccount: "Owner's Equity", subType: "Capital", type: "Equity", fs: "Balance Sheet" },
    { glAccount: "Retained Earnings", subType: "Retained Earnings", type: "Equity", fs: "Balance Sheet" },
    // Income
    { glAccount: "Sales Revenue", subType: "Primary Income", type: "Direct Income", fs: "Profit and Loss" },
    { glAccount: "Service Income", subType: "Primary Income", type: "Direct Income", fs: "Profit and Loss" },
    // Expenses
    { glAccount: "Advertising & Marketing", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
    { glAccount: "Bank Fees", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
    { glAccount: "Cost of Goods Sold", subType: "COGS", type: "Direct Expense", fs: "Profit and Loss" },
    { glAccount: "Office Supplies", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
    { glAccount: "Rent Expense", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
    { glAccount: "Software & Subscriptions", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
    { glAccount: "Utilities", subType: "Operating Expense", type: "Indirect Expense", fs: "Profit and Loss" },
];

interface ChartOfAccountItem {
  id: string;
  companyId: string | null;
  createdBy: string;
  updatedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  glAccount: string;
  subType: string;
  type: TypeOption;
  fs?: FSOption;
  accountNumber?: string;
}

interface ColumnMapping {
  glAccount: string;
  subType: string;
  type: string;
  fs: string;
  accountNumber: string;
}

interface SortConfig {
  key: keyof ChartOfAccountItem | null;
  direction: 'ascending' | 'descending';
}

const SKIP_COLUMN_VALUE = "__SKIP__";
const SELECT_ITEM_NO_CHANGE_VALUE = "__SELECT_ITEM_NO_CHANGE__";

const createAccountSchema = z.object({
  glAccount: z.string().min(1, { message: "GL Account name is required." }),
  accountNumber: z.string().optional(),
  subType: z.string().min(1, { message: "Sub Type is required." }),
  type: z.enum(TYPE_OPTIONS, { errorMap: () => ({ message: "Please select a valid Type." }) }),
  fs: z.enum(FS_OPTIONS, { errorMap: () => ({ message: "Please select a valid FS mapping." }) }),
});

type CreateAccountFormValues = z.infer<typeof createAccountSchema>;

interface SkippedRowDetail {
  rowData: any[];
  reason: string;
}


export default function ChartOfAccountsPage() {
  const { user } = useAuth();
  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({
    glAccount: '',
    subType: '',
    type: '',
    fs: '',
    accountNumber: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const { toast } = useToast();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'glAccount', direction: 'ascending' });

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isBulkEditDialogOpen, setIsBulkEditDialogOpen] = useState(false);
  const [bulkEditGlAccount, setBulkEditGlAccount] = useState("");
  const [bulkEditSubType, setBulkEditSubType] = useState("");
  const [bulkEditType, setBulkEditType] = useState<TypeOption | "">(""); 
  const [bulkEditFs, setBulkEditFs] = useState<FSOption | "">("");
  const [bulkEditAccountNumber, setBulkEditAccountNumber] = useState("");
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [lastSelectedItemId, setLastSelectedItemId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const [isImportSummaryDialogOpen, setIsImportSummaryDialogOpen] = useState(false);
  const [importedCountState, setImportedCountState] = useState(0);
  const [skippedRowsDetail, setSkippedRowsDetail] = useState<SkippedRowDetail[]>([]);


  const createAccountForm = useForm<CreateAccountFormValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      glAccount: "",
      accountNumber: "",
      subType: "",
      type: undefined, 
      fs: undefined,
    },
  });

  
  const { selectedCompanyId } = useCompany();
  const { logAction } = useAuditLog();

  // const fetchChartOfAccounts = useCallback(async () => {
  //   if (!user) {
  //     setIsFetching(false);
  //     return;
  //   }
  //   setIsFetching(true);
  //   try {
  //     //make a contidition here
  //     const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
  //     const querySnapshot = await getDocs(q);
  //     const fetchedItems: ChartOfAccountItem[] = [];
  //     querySnapshot.forEach((doc) => {
  //       fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, 'id'>) });
  //     });
  //     setChartOfAccounts(fetchedItems); 
  //   } catch (error) {
  //     console.error("Error fetching chart of accounts: ", error);
  //     toast({ title: "Error", description: "Could not fetch chart of accounts from database.", variant: "destructive" });
  //   } finally {
  //     setIsFetching(false);
  //   }
  // }, [user, selectedCompanyId, toast]);
  const fetchChartOfAccounts = useCallback(async () => {
    if (!user?.uid || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
  
    setIsFetching(true);
    try {
      const q = query(
        collection(db, "chartOfAccounts"),
        where("companyId", "==", selectedCompanyId)
      );

      
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setChartOfAccounts([]);
        toast({
          title: "No Accounts Found",
          description: "This company has no chart of accounts yet.",
          variant: "default"
        });
        return;
      }
  
      const fetchedItems: ChartOfAccountItem[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Validate required fields
        if (data.companyId && data.glAccount && data.type) {
          fetchedItems.push({ 
            id: doc.id, 
            companyId: data.companyId,
            createdBy: data.createdBy || user.uid,
            glAccount: data.glAccount,
            subType: data.subType || '',
            type: data.type,
            fs: data.fs || 'Balance Sheet',
            accountNumber: data.accountNumber || '',
            createdAt: data.createdAt,
          });
        }
      });
  
      setChartOfAccounts(fetchedItems.sort((a, b) => 
        a.glAccount.localeCompare(b.glAccount)
      ));
  
    } catch (error) {
      console.error("Firestore error:", error);
      if (error.code === 'permission-denied') {
        toast({
          title: "Access Denied",
          description: "You don't have permission to view these accounts.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Error Loading Accounts",
          description: "Failed to fetch chart of accounts.",
          variant: "destructive"
        });
      }
    } finally {
      setIsFetching(false);
    }
  }, [user, selectedCompanyId, toast]);


  useEffect(() => {
    if (user) {
      if (!selectedCompanyId) {
        toast({
          title: "No Company Selected",
          description: "Please select a company first.",
          variant: "destructive"
        });
        return;
      }
      fetchChartOfAccounts();
    }
  }, [user, fetchChartOfAccounts]);

  const requestSort = (key: keyof ChartOfAccountItem) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedChartOfAccounts = useMemo(() => {
    let items = [...chartOfAccounts];

    if (searchTerm) {
        const lowerSearchTerm = searchTerm.toLowerCase();
        items = items.filter(item => 
            item.glAccount.toLowerCase().includes(lowerSearchTerm) ||
            (item.accountNumber && item.accountNumber.toLowerCase().includes(lowerSearchTerm)) ||
            item.subType.toLowerCase().includes(lowerSearchTerm) ||
            item.type.toLowerCase().includes(lowerSearchTerm) ||
            (item.fs && item.fs.toLowerCase().includes(lowerSearchTerm))
        );
    }

    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        const valA = String(a[key as keyof ChartOfAccountItem] ?? '').toLowerCase();
        const valB = String(b[key as keyof ChartOfAccountItem] ?? '').toLowerCase();
        let comparison = valA.localeCompare(valB);
        return sortConfig.direction === 'ascending' ? comparison : -comparison;
      });
    }
    return items;
  }, [chartOfAccounts, sortConfig, searchTerm]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof ChartOfAccountItem }) => {
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
          const workbook = XLSX.read(data, { type: 'array', defval: "" });
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
    setColumnMappings(prev => ({ ...prev, [field]: value }));
  };

  const handleImportData = async () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to import data.", variant: "destructive" });
      return;
    }

    const { glAccount: glCol, subType: subTypeCol, type: typeCol, fs: fsCol } = columnMappings;

    if (!glCol || !subTypeCol || !typeCol || !fsCol) {
      toast({
        title: "Mapping Incomplete",
        description: "Please ensure 'GL Account', 'Sub Type', 'Type', and 'FS' columns are mapped.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    let localImportedCount = 0;
    const newItemsBatch: Omit<ChartOfAccountItem, 'id' | 'createdAt'>[] = [];
    const localSkippedRowsDetail: SkippedRowDetail[] = [];

    excelData.forEach((row, rowIndex) => {
      const glAccountValue = String(row[excelHeaders.indexOf(columnMappings.glAccount)] || '').trim();
      const subTypeValue = String(row[excelHeaders.indexOf(columnMappings.subType)] || '').trim();
      const typeValueRaw = String(row[excelHeaders.indexOf(columnMappings.type)] || '').trim().toLowerCase();
      const fsValueRaw = String(fsCol ? row[excelHeaders.indexOf(fsCol)] : '').trim().toLowerCase();
      const accountNumberValue = String(columnMappings.accountNumber && columnMappings.accountNumber !== SKIP_COLUMN_VALUE ? row[excelHeaders.indexOf(columnMappings.accountNumber)] : '').trim();

      let reason = "";
      if (!glAccountValue) reason = "Missing GL Account.";
      else if (!subTypeValue) reason = "Missing Sub Type.";
      
      let originalType: TypeOption | undefined = undefined;
      if (!reason) {
          originalType = TYPE_OPTIONS.find(opt => opt.toLowerCase() === typeValueRaw);
          if (!originalType) reason = `Invalid 'Type' value: "${row[excelHeaders.indexOf(columnMappings.type)] || ''}". Must be one of: ${TYPE_OPTIONS.join(', ')}.`;
      }

      let originalFs: FSOption | undefined = undefined;
      if (!reason) {
          originalFs = FS_OPTIONS.find(opt => opt.toLowerCase() === fsValueRaw);
          if (!originalFs) reason = `Invalid or missing 'FS' value: "${row[excelHeaders.indexOf(fsCol)] || ''}". Must be one of: ${FS_OPTIONS.join(', ')}.`;
      }
      
      if (reason) {
        localSkippedRowsDetail.push({ rowData: row, reason });
        return;
      }
      
      const newItem: Omit<ChartOfAccountItem, 'id' | 'createdAt'> = {
        companyId: selectedCompanyId,
        createdBy: user.uid,
        glAccount: glAccountValue,
        subType: subTypeValue,
        type: originalType!, 
        fs: originalFs!,   
        accountNumber: accountNumberValue,  
      };
      newItemsBatch.push(newItem);
    });
    
    if (newItemsBatch.length > 0) {
        try {
          // const batch = writeBatch(db);
          // for (const itemData of newItemsBatch) {
          //   //WIP: pending
          //   const newDocRef = doc(collection(db, "chartOfAccounts"));
          //   batch.set(newDocRef, { ...itemData, createdAt: serverTimestamp() });
          //   localImportedCount++;
          // }

          const batch = writeBatch(db);
          for (const itemData of newItemsBatch) {
            const newDocRef = doc(collection(db, "chartOfAccounts"));
            batch.set(newDocRef, { 
              ...itemData, 
              companyId: selectedCompanyId,
              createdAt: serverTimestamp() 
            });
            localImportedCount++;
          }
          await batch.commit();


          await logAction("bulk_import", "chartOfAccounts", [
            `Imported ${newItemsBatch.length} accounts`,
            `Skipped ${skippedRowsDetail.length} rows`,
            ...(skippedRowsDetail.length > 0 ? [
              `Sample skip reasons: ${Array.from(new Set(skippedRowsDetail.map(s => s.reason))).slice(0, 3).join(", ")}`
            ] : [])
          ]);
          await fetchChartOfAccounts();
        } catch (error) {
          console.error("Error saving chart of accounts to Firestore:", error);
          toast({ title: "Database Error", description: "Could not save chart of account items to the database.", variant: "destructive" });
        }
    }
    
    setImportedCountState(localImportedCount);
    setSkippedRowsDetail(localSkippedRowsDetail);
    setIsImportSummaryDialogOpen(true);

    setIsLoading(false);
    setIsImportDialogOpen(false); 
    setSelectedFile(null);
    setExcelHeaders([]);
    setExcelData([]);
    setColumnMappings({ glAccount: '', subType: '', type: '', fs: '', accountNumber: ''});
  };
  
  useEffect(() => {
    setColumnMappings({ glAccount: '', subType: '', type: '', fs: '', accountNumber: ''});
  }, [excelHeaders]);

  const handleDeleteChartOfAccountItem = async (itemId: string, itemGLAccount: string) => {

    if (!user) return;
    setIsLoading(true);
    try {
      await logAction("delete", "chartOfAccounts", [`Deleted account: ${itemGLAccount}`]);
      await deleteDoc(doc(db, "chartOfAccounts", itemId));
      setChartOfAccounts(prevItems => prevItems.filter(item => item.id !== itemId));
      toast({ title: "Item Deleted", description: "The chart of account item has been removed." });
    } catch (error) {
      console.error("Error deleting item: ", error);
      toast({ title: "Delete Error", description: "Could not delete the item.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportToExcel = () => {
    if (filteredAndSortedChartOfAccounts.length === 0) {
      toast({ title: "No Data to Export", description: "There are no chart of account items to export.", variant: "default" });
      return;
    }

    const exportData = filteredAndSortedChartOfAccounts.map(item => ({
      'GL Account': item.glAccount,
      'Sub Type': item.subType,
      'Type': item.type,
      'FS': item.fs,
      'Account Number': item.accountNumber || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ChartOfAccounts");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `chart_of_accounts_${today}.xlsx`);
    toast({ title: "Export Successful", description: "Chart of accounts exported to Excel." });
  };

  const handleToggleSelectItem = (itemId: string, checked: boolean, isShift: boolean) => {
    setSelectedItemIds(prevSelectedIds => {
        if (isShift && lastSelectedItemId && lastSelectedItemId !== itemId) {
            const currentIndex = filteredAndSortedChartOfAccounts.findIndex(item => item.id === itemId);
            const lastIndex = filteredAndSortedChartOfAccounts.findIndex(item => item.id === lastSelectedItemId);

            if (currentIndex === -1 || lastIndex === -1) {
                return checked ? [...prevSelectedIds, itemId] : prevSelectedIds.filter(id => id !== itemId);
            }

            const start = Math.min(currentIndex, lastIndex);
            const end = Math.max(currentIndex, lastIndex);
            const idsInRange = filteredAndSortedChartOfAccounts.slice(start, end + 1).map(item => item.id);
            
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
      setSelectedItemIds(filteredAndSortedChartOfAccounts.map(item => item.id));
    } else {
      setSelectedItemIds([]);
    }
    setLastSelectedItemId(null);
  };

  const handleOpenBulkEditDialog = () => {
    if (selectedItemIds.length === 0) return;
    setBulkEditGlAccount("");
    setBulkEditSubType("");
    setBulkEditType(""); 
    setBulkEditFs("");   
    setBulkEditAccountNumber("");
    setIsBulkEditDialogOpen(true);
  };

  const handleSaveBulkEdit = async () => {
    if (!user || selectedItemIds.length === 0) return;
     if (!bulkEditGlAccount && !bulkEditSubType && !bulkEditType && !bulkEditFs && !bulkEditAccountNumber) {
      toast({title: "No Changes Specified", description: "Please provide values for at least one field to update.", variant: "destructive"});
      return;
    }

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      const updates: any = {};
      // const changedFields: string[] = [];
      // if (bulkEditGlAccount) {
      //   updates.glAccount = bulkEditGlAccount;
      //   changedFields.push(`GL Account → "${bulkEditGlAccount}"`);
      // }
      if (bulkEditGlAccount) updates.glAccount = bulkEditGlAccount;
      if (bulkEditSubType) updates.subType = bulkEditSubType;
      if (bulkEditType) updates.type = bulkEditType as TypeOption;
      if (bulkEditAccountNumber) updates.accountNumber = bulkEditAccountNumber;
      if (bulkEditFs) updates.fs = bulkEditFs as FSOption;
      updates.updatedBy = user.uid;
      updates.updatedAt = serverTimestamp();

      selectedItemIds.forEach(id => {
        const docRef = doc(db, "chartOfAccounts", id);
        batch.update(docRef, {
          ...updates,
          updatedBy: user.uid,
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      await logAction("bulk_update", "chartOfAccounts", [
        `Updated ${selectedItemIds.length} accounts`,
        ...Object.keys(updates)
          .filter(k => !['updatedBy', 'updatedAt'].includes(k))
          .map(k => `Changed ${k} to ${updates[k]}`)
      ]);
      
      toast({title: "Bulk Edit Successful", description: `${selectedItemIds.length} items updated.`});
      await fetchChartOfAccounts();
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
    if (!user || selectedItemIds.length === 0) return;
    setIsLoading(true);
    try {


       const batch = writeBatch(db);
  selectedItemIds.forEach(id => {
    const docRef = doc(db, "chartOfAccounts", id);
    batch.delete(docRef);
  });

      await batch.commit();
     
      const itemsToDelete = chartOfAccounts.filter(item => selectedItemIds.includes(item.id));
      await logAction("bulk_delete", "chartOfAccounts", [
        `Deleted ${selectedItemIds.length} accounts`,
        ...itemsToDelete.slice(0, 5).map(item => `Deleted: ${item.glAccount}`)
      ]);
      toast({title: "Bulk Delete Successful", description: `${selectedItemIds.length} items deleted.`});
      await fetchChartOfAccounts();
      setSelectedItemIds([]);
      setIsBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error bulk deleting items:", error);
      toast({title: "Bulk Delete Failed", description: "Could not delete items.", variant: "destructive"});
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAccountSubmit: SubmitHandler<CreateAccountFormValues> = async (data) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const newItemData: Omit<ChartOfAccountItem, 'id' | 'createdAt'> = {
        companyId: selectedCompanyId, 
        createdBy: user.uid,         
        glAccount: data.glAccount,
        accountNumber: data.accountNumber,
        subType: data.subType,
        type: data.type,
        fs: data.fs, 
      };
      await addDoc(collection(db, "chartOfAccounts"),{ ...newItemData, createdAt: serverTimestamp()});

      await logAction("create", "chartOfAccounts", [
        `Created account: ${newItemData.glAccount}`,
        `Type: ${newItemData.type}`,
        `FS: ${newItemData.fs}`
      ]);

      toast({ title: "Account Created", description: `Account "${data.glAccount}" has been successfully added.` });
      await fetchChartOfAccounts();
      setIsCreateDialogOpen(false);
      createAccountForm.reset();
    } catch (error) {
      console.error("Error creating account:", error);
      toast({ title: "Creation Failed", description: "Could not create the account.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateDefaultCoA = async () => {
    if (!user || !selectedCompanyId) return;

    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
    const coaCollectionRef = collection(db, "chartOfAccounts");
    
    DEFAULT_CHART_OF_ACCOUNTS.forEach(account => {
      const docRef = doc(coaCollectionRef);
      batch.set(docRef, { 
        ...account, 
        companyId: selectedCompanyId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      });
    });

      await batch.commit();
      await logAction("create_default", "chartOfAccounts", [
        "Created default Chart of Accounts"
      ]);
      
      toast({ title: "Default Accounts Created", description: "The standard Chart of Accounts has been created for you." });
      await fetchChartOfAccounts();
    } catch (error) {
      console.error("Error creating default chart of accounts:", error);
      toast({ title: "Creation Failed", description: "Could not create the default accounts.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadSkippedExcel = () => {
    if (skippedRowsDetail.length === 0) {
      toast({ title: "No Skipped Data", description: "There is no data from skipped rows to download.", variant: "default" });
      return;
    }
    const dataToExport = skippedRowsDetail.map(item => [...item.rowData, item.reason]);
    const headersWithReason = [...excelHeaders, "Reason for Skipping"];
    
    const worksheet = XLSX.utils.aoa_to_sheet([headersWithReason, ...dataToExport]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Skipped_CoA_Import");
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `skipped_chart_of_accounts_${today}.xlsx`);
    toast({ title: "Download Started", description: "Skipped Chart of Accounts data is being downloaded." });
  };

  const targetColumns: Array<{ key: keyof ColumnMapping; label: string; isOptional?: boolean }> = [
    { key: "glAccount", label: "GL Account *" },
    { key: "subType", label: "Sub Type *" },
    { key: "type", label: "Type *" },
    { key: "fs", label: "FS *" },
    { key: "accountNumber", label: "Account Number (Optional)", isOptional: true },
  ];

  const commonButtonDisabled = isLoading || isFetching || isBulkEditDialogOpen || isBulkDeleteDialogOpen || isCreateDialogOpen || isImportDialogOpen || isImportSummaryDialogOpen;
  
  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedChartOfAccounts.length === 0) return false;
    return filteredAndSortedChartOfAccounts.every(item => selectedItemIds.includes(item.id));
  }, [filteredAndSortedChartOfAccounts, selectedItemIds]);


  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline">
              Chart of Accounts
            </h1>
            <p className="text-lg text-muted-foreground">
              Manage your general ledger accounts. FS mapping is required.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(true)} disabled={commonButtonDisabled || selectedItemIds.length > 0}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Account
            </Button>
             <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => {
                setIsImportDialogOpen(isOpen);
                if (!isOpen) { 
                    setSelectedFile(null);
                    setExcelHeaders([]);
                    setExcelData([]);
                    setColumnMappings({ glAccount: '', subType: '', type: '', fs: '', accountNumber: '' });
                }
             }}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={commonButtonDisabled || selectedItemIds.length > 0}>
                  <Upload className="mr-2 h-4 w-4" /> Import Data
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                  <DialogTitle className="font-headline">Import Chart of Accounts from Excel</DialogTitle>
                  <DialogDescription>
                    Select an Excel file (.xlsx, .xls, .csv) and map columns. Fields marked with * are mandatory.
                    'Type' must be one of: {TYPE_OPTIONS.join(', ')}.
                    'FS' *must* be one of: {FS_OPTIONS.join(', ')}.
                    (Matching for Type & FS is case-insensitive and trims whitespace.)
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
                  {isLoading && selectedFile && (
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
                            onValueChange={(value) => handleMappingChange(targetCol.key, value === SKIP_COLUMN_VALUE ? '' : value)}
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
                    Import & Save Data
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedChartOfAccounts.length === 0 || selectedItemIds.length > 0}>
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
                    placeholder="Search accounts..."
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
              <ListChecks className="inline-block mr-3 h-7 w-7 text-primary" />
              Accounts List
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" /><span className="ml-3 text-muted-foreground">Loading accounts...</span>
              </div>
            ) : chartOfAccounts.length === 0 ? (
                <div className="text-center py-10">
                    <p className="text-muted-foreground mb-4">Your Chart of Accounts is empty. Get started by creating a default set.</p>
                    <Button onClick={handleCreateDefaultCoA} disabled={isLoading}>
                        {isLoading && <LoadingSpinner className="mr-2"/>}
                        Create Default Chart of Accounts
                    </Button>
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
                          disabled={commonButtonDisabled || filteredAndSortedChartOfAccounts.length === 0}
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('glAccount')}>
                        <div className="flex items-center">GL Account <SortIndicator columnKey="glAccount" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('accountNumber')}>
                        <div className="flex items-center">Account Number <SortIndicator columnKey="accountNumber" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('subType')}>
                        <div className="flex items-center">Sub Type <SortIndicator columnKey="subType" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('type')}>
                        <div className="flex items-center">Type <SortIndicator columnKey="type" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => requestSort('fs')}>
                        <div className="flex items-center">FS <SortIndicator columnKey="fs" /></div>
                      </TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedChartOfAccounts.length > 0 ? (
                      filteredAndSortedChartOfAccounts.map((item) => (
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
                          <TableCell>{item.glAccount}</TableCell>
                          <TableCell>{item.accountNumber || '-'}</TableCell>
                          <TableCell>{item.subType}</TableCell>
                          <TableCell>{item.type}</TableCell>
                          <TableCell>{item.fs}</TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteChartOfAccountItem(item.id, item.glAccount)}
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
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                           {searchTerm ? "No accounts match your search." : <span>No chart of account items found. Try importing some or <Button variant="link" className="p-0 h-auto" onClick={() => setIsCreateDialogOpen(true)}>create one</Button>.</span>}
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

      <Dialog open={isCreateDialogOpen} onOpenChange={(isOpen) => {
        setIsCreateDialogOpen(isOpen);
        if (!isOpen) createAccountForm.reset();
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Create New Account</DialogTitle>
            <DialogDescription>
              Fill in the details for the new account. FS mapping is required.
            </DialogDescription>
          </DialogHeader>
          <Form {...createAccountForm}>
            <form onSubmit={createAccountForm.handleSubmit(handleCreateAccountSubmit)} className="grid gap-4 py-4">
              <FormField
                control={createAccountForm.control}
                name="glAccount"
                render={({ field }) => (
                  <FormItem className="grid grid-cols-4 items-center gap-4">
                    <FormLabel className="text-right">GL Account *</FormLabel>
                    <FormControl className="col-span-3">
                      <Input placeholder="E.g., Sales Revenue" {...field} />
                    </FormControl>
                    <FormMessage className="col-span-3 col-start-2" />
                  </FormItem>
                )}
              />
              <FormField
                control={createAccountForm.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem className="grid grid-cols-4 items-center gap-4">
                    <FormLabel className="text-right">Account Number</FormLabel>
                    <FormControl className="col-span-3">
                      <Input placeholder="Optional account code" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage className="col-span-3 col-start-2" />
                  </FormItem>
                )}
              />
              <FormField
                control={createAccountForm.control}
                name="subType"
                render={({ field }) => (
                  <FormItem className="grid grid-cols-4 items-center gap-4">
                    <FormLabel className="text-right">Sub Type *</FormLabel>
                    <FormControl className="col-span-3">
                      <Input placeholder="E.g., Product Sales" {...field} />
                    </FormControl>
                    <FormMessage className="col-span-3 col-start-2" />
                  </FormItem>
                )}
              />
              <FormField
                control={createAccountForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="grid grid-cols-4 items-center gap-4">
                    <FormLabel className="text-right">Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl className="col-span-3">
                        <SelectTrigger>
                          <SelectValue placeholder="Select account type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TYPE_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="col-span-3 col-start-2" />
                  </FormItem>
                )}
              />
              <FormField
                control={createAccountForm.control}
                name="fs"
                render={({ field }) => (
                  <FormItem className="grid grid-cols-4 items-center gap-4">
                    <FormLabel className="text-right">FS *</FormLabel>
                     <Select 
                       onValueChange={field.onChange} 
                       value={field.value || ""}
                     >
                        <FormControl className="col-span-3">
                            <SelectTrigger>
                                <SelectValue placeholder="Select FS Mapping *" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {FS_OPTIONS.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormMessage className="col-span-3 col-start-2" />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {setIsCreateDialogOpen(false); createAccountForm.reset();}}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading && <LoadingSpinner className="mr-2"/>}
                  Create Account
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Bulk Edit Chart of Accounts</DialogTitle>
            <DialogDescription>
              Update fields for {selectedItemIds.length} selected item(s).
              Leave fields blank or select "No Change" to keep original values. FS mapping is required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-glAccount" className="text-right">GL Account</Label>
              <Input
                id="bulk-glAccount"
                value={bulkEditGlAccount}
                onChange={(e) => setBulkEditGlAccount(e.target.value)}
                className="col-span-3"
                placeholder="New GL Account (optional)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-accountNumber" className="text-right">Account No.</Label>
              <Input
                id="bulk-accountNumber"
                value={bulkEditAccountNumber}
                onChange={(e) => setBulkEditAccountNumber(e.target.value)}
                className="col-span-3"
                placeholder="New Account Number (optional)"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-subType" className="text-right">Sub Type</Label>
              <Input
                id="bulk-subType"
                value={bulkEditSubType}
                onChange={(e) => setBulkEditSubType(e.target.value)}
                className="col-span-3"
                placeholder="New Sub Type (optional)"
              />
            </div>
             <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-type" className="text-right">Type</Label>
              <Select
                value={bulkEditType || SELECT_ITEM_NO_CHANGE_VALUE}
                onValueChange={(value) => {
                  setBulkEditType(value === SELECT_ITEM_NO_CHANGE_VALUE ? "" : (value as TypeOption));
                }}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select Type (No Change)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_ITEM_NO_CHANGE_VALUE}><em>(No Change)</em></SelectItem>
                  {TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="bulk-fs" className="text-right">FS *</Label>
               <Select
                value={bulkEditFs || SELECT_ITEM_NO_CHANGE_VALUE}
                onValueChange={(value) => {
                  setBulkEditFs(value === SELECT_ITEM_NO_CHANGE_VALUE ? "" : (value as FSOption));
                }}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select FS (No Change)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_ITEM_NO_CHANGE_VALUE}><em>(No Change)</em></SelectItem>
                  {FS_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkEditDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleSaveBulkEdit} 
              disabled={isLoading || (!bulkEditGlAccount && !bulkEditSubType && !bulkEditType && !bulkEditFs && !bulkEditAccountNumber)}
            >
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
        if (!isOpen) { 
            setImportedCountState(0);
            setSkippedRowsDetail([]);
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Import Summary</DialogTitle>
            <DialogDescription>
              Review the results of your Chart of Accounts import.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p>Successfully imported items: <span className="font-semibold">{importedCountState}</span></p>
            <p>Skipped items (due to missing required data or invalid values): <span className="font-semibold">{skippedRowsDetail.length}</span></p>
            
            {skippedRowsDetail.length > 0 && (
              <div>
                <p className="font-semibold text-sm">Reasons for skipping include:</p>
                <ScrollArea className="h-24 mt-1 border rounded-md p-2">
                  <ul className="list-disc list-inside text-xs">
                    {Array.from(new Set(skippedRowsDetail.map(sr => sr.reason))).slice(0, 5).map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                    {Array.from(new Set(skippedRowsDetail.map(sr => sr.reason))).length > 5 && (
                      <li>And other issues...</li>
                    )}
                  </ul>
                </ScrollArea>
                <p className="text-xs text-muted-foreground mt-1">
                  Skipped rows can be downloaded for review and correction.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="sm:justify-between">
             {skippedRowsDetail.length > 0 ? (
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
