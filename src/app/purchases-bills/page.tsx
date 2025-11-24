"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  ReceiptText,
  PlusCircle,
  Upload,
  FileDown,
  Search,
  Edit3,
  Trash2,
  Library,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  DollarSign,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { ChangeEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db, serverTimestamp } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  writeBatch,
  doc,
  deleteDoc,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import type { WriteBatch } from "firebase/firestore";
import LoadingSpinner from "@/components/ui/loading-spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  format,
  parse as dateFnsParse,
  isValid as isDateValid,
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { nanoid } from "nanoid";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";

interface PurchaseBillLineItem {
  localId: string;
  description: string;
  glAccount: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface PurchaseBill {
  id: string;
  companyId: string;
  createdBy: string;
  updatedBy?: string;
  updatedAt?: Timestamp;
  date: string;
  vendorName: string;
  billNumber?: string | null;
  dueDate?: string | null;
  totalAmount: number;
  description?: string | null;
  lineItems: Omit<PurchaseBillLineItem, "localId">[];
  isLedgerApproved: boolean;
  createdAt: Timestamp;
  paymentStatus?: "Paid" | "Unpaid";
  paymentDate?: string | null;
  paidFromToBankGL?: string | null;
}

interface ChartOfAccountItem {
  id: string;
  companyId: string;
  glAccount: string;
  type: string;
}

interface PageContactItem {
  id: string;
  name: string;
  type: "Customer" | "Vendor";
}

interface AllTransactionsLedgerItemNoId {
  companyId: string;
  createdBy: string;
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
  createdAt: any;
}

async function ensureVendorExistsAndAddToBatch(
  companyId: string,
  createdBy: string,
  vendorName: string,
  existingContacts: PageContactItem[],
  batch: WriteBatch
): Promise<boolean> {
  if (
    !companyId ||
    !vendorName ||
    vendorName.trim() === "" ||
    vendorName.trim() === "-"
  ) {
    return false;
  }
  const trimmedVendorName = vendorName.trim();
  const normalizedVendorName = trimmedVendorName.toLowerCase();

  const contactExists = existingContacts.some(
    (c) =>
      c.name.trim().toLowerCase() === normalizedVendorName &&
      c.type === "Vendor"
  );

  if (!contactExists) {
    const newContactRef = doc(collection(db, "contacts"));
    batch.set(newContactRef, {
      companyId,
      createdBy,
      name: trimmedVendorName,
      type: "Vendor",
      address: null,
      contactNumber: null,
      email: null,
      createdAt: serverTimestamp(),
    });
    existingContacts.push({
      id: newContactRef.id,
      name: trimmedVendorName,
      type: "Vendor",
    });
    return true;
  }
  return false;
}

const addPurchaseBillToLedger = (
  batch: WriteBatch,
  companyId: string,
  createdBy: string,
  bill: PurchaseBill,
  accountsPayableGL: string
) => {
  bill.lineItems.forEach((line) => {
    const debitEntry: AllTransactionsLedgerItemNoId = {
      companyId,
      createdBy,
      date: bill.date,
      description: `Bill #${bill.billNumber || "N/A"} - ${line.description}`,
      source: "Purchase Bill",
      sourceDocId: bill.id,
      customer: null,
      vendor: bill.vendorName,
      glAccount: line.glAccount,
      debitAmount: line.amount,
      creditAmount: null,
      createdAt: serverTimestamp(),
    };
    batch.set(doc(collection(db, "all_transactions_ledger")), debitEntry);
  });

  const creditEntry: AllTransactionsLedgerItemNoId = {
    companyId,
    createdBy,
    date: bill.date,
    description: `Bill #${bill.billNumber || "N/A"} from ${bill.vendorName}`,
    source: "Purchase Bill",
    sourceDocId: bill.id,
    customer: null,
    vendor: bill.vendorName,
    glAccount: accountsPayableGL,
    debitAmount: null,
    creditAmount: bill.totalAmount,
    createdAt: serverTimestamp(),
  };
  batch.set(doc(collection(db, "all_transactions_ledger")), creditEntry);
};

// This function now ONLY deletes the original bill's ledger entries.
const deletePurchaseBillFromLedger = async (
  companyId: string,
  billId: string,
  batch?: WriteBatch
) => {
  const ledgerQuery = query(
    collection(db, "all_transactions_ledger"),
    where("companyId", "==", companyId),
    where("source", "==", "Purchase Bill"),
    where("sourceDocId", "==", billId)
  );
  const ledgerSnapshot = await getDocs(ledgerQuery);

  const localBatch = batch || writeBatch(db);
  ledgerSnapshot.forEach((docSnap) => localBatch.delete(docSnap.ref));

  if (!batch) {
    await localBatch.commit();
  }
};

export default function PurchasesBillsPage() {
  const { user, viewingAsClientInfo } = useAuth();
  const { toast } = useToast();
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoadingAction, setIsLoadingAction] = useState(false);

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>(
    []
  );
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] =
    useState(true);
  const [contacts, setContacts] = useState<PageContactItem[]>([]);
  const [isFetchingContacts, setIsFetchingContacts] = useState(true);

  const [isCreateBillDialogOpen, setIsCreateBillDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<PurchaseBill | null>(null);

  const [billDate, setBillDate] = useState<Date | undefined>(new Date());
  const [vendorName, setVendorName] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [billDescription, setBillDescription] = useState("");
  const [lineItems, setLineItems] = useState<PurchaseBillLineItem[]>([]);

  const [accountsPayableGL, setAccountsPayableGL] = useState<string>("");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [lastSelectedBillId, setLastSelectedBillId] = useState<string | null>(
    null
  );
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);
  const [isBulkPostDialogOpen, setIsBulkPostDialogOpen] = useState(false);
  const [isMarkAsPaidDialogOpen, setIsMarkAsPaidDialogOpen] = useState(false);

  const [isMarkAsUnpaidDialogOpen, setIsMarkAsUnpaidDialogOpen] =
    useState(false);

  const { selectedCompanyId } = useCompany();
  const { logAction } = useAuditLog();
  const [paymentDateForDialog, setPaymentDateForDialog] = useState<
    Date | undefined
  >(new Date());
  const [bankGLForPaymentDialog, setBankGLForPaymentDialog] =
    useState<string>("");

  const activeUserId = useMemo(
    () => viewingAsClientInfo?.id || user?.uid,
    [user, viewingAsClientInfo]
  );

  const fetchBills = useCallback(async () => {
    if (!selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(
        collection(db, "purchase_bills"),
        where("companyId", "==", selectedCompanyId)
      );
      const querySnapshot = await getDocs(q);
      const fetchedBillsData: PurchaseBill[] = [];
      querySnapshot.forEach((doc) => {
        fetchedBillsData.push({
          id: doc.id,
          ...(doc.data() as Omit<PurchaseBill, "id">),
        });
      });
      fetchedBillsData.sort(
        (a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()
      );
      setBills(fetchedBillsData);
    } catch (error) {
      console.error("Error fetching bills: ", error);
      toast({
        title: "Error",
        description: "Could not fetch purchase bills.",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }, [selectedCompanyId, toast]);

  const fetchChartOfAccounts = useCallback(async () => {
    if (!selectedCompanyId) {
      setIsFetchingChartOfAccounts(false);
      return;
    }
    setIsFetchingChartOfAccounts(true);
    try {
      const q = query(
        collection(db, "chartOfAccounts"),
        where("companyId", "==", selectedCompanyId)
      );
      const querySnapshot = await getDocs(q);
      const coa: ChartOfAccountItem[] = [];
      querySnapshot.forEach((doc) =>
        coa.push({
          id: doc.id,
          ...(doc.data() as Omit<ChartOfAccountItem, "id">),
        })
      );
      coa.sort((a, b) => a.glAccount.localeCompare(b.glAccount));
      setChartOfAccounts(coa);

      const defaultAP = coa.find(
        (acc) =>
          acc.glAccount.toLowerCase().includes("accounts payable") &&
          acc.type.toLowerCase().includes("liability")
      );
      if (defaultAP) {
        setAccountsPayableGL(defaultAP.glAccount);
      } else if (coa.length > 0 && !defaultAP) {
        const firstLiability = coa.find((acc) =>
          acc.type.toLowerCase().includes("liability")
        );
        if (firstLiability) setAccountsPayableGL(firstLiability.glAccount);
        else setAccountsPayableGL("");
      } else {
        setAccountsPayableGL("");
      }
    } catch (error) {
      console.error("Error fetching chart of accounts:", error);
      toast({
        title: "CoA Error",
        description: "Could not fetch Chart of Accounts.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingChartOfAccounts(false);
    }
  }, [selectedCompanyId, toast]);

  const fetchContacts = useCallback(async () => {
    if (!selectedCompanyId) {
      setIsFetchingContacts(false);
      return;
    }
    setIsFetchingContacts(true);
    try {
      const q = query(
        collection(db, "contacts"),
        where("companyId", "==", selectedCompanyId)
      );
      const snapshot = await getDocs(q);
      const fetchedContacts: PageContactItem[] = [];
      snapshot.forEach((doc) =>
        fetchedContacts.push({
          id: doc.id,
          name: doc.data().name,
          type: doc.data().type,
        })
      );
      setContacts(fetchedContacts.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Error fetching contacts:", error);
      toast({
        title: "Contacts Error",
        description: "Could not fetch contacts.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingContacts(false);
    }
  }, [selectedCompanyId, toast]);

  useEffect(() => {
    if (selectedCompanyId) {
      fetchBills();
      fetchChartOfAccounts();
      fetchContacts();
    }
  }, [selectedCompanyId, fetchBills, fetchChartOfAccounts, fetchContacts]);

  const filteredBills = useMemo(() => {
    return bills.filter(
      (bill) =>
        (bill.vendorName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase()
        ) ||
        (bill.billNumber?.toLowerCase() || "").includes(
          searchTerm.toLowerCase()
        ) ||
        (bill.description?.toLowerCase() || "").includes(
          searchTerm.toLowerCase()
        )
    );
  }, [bills, searchTerm]);

  const handleOpenCreateBillDialog = (
    billToEdit: PurchaseBill | null = null
  ) => {
    setEditingBill(billToEdit);
    if (billToEdit) {
      setBillDate(dateFnsParse(billToEdit.date, "yyyy-MM-dd", new Date()));
      setVendorName(billToEdit.vendorName);
      setBillNumber(billToEdit.billNumber || "");
      setDueDate(
        billToEdit.dueDate
          ? dateFnsParse(billToEdit.dueDate, "yyyy-MM-dd", new Date())
          : undefined
      );
      setBillDescription(billToEdit.description || "");
      setLineItems(
        billToEdit.lineItems.map((line) => ({ ...line, localId: nanoid() }))
      );
    } else {
      setBillDate(new Date());
      setVendorName("");
      setBillNumber("");
      setDueDate(undefined);
      setBillDescription("");
      setLineItems([
        {
          localId: nanoid(),
          description: "",
          glAccount: "",
          quantity: 1,
          unitPrice: 0,
          amount: 0,
        },
      ]);
    }
    setIsCreateBillDialogOpen(true);
  };

  const handleAddLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        localId: nanoid(),
        description: "",
        glAccount: "",
        quantity: 1,
        unitPrice: 0,
        amount: 0,
      },
    ]);
  };

  const handleRemoveLineItem = (localId: string) => {
    setLineItems((prev) => prev.filter((line) => line.localId !== localId));
  };

  const handleLineItemChange = (
    localId: string,
    field: keyof Omit<PurchaseBillLineItem, "localId" | "amount">,
    value: string | number
  ) => {
    setLineItems((prev) =>
      prev.map((line) => {
        if (line.localId === localId) {
          const updatedLine = { ...line, [field]: value };
          if (field === "quantity" || field === "unitPrice") {
            const qty = field === "quantity" ? Number(value) : line.quantity;
            const price =
              field === "unitPrice" ? Number(value) : line.unitPrice;
            updatedLine.amount = isNaN(qty) || isNaN(price) ? 0 : qty * price;
          }
          return updatedLine;
        }
        return line;
      })
    );
  };

  const totalBillAmountFromLines = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + line.amount, 0);
  }, [lineItems]);

  const isDialogBillFormComplete = useMemo(() => {
    if (!billDate || !vendorName.trim() || lineItems.length === 0) {
      return false;
    }
    const allLinesValid = lineItems.every(
      (line) =>
        line.description.trim() !== "" &&
        line.glAccount !== "" &&
        Number(line.quantity) > 0 &&
        Number(line.unitPrice) >= 0
    );
    if (!allLinesValid) return false;
    if (totalBillAmountFromLines <= 0) return false;

    return true;
  }, [billDate, vendorName, lineItems, totalBillAmountFromLines]);

  const handleSaveBill = async () => {
    if (!selectedCompanyId || !activeUserId) {
      toast({
        title: "Error",
        description: "Company or user session not found.",
        variant: "destructive",
      });
      return;
    }
    if (!isDialogBillFormComplete) {
      toast({
        title: "Validation Error",
        description:
          "Please ensure all required fields are filled, line items are complete, and total amount is positive.",
        variant: "destructive",
      });
      return;
    }
    if (!accountsPayableGL && !editingBill?.isLedgerApproved) {
      toast({
        title: "Accounts Payable GL Required",
        description:
          "Please select an Accounts Payable GL account from settings before saving a new bill.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingAction(true);

    const billDataForSave: Omit<
      PurchaseBill,
      "id" | "createdAt" | "paymentStatus" | "paymentDate" | "paidFromToBankGL"
    > = {
      companyId: selectedCompanyId,
      createdBy: activeUserId,
      date: format(billDate!, "yyyy-MM-dd"),
      vendorName: vendorName.trim(),
      billNumber: billNumber.trim() || null,
      dueDate: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
      totalAmount: totalBillAmountFromLines,
      description: billDescription.trim() || null,
      lineItems: lineItems.map(({ localId, ...rest }) => rest),
      isLedgerApproved: editingBill?.isLedgerApproved || false,
    };

    const fullBillData: Omit<PurchaseBill, "id" | "createdAt"> = {
      ...billDataForSave,
      paymentStatus: editingBill?.paymentStatus || "Unpaid",
      paymentDate: editingBill?.paymentDate || null,
      paidFromToBankGL: editingBill?.paidFromToBankGL || null,
    };

    try {
      const batch = writeBatch(db);
      let newVendorCreated = false;
      const currentContactsForSave = [...contacts];
      if (
        !currentContactsForSave.find(
          (c) =>
            c.name.trim().toLowerCase() ===
              fullBillData.vendorName.toLowerCase() && c.type === "Vendor"
        )
      ) {
        newVendorCreated = await ensureVendorExistsAndAddToBatch(
          selectedCompanyId,
          activeUserId,
          fullBillData.vendorName,
          currentContactsForSave,
          batch
        );
      }

      if (editingBill) {
        const billRef = doc(db, "purchase_bills", editingBill.id);
        if (editingBill.isLedgerApproved) {
          await deletePurchaseBillFromLedger(
            selectedCompanyId,
            editingBill.id,
            batch
          );
          (fullBillData as PurchaseBill).isLedgerApproved = false;
        }
        batch.update(billRef, {
          ...fullBillData,
          updatedBy: activeUserId,
          updatedAt: serverTimestamp(),
        });

        await logAction(
          "Update",
          "Purchase Bill",
          [
            `Vendor: ${fullBillData.vendorName}`,
            `Amount: ${fullBillData.totalAmount}`,
            editingBill.isLedgerApproved ? "Ledger posting reset" : "",
          ].filter(Boolean)
        );

        toast({
          title: "Bill Updated",
          description: `Bill from ${fullBillData.vendorName} updated. ${
            editingBill.isLedgerApproved ? "Ledger posting reset." : ""
          }`,
        });
      } else {
        const newBillRef = doc(collection(db, "purchase_bills"));
        batch.set(newBillRef, {
          ...fullBillData,
          createdAt: serverTimestamp(),
        });

        await logAction("Create", "Purchase Bill", [
          `Vendor: ${fullBillData.vendorName}`,
          `Amount: ${fullBillData.totalAmount}`,
        ]);
        toast({
          title: "Bill Created",
          description: `New bill from ${fullBillData.vendorName} created.`,
        });
      }

      await batch.commit();
      await fetchBills();
      if (newVendorCreated) await fetchContacts();
      setIsCreateBillDialogOpen(false);
    } catch (error) {
      console.error("Error saving bill:", error);
      toast({
        title: "Save Error",
        description: "Could not save the bill.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleDeleteBill = async (billId: string) => {
    if (!selectedCompanyId || !activeUserId) return;
    setIsLoadingAction(true);
    try {
      const billToDelete = bills.find((b) => b.id === billId);
      const batch = writeBatch(db);

      if (billToDelete?.isLedgerApproved) {
        await deletePurchaseBillFromLedger(selectedCompanyId, billId, batch);
        const paymentLedgerQuery = query(
          collection(db, "all_transactions_ledger"),
          where("companyId", "==", selectedCompanyId),
          where("source", "==", "Purchase Bill Payment"),
          where("sourceDocId", "==", billId)
        );
        const paymentLedgerSnapshot = await getDocs(paymentLedgerQuery);
        paymentLedgerSnapshot.forEach((docSnap) => batch.delete(docSnap.ref));
      }

      batch.delete(doc(db, "purchase_bills", billId));
      await batch.commit();

      await logAction("Delete", "Purchase Bill", [
        `Vendor: ${billToDelete?.vendorName}`,
        `Amount: ${billToDelete?.totalAmount}`,
      ]);

      toast({
        title: "Bill Deleted",
        description: "The purchase bill has been removed.",
      });
      await fetchBills();
      setSelectedBillIds((prev) => prev.filter((id) => id !== billId));
    } catch (error) {
      console.error("Error deleting bill: ", error);
      toast({
        title: "Delete Error",
        description: "Could not delete the bill.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handlePostBillToLedger = async (billId: string) => {
    if (!selectedCompanyId || !activeUserId) return;
    const billToPost = bills.find((b) => b.id === billId);
    if (!billToPost || billToPost.isLedgerApproved) {
      toast({
        title: "Invalid Action",
        description: "Bill not found or already approved.",
        variant: "destructive",
      });
      return;
    }
    if (!accountsPayableGL) {
      toast({
        title: "Accounts Payable GL Required",
        description:
          "Please select an Accounts Payable GL account from settings before posting.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingAction(true);
    try {
      const batch = writeBatch(db);

      addPurchaseBillToLedger(
        batch,
        selectedCompanyId,
        activeUserId,
        billToPost,
        accountsPayableGL
      );
      batch.update(doc(db, "purchase_bills", billId), {
        isLedgerApproved: true,
        updatedBy: activeUserId,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      await logAction("Post to Ledger", "Purchase Bill", [
        `Bill #: ${billToPost.billNumber || billToPost.id.substring(0, 5)}`,
        `Vendor: ${billToPost.vendorName}`,
        `Amount: ${billToPost.totalAmount}`,
      ]);

      toast({
        title: "Bill Posted",
        description: `Bill ${
          billToPost.billNumber || billToPost.id.substring(0, 5)
        } posted to ledger.`,
      });
      await fetchBills();
    } catch (error) {
      console.error("Error posting bill:", error);
      toast({
        title: "Posting Error",
        description: "Could not post bill to ledger.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleUnpostBillFromLedger = async (billId: string) => {
    if (!selectedCompanyId || !activeUserId) return;
    const billToUnpost = bills.find((b) => b.id === billId);
    if (!billToUnpost || !billToUnpost.isLedgerApproved) {
      toast({
        title: "Invalid Action",
        description: "Bill not found or not approved.",
        variant: "destructive",
      });
      return;
    }
    setIsLoadingAction(true);
    try {
      const batch = writeBatch(db);
      await deletePurchaseBillFromLedger(selectedCompanyId, billId, batch);
      batch.update(doc(db, "purchase_bills", billId), {
        isLedgerApproved: false,
        updatedBy: activeUserId,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      await logAction("Unpost from Ledger", "Purchase Bill", [
        `Bill #: ${billToUnpost.billNumber || billToUnpost.id.substring(0, 5)}`,
        `Vendor: ${billToUnpost.vendorName}`,
        `Amount: ${billToUnpost.totalAmount}`,
      ]);

      toast({
        title: "Bill Unposted",
        description: `Bill ${
          billToUnpost.billNumber || billToUnpost.id.substring(0, 5)
        } unposted from ledger.`,
      });
      await fetchBills();
    } catch (error) {
      console.error("Error unposting bill:", error);
      toast({
        title: "Unposting Error",
        description: "Could not unpost bill.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
    }
  };

  const handleToggleSelectBill = (
    billId: string,
    checked: boolean,
    isShiftEvent: boolean
  ) => {
    setSelectedBillIds((prevSelectedIds) => {
      if (isShiftEvent && lastSelectedBillId && lastSelectedBillId !== billId) {
        const currentIndex = filteredBills.findIndex((b) => b.id === billId);
        const lastIndex = filteredBills.findIndex(
          (b) => b.id === lastSelectedBillId
        );
        if (currentIndex === -1 || lastIndex === -1) {
          return checked
            ? [...prevSelectedIds, billId]
            : prevSelectedIds.filter((id) => id !== billId);
        }
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const idsInRange = filteredBills.slice(start, end + 1).map((b) => b.id);
        return checked
          ? Array.from(new Set([...prevSelectedIds, ...idsInRange]))
          : prevSelectedIds.filter((id) => !idsInRange.includes(id));
      } else {
        if (!isShiftEvent) setLastSelectedBillId(billId);
        return checked
          ? [...prevSelectedIds, billId]
          : prevSelectedIds.filter((id) => id !== billId);
      }
    });
  };

  const handleToggleSelectAllBills = (checked: boolean) => {
    setSelectedBillIds(checked ? filteredBills.map((b) => b.id) : []);
    setLastSelectedBillId(null);
  };

  const handleConfirmBulkPostToLedger = async () => {
    if (!selectedCompanyId || !activeUserId || selectedBillIds.length === 0)
      return;
    setIsLoadingAction(true);

    const billsToPost = bills.filter(
      (b) => selectedBillIds.includes(b.id) && !b.isLedgerApproved
    );
    if (billsToPost.length === 0) {
      toast({
        title: "No Action Needed",
        description:
          "Selected bills are already posted or none were selected for posting.",
        variant: "default",
      });
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
      return;
    }
    if (!accountsPayableGL) {
      toast({
        title: "A/P GL Account Required",
        description:
          "Please select an Accounts Payable GL account from settings before bulk posting.",
        variant: "destructive",
      });
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
      return;
    }

    let postedCount = 0;
    let vendorContactsCreated = 0;
    const currentContactsForBulkPost = [...contacts];
    try {
      const batch = writeBatch(db);
      for (const bill of billsToPost) {
        const newVendorCreated = await ensureVendorExistsAndAddToBatch(
          selectedCompanyId,
          activeUserId,
          bill.vendorName,
          currentContactsForBulkPost,
          batch
        );
        if (newVendorCreated) vendorContactsCreated++;

        addPurchaseBillToLedger(
          batch,
          selectedCompanyId,
          activeUserId,
          bill,
          accountsPayableGL
        );
        batch.update(doc(db, "purchase_bills", bill.id), {
          isLedgerApproved: true,
          updatedBy: activeUserId,
          updatedAt: serverTimestamp(),
        });
        postedCount++;
      }
      if (postedCount > 0 || vendorContactsCreated > 0) {
        await batch.commit();

        await logAction("Bulk Post", "Purchase Bills", [
          `Count: ${postedCount}`,
          `Total Amount: ${billsToPost.reduce(
            (sum, b) => sum + b.totalAmount,
            0
          )}`,
          vendorContactsCreated > 0
            ? `${vendorContactsCreated} new vendors created`
            : "",
        ]);
      }

      let successMsg = `${postedCount} bill(s) posted to ledger.`;
      if (vendorContactsCreated > 0) {
        successMsg += ` ${vendorContactsCreated} new vendor contact(s) auto-created.`;
      }
      toast({ title: "Bulk Post Successful", description: successMsg });
      await fetchBills();
      if (vendorContactsCreated > 0) await fetchContacts();
      setSelectedBillIds([]);
    } catch (error) {
      console.error("Error during bulk posting bills:", error);
      toast({
        title: "Bulk Post Error",
        description: "An error occurred during bulk posting.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
      setIsBulkPostDialogOpen(false);
    }
  };

  const handleOpenMarkAsPaidDialog = () => {
    const unpaidSelected = selectedBillIds.filter((id) => {
      const bill = bills.find((b) => b.id === id);
      return bill && bill.paymentStatus !== "Paid";
    }).length;

    if (unpaidSelected === 0) {
      toast({
        title: "No Unpaid Bills Selected",
        description: "Please select one or more unpaid bills to mark as paid.",
        variant: "default",
      });
      return;
    }
    setPaymentDateForDialog(new Date());
    setBankGLForPaymentDialog("");
    setIsMarkAsPaidDialogOpen(true);
  };

  const handleConfirmMarkAsPaid = async () => {
    if (
      !selectedCompanyId ||
      !activeUserId ||
      !paymentDateForDialog ||
      !bankGLForPaymentDialog
    ) {
      toast({
        title: "Missing Information",
        description: "Please select a payment date and a bank GL account.",
        variant: "destructive",
      });
      return;
    }
    if (!accountsPayableGL) {
      toast({
        title: "A/P GL Account Missing",
        description:
          "Default Accounts Payable GL is not set. Please configure it.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingAction(true);
    const batch = writeBatch(db);
    let paidCount = 0;
    const formattedPaymentDate = format(paymentDateForDialog, "yyyy-MM-dd");

    for (const billId of selectedBillIds) {
      const bill = bills.find((b) => b.id === billId);
      if (bill && bill.paymentStatus !== "Paid") {
        // 1. Create Bank Transaction
        const bankTransactionRef = doc(collection(db, "transactions"));
        batch.set(bankTransactionRef, {
          companyId: selectedCompanyId,
          createdBy: activeUserId,
          date: formattedPaymentDate,
          description: `Payment for Bill #${
            bill.billNumber || bill.id.substring(0, 5)
          } to ${bill.vendorName}`,
          bankName: bankGLForPaymentDialog,
          vendor: bill.vendorName,
          glAccount: accountsPayableGL,
          amountPaid: bill.totalAmount,
          amountReceived: null,
          createdAt: serverTimestamp(),
          isLedgerApproved: true,
          source: "Purchase Bill Payment",
          sourceDocId: bill.id,
        });

        // 2. Update Bill Status
        const billRef = doc(db, "purchase_bills", bill.id);
        batch.update(billRef, {
          paymentStatus: "Paid",
          paymentDate: formattedPaymentDate,
          paidFromToBankGL: bankGLForPaymentDialog,
          updatedBy: activeUserId,
          updatedAt: serverTimestamp(),
        });

        // 3. Create Ledger Entries for Payment
        const debitLedgerEntry = {
          companyId: selectedCompanyId,
          createdBy: activeUserId,
          date: formattedPaymentDate,
          description: `Payment made for Bill #${
            bill.billNumber || bill.id.substring(0, 5)
          }`,
          source: "Purchase Bill Payment",
          sourceDocId: bill.id,
          customer: null,
          vendor: bill.vendorName,
          glAccount: accountsPayableGL,
          debitAmount: bill.totalAmount,
          creditAmount: null,
          createdAt: serverTimestamp(),
        };
        batch.set(
          doc(collection(db, "all_transactions_ledger")),
          debitLedgerEntry
        );

        const creditLedgerEntry = {
          companyId: selectedCompanyId,
          createdBy: activeUserId,
          date: formattedPaymentDate,
          description: `Payment made for Bill #${
            bill.billNumber || bill.id.substring(0, 5)
          }`,
          source: "Purchase Bill Payment",
          sourceDocId: bill.id,
          customer: null,
          vendor: bill.vendorName,
          glAccount: bankGLForPaymentDialog,
          debitAmount: null,
          creditAmount: bill.totalAmount,
          createdAt: serverTimestamp(),
        };
        batch.set(
          doc(collection(db, "all_transactions_ledger")),
          creditLedgerEntry
        );
        paidCount++;
      }
    }

    if (paidCount > 0) {
      try {
        await batch.commit();
        await logAction("Mark as Paid", "Purchase Bills", [`Count: ${paidCount}`,`Total Amount: ${selectedBillIds.map(id => bills.find(b => b.id === id)?.totalAmount)}`,`Bank GL: ${bankGLForPaymentDialog}`]);
        
        toast({
          title: "Payment Recorded",
          description: `${paidCount} bill(s) marked as paid. Corresponding bank transaction auto-approved for ledger.`,
        });
        await fetchBills();
        setSelectedBillIds([]);
      } catch (error) {
        console.error("Error marking bills as paid:", error);
        toast({
          title: "Payment Error",
          description: "Could not mark bills as paid.",
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "No Action",
        description: "No unpaid bills were selected or no changes made.",
      });
    }
    setIsLoadingAction(false);
    setIsMarkAsPaidDialogOpen(false);
  };

  const handleOpenMarkAsUnpaidDialog = (bill: PurchaseBill) => {
    setEditingBill(bill);
    setIsMarkAsUnpaidDialogOpen(true);
  };

  const handleConfirmMarkAsUnpaid = async () => {
  if (!selectedCompanyId || !activeUserId || !editingBill) return;
     setIsLoadingAction(true);
     
     const batch = writeBatch(db);
     let bankTxFoundAndDeleted = false;
 
     try {
       // 1. Delete associated ledger entries for the payment ONLY
       const paymentLedgerQuery = query(
         collection(db, "all_transactions_ledger"),
         where("companyId", "==", selectedCompanyId),
         where("source", "==", "Purchase Bill Payment"),
         where("sourceDocId", "==", editingBill.id)
       );
       const paymentLedgerSnapshot = await getDocs(paymentLedgerQuery);
       paymentLedgerSnapshot.forEach(docSnap => batch.delete(docSnap.ref));
 
       // 2. Try to find and delete the associated bank transaction
       const transactionQuery = query(
         collection(db, "transactions"),
         where("companyId", "==", selectedCompanyId),
         where("source", "==", "Purchase Bill Payment"),
         where("sourceDocId", "==", editingBill.id)
       );
       const transactionSnapshot = await getDocs(transactionQuery);
       transactionSnapshot.forEach(doc => {
           batch.delete(doc.ref);
           bankTxFoundAndDeleted = true;
       });

       // 3. Update the bill status
            const billRef = doc(db, "purchase_bills", editingBill.id);
            batch.update(billRef, {
              paymentStatus: "Unpaid",
              paymentDate: null,
              paidFromToBankGL: null,
              updatedBy: activeUserId,
              updatedAt: serverTimestamp()
            });
      
            await batch.commit();
            
            await logAction("Mark as Unpaid", "Purchase Bill", [
              `Bill #: ${editingBill.billNumber || editingBill.id.substring(0,5)}`,
              `Vendor: ${editingBill.vendorName}`,
              `Amount: ${editingBill.totalAmount}`
            ]);

      let toastDescription =
        "Bill has been marked as unpaid and payment ledger entries reversed.";
      if (!bankTxFoundAndDeleted) {
        toastDescription +=
          " Please manually delete the corresponding payment from Bank Transactions if it exists.";
      }
      toast({ title: "Bill Marked as Unpaid", description: toastDescription });

      await fetchBills();
      setSelectedBillIds((prev) => prev.filter((id) => id !== editingBill!.id));
    } catch (error) {
      console.error("Error marking bill as unpaid:", error);
      toast({
        title: "Error",
        description: "Could not mark bill as unpaid.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAction(false);
      setIsMarkAsUnpaidDialogOpen(false);
      setEditingBill(null);
    }
  };

  const handleComingSoon = (featureName: string) => {
    toast({
      title: "Coming Soon!",
      description: `${featureName} functionality will be available soon.`,
    });
  };

  const commonButtonDisabled =
    isFetching ||
    isFetchingChartOfAccounts ||
    isFetchingContacts ||
    isLoadingAction ||
    isBulkPostDialogOpen ||
    isMarkAsPaidDialogOpen ||
    isMarkAsUnpaidDialogOpen;
  const expenseAndAssetGLs = useMemo(
    () =>
      chartOfAccounts.filter(
        (acc) =>
          acc.type.toLowerCase().includes("expense") ||
          acc.type.toLowerCase().includes("asset")
      ),
    [chartOfAccounts]
  );
  const bankAssetGLAccounts = useMemo(
    () =>
      chartOfAccounts.filter(
        (acc) => acc.type.toLowerCase() === "current asset"
      ),
    [chartOfAccounts]
  );

  const isSelectAllChecked = useMemo(() => {
    if (filteredBills.length === 0) return false;
    return filteredBills.every((b) => selectedBillIds.includes(b.id));
  }, [filteredBills, selectedBillIds]);
  const canBulkPost = useMemo(
    () =>
      selectedBillIds.some((id) =>
        bills.find((b) => b.id === id && !b.isLedgerApproved)
      ),
    [selectedBillIds, bills]
  );
  const canMarkAsPaid = useMemo(
    () =>
      selectedBillIds.some((id) => {
        const bill = bills.find((b) => b.id === id);
        return bill && bill.paymentStatus !== "Paid";
      }),
    [selectedBillIds, bills]
  );

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <ReceiptText className="mr-3 h-10 w-10 text-primary" /> Purchases
              & Bills
            </h1>
            <p className="text-lg text-muted-foreground">
              Manage vendor bills and track your expenses.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="default"
              onClick={() => handleOpenCreateBillDialog()}
              disabled={
                commonButtonDisabled ||
                isFetchingChartOfAccounts ||
                chartOfAccounts.length === 0 ||
                isFetchingContacts
              }
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Create Bill
            </Button>
            <Button
              variant="outline"
              onClick={() => handleComingSoon("Import Bills")}
              disabled={commonButtonDisabled}
            >
              <Upload className="mr-2 h-4 w-4" /> Import Bills
            </Button>
            <Button
              variant="outline"
              onClick={() => handleComingSoon("Export Bills")}
              disabled={commonButtonDisabled}
            >
              <FileDown className="mr-2 h-4 w-4" /> Export Bills
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
              </Link>
            </Button>
          </div>
        </header>

        <div className="mb-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search bills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              disabled={commonButtonDisabled}
            />
          </div>
          <div className="max-w-xs">
            <Label
              htmlFor="ap-gl-select"
              className="text-xs text-muted-foreground"
            >
              Default Accounts Payable GL:
            </Label>
            <Select
              value={accountsPayableGL}
              onValueChange={setAccountsPayableGL}
              disabled={
                commonButtonDisabled ||
                isFetchingChartOfAccounts ||
                chartOfAccounts.filter((acc) =>
                  acc.type.toLowerCase().includes("liability")
                ).length === 0
              }
            >
              <SelectTrigger id="ap-gl-select" className="h-9 text-sm">
                <SelectValue
                  placeholder={
                    isFetchingChartOfAccounts
                      ? "Loading..."
                      : chartOfAccounts.filter((acc) =>
                          acc.type.toLowerCase().includes("liability")
                        ).length === 0
                      ? "No Liability GLs"
                      : "Select A/P GL"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {chartOfAccounts
                  .filter((acc) => acc.type.toLowerCase().includes("liability"))
                  .map((acc) => (
                    <SelectItem key={acc.id} value={acc.glAccount}>
                      {acc.glAccount}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Required for creating/posting new bills.
            </p>
          </div>
          {selectedBillIds.length > 0 && (
            <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between mt-4 sm:mt-0 sm:ml-4 flex-grow w-full sm:w-auto">
              <span className="text-sm font-medium">
                {selectedBillIds.length} bill(s) selected
              </span>
              <div className="space-x-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenMarkAsPaidDialog}
                  disabled={commonButtonDisabled || !canMarkAsPaid}
                >
                  <DollarSign className="mr-2 h-4 w-4" /> Mark as Paid
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setIsBulkPostDialogOpen(true)}
                  disabled={commonButtonDisabled || !canBulkPost}
                >
                  <Library className="mr-2 h-4 w-4" /> Post Selected
                </Button>
              </div>
            </div>
          )}
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Bill List</CardTitle>
          </CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10">
                <LoadingSpinner size="lg" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={isSelectAllChecked}
                          onCheckedChange={(checked) =>
                            handleToggleSelectAllBills(Boolean(checked))
                          }
                          aria-label="Select all bills"
                          disabled={
                            commonButtonDisabled || filteredBills.length === 0
                          }
                        />
                      </TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill #</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-center">
                        Payment Status
                      </TableHead>
                      <TableHead className="text-center">
                        Ledger Status
                      </TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBills.length > 0 ? (
                      filteredBills.map((bill) => (
                        <TableRow
                          key={bill.id}
                          data-state={
                            selectedBillIds.includes(bill.id) ? "selected" : ""
                          }
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedBillIds.includes(bill.id)}
                              onPointerDown={(
                                e: React.PointerEvent<HTMLButtonElement>
                              ) => setIsShiftKeyPressed(e.shiftKey)}
                              onCheckedChange={(checked, event) =>
                                handleToggleSelectBill(
                                  bill.id,
                                  Boolean(checked),
                                  isShiftKeyPressed ||
                                    (
                                      event as unknown as React.MouseEvent<HTMLButtonElement>
                                    )?.nativeEvent?.shiftKey
                                )
                              }
                              aria-labelledby={`select-bill-${bill.id}`}
                              disabled={commonButtonDisabled}
                            />
                          </TableCell>
                          <TableCell>
                            {bill.date
                              ? format(
                                  dateFnsParse(
                                    bill.date,
                                    "yyyy-MM-dd",
                                    new Date()
                                  ),
                                  "MM/dd/yyyy"
                                )
                              : ""}
                          </TableCell>
                          <TableCell>{bill.vendorName}</TableCell>
                          <TableCell>{bill.billNumber || "-"}</TableCell>
                          <TableCell>
                            {bill.dueDate
                              ? format(
                                  dateFnsParse(
                                    bill.dueDate,
                                    "yyyy-MM-dd",
                                    new Date()
                                  ),
                                  "MM/dd/yyyy"
                                )
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            ${bill.totalAmount.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            {bill.paymentStatus === "Paid" ? (
                              <Badge
                                variant="default"
                                className="bg-emerald-500 hover:bg-emerald-600"
                              >
                                Paid
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-600"
                              >
                                Unpaid
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {bill.isLedgerApproved ? (
                              <Badge
                                variant="secondary"
                                className="bg-green-100 text-green-700 border-green-300"
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />{" "}
                                Approved
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-yellow-50 text-yellow-700 border-yellow-300"
                              >
                                <AlertCircle className="mr-1 h-3 w-3" /> Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center space-x-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenCreateBillDialog(bill)}
                              disabled={
                                isLoadingAction ||
                                selectedBillIds.length > 0 ||
                                bill.paymentStatus === "Paid"
                              }
                              title={
                                bill.paymentStatus === "Paid"
                                  ? "Unmark as paid to edit"
                                  : "Edit Bill"
                              }
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>

                            {bill.paymentStatus === "Paid" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleOpenMarkAsUnpaidDialog(bill)
                                }
                                disabled={
                                  isLoadingAction || selectedBillIds.length > 0
                                }
                                title="Unmark as Paid"
                              >
                                <Undo2 className="h-4 w-4 text-orange-500" />
                              </Button>
                            ) : !bill.isLedgerApproved ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePostBillToLedger(bill.id)}
                                disabled={
                                  isLoadingAction ||
                                  !accountsPayableGL ||
                                  selectedBillIds.length > 0
                                }
                                title={
                                  !accountsPayableGL
                                    ? "Select A/P GL first"
                                    : "Post to Ledger"
                                }
                              >
                                <Library className="h-4 w-4 text-green-600" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleUnpostBillFromLedger(bill.id)
                                }
                                disabled={
                                  isLoadingAction ||
                                  selectedBillIds.length > 0 ||
                                  bill.paymentStatus === "Paid"
                                }
                                title={
                                  bill.paymentStatus === "Paid"
                                    ? "Cannot unpost paid bill"
                                    : "Unpost from Ledger"
                                }
                              >
                                <AlertTriangle className="h-4 w-4 text-orange-500" />
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteBill(bill.id)}
                              disabled={
                                isLoadingAction ||
                                selectedBillIds.length > 0 ||
                                bill.paymentStatus === "Paid"
                              }
                              title={
                                bill.paymentStatus === "Paid"
                                  ? "Unmark as paid to delete"
                                  : "Delete Bill"
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-10">
                          No bills found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={isCreateBillDialogOpen}
          onOpenChange={(isOpen) => {
            setIsCreateBillDialogOpen(isOpen);
            if (!isOpen) setEditingBill(null);
          }}
        >
          <DialogContent className="sm:max-w-3xl md:max-w-4xl lg:max-w-5xl h-[90vh] flex flex-col p-0">
            <DialogHeader className="p-6 pb-4 border-b">
              <DialogTitle className="font-headline text-2xl">
                {editingBill
                  ? "Edit Purchase Bill"
                  : "Create New Purchase Bill"}
              </DialogTitle>
              <DialogDescription>
                Enter bill details. Line items will determine the total amount.
              </DialogDescription>
            </DialogHeader>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-none">
              <div>
                <Label htmlFor="billDate">Bill Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="billDate"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1",
                        !billDate && "text-muted-foreground"
                      )}
                      disabled={isLoadingAction}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {billDate ? (
                        format(billDate, "MM/dd/yyyy")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={billDate}
                      onSelect={setBillDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label htmlFor="vendorNameDialog">Vendor Name *</Label>
                <Select
                  value={vendorName}
                  onValueChange={setVendorName}
                  disabled={isLoadingAction || isFetchingContacts}
                >
                  <SelectTrigger id="vendorNameDialog" className="mt-1">
                    <SelectValue
                      placeholder={
                        isFetchingContacts
                          ? "Loading..."
                          : contacts.filter((c) => c.type === "Vendor")
                              .length === 0
                          ? "No Vendors"
                          : "Select Vendor"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts
                      .filter((c) => c.type === "Vendor")
                      .map((c) => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Or type new vendor"
                  className="mt-1 text-xs"
                  disabled={isLoadingAction}
                />
              </div>
              <div>
                <Label htmlFor="billNumber">Bill Number</Label>
                <Input
                  id="billNumber"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="Optional"
                  className="mt-1"
                  disabled={isLoadingAction}
                />
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="dueDate"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1",
                        !dueDate && "text-muted-foreground"
                      )}
                      disabled={isLoadingAction}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? (
                        format(dueDate, "MM/dd/yyyy")
                      ) : (
                        <span>Optional</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="md:col-span-2 lg:col-span-4">
                <Label htmlFor="billDescription">General Description</Label>
                <Textarea
                  id="billDescription"
                  value={billDescription}
                  onChange={(e) => setBillDescription(e.target.value)}
                  placeholder="Optional overall description for the bill"
                  className="mt-1"
                  disabled={isLoadingAction}
                />
              </div>
            </div>
            <div className="p-6 pt-0 border-b flex-none">
              <h4 className="text-md font-medium mb-2">
                Line Items (Total: ${totalBillAmountFromLines.toFixed(2)})
              </h4>
            </div>
            <div className="flex-grow overflow-hidden px-2">
              <ScrollArea className="h-full p-4 pb-0">
                <div className="space-y-3">
                  {lineItems.map((line) => (
                    <Card key={line.localId} className="p-3 shadow-sm">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                        <div className="md:col-span-4">
                          <Label htmlFor={`line-item-desc-${line.localId}`}>
                            Description *
                          </Label>
                          <Input
                            id={`line-item-desc-${line.localId}`}
                            value={line.description}
                            onChange={(e) =>
                              handleLineItemChange(
                                line.localId,
                                "description",
                                e.target.value
                              )
                            }
                            placeholder="Item/Service"
                            className="mt-1 text-xs"
                            disabled={isLoadingAction}
                          />
                        </div>
                        <div className="md:col-span-3">
                          <Label htmlFor={`line-item-gl-${line.localId}`}>
                            GL Account * (Expense/Asset)
                          </Label>
                          <Select
                            value={line.glAccount}
                            onValueChange={(val) =>
                              handleLineItemChange(
                                line.localId,
                                "glAccount",
                                val
                              )
                            }
                            disabled={
                              isLoadingAction ||
                              isFetchingChartOfAccounts ||
                              expenseAndAssetGLs.length === 0
                            }
                          >
                            <SelectTrigger
                              id={`line-item-gl-${line.localId}`}
                              className="mt-1 text-xs"
                            >
                              <SelectValue
                                placeholder={
                                  isFetchingChartOfAccounts
                                    ? "Loading..."
                                    : expenseAndAssetGLs.length === 0
                                    ? "No Exp/Asset GLs"
                                    : "Select GL"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {expenseAndAssetGLs.map((acc) => (
                                <SelectItem key={acc.id} value={acc.glAccount}>
                                  {acc.glAccount} ({acc.type})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-1">
                          <Label htmlFor={`line-item-qty-${line.localId}`}>
                            Qty *
                          </Label>
                          <Input
                            id={`line-item-qty-${line.localId}`}
                            type="number"
                            value={line.quantity}
                            onChange={(e) =>
                              handleLineItemChange(
                                line.localId,
                                "quantity",
                                Number(e.target.value)
                              )
                            }
                            className="mt-1 text-xs text-right"
                            disabled={isLoadingAction}
                            min="0.01"
                            step="0.01"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label htmlFor={`line-item-price-${line.localId}`}>
                            Unit Price *
                          </Label>
                          <Input
                            id={`line-item-price-${line.localId}`}
                            type="number"
                            value={line.unitPrice}
                            onChange={(e) =>
                              handleLineItemChange(
                                line.localId,
                                "unitPrice",
                                Number(e.target.value)
                              )
                            }
                            placeholder="0.00"
                            className="mt-1 text-xs text-right"
                            disabled={isLoadingAction}
                            min="0"
                            step="0.01"
                          />
                        </div>
                        <div className="md:col-span-1 flex items-end">
                          <p className="text-xs text-right w-full pt-6 pr-1">
                            = ${line.amount.toFixed(2)}
                          </p>
                        </div>
                        <div className="md:col-span-1 flex items-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveLineItem(line.localId)}
                            disabled={isLoadingAction || lineItems.length <= 1}
                            className="text-destructive hover:bg-destructive/10 w-full md:w-auto"
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddLineItem}
                    disabled={isLoadingAction}
                    className="mt-2"
                  >
                    <PlusCircle className="mr-2 h-3 w-3" /> Add Line Item
                  </Button>
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="p-6 pt-4 border-t flex-none">
              <Button
                variant="ghost"
                onClick={() => setIsCreateBillDialogOpen(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveBill}
                disabled={
                  isLoadingAction ||
                  !isDialogBillFormComplete ||
                  (!accountsPayableGL && !editingBill?.isLedgerApproved)
                }
              >
                {isLoadingAction ? (
                  <LoadingSpinner className="mr-2" />
                ) : editingBill ? (
                  "Update Bill"
                ) : (
                  "Create Bill"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isBulkPostDialogOpen}
          onOpenChange={setIsBulkPostDialogOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline flex items-center">
                <Library className="mr-2 h-6 w-6 text-primary" /> Confirm Bulk
                Post to Ledger
              </DialogTitle>
              <DialogDescription>
                You are about to post{" "}
                {
                  selectedBillIds.filter(
                    (id) => !bills.find((b) => b.id === id)?.isLedgerApproved
                  ).length
                }{" "}
                selected pending bill(s) to the ledger. This will also attempt
                to auto-create any new vendor contacts if they don't exist. Are
                you sure?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsBulkPostDialogOpen(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmBulkPostToLedger}
                disabled={isLoadingAction || !accountsPayableGL}
              >
                {isLoadingAction && <LoadingSpinner className="mr-2" />} Confirm
                & Post to Ledger
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isMarkAsPaidDialogOpen}
          onOpenChange={setIsMarkAsPaidDialogOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline flex items-center">
                <DollarSign className="mr-2 h-6 w-6 text-primary" /> Mark
                Bill(s) as Paid
              </DialogTitle>
              <DialogDescription>
                Select payment date and the bank account used for payment for{" "}
                {
                  selectedBillIds.filter((id) =>
                    bills.find((b) => b.id === id && b.paymentStatus !== "Paid")
                  ).length
                }{" "}
                bill(s).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="paymentDateDialogBill">Payment Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="paymentDateDialogBill"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal mt-1",
                        !paymentDateForDialog && "text-muted-foreground"
                      )}
                      disabled={isLoadingAction}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {paymentDateForDialog ? (
                        format(paymentDateForDialog, "MM/dd/yyyy")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={paymentDateForDialog}
                      onSelect={setPaymentDateForDialog}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label htmlFor="bankGLPaymentDialogBill">
                  Bank GL Account (Paid From) *
                </Label>
                <Select
                  value={bankGLForPaymentDialog}
                  onValueChange={setBankGLForPaymentDialog}
                  disabled={
                    isLoadingAction ||
                    isFetchingChartOfAccounts ||
                    bankAssetGLAccounts.length === 0
                  }
                >
                  <SelectTrigger id="bankGLPaymentDialogBill" className="mt-1">
                    <SelectValue
                      placeholder={
                        isFetchingChartOfAccounts
                          ? "Loading CoA..."
                          : bankAssetGLAccounts.length === 0
                          ? "No Asset GLs"
                          : "Select Bank GL"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAssetGLAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.glAccount}>
                        {acc.glAccount}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsMarkAsPaidDialogOpen(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmMarkAsPaid}
                disabled={
                  isLoadingAction ||
                  !paymentDateForDialog ||
                  !bankGLForPaymentDialog
                }
              >
                {isLoadingAction && <LoadingSpinner className="mr-2" />} Confirm
                Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isMarkAsUnpaidDialogOpen}
          onOpenChange={setIsMarkAsUnpaidDialogOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline flex items-center">
                <Undo2 className="mr-2 h-6 w-6 text-orange-500" /> Confirm Mark
                as Unpaid
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to mark this bill as unpaid? This will
                reverse the payment from the ledger and delete the associated
                bank withdrawal transaction.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsMarkAsUnpaidDialogOpen(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmMarkAsUnpaid}
                disabled={isLoadingAction}
              >
                {isLoadingAction && <LoadingSpinner className="mr-2" />} Confirm
                & Un-pay
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AuthGuard>
  );
}
