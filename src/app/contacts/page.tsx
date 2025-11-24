
"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, ArrowLeft, Upload, Trash2, FileDown, Edit, Search, ArrowUp, ArrowDown, AlertTriangle, PlusCircle, Edit3 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import React, { useState, ChangeEvent, useEffect, useCallback, useMemo } from "react";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { useAuth } from "@/context/AuthContext";
import { db, serverTimestamp } from "@/lib/firebase";
import { collection, addDoc, query, where, getDocs, doc, deleteDoc, Timestamp, writeBatch, updateDoc } from "firebase/firestore";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";


import { useCompany } from "@/context/CompanyContext";
import { useAuditLog } from "@/hooks/useAuditLog";

interface ContactItem {
  id: string;
  userId: string;
  name: string;
  address: string | null;
  contactNumber: string | null;
  email: string | null;
  type: "Customer" | "Vendor";
  createdAt?: Timestamp;
}

interface SortConfig {
  key: keyof Omit<ContactItem, 'userId' | 'createdAt'> | null;
  direction: 'ascending' | 'descending';
}

const contactFormSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }).max(100, { message: "Name cannot exceed 100 characters."}),
  address: z.string().max(200, { message: "Address cannot exceed 200 characters."}).optional().nullable(),
  contactNumber: z.string().max(20, { message: "Contact number cannot exceed 20 characters."}).optional().nullable(),
  email: z.string().email({ message: "Invalid email address." }).max(100, { message: "Email cannot exceed 100 characters."}).optional().nullable(),
  type: z.enum(["Customer", "Vendor"], { errorMap: () => ({ message: "Please select a contact type." }) }),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

interface ColumnMapping {
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  type: string;
}

const SKIP_COLUMN_VALUE = "__SKIP__";

export default function ContactsPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isLoading, setIsLoading] = useState(false); // For CRUD, import, export etc.
  const { toast } = useToast();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'ascending' });

  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [lastSelectedContactId, setLastSelectedContactId] = useState<string | null>(null);
  const [isShiftKeyPressed, setIsShiftKeyPressed] = useState(false);

  const [isCreateOrEditDialogOpen, setIsCreateOrEditDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null);

  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({
    name: '', address: '', contactNumber: '', email: '', type: ''
  });

  const [isBulkEditDialogOpen, setIsBulkEditDialogOpen] = useState(false);
  const [bulkEditType, setBulkEditType] = useState<"Customer" | "Vendor" | "">("");
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);


  const { selectedCompanyId } = useCompany();
  const { logAction } = useAuditLog();

  const contactForm = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "", address: "", contactNumber: "", email: "", type: undefined
    },
  });

  const fetchContacts = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    try {
      const q = query(collection(db, "contacts"), where("companyId", "==", selectedCompanyId));
      const querySnapshot = await getDocs(q);
      const fetchedItems: ContactItem[] = [];
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<ContactItem, 'id'>) });
      });
      setContacts(fetchedItems);
    } catch (error) {
      console.error("Error fetching contacts: ", error);
      toast({ title: "Error", description: "Could not fetch contacts.", variant: "destructive" });
    } finally {
      setIsFetching(false);
    }
  }, [user, selectedCompanyId, toast]);

  useEffect(() => {
    if (user) {
      fetchContacts();
    } else {
      setContacts([]);
    }
  }, [user, fetchContacts]);

  const requestSort = (key: keyof Omit<ContactItem, 'userId' | 'createdAt'>) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedContacts = useMemo(() => {
    let items = [...contacts];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      items = items.filter(item =>
        item.name.toLowerCase().includes(lowerSearchTerm) ||
        (item.address && item.address.toLowerCase().includes(lowerSearchTerm)) ||
        (item.contactNumber && item.contactNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.email && item.email.toLowerCase().includes(lowerSearchTerm)) ||
        item.type.toLowerCase().includes(lowerSearchTerm)
      );
    }
    if (sortConfig.key) {
      const key = sortConfig.key;
      items.sort((a, b) => {
        const valA = String(a[key] ?? '').toLowerCase();
        const valB = String(b[key] ?? '').toLowerCase();
        return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });
    }
    return items;
  }, [contacts, sortConfig, searchTerm]);

  const SortIndicator = ({ columnKey }: { columnKey: keyof Omit<ContactItem, 'userId' | 'createdAt'> }) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'ascending' ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />;
    }
    return null;
  };

  const handleToggleSelectContact = (contactId: string, checked: boolean, isShift: boolean) => {
    setSelectedContactIds(prev => {
      if (isShift && lastSelectedContactId && lastSelectedContactId !== contactId) {
        const currentIndex = filteredAndSortedContacts.findIndex(c => c.id === contactId);
        const lastIndex = filteredAndSortedContacts.findIndex(c => c.id === lastSelectedContactId);
        if (currentIndex === -1 || lastIndex === -1) return checked ? [...prev, contactId] : prev.filter(id => id !== contactId);
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const idsInRange = filteredAndSortedContacts.slice(start, end + 1).map(c => c.id);
        return checked ? Array.from(new Set([...prev, ...idsInRange])) : prev.filter(id => !idsInRange.includes(id));
      } else {
        if (!isShift) setLastSelectedContactId(contactId);
        return checked ? [...prev, contactId] : prev.filter(id => id !== contactId);
      }
    });
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setSelectedContactIds(checked ? filteredAndSortedContacts.map(c => c.id) : []);
    setLastSelectedContactId(null);
  };

  const handleOpenCreateOrEditDialog = (contact: ContactItem | null = null) => {
    setEditingContact(contact);
    contactForm.reset(contact ? {
      name: contact.name,
      address: contact.address || "",
      contactNumber: contact.contactNumber || "",
      email: contact.email || "",
      type: contact.type
    } : {
      name: "", address: "", contactNumber: "", email: "", type: undefined
    });
    setIsCreateOrEditDialogOpen(true);
  };

  const handleSaveContact: SubmitHandler<ContactFormValues> = async (data) => {
    if (!user|| !selectedCompanyId ) return;
    setIsLoading(true);

    const contactData = {
      companyId: selectedCompanyId,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      // updatedBy: user.uid,
      // updatedAt: serverTimestamp(),
      name: data.name,
      address: data.address || null,
      contactNumber: data.contactNumber || null,
      email: data.email || null,
      type: data.type,
    };
    
    try {
      if (editingContact) {
        const contactRef = doc(db, "contacts", editingContact.id);
        await updateDoc(contactRef, {
          ...contactData,
          updatedBy: user.uid,
          updatedAt: serverTimestamp()
        });
        await logAction("update", "contacts", Object.keys(data));
        toast({ title: "Contact Updated", description: "The contact details have been updated." });
      } else {
        const contactRef = collection(db, "contacts");
        await addDoc(contactRef, contactData);
        await logAction("create", "contacts", Object.keys(data));
        toast({ title: "Contact Created", description: "The new contact has been added." });
      }
      await fetchContacts();
      setIsCreateOrEditDialogOpen(false);
      setEditingContact(null);
    } catch (error) {
      console.error("Error saving contact: ", error);
      toast({ title: "Save Error", description: "Could not save contact details.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!user || !selectedCompanyId) return;
    setIsLoading(true);
    try {
      const contactRef = doc(db, "contacts", contactId);
      await deleteDoc(contactRef);
      await logAction("delete", "contacts");
      setContacts(prev => prev.filter(c => c.id !== contactId));
      setSelectedContactIds(prev => prev.filter(id => id !== contactId));
      toast({ title: "Contact Deleted", description: "The contact has been removed." });
    } catch (error) {
      console.error("Error deleting contact: ", error);
      toast({ title: "Delete Error", description: "Could not delete the contact.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (!user || !selectedCompanyId || selectedContactIds.length === 0) return;;
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      selectedContactIds.forEach(id => {
        const contactRef = doc(db, "contacts", id);
        batch.delete(contactRef);
      });
      await batch.commit();
      await logAction("bulk_delete", "contacts", [`${selectedContactIds.length}`]);
      toast({ title: "Bulk Delete Successful", description: `${selectedContactIds.length} contacts deleted.` });
      await fetchContacts();
      setSelectedContactIds([]);
    } catch (error) {
      console.error("Error bulk deleting contacts:", error);
      toast({ title: "Bulk Delete Failed", description: "Could not delete selected contacts.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsBulkDeleteDialogOpen(false);
    }
  };
  
  const handleSaveBulkEdit = async () => {
    if (!user ||  !selectedCompanyId ||  selectedContactIds.length  === 0 || !bulkEditType) {
        toast({title: "No Type Specified", description: "Please select a type to update.", variant: "destructive"});
        return;
    }
    setIsLoading(true);
    try {
       const batch = writeBatch(db);
        selectedContactIds.forEach(id => {
          batch.update(doc(db, "contacts", id), { 
            type: bulkEditType,
            updatedBy: user.uid,
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
        await logAction("bulk_update", "contacts", ["type"]);
        toast({title: "Bulk Edit Successful", description: `${selectedContactIds.length} contacts updated to type: ${bulkEditType}.`});
        await fetchContacts();
        setSelectedContactIds([]);
        setIsBulkEditDialogOpen(false);
        setBulkEditType("");
    } catch (error) {
        console.error("Error bulk editing contact types:", error);
        toast({title: "Bulk Edit Failed", description: "Could not update contact types.", variant: "destructive"});
    } finally {
        setIsLoading(false);
    }
  };


  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setIsLoading(true); // Using general isLoading
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // const data = e.target?.result;
          // const workbook = XLSX.read(data, { type: 'array', defval: "" });
          // const sheetName = workbook.SheetNames[0];
          // const worksheet = workbook.Sheets[sheetName];
          // const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });
          // if (jsonData.length > 0 && jsonData[0].length > 0) {
          //   setExcelHeaders(jsonData[0] as string[]);
          //   setExcelData(jsonData.slice(1));
          //   setColumnMappings({ name: '', address: '', contactNumber: '', email: '', type: '' });
          // } else {
          //   setExcelHeaders([]); setExcelData([]);
          //   toast({ title: "Empty File", description: "Selected file is empty or has no headers.", variant: "destructive" });
          // }

          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array', defval: "" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, defval: "" });

          if (jsonData.length > 0 && jsonData[0].length > 0) {
            // Clean headers - replace empty/whitespace with "Column_X"
            const cleanedHeaders = jsonData[0].map((h, index) => {
              const str = String(h || '').trim();
              return str || `Column_${index + 1}`; 
            });
            
            setExcelHeaders(cleanedHeaders);
            setExcelData(jsonData.slice(1));
            setColumnMappings({ name: '', address: '', contactNumber: '', email: '', type: '' });
          }

        } catch (error) {
          console.error("Error parsing Excel:", error);
          toast({ title: "Parsing Error", description: "Could not parse Excel file.", variant: "destructive" });
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleMappingChange = (field: keyof ColumnMapping, value: string) => {
    setColumnMappings(prev => ({ ...prev, [field]: value === SKIP_COLUMN_VALUE ? '' : value }));
  };

  const handleImportData = async () => {
    if (!user || !selectedCompanyId || !columnMappings.name || !columnMappings.type) {
      toast({ title: "Mapping Incomplete", description: "Please map 'Name' and 'Type' columns.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    let importedCount = 0;
    const batch = writeBatch(db);
    try {
      excelData.forEach(row => {
        const name = String(row[excelHeaders.indexOf(columnMappings.name)] || '').trim();
        const typeRaw = String(row[excelHeaders.indexOf(columnMappings.type)] || '').trim();
        if (!name || (typeRaw.toLowerCase() !== "customer" && typeRaw.toLowerCase() !== "vendor")) return; // Skip invalid rows

        const newContact: Omit<ContactItem, 'id'> = {
          companyId: selectedCompanyId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          // updatedBy: user.uid,
          // updatedAt: serverTimestamp(),
          name,
          address: columnMappings.address ? String(row[excelHeaders.indexOf(columnMappings.address)] || '').trim() : null,
          contactNumber: columnMappings.contactNumber ? String(row[excelHeaders.indexOf(columnMappings.contactNumber)] || '').trim() : null,
          email: columnMappings.email ? String(row[excelHeaders.indexOf(columnMappings.email)] || '').trim() : null,
          type: typeRaw as "Customer" | "Vendor",
        };
        batch.set(doc(collection(db, "contacts")), { ...newContact, createdAt: serverTimestamp() });
        importedCount++;
      });
      if (importedCount > 0){ await batch.commit()
        await logAction("import", "contacts", [String(importedCount)]);
      };
      toast({ title: "Import Complete", description: `${importedCount} contacts imported.` });
      await fetchContacts();
      setIsImportDialogOpen(false);
      setSelectedFile(null); setExcelHeaders([]); setExcelData([]);
    } catch (error) {
      console.error("Error importing contacts:", error);
      toast({ title: "Import Error", description: "Could not import contacts.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportToExcel = () => {
    if (filteredAndSortedContacts.length === 0) {
      toast({ title: "No Data", description: "No contacts to export.", variant: "default" });
      return;
    }
    const exportData = filteredAndSortedContacts.map(c => ({
      Name: c.name, Address: c.address || '', 'Contact Number': c.contactNumber || '', Email: c.email || '', Type: c.type
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts");
    XLSX.writeFile(workbook, `contacts_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast({ title: "Export Successful", description: "Contacts exported to Excel." });
  };

  const targetImportColumns: Array<{ key: keyof ColumnMapping; label: string; isOptional?: boolean }> = [
    { key: "name", label: "Name *" },
    { key: "address", label: "Address", isOptional: true },
    { key: "contactNumber", label: "Contact Number", isOptional: true },
    { key: "email", label: "Email", isOptional: true },
    { key: "type", label: "Type (Customer/Vendor) *" },
  ];

  const commonButtonDisabled = isLoading || isFetching;
  const isSelectAllChecked = useMemo(() => {
    if (filteredAndSortedContacts.length === 0) return false;
    return filteredAndSortedContacts.every(c => selectedContactIds.includes(c.id));
  }, [filteredAndSortedContacts, selectedContactIds]);

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-8 animate-fade-in">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 font-headline flex items-center">
              <Users className="mr-3 h-10 w-10 text-primary" /> Customers &amp; Vendors
            </h1>
            <p className="text-lg text-muted-foreground">Manage your contacts.</p>
          </div>
          <div className="flex items-center space-x-2">
            <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={commonButtonDisabled}><Upload className="mr-2 h-4 w-4" /> Import</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                  <DialogTitle>Import Contacts from Excel</DialogTitle>
                  <DialogDescription>Map columns. 'Name' and 'Type' (must be 'Customer' or 'Vendor') are required.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <Input id="excel-file-contact" type="file" accept=".xlsx, .xls, .csv" onChange={handleFileChange} />
                  {excelHeaders.length > 0 && (
                    <ScrollArea className="max-h-[300px] mt-4">
                      {targetImportColumns.map(col => (
                        <div key={col.key} className="grid grid-cols-4 items-center gap-4 mb-2">
                          <Label htmlFor={`map-${col.key}`} className="text-right">{col.label}</Label>
                          <Select value={columnMappings[col.key] || SKIP_COLUMN_VALUE} onValueChange={(val) => handleMappingChange(col.key, val)}>
                            <SelectTrigger className="col-span-3"><SelectValue placeholder={col.isOptional ? "Select (Optional)" : "Select Column"} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP_COLUMN_VALUE}><em>Skip</em></SelectItem>
                              {/* {excelHeaders.map((h, idx) => <SelectItem key={idx} value={h}>{h}</SelectItem>)} */}
                              {excelHeaders
                                  .filter(h => h)
                                  .map((h, idx) => (
                                    <SelectItem key={`${col.key}-${idx}`} value={h}>
                                      {h}
                                    </SelectItem>
                                  ))
                                }
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </ScrollArea>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleImportData} disabled={excelHeaders.length === 0 || isLoading || !columnMappings.name || !columnMappings.type}>Import Data</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={handleExportToExcel} disabled={commonButtonDisabled || filteredAndSortedContacts.length === 0}>
              <FileDown className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button variant="default" onClick={() => handleOpenCreateOrEditDialog()} disabled={commonButtonDisabled}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Contact
            </Button>
            <Button variant="outline" asChild><Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Dashboard</Link></Button>
          </div>
        </header>

        <div className="mb-4 flex justify-between items-center">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder="Search contacts..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" disabled={commonButtonDisabled} />
          </div>
          {selectedContactIds.length > 0 && (
            <div className="p-3 bg-muted rounded-md shadow flex items-center justify-between ml-4 flex-grow">
              <span className="text-sm font-medium">{selectedContactIds.length} selected</span>
              <div className="space-x-2">
                <Button size="sm" variant="outline" onClick={() => setIsBulkEditDialogOpen(true)} disabled={commonButtonDisabled}><Edit3 className="mr-2 h-4 w-4" /> Bulk Edit Type</Button>
                <Button size="sm" variant="destructive" onClick={() => setIsBulkDeleteDialogOpen(true)} disabled={commonButtonDisabled}><Trash2 className="mr-2 h-4 w-4" /> Bulk Delete</Button>
              </div>
            </div>
          )}
        </div>

        <Card className="shadow-lg">
          <CardHeader><CardTitle>Contact List</CardTitle></CardHeader>
          <CardContent>
            {isFetching ? (
              <div className="flex justify-center items-center py-10"><LoadingSpinner size="lg" /><span className="ml-3">Loading...</span></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"><Checkbox checked={isSelectAllChecked} onCheckedChange={handleToggleSelectAll} /></TableHead>
                      <TableHead className="cursor-pointer" onClick={() => requestSort('name')}><div className="flex items-center">Name <SortIndicator columnKey="name" /></div></TableHead>
                      <TableHead className="cursor-pointer" onClick={() => requestSort('address')}><div className="flex items-center">Address <SortIndicator columnKey="address" /></div></TableHead>
                      <TableHead className="cursor-pointer" onClick={() => requestSort('contactNumber')}><div className="flex items-center">Contact <SortIndicator columnKey="contactNumber" /></div></TableHead>
                      <TableHead className="cursor-pointer" onClick={() => requestSort('email')}><div className="flex items-center">Email <SortIndicator columnKey="email" /></div></TableHead>
                      <TableHead className="cursor-pointer" onClick={() => requestSort('type')}><div className="flex items-center">Type <SortIndicator columnKey="type" /></div></TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedContacts.length > 0 ? (
                      filteredAndSortedContacts.map(contact => (
                        <TableRow key={contact.id} data-state={selectedContactIds.includes(contact.id) ? "selected" : ""}>
                          <TableCell><Checkbox checked={selectedContactIds.includes(contact.id)} onPointerDown={e => setIsShiftKeyPressed(e.shiftKey)} onCheckedChange={c => handleToggleSelectContact(contact.id, Boolean(c), isShiftKeyPressed)} /></TableCell>
                          <TableCell>{contact.name}</TableCell>
                          <TableCell>{contact.address || '-'}</TableCell>
                          <TableCell>{contact.contactNumber || '-'}</TableCell>
                          <TableCell>{contact.email || '-'}</TableCell>
                          <TableCell>{contact.type}</TableCell>
                          <TableCell className="text-center space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => handleOpenCreateOrEditDialog(contact)} disabled={commonButtonDisabled}><Edit className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteContact(contact.id)} disabled={commonButtonDisabled}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={7} className="text-center py-10">{searchTerm ? "No contacts match." : "No contacts found."}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isCreateOrEditDialogOpen} onOpenChange={isOpen => { if (!isOpen) setEditingContact(null); setIsCreateOrEditDialogOpen(isOpen); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact" : "Create New Contact"}</DialogTitle>
            <DialogDescription>{editingContact ? "Update the contact details." : "Fill in the form to add a new contact."}</DialogDescription>
          </DialogHeader>
          <Form {...contactForm}>
            <form onSubmit={contactForm.handleSubmit(handleSaveContact)} className="grid gap-4 py-4">
              <FormField control={contactForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={contactForm.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="123 Main St" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={contactForm.control} name="contactNumber" render={({ field }) => (
                <FormItem><FormLabel>Contact Number</FormLabel><FormControl><Input placeholder="(555) 123-4567" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={contactForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="john@example.com" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={contactForm.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Type *</FormLabel>
                  <RadioGroup onValueChange={field.onChange} value={field.value} className="flex space-x-4">
                    <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="Customer" /></FormControl><FormLabel className="font-normal">Customer</FormLabel></FormItem>
                    <FormItem className="flex items-center space-x-2"><FormControl><RadioGroupItem value="Vendor" /></FormControl><FormLabel className="font-normal">Vendor</FormLabel></FormItem>
                  </RadioGroup><FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOrEditDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>{isLoading ? <LoadingSpinner /> : "Save Contact"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isBulkEditDialogOpen} onOpenChange={setIsBulkEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Bulk Edit Contact Type</DialogTitle>
                <DialogDescription>Update type for {selectedContactIds.length} selected contact(s).</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <Label htmlFor="bulk-edit-type-select">New Type</Label>
                 <Select value={bulkEditType} onValueChange={(val: "Customer" | "Vendor" | "") => setBulkEditType(val)}>
                    <SelectTrigger id="bulk-edit-type-select"><SelectValue placeholder="Select new type..." /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value=""><em>(No Change)</em></SelectItem>
                        <SelectItem value="Customer">Customer</SelectItem>
                        <SelectItem value="Vendor">Vendor</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsBulkEditDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveBulkEdit} disabled={isLoading || !bulkEditType}>Apply Changes</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-headline flex items-center"><AlertTriangle className="mr-2 h-6 w-6 text-destructive" /> Confirm Bulk Delete</DialogTitle><DialogDescription>Delete {selectedContactIds.length} contacts? This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)}>Cancel</Button><Button variant="destructive" onClick={handleConfirmBulkDelete} disabled={isLoading}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </AuthGuard>
  );
}

    