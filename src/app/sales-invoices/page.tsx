
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, PlusCircle, Upload, FileDown, Search, Edit3, Trash2, Library, AlertTriangle, CheckCircle2, AlertCircle, Calendar as CalendarIcon, DollarSign, Undo2, Download, Send } from "lucide-react";
import Link from "next/link";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { ChangeEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp, writeBatch, doc, deleteDoc, addDoc, updateDoc } from "firebase/firestore";
import type { WriteBatch } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format, parse as dateFnsParse, isValid as isDateValid } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { nanoid } from "nanoid";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";


interface SalesInvoiceLineItem {
  localId: string;
  description: string;
  glAccount: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface SalesInvoice {
  id: string;
  createdBy: string;
  companyId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
  date: string; 
  customerName: string;
  invoiceNumber?: string | null;
  dueDate?: string | null; 
  totalAmount: number;
  description?: string | null;
  lineItems: Omit<SalesInvoiceLineItem, 'localId'>[];
  isLedgerApproved: boolean;
  paymentStatus?: "Paid" | "Unpaid";
  paymentDate?: string | null;
  paidFromToBankGL?: string | null;
}

interface ChartOfAccountItem {
  id: string;
  glAccount: string;
  type: string;
  companyId: string;
}

interface PageContactItem {
  id: string;
  name: string;
  type: "Customer" | "Vendor";
  companyId: string;
  email?: string;
}

interface AllTransactionsLedgerItemNoId {
  companyId: string; 
  createdBy: string;
  createdAt: any; 
  updatedBy?: string;
  updatedAt?: Timestamp;
  date: string; 
  description: string;
  source: string; 
  sourceDocId: string; 
  customer: string | null;
  vendor: string | null;
  glAccount: string;
  debitAmount: number | null;
  creditAmount: number | null;

}


async function ensureCustomerExistsAndAddToBatch(
  userId: string,
  companyId: string,
  customerName: string,
  existingContacts: PageContactItem[],
  batch: WriteBatch
): Promise<boolean> {
  if (!userId || !companyId || !customerName || customerName.trim() === "" || customerName.trim() === "-") {
    return false;
  }
  const trimmedCustomerName = customerName.trim();
  const normalizedCustomerName = trimmedCustomerName.toLowerCase();
  
  const contactExists = existingContacts.some(
    (c) => c.name.trim().toLowerCase() === normalizedCustomerName && c.type === "Customer" && c.companyId === companyId
  );

  if (!contactExists) {
    const newContactRef = doc(collection(db, "contacts"));
    batch.set(newContactRef, {
      createdBy: userId,
      companyId,
      name: trimmedCustomerName,
      type: "Customer",
      address: null,
      contactNumber: null,
      email: null,
      createdAt: serverTimestamp(),
    });
    existingContacts.push({ id: newContactRef.id, name: trimmedCustomerName, type: "Customer", companyId });
    return true;
  }
  return false;
}

const addSalesInvoiceToLedger = (batch: WriteBatch, userId: string, companyId: string, invoice: SalesInvoice, accountsReceivableGL: string) => {
  invoice.lineItems.forEach(line => {
    const creditEntry: Omit<AllTransactionsLedgerItemNoId, 'createdAt'> = {
      createdBy: userId,
      companyId,
      date: invoice.date,
      description: `Invoice #${invoice.invoiceNumber || 'N/A'} - ${line.description}`,
      source: "Sales Invoice",
      sourceDocId: invoice.id,
      customer: invoice.customerName,
      vendor: null,
      glAccount: line.glAccount, 
      debitAmount: null,
      creditAmount: line.amount,
    };
    batch.set(doc(collection(db, "all_transactions_ledger")), {...creditEntry, createdAt: serverTimestamp()});
  });

  const debitEntry: Omit<AllTransactionsLedgerItemNoId, 'createdAt'> = {
    createdBy: userId,
    companyId,
    date: invoice.date,
    description: `Invoice #${invoice.invoiceNumber || 'N/A'} to ${invoice.customerName}`,
    source: "Sales Invoice",
    sourceDocId: invoice.id,
    customer: invoice.customerName,
    vendor: null,
    glAccount: accountsReceivableGL, 
    debitAmount: invoice.totalAmount,
    creditAmount: null,
  };
  batch.set(doc(collection(db, "all_transactions_ledger")), {...debitEntry, createdAt: serverTimestamp()});
};


// This function now ONLY deletes the original invoice's ledger entries.
const deleteSalesInvoiceFromLedger = async (userId: string, companyId: string, invoiceId: string, batch?: WriteBatch) => {
  const ledgerQuery = query(
    collection(db, "all_transactions_ledger"),
    where("companyId", "==", companyId),
    where("source", "==", "Sales Invoice"),
    where("sourceDocId", "==", invoiceId)
  );
  const ledgerSnapshot = await getDocs(ledgerQuery);
  const localBatch = batch || writeBatch(db);
  ledgerSnapshot.forEach(docSnap => localBatch.delete(docSnap.ref));
  
  if (!batch) { 
    await localBatch.commit();
  }
};

export default function SalesInvoicesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoadingAction, setIsLoadingAction] = useState(false);

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([]);
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true);
  const [contacts, setContacts] = useState<PageContactItem[]>([]);
  const [isFetchingContacts, setIsFetchingContacts] = useState(true);
  
  const [isCreateInvoiceDialogOpen, setIsCreateInvoiceDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<SalesInvoice | null>(null);

  const [invoiceDate, setInvoiceDate] = useState<Date | undefined>(new Date());
  const [customerName, setCustomerName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [lineItems, setLineItems] = useState<SalesInvoiceLineItem[]>([]);
  
  const [accountsReceivableGL, setAccountsReceivableGL] = useState<string>("");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [lastSelectedInvoiceId, setLastSelectedInvoiceId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);
  const [isBulkPostDialogOpen, setIsBulkPostDialogOpen] = useState(false);
  const [isMarkAsPaidDialogOpen, setIsMarkAsPaidDialogOpen] = useState(false);
  const [isMarkAsUnpaidDialogOpen, setIsMarkAsUnpaidDialogOpen] = useState(false);
  const [paymentDateForDialog, setPaymentDateForDialog] = useState<Date | undefined>(new Date());
  const [bankGLForPaymentDialog, setBankGLForPaymentDialog] = useState<string>("");

  const { selectedCompanyId, selectedCompanyName } = useCompany();
  const { logAction } = useAuditLog();  

  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [emailToSend, setEmailToSend] = useState("");
  const [invoiceToSend, setInvoiceToSend] = useState<SalesInvoice | null>(null);


  const fetchInvoices = useCallback(async () => {
    if (!user || !selectedCompanyId) { setIsFetching(false); return; }
    setIsFetching(true);
    try {
      const q = query(collection(db, "sales_invoices"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const fetchedInvoicesData: SalesInvoice[] = [];
      querySnapshot.forEach((doc) => {
        fetchedInvoicesData.push({ id: doc.id, ...(doc.data() as Omit<SalesInvoice, 'id'>) });
      });
      fetchedInvoicesData.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      setInvoices(fetchedInvoicesData);
    } catch (error) {
      console.error("Error fetching invoices: ", error);
      toast({ title: "Error", description: "Could not fetch sales invoices.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, selectedCompanyId, toast]);

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user || !selectedCompanyId) { setIsFetchingChartOfAccounts(false); return; }
    setIsFetchingChartOfAccounts(true);
    try {
      const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const coa: ChartOfAccountItem[] = [];
      querySnapshot.forEach(doc => coa.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, 'id'>) }));
      coa.sort((a, b) => a.glAccount.localeCompare(b.glAccount));
      setChartOfAccounts(coa);
      const defaultAR = coa.find(acc => acc.glAccount.toLowerCase().includes("accounts receivable") && acc.type.toLowerCase().includes("asset"));
      if (defaultAR) {
         setAccountsReceivableGL(defaultAR.glAccount);
      } else if (coa.length > 0 && !defaultAR) {
        const firstAsset = coa.find(acc => acc.type.toLowerCase().includes("asset"));
        if (firstAsset) setAccountsReceivableGL(firstAsset.glAccount);
        else setAccountsReceivableGL("");
      } else {
        setAccountsReceivableGL("");
      }
    } catch (error) {
      console.error("Error fetching CoA:", error);
      toast({ title: "CoA Error", description: "Could not fetch Chart of Accounts.", variant: "destructive" });
    } finally {
      setIsFetchingChartOfAccounts(false);
    }
  }, [user, selectedCompanyId, toast]);

  const fetchContacts = useCallback(async () => {
    if (!user || !selectedCompanyId) { setIsFetchingContacts(false); return; }
    setIsFetchingContacts(true);
    try {
        const q = query(collection(db, "contacts"),where("companyId", "==", selectedCompanyId));
        const snapshot = await getDocs(q);
        const fetchedContacts: PageContactItem[] = [];
        snapshot.forEach(doc => fetchedContacts.push({ 
          id: doc.id, 
          ...(doc.data() as Omit<PageContactItem, 'id'>)
        }));
        setContacts(fetchedContacts.sort((a,b) => a.name.localeCompare(b.name)));
    } catch (error) {
        console.error("Error fetching contacts:", error);
        toast({title: "Contacts Error", description: "Could not fetch contacts.", variant: "destructive"});
    } finally {
        setIsFetchingContacts(false);
    }
  }, [user, selectedCompanyId, toast]);

  useEffect(() => {
    if(user && selectedCompanyId) {
      fetchInvoices();
      fetchChartOfAccounts();
      fetchContacts();
    }
  }, [user, selectedCompanyId, fetchInvoices, fetchChartOfAccounts, fetchContacts]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice =>
      (invoice.customerName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (invoice.invoiceNumber?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (invoice.description?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
  }, [invoices, searchTerm]);

  const handleOpenCreateInvoiceDialog = (invoiceToEdit: SalesInvoice | null = null) => {
    setEditingInvoice(invoiceToEdit);
    if (invoiceToEdit) {
      setInvoiceDate(dateFnsParse(invoiceToEdit.date, "yyyy-MM-dd", new Date()));
      setCustomerName(invoiceToEdit.customerName);
      setInvoiceNumber(invoiceToEdit.invoiceNumber || "");
      setDueDate(invoiceToEdit.dueDate ? dateFnsParse(invoiceToEdit.dueDate, "yyyy-MM-dd", new Date()) : undefined);
      setInvoiceDescription(invoiceToEdit.description || "");
      setLineItems(invoiceToEdit.lineItems.map(line => ({...line, localId: nanoid()})));
    } else {
      setInvoiceDate(new Date());
      setCustomerName("");
      setInvoiceNumber("");
      setDueDate(undefined);
      setInvoiceDescription("");
      setLineItems([{ localId: nanoid(), description: "", glAccount: "", quantity: 1, unitPrice: 0, amount: 0 }]);
    }
    setIsCreateInvoiceDialogOpen(true);
  };
  
  const handleAddLineItem = () => {
    setLineItems(prev => [...prev, { localId: nanoid(), description: "", glAccount: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const handleRemoveLineItem = (localId: string) => {
    setLineItems(prev => prev.filter(line => line.localId !== localId));
  };

  const handleLineItemChange = (localId: string, field: keyof Omit<SalesInvoiceLineItem, 'localId' | 'amount'>, value: string | number) => {
    setLineItems(prev => prev.map(line => {
      if (line.localId === localId) {
        const updatedLine = { ...line, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          const qty = field === 'quantity' ? Number(value) : line.quantity;
          const price = field === 'unitPrice' ? Number(value) : line.unitPrice;
          updatedLine.amount = isNaN(qty) || isNaN(price) ? 0 : qty * price;
        }
        return updatedLine;
      }
      return line;
    }));
  };

  const totalInvoiceAmountFromLines = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + line.amount, 0);
  }, [lineItems]);

  const isDialogInvoiceFormComplete = useMemo(() => {
    if (!invoiceDate || !customerName.trim() || lineItems.length === 0) return false;
    const allLinesValid = lineItems.every(line =>
        line.description.trim() !== "" &&
        line.glAccount !== "" &&
        Number(line.quantity) > 0 && 
        Number(line.unitPrice) >= 0 
    );
    if (!allLinesValid) return false;
    return totalInvoiceAmountFromLines > 0;
  }, [invoiceDate, customerName, lineItems, totalInvoiceAmountFromLines]);

  const handleSaveInvoice = async () => {
    if (!user || !selectedCompanyId) {
      toast({ title: "Error", description: "User session not found.", variant: "destructive" });
      return;
    }
    if (!isDialogInvoiceFormComplete) {
        toast({ title: "Validation Error", description: "Please ensure all required fields are filled, line items are complete, and total amount is positive.", variant: "destructive" });
        return;
    }
    if (!accountsReceivableGL && !editingInvoice?.isLedgerApproved) {
      toast({ title: "Accounts Receivable GL Required", description: "Please select an Accounts Receivable GL account from settings before saving.", variant: "destructive" });
      return;
    }

    setIsLoadingAction(true);
    
  const invoiceData: Omit<SalesInvoice, 'id' | 'createdAt' | 'paymentStatus' | 'paymentDate' | 'paidFromToBankGL' | 'updatedAt' | 'updatedBy'> = {
    createdBy: user.uid,
    companyId: selectedCompanyId,
    date: format(invoiceDate!, "yyyy-MM-dd"),
    customerName: customerName.trim(),
    invoiceNumber: invoiceNumber.trim() || null,
    dueDate: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
    totalAmount: totalInvoiceAmountFromLines,
    description: invoiceDescription.trim() || null,
    lineItems: lineItems.map(({localId, ...rest}) => rest),
    isLedgerApproved: editingInvoice?.isLedgerApproved || false,
  };
    
    const fullInvoiceData: Omit<SalesInvoice, 'id' | 'createdAt'> = {
      ...invoiceData,
      paymentStatus: editingInvoice?.paymentStatus || "Unpaid",
      paymentDate: editingInvoice?.paymentDate || null,
      paidFromToBankGL: editingInvoice?.paidFromToBankGL || null,
      // updatedAt: serverTimestamp(),
      // updatedBy: user.uid,
  };


    try {
      const batch = writeBatch(db);
      let newCustomerCreated = false;
      const currentContactsForSave = [...contacts]; 

      if (!currentContactsForSave.find(c => c.name.trim().toLowerCase() === fullInvoiceData.customerName.toLowerCase() && c.type === "Customer" && c.companyId === selectedCompanyId)) {
        newCustomerCreated = await ensureCustomerExistsAndAddToBatch(user.uid, selectedCompanyId, fullInvoiceData.customerName, currentContactsForSave, batch);
     }
      
      if (editingInvoice) {
        const invoiceRef = doc(db, "sales_invoices", editingInvoice.id);
        if (editingInvoice.isLedgerApproved) {
          await deleteSalesInvoiceFromLedger(user.uid, selectedCompanyId, editingInvoice.id, batch);
          (fullInvoiceData as SalesInvoice).isLedgerApproved = false;
        }
        batch.update(invoiceRef, fullInvoiceData);
        logAction("update", "sales_invoice", [
          "date", "customerName", "invoiceNumber", "dueDate", 
          "totalAmount", "description", "lineItems", "isLedgerApproved"
        ]);
        toast({ title: "Invoice Updated", description: `Invoice for ${fullInvoiceData.customerName} updated. ${editingInvoice.isLedgerApproved ? 'Ledger posting reset.' : ''}` });
      } else {
        const newInvoiceRef = doc(collection(db, "sales_invoices"));
        batch.set(newInvoiceRef, { ...fullInvoiceData, createdAt: serverTimestamp() });
        logAction("create", "sales_invoice", [
          "date", "customerName", "invoiceNumber", "dueDate", 
          "totalAmount", "description", "lineItems"
        ]);
        toast({ title: "Invoice Created", description: `New invoice for ${fullInvoiceData.customerName} created.` });
      }
      await batch.commit();
      await fetchInvoices();
      if (newCustomerCreated) await fetchContacts(); 
      setIsCreateInvoiceDialogOpen(false);
    } catch (error) {
      console.error("Error saving invoice:", error);
      toast({ title: "Save Error", description: "Could not save the invoice.", variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!user || !selectedCompanyId) return;
    setIsLoadingAction(true);
    try {
      const invoiceToDelete = invoices.find(inv => inv.id === invoiceId);
      const batch = writeBatch(db);
       // If it's approved, delete its ledger entries too
       if (invoiceToDelete?.isLedgerApproved) {
        await deleteSalesInvoiceFromLedger(user.uid, selectedCompanyId, invoiceId, batch);
        const paymentLedgerQuery = query(
            collection(db, "all_transactions_ledger"),
            where("companyId", "==", selectedCompanyId),
            where("source", "==", "Sales Invoice Payment"),
            where("sourceDocId", "==", invoiceId)
        );
        const paymentLedgerSnapshot = await getDocs(paymentLedgerQuery);
        paymentLedgerSnapshot.forEach(docSnap => batch.delete(docSnap.ref));
      }

      batch.delete(doc(db, "sales_invoices", invoiceId));
      logAction("delete", "sales_invoice", [
        "date", "customerName", "invoiceNumber", "totalAmount"
      ]);
      await batch.commit();
      toast({ title: "Invoice Deleted", description: "The sales invoice has been removed." });
      await fetchInvoices();
      setSelectedInvoiceIds(prev => prev.filter(id => id !== invoiceId));
    } catch (error) {
      console.error("Error deleting invoice: ", error);
      toast({ title: "Delete Error", description: "Could not delete the invoice.", variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
    }
  };


  const handlePostInvoiceToLedger = async (invoiceId: string) => {
    if (!user || !selectedCompanyId) return;
    const invoiceToPost = invoices.find(inv => inv.id === invoiceId);
    if (!invoiceToPost || invoiceToPost.isLedgerApproved) {
      toast({ title: "Invalid Action", description: "Invoice not found or already approved.", variant: "destructive"});
      return;
    }
    if (!accountsReceivableGL) {
      toast({ title: "Accounts Receivable GL Required", description: "Please select an Accounts Receivable GL account from settings.", variant: "destructive" });
      return;
    }
    setIsLoadingAction(true);
    try {
      const batch = writeBatch(db);
      addSalesInvoiceToLedger(batch, user.uid, selectedCompanyId, invoiceToPost, accountsReceivableGL);
      batch.update(doc(db, "sales_invoices", invoiceId), { 
        isLedgerApproved: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      
      logAction("post_to_ledger", "sales_invoice", [
        "isLedgerApproved", "ledgerEntries"
      ]);
      
      await batch.commit();
      toast({ title: "Invoice Posted", description: `Invoice ${invoiceToPost.invoiceNumber || invoiceToPost.id.substring(0,5)} posted to ledger.` });
      await fetchInvoices();
    } catch (error) {
      console.error("Error posting invoice:", error);
      toast({ title: "Posting Error", description: "Could not post invoice to ledger.", variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
    }
  };
  
  const handleUnpostInvoiceFromLedger = async (invoiceId: string) => {
    if (!user || !selectedCompanyId) return;
    const invoiceToUnpost = invoices.find(inv => inv.id === invoiceId);
    if (!invoiceToUnpost || !invoiceToUnpost.isLedgerApproved) {
      toast({ title: "Invalid Action", description: "Invoice not found or not approved.", variant: "destructive"});
      return;
    }
    setIsLoadingAction(true);
    try {
        const batch = writeBatch(db);
        await deleteSalesInvoiceFromLedger(user.uid, selectedCompanyId, invoiceId, batch);
        batch.update(doc(db, "sales_invoices", invoiceId), { 
          isLedgerApproved: false,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        });
        
        logAction("unpost_from_ledger", "sales_invoice", [
          "isLedgerApproved", "ledgerEntries"
        ]);
        
        await batch.commit();
        toast({ title: "Invoice Unposted", description: `Invoice ${invoiceToUnpost.invoiceNumber || invoiceToUnpost.id.substring(0,5)} unposted from ledger.` });
        await fetchInvoices();
    } catch(error) {
        console.error("Error unposting invoice:", error);
        toast({ title: "Unposting Error", description: "Could not unpost invoice.", variant: "destructive"});
    } finally {
        setIsLoadingAction(false);
    }
  };


  const handleToggleSelectInvoice = (invoiceId: string, checked: boolean, isShiftEvent: boolean) => {
    setSelectedInvoiceIds(prevSelectedIds => {
      if (isShiftEvent && lastSelectedInvoiceId && lastSelectedInvoiceId !== invoiceId) {
        const currentIndex = filteredInvoices.findIndex(inv => inv.id === invoiceId);
        const lastIndex = filteredInvoices.findIndex(inv => inv.id === lastSelectedInvoiceId);
        if (currentIndex === -1 || lastIndex === -1) { 
          return checked ? [...prevSelectedIds, invoiceId] : prevSelectedIds.filter(id => id !== invoiceId);
        }
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const idsInRange = filteredInvoices.slice(start, end + 1).map(inv => inv.id);
        return checked ? Array.from(new Set([...prevSelectedIds, ...idsInRange])) : prevSelectedIds.filter(id => !idsInRange.includes(id));
      } else { 
        if (!isShiftEvent) setLastSelectedInvoiceId(invoiceId);
        return checked ? [...prevSelectedIds, invoiceId] : prevSelectedIds.filter(id => id !== invoiceId);
      }
    });
  };

  const handleToggleSelectAllInvoices = (checked: boolean) => {
    setSelectedInvoiceIds(checked ? filteredInvoices.map(inv => inv.id) : []);
    setLastSelectedInvoiceId(null);
  };
  
  const handleConfirmBulkPostToLedger = async () => {
    if (!user || !selectedCompanyId || selectedInvoiceIds.length === 0) return;
    setIsLoadingAction(true);

    const invoicesToPost = invoices.filter(inv => selectedInvoiceIds.includes(inv.id) && !inv.isLedgerApproved);
    if (invoicesToPost.length === 0) {
      toast({ title: "No Action Needed", description: "Selected invoices are already posted or none were selected for posting.", variant: "default" });
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
      return;
    }
    if (!accountsReceivableGL) {
      toast({ title: "A/R GL Account Required", description: "Please select an Accounts Receivable GL account from settings before bulk posting.", variant: "destructive" });
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
      return;
    }

    let postedCount = 0;
    let customerContactsCreated = 0;
    const currentContactsForBulkPost = [...contacts];
    try {
      const batch = writeBatch(db);
      for (const invoice of invoicesToPost) {
        const newCustomerCreated = await ensureCustomerExistsAndAddToBatch(user.uid, selectedCompanyId, invoice.customerName, currentContactsForBulkPost, batch);
        if(newCustomerCreated) customerContactsCreated++;

        addSalesInvoiceToLedger(batch, user.uid, selectedCompanyId, invoice, accountsReceivableGL);
        batch.update(doc(db, "sales_invoices", invoice.id), { 
          isLedgerApproved: true,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        });
        postedCount++;
      }
      
      if (postedCount > 0 || customerContactsCreated > 0) {
        logAction("bulk_post_to_ledger", "sales_invoice", [
          `postedCount:${postedCount}`, `contactsCreated:${customerContactsCreated}`
        ]);
        await batch.commit();
      }
      
      let successMsg = `${postedCount} invoice(s) posted to ledger.`;
      if (customerContactsCreated > 0) {
        successMsg += ` ${customerContactsCreated} new customer contact(s) auto-created.`;
      }
      toast({ title: "Bulk Post Successful", description: successMsg });
      await fetchInvoices();
      if (customerContactsCreated > 0) await fetchContacts();
      setSelectedInvoiceIds([]);
    } catch (error) {
      console.error("Error during bulk posting invoices:", error);
      toast({ title: "Bulk Post Error", description: "An error occurred during bulk posting.", variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
    }
  };
  
  const handleOpenMarkAsPaidDialog = () => {
    const unpaidSelected = selectedInvoiceIds.filter(id => {
        const inv = invoices.find(i => i.id === id);
        return inv && inv.paymentStatus !== "Paid";
    }).length;

    if (unpaidSelected === 0) {
        toast({title: "No Unpaid Invoices Selected", description: "Please select one or more unpaid invoices to mark as paid.", variant:"default"});
        return;
    }
    setPaymentDateForDialog(new Date());
    setBankGLForPaymentDialog("");
    setIsMarkAsPaidDialogOpen(true);
  };

  const handleConfirmMarkAsPaid = async () => {
    if (!user || !selectedCompanyId || !paymentDateForDialog || !bankGLForPaymentDialog) {
      toast({ title: "Missing Information", description: "Please select a payment date and a bank GL account.", variant: "destructive" });
      return;
    }
    if (!accountsReceivableGL) {
      toast({ title: "A/R GL Account Missing", description: "Default Accounts Receivable GL is not set. Please configure it.", variant: "destructive" });
      return;
    }

    setIsLoadingAction(true);
    const batch = writeBatch(db);
    let paidCount = 0;
    const formattedPaymentDate = format(paymentDateForDialog, "yyyy-MM-dd");

    for (const invoiceId of selectedInvoiceIds) {
      const invoice = invoices.find(inv => inv.id === invoiceId);
      if (invoice && invoice.paymentStatus !== "Paid") {
        // 1. Create Bank Transaction
        const bankTransactionRef = doc(collection(db, "transactions"));
        batch.set(bankTransactionRef, {
          createdBy: user.uid,
          companyId: selectedCompanyId,
          date: formattedPaymentDate,
          description: `Payment for Inv #${invoice.invoiceNumber || invoice.id.substring(0,5)} from ${invoice.customerName}`,
          bankName: bankGLForPaymentDialog,
          vendor: invoice.customerName, 
          glAccount: accountsReceivableGL,
          amountReceived: invoice.totalAmount,
          amountPaid: null,
          createdAt: serverTimestamp(),
          isLedgerApproved: true,
          source: "Sales Invoice Payment",
          sourceDocId: invoice.id,
        });

        // 2. Update Invoice Status
        const invoiceRef = doc(db, "sales_invoices", invoice.id);
        batch.update(invoiceRef, {
          paymentStatus: "Paid",
          paymentDate: formattedPaymentDate,
          paidFromToBankGL: bankGLForPaymentDialog,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        });

        // 3. Create Ledger Entries for Payment
        const debitLedgerEntry: Omit<AllTransactionsLedgerItemNoId, 'createdAt'> = {
          createdBy: user.uid,
          companyId: selectedCompanyId,
          date: formattedPaymentDate,
          description: `Payment received for Invoice #${invoice.invoiceNumber || invoice.id.substring(0,5)}`,
          source: "Sales Invoice Payment",
          sourceDocId: invoice.id, 
          customer: invoice.customerName,
          vendor: null,
          glAccount: bankGLForPaymentDialog,
          debitAmount: invoice.totalAmount,
          creditAmount: null,
        };
        batch.set(doc(collection(db, "all_transactions_ledger")), {...debitLedgerEntry, createdAt: serverTimestamp()});

        const creditLedgerEntry: Omit<AllTransactionsLedgerItemNoId, 'createdAt'> = {
          createdBy: user.uid,
          companyId: selectedCompanyId,
          date: formattedPaymentDate,
          description: `Payment applied for Invoice #${invoice.invoiceNumber || invoice.id.substring(0,5)}`,
          source: "Sales Invoice Payment",
          sourceDocId: invoice.id, 
          customer: invoice.customerName,
          vendor: null,
          glAccount: accountsReceivableGL,
          debitAmount: null,
          creditAmount: invoice.totalAmount,
        };
        batch.set(doc(collection(db, "all_transactions_ledger")), {...creditLedgerEntry, createdAt: serverTimestamp()});
        paidCount++;
      }
    }

    if (paidCount > 0) {
      try {
        logAction("bulk_mark_as_paid", "sales_invoice", [
          `paidCount:${paidCount}`, `bankGL:${bankGLForPaymentDialog}`
        ]);
        await batch.commit();
        toast({ title: "Payment Recorded", description: `${paidCount} invoice(s) marked as paid. Corresponding bank transaction auto-approved for ledger.` });
        await fetchInvoices();
        setSelectedInvoiceIds([]);
      } catch (error) {
        console.error("Error marking invoices as paid:", error);
        toast({ title: "Payment Error", description: "Could not mark invoices as paid.", variant: "destructive" });
      }
    } else {
      toast({ title: "No Action", description: "No unpaid invoices were selected or no changes made." });
    }
    setIsLoadingAction(false);
    setIsMarkAsPaidDialogOpen(false);
  };
  
  const handleOpenMarkAsUnpaidDialog = (invoice: SalesInvoice) => {
    setEditingInvoice(invoice);
    setIsMarkAsUnpaidDialogOpen(true);
  };

  const handleConfirmMarkAsUnpaid = async () => {
    if (!user || !selectedCompanyId || !editingInvoice) return;
    setIsLoadingAction(true);
    
    const batch = writeBatch(db);
    let bankTxFoundAndDeleted = false;

    try {
      // 1. Delete associated ledger entries for the payment ONLY
      const paymentLedgerQuery = query(
        collection(db, "all_transactions_ledger"),
        where("companyId", "==", selectedCompanyId),
        where("source", "==", "Sales Invoice Payment"),
        where("sourceDocId", "==", editingInvoice.id)
      );
      const paymentLedgerSnapshot = await getDocs(paymentLedgerQuery);
      paymentLedgerSnapshot.forEach(docSnap => batch.delete(docSnap.ref));

      // 2. Try to find and delete the associated bank transaction
      const transactionQuery = query(
        collection(db, "transactions"),
        where("companyId", "==", selectedCompanyId),
        where("source", "==", "Sales Invoice Payment"),
        where("sourceDocId", "==", editingInvoice.id)
      );
      const transactionSnapshot = await getDocs(transactionQuery);
      transactionSnapshot.forEach(doc => {
          batch.delete(doc.ref);
          bankTxFoundAndDeleted = true;
      });

      // 3. Update the invoice status
      const invoiceRef = doc(db, "sales_invoices", editingInvoice.id);
      batch.update(invoiceRef, {
        paymentStatus: "Unpaid",
        paymentDate: null,
        paidFromToBankGL: null,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });

      logAction("mark_as_unpaid", "sales_invoice", [
        "paymentStatus", "paymentDate", "paidFromToBankGL"
      ]);
      
      await batch.commit();
      
      let toastDescription = "Invoice has been marked as unpaid and payment ledger entries reversed.";
      if (!bankTxFoundAndDeleted) {
        toastDescription += " Please manually delete the corresponding deposit from Bank Transactions if it exists.";
      }
      toast({ title: "Invoice Marked as Unpaid", description: toastDescription });
      
      await fetchInvoices();
      setSelectedInvoiceIds(prev => prev.filter(id => id !== editingInvoice!.id));
    } catch (error) {
      console.error("Error marking invoice as unpaid:", error);
      toast({ title: "Error", description: "Could not mark invoice as unpaid.", variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
      setIsMarkAsUnpaidDialogOpen(false);
      setEditingInvoice(null);
    }
  };

  const handleDownloadInvoicePDF = (invoice: SalesInvoice) => {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
    let currentY = 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(selectedCompanyName || user?.displayName || 'Your Company', 20, currentY);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(user?.email || '', 20, currentY + 7);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text('INVOICE', pageWidth - 20, currentY, { align: 'right' });
    currentY += 15;

    doc.setLineWidth(0.5);
    doc.line(20, currentY, pageWidth - 20, currentY);
    currentY += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO:', 20, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.customerName, 20, currentY + 5);

    doc.setFont('helvetica', 'bold');
    doc.text('Invoice #:', pageWidth - 60, currentY);
    doc.text('Date:', pageWidth - 60, currentY + 5);
    doc.text('Due Date:', pageWidth - 60, currentY + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.invoiceNumber || invoice.id.substring(0, 8), pageWidth - 20, currentY, { align: 'right' });
    doc.text(format(dateFnsParse(invoice.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy"), pageWidth - 20, currentY + 5, { align: 'right' });
    doc.text(invoice.dueDate ? format(dateFnsParse(invoice.dueDate, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : 'N/A', pageWidth - 20, currentY + 10, { align: 'right' });
    currentY += 20;

    const tableColumn = ["Description", "Quantity", "Unit Price", "Amount"];
    const tableRows = invoice.lineItems.map(item => [
      item.description,
      item.quantity.toString(),
      `$${item.unitPrice.toFixed(2)}`,
      `$${item.amount.toFixed(2)}`
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: currentY,
      headStyles: { fillColor: [255, 98, 29] }, 
      theme: 'grid',
    });
    
    const finalY = (doc as any).lastAutoTable.finalY;
    currentY = finalY + 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Total:', pageWidth - 60, currentY);
    doc.text(`$${invoice.totalAmount.toFixed(2)}`, pageWidth - 20, currentY, { align: 'right' });
    currentY += 15;

    if (currentY > pageHeight - 30) {
        doc.addPage();
        currentY = 20;
    }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('Thank you for your business!', pageWidth / 2, currentY, { align: 'center' });

    doc.save(`Invoice-${invoice.invoiceNumber || invoice.id.substring(0, 5)}.pdf`);
    toast({ title: "PDF Generated", description: "Your invoice PDF has started downloading." });
  };

  const handleOpenEmailDialog = (invoice: SalesInvoice) => {
    const contact = contacts.find(c => c.name === invoice.customerName);
    setEmailToSend(contact?.email || "");
    setInvoiceToSend(invoice);
    setIsEmailDialogOpen(true);
  };
  
  const handleSendEmail = async () => {
    if (!invoiceToSend || !emailToSend) {
      toast({ title: "Missing Information", description: "Customer email is required.", variant: "destructive" });
      return;
    }
    setIsLoadingAction(true);
    try {
      const response = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          invoice: invoiceToSend, 
          customerEmail: emailToSend,
          companyName: selectedCompanyName,
          userEmail: user?.email
        }),
      });
  
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to send email.');
      }
      
      toast({ title: "Email Sent", description: `Invoice successfully sent to ${emailToSend}.` });
      setIsEmailDialogOpen(false);
      setInvoiceToSend(null);
      setEmailToSend("");
  
    } catch (error) {
      console.error("Error sending invoice email:", error);
      toast({ title: "Email Error", description: error.message, variant: "destructive" });
    } finally {
      setIsLoadingAction(false);
    }
  };


  const handleComingSoon = (featureName: string) => {
    toast({
      title: "Coming Soon!",
      description: `${featureName} functionality will be available soon.`,
    });
  };

  const commonButtonDisabled = isFetching || isFetchingChartOfAccounts || isFetchingContacts || isLoadingAction || isBulkPostDialogOpen || isMarkAsPaidDialogOpen || isMarkAsUnpaidDialogOpen;
  const customerContacts = useMemo(() => contacts.filter(c => c.type === "Customer"), [contacts]);
  const revenueGLAccounts = useMemo(() => chartOfAccounts.filter(acc => acc.type.toLowerCase().includes("income") || acc.type.toLowerCase().includes("revenue")), [chartOfAccounts]);
  const bankAssetGLAccounts = useMemo(() => chartOfAccounts.filter(acc => acc.type.toLowerCase() === "current asset"), [chartOfAccounts]);

  const isSelectAllChecked = useMemo(() => {
    if (filteredInvoices.length === 0) return false;
    return filteredInvoices.every(inv => selectedInvoiceIds.includes(inv.id));
  }, [filteredInvoices, selectedInvoiceIds]);
  const canBulkPost = useMemo(() => selectedInvoiceIds.some(id => invoices.find(inv => inv.id === id && !inv.isLedgerApproved)), [selectedInvoiceIds, invoices]);
  const canMarkAsPaid = useMemo(() => selectedInvoiceIds.some(id => {
    const inv = invoices.find(i => i.id === id);
    return inv && inv.paymentStatus !== "Paid";
  }), [selectedInvoiceIds, invoices]);

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <FileText className="mr-3 h-10 w-10 text-primary" /> Sales Invoices
            </h1>
            <p className="text-lg text-muted-foreground">Create, send, and manage customer invoices.</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button onClick={() => handleOpenCreateInvoiceDialog()} disabled={commonButtonDisabled || isFetchingChartOfAccounts || isFetchingContacts}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Invoice
            </Button>
            <Button variant="outline" onClick={() => handleComingSoon("Import Invoices")} disabled={commonButtonDisabled}>
              <Upload className="mr-2 h-4 w-4" /> Import
            </Button>
            <Button variant="outline" asChild><Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Dashboard</Link></Button>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                    type="search"
                    placeholder="Search invoices..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    disabled={commonButtonDisabled}
                />
            </div>
            <div className="max-w-xs">
                <Label htmlFor="ar-gl-select" className="text-xs text-muted-foreground">Default Accounts Receivable GL:</Label>
                <Select
                    value={accountsReceivableGL}
                    onValueChange={setAccountsReceivableGL}
                    disabled={commonButtonDisabled || isFetchingChartOfAccounts || chartOfAccounts.filter(acc => acc.type.toLowerCase().includes("asset")).length === 0}
                >
                    <SelectTrigger id="ar-gl-select" className="h-9 text-sm">
                        <SelectValue placeholder={isFetchingChartOfAccounts ? "Loading..." : (chartOfAccounts.filter(acc => acc.type.toLowerCase().includes("asset")).length === 0 ? "No Asset GLs" : "Select A/R GL")} />
                    </SelectTrigger>
                    <SelectContent>
                        {chartOfAccounts.filter(acc => acc.type.toLowerCase().includes("asset")).map(acc => (
                            <SelectItem key={acc.id} value={acc.glAccount}>{acc.glAccount}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Required for creating/posting new invoices.</p>
            </div>
            {selectedInvoiceIds.length > 0 && (
                <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between mt-4 sm:mt-0 sm:ml-4 flex-grow w-full sm:w-auto">
                    <span className="text-sm font-medium">{selectedInvoiceIds.length} invoice(s) selected</span>
                    <div className="space-x-2">
                        <Button size="sm" variant="outline" onClick={handleOpenMarkAsPaidDialog} disabled={commonButtonDisabled || !canMarkAsPaid}>
                           <DollarSign className="mr-2 h-4 w-4" /> Mark as Paid
                        </Button>
                        <Button size="sm" variant="default" onClick={() => setIsBulkPostDialogOpen(true)} disabled={commonButtonDisabled || !canBulkPost}>
                            <Library className="mr-2 h-4 w-4" /> Post Selected
                        </Button>
                    </div>
                </div>
            )}
        </div>

        <Card className="shadow-lg">
          <CardHeader><CardTitle>Invoice List</CardTitle></CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10"><LoadingSpinner size="lg" /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                            checked={isSelectAllChecked}
                            onCheckedChange={(checked) => handleToggleSelectAllInvoices(Boolean(checked))}
                            aria-label="Select all invoices"
                            disabled={commonButtonDisabled || filteredInvoices.length === 0}
                        />
                      </TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-center">Payment Status</TableHead>
                      <TableHead className="text-center">Ledger Status</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.length > 0 ? (
                      filteredInvoices.map((invoice) => (
                        <TableRow key={invoice.id} data-state={selectedInvoiceIds.includes(invoice.id) ? "selected" : ""}>
                          <TableCell>
                            <Checkbox
                                checked={selectedInvoiceIds.includes(invoice.id)}
                                onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => setIsShiftKeyPressed(e.shiftKey)}
                                onCheckedChange={(checked, event) => 
                                    handleToggleSelectInvoice(
                                        invoice.id, 
                                        Boolean(checked), 
                                        isShiftKeyPressed || (event as unknown as React.MouseEvent<HTMLButtonElement>)?.nativeEvent?.shiftKey
                                    )
                                }
                                aria-labelledby={`select-invoice-${invoice.id}`}
                                disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell>{invoice.date ? format(dateFnsParse(invoice.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : ""}</TableCell>
                          <TableCell>{invoice.customerName}</TableCell>
                          <TableCell>{invoice.invoiceNumber || '-'}</TableCell>
                          <TableCell>{invoice.dueDate ? format(dateFnsParse(invoice.dueDate, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : '-'}</TableCell>
                          <TableCell className="text-right">${invoice.totalAmount.toFixed(2)}</TableCell>
                          <TableCell className="text-center">
                            {invoice.paymentStatus === "Paid" ? (
                                <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">Paid</Badge>
                            ) : (
                                <Badge variant="outline" className="border-amber-500 text-amber-600">Unpaid</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {invoice.isLedgerApproved ? (
                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-300"><CheckCircle2 className="mr-1 h-3 w-3" /> Approved</Badge>
                            ) : (
                                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300"><AlertCircle className="mr-1 h-3 w-3" /> Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => handleDownloadInvoicePDF(invoice)} disabled={isLoadingAction} title="Download PDF"><Download className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleOpenEmailDialog(invoice)} disabled={isLoadingAction} title="Send Email"><Send className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleOpenCreateInvoiceDialog(invoice)} disabled={isLoadingAction || selectedInvoiceIds.length > 0 || invoice.paymentStatus === "Paid"} title={invoice.paymentStatus === "Paid" ? "Unmark as paid to edit" : "Edit Invoice"}><Edit3 className="h-4 w-4" /></Button>
                            
                            {invoice.paymentStatus === "Paid" ? (
                                <Button variant="ghost" size="icon" onClick={() => handleOpenMarkAsUnpaidDialog(invoice)} disabled={isLoadingAction || selectedInvoiceIds.length > 0} title="Unmark as Paid"><Undo2 className="h-4 w-4 text-orange-500" /></Button>
                            ) : !invoice.isLedgerApproved ? (
                                <Button variant="ghost" size="icon" onClick={() => handlePostInvoiceToLedger(invoice.id)} disabled={isLoadingAction || !accountsReceivableGL || selectedInvoiceIds.length > 0} title={!accountsReceivableGL ? "Select A/R GL first" : "Post to Ledger"}><Library className="h-4 w-4 text-green-600" /></Button>
                            ) : (
                                <Button variant="ghost" size="icon" onClick={() => handleUnpostInvoiceFromLedger(invoice.id)} disabled={isLoadingAction || selectedInvoiceIds.length > 0 || invoice.paymentStatus === "Paid"} title={invoice.paymentStatus === "Paid" ? "Cannot unpost paid invoice" : "Unpost from Ledger"}><AlertTriangle className="h-4 w-4 text-orange-500" /></Button>
                            )}
                            
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteInvoice(invoice.id)} disabled={isLoadingAction || selectedInvoiceIds.length > 0 || invoice.paymentStatus === "Paid"} title={invoice.paymentStatus === "Paid" ? "Unmark as paid to delete" : "Delete Invoice"}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={9} className="text-center py-10">No invoices found.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Other Dialogs (Create, Bulk Post, Mark Paid, etc.) would go here... */}
        <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline">Send Invoice to Customer</DialogTitle>
              <DialogDescription>
                Confirm the email address to send the invoice for {invoiceToSend?.customerName}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Label htmlFor="customer-email">Customer Email</Label>
              <Input
                id="customer-email"
                type="email"
                value={emailToSend}
                onChange={(e) => setEmailToSend(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEmailDialogOpen(false)} disabled={isLoadingAction}>Cancel</Button>
              <Button onClick={handleSendEmail} disabled={isLoadingAction || !emailToSend}>
                {isLoadingAction ? <LoadingSpinner className="mr-2" /> : "Send Email"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AuthGuard>
  );
}

    
