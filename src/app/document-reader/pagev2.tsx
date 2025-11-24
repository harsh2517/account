
"use client"

import { ScrollArea } from "@/components/ui/scroll-area"

import AuthGuard from "@/components/auth/AuthGuard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  FileScan,
  ArrowLeft,
  UploadCloud,
  FileDown,
  AlertTriangle,
  Send,
  Download,
  DollarSign,
  PlusCircle,
  Trash2,
  CalendarDays,
  ChevronsUpDown,
  Info,
  Repeat,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useState, type ChangeEvent, useCallback, useMemo, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import LoadingSpinner from "@/components/ui/loading-spinner"
import type { ExtractTabularDataInput, ExtractTabularDataOutput } from "@/ai/flows/extract-tabular-data-flow"
import { extractDataFromDocument } from "@/ai/flows/extract-tabular-data-flow"
import * as XLSX from "xlsx"
import { useAuth } from "@/context/AuthContext"
import { db, serverTimestamp } from "@/lib/firebase"
import { collection, doc, writeBatch, query, where, getDocs, type Timestamp } from "firebase/firestore"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { format, parse as dateFnsParse, isValid as isDateValid, setYear } from "date-fns"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCompany } from "@/context/CompanyContext"
import { useAuditLog } from "@/hooks/useAuditLog"
import { Progress } from "@/components/ui/progress"
import * as pdfjs from "pdfjs-dist"
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

const DOCUMENT_COLUMNS_DEFINITION = {
  bankStatement: ["Date", "Description", "Amount Paid", "Amount Received", "Balance", "Calculated Balance"],
  vendorBill: [
    "Date",
    "Vendor Name",
    "Bill Number",
    "Description",
    "Unit Price",
    "Quantity",
    "Amount",
    "Total GST",
    "Total Amount",
  ],
  check: ["Date", "Check Number", "Vendor", "Amount", "Memo/Narration"],
}

type DocumentType = "bankStatement" | "vendorBill" | "check"

interface TransactionData {
  companyId: string
  createdBy: string
  updatedBy: string
  date: string
  description: string
  bankName: string
  vendor: string
  glAccount: string
  amountPaid: number | null
  amountReceived: number | null
  createdAt: Timestamp
  updatedAt: Timestamp
  isLedgerApproved: boolean
}

interface SkippedRowData {
  originalRow: string[]
  reason: string
}

const FS_OPTIONS = ["Profit and Loss", "Balance Sheet"] as const
type FSOption = (typeof FS_OPTIONS)[number]

const TYPE_OPTIONS = [
  "Direct Income",
  "Indirect Income",
  "Direct Expense",
  "Indirect Expense",
  "Non Current Asset",
  "Current Asset",
  "Current Liability",
  "Non Current Liability",
  "Equity",
] as const
type TypeOption = (typeof TYPE_OPTIONS)[number]

interface ChartOfAccountItem {
  id: string
  userId?: string
  glAccount: string
  subType: string
  type: TypeOption
  fs?: FSOption
  accountNumber?: string
  createdAt?: Timestamp
}

interface FinancialSummary {
  openingBalance: number
  totalPaid: number
  totalReceived: number
  calculatedClosingBalance: number
}

const DATE_FORMAT_OPTIONS = [
  { value: "MM/dd/yyyy", label: "MM/DD/YYYY" },
  { value: "dd/MM/yyyy", label: "DD/MM/YYYY" },
  { value: "yyyy-MM-dd", label: "YYYY-MM-DD" },
  { value: "MM-dd-yyyy", label: "MM-DD-YYYY" },
  { value: "M/d/yy", label: "M/D/YY" },
  { value: "dd-MMM-yy", label: "DD-MMM-YY (e.g., 25-Jul-23)" },
]

const cleanAmountString = (s: string | number): string => {
  if (typeof s !== "string") s = String(s ?? "")
  const cleaned = s.replace(/[^0-9.-]+/g, "")
  const num = Number.parseFloat(cleaned)
  return isNaN(num) ? "0.00" : num.toFixed(2)
}

const parseAndFormatDateToYYYYMMDD = (dateStr: string, userFormat?: string): string => {
  if (!dateStr || String(dateStr).trim() === "") return ""
  const trimmedDateStr = String(dateStr).trim()

  if (userFormat) {
    try {
      const parsedWithUserFormat = dateFnsParse(trimmedDateStr, userFormat, new Date())
      if (isDateValid(parsedWithUserFormat)) {
        return format(parsedWithUserFormat, "yyyy-MM-dd")
      }
    } catch (e) {
      /* ignore parse error with user format, try others */
    }
  }

  const commonFormats = [
    "yyyy-MM-dd",
    "MM/dd/yyyy",
    "dd/MM/yyyy",
    "MM-dd-yyyy",
    "M/d/yy",
    "MM/dd/yy",
    "dd/MM/yy",
    "yy/MM/dd",
    "M/d/yyyy",
    "d/M/yyyy",
    "yyyy/MM/dd",
    "yyyy.MM.dd",
    "dd-MMM-yy",
    "dd-MMM-yyyy",
    "MMM d, yyyy",
    "d MMM yyyy",
  ]
  for (const fmt of commonFormats) {
    try {
      const parsed = dateFnsParse(trimmedDateStr, fmt, new Date())
      if (isDateValid(parsed)) {
        return format(parsed, "yyyy-MM-dd")
      }
    } catch (e) {
      /* ignore parse error for this format */
    }
  }
  try {
    const genericParsed = new Date(trimmedDateStr)
    if (isDateValid(genericParsed)) {
      if (String(dateStr).length > 4 || genericParsed.getFullYear() > 1970) {
        return format(genericParsed, "yyyy-MM-dd")
      }
    }
  } catch (e) {
    /* ignore generic parse error */
  }

  console.warn(`Could not parse date string: "${trimmedDateStr}" into a known YYYY-MM-DD format. Returning original.`)
  return trimmedDateStr
}

export default function DocumentReaderPage() {
  const { user } = useAuth()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<DocumentType | null>(null)
  const [selectedDateFormat, setSelectedDateFormat] = useState<string | undefined>(undefined)
  const [editableTableData, setEditableTableData] = useState<string[][]>([])
  const [isConverting, setIsConverting] = useState(false)
  const [conversionProgress, setConversionProgress] = useState(0)
  const [isSendingToBank, setIsSendingToBank] = useState(false)
  const [conversionMessage, setConversionMessage] = useState<string | null>(null)
  const { toast } = useToast()

  const [bankGlAccountToApply, setBankGlAccountToApply] = useState<string>("")
  const [isBankGlAccountDialogOpen, setIsBankGlAccountDialogOpen] = useState<boolean>(false)

  const [isSendSummaryDialogOpen, setIsSendSummaryDialogOpen] = useState<boolean>(false)
  const [sendSummaryData, setSendSummaryData] = useState<{ sentCount: number; skippedCount: number } | null>(null)
  const [skippedRowsForDownload, setSkippedRowsForDownload] = useState<SkippedRowData[]>([])

  const [chartOfAccounts, setChartOfAccounts] = useState<ChartOfAccountItem[]>([])
  const [isFetchingChartOfAccounts, setIsFetchingChartOfAccounts] = useState(true)

  const [openingBalanceInput, setOpeningBalanceInput] = useState<string>("")
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null)

  const [isYearUpdateDialogOpen, setIsYearUpdateDialogOpen] = useState(false)
  const [yearToUpdate, setYearToUpdate] = useState<string>("")

  const { selectedCompanyId } = useCompany()
  const { logAction } = useAuditLog()

  const [displayedTableData, setDisplayedTableData] = useState<string[][]>([])
  const [processingBatches, setProcessingBatches] = useState<boolean>(false)
  const [currentBatch, setCurrentBatch] = useState<number>(0)
  const [totalBatches, setTotalBatches] = useState<number>(0)
  const [batchProgress, setBatchProgress] = useState<number>(0)

  const fetchChartOfAccounts = useCallback(async () => {
    if (!user || !selectedCompanyId) {
      setIsFetchingChartOfAccounts(false)
      return
    }
    setIsFetchingChartOfAccounts(true)
    try {
      const q = query(collection(db, "chartOfAccounts"), where("companyId", "==", selectedCompanyId))
      const querySnapshot = await getDocs(q)
      const fetchedItems: ChartOfAccountItem[] = []
      querySnapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...(doc.data() as Omit<ChartOfAccountItem, "id">) })
      })
      fetchedItems.sort((a, b) => a.glAccount.localeCompare(b.glAccount))
      setChartOfAccounts(fetchedItems)
    } catch (error) {
      console.error("Error fetching chart of accounts:", error)
      toast({ title: "Error", description: "Could not fetch chart of accounts.", variant: "destructive" })
    } finally {
      setIsFetchingChartOfAccounts(false)
    }
  }, [user, selectedCompanyId, toast])

  useEffect(() => {
    if (user) {
      fetchChartOfAccounts()
    }
  }, [user, fetchChartOfAccounts])

  const displayHeaders = useMemo(() => {
    if (!selectedFileType) return []

    // For vendorBill and check, if the AI provided headers that look like headers, use them.
    if (selectedFileType === "vendorBill" || selectedFileType === "check") {
      if (editableTableData && editableTableData.length > 0) {
        const firstRow = editableTableData[0]
        const firstRowLooksLikeHeader = firstRow.some(
          (cell) =>
            typeof cell === "string" &&
            isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
            !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
        )
        if (firstRowLooksLikeHeader) {
          return firstRow // Use the header row returned by the AI.
        }
      }
    }
    // For all other cases, use our predefined headers.
    return DOCUMENT_COLUMNS_DEFINITION[selectedFileType]
  }, [selectedFileType, editableTableData])

  const dataRowsForRendering = useMemo(() => {
    if (!displayedTableData || displayedTableData.length === 0) return []

    const firstRow = displayedTableData[0]
    const firstRowLooksLikeHeader = firstRow.some(
      (cell) =>
        typeof cell === "string" &&
        isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
        !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
    )

    return firstRowLooksLikeHeader ? displayedTableData.slice(1) : displayedTableData
  }, [displayedTableData])

  useEffect(() => {
    if (selectedFileType === "bankStatement" && displayedTableData && displayedTableData.length > 0) {
      const openingBal = Number.parseFloat(openingBalanceInput.replace(/[^0-9.-]+/g, "")) || 0
      let totalPaid = 0
      let totalReceived = 0

      const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid")
      const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received")

      dataRowsForRendering.forEach((row) => {
        const paidVal = Number.parseFloat(String(row[paidColIndex] || "0").replace(/[^0-9.-]/g, ""))
        const receivedVal = Number.parseFloat(String(row[receivedColIndex] || "0").replace(/[^0-9.-]/g, ""))
        if (!isNaN(paidVal)) totalPaid += paidVal
        if (!isNaN(receivedVal)) totalReceived += receivedVal
      })

      setFinancialSummary({
        openingBalance: openingBal,
        totalPaid: totalPaid,
        totalReceived: totalReceived,
        calculatedClosingBalance: openingBal + totalReceived - totalPaid,
      })
    } else if (selectedFileType === "bankStatement") {
      const openingBal = Number.parseFloat(openingBalanceInput.replace(/[^0-9.-]/g, "")) || 0
      setFinancialSummary({
        openingBalance: openingBal,
        totalPaid: 0,
        totalReceived: 0,
        calculatedClosingBalance: openingBal,
      })
    } else {
      setFinancialSummary(null)
    }
  }, [editableTableData, dataRowsForRendering, openingBalanceInput, selectedFileType, displayedTableData])

  const correctBankStatementColumns = (aiExtractedTable: string[][], userDateFormat?: string): string[][] => {
    if (!aiExtractedTable || aiExtractedTable.length === 0) return []

    const firstRowIsHeader = aiExtractedTable[0].some((cell) => {
      if (typeof cell !== "string") return false
      const cellTrimmed = cell.trim()
      return (
        isNaN(Number.parseFloat(cellTrimmed.replace(/[^0-9.-]/g, ""))) &&
        !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cellTrimmed) &&
        !/^\d{1,2}$/.test(cellTrimmed)
      )
    })

    const dataRowsOnly = firstRowIsHeader ? aiExtractedTable.slice(1) : aiExtractedTable
    const processedRows: string[][] = []

    for (const row of dataRowsOnly) {
      if (row.length < 2) {
        continue
      }

      const originalAiDate = String(row[0] || "").trim()
      const formattedDate = parseAndFormatDateToYYYYMMDD(originalAiDate, userDateFormat) // Use userDateFormat
      const aiDescription = String(row[1] || "").trim()
      const aiPaidStr = String(row[2] || "0").trim()
      const aiReceivedStr = String(row[3] || "0").trim()
      const aiBalanceStr = String(row[4] || "0").trim()
      let finalPaid = "0.00"
      let finalReceived = "0.00"
      const paidNumeric = Number.parseFloat(aiPaidStr.replace(/[^0-9.-]/g, ""))
      const receivedNumeric = Number.parseFloat(aiReceivedStr.replace(/[^0-9.-]/g, ""))
      const paidHasDr = aiPaidStr.toUpperCase().includes("DR")
      const paidHasCr = aiPaidStr.toUpperCase().includes("CR")
      const receivedHasDr = aiReceivedStr.toUpperCase().includes("DR")
      const receivedHasCr = aiReceivedStr.toUpperCase().includes("CR")

      if (paidHasDr) {
        finalPaid = cleanAmountString(aiPaidStr)
        finalReceived = "0.00"
      } else if (paidHasCr) {
        finalReceived = cleanAmountString(aiPaidStr)
        finalPaid = "0.00"
      } else if (receivedHasDr) {
        finalPaid = cleanAmountString(aiReceivedStr)
        finalReceived = "0.00"
      } else if (receivedHasCr) {
        finalReceived = cleanAmountString(aiReceivedStr)
        finalPaid = "0.00"
      } else {
        if (!isNaN(paidNumeric) && paidNumeric !== 0) {
          finalPaid = cleanAmountString(aiPaidStr)
          if (!isNaN(receivedNumeric) && receivedNumeric !== 0) {
            if (paidNumeric < 0) {
              finalReceived = cleanAmountString(String(-paidNumeric))
              finalPaid = "0.00"
            } else if (receivedNumeric < 0) {
              finalPaid = cleanAmountString(String(-receivedNumeric))
              finalReceived = "0.00"
            } else {
              finalReceived = "0.00"
            }
          } else {
            finalReceived = "0.00"
          }
        } else if (!isNaN(receivedNumeric) && receivedNumeric !== 0) {
          finalReceived = cleanAmountString(aiReceivedStr)
          finalPaid = "0.00"
        }
      }
      if (Number.parseFloat(finalPaid) > 0 && Number.parseFloat(finalReceived) > 0) {
        if (aiPaidStr && aiPaidStr !== "0" && aiPaidStr !== "0.00") {
          finalReceived = "0.00"
        } else {
          finalPaid = "0.00"
        }
      }
      processedRows.push([formattedDate, aiDescription, finalPaid, finalReceived, cleanAmountString(aiBalanceStr)])
    }
    return firstRowIsHeader && aiExtractedTable[0] ? [aiExtractedTable[0], ...processedRows] : processedRows
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"]
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: `Please select a PDF, JPEG, or PNG file.`,
          variant: "destructive",
        })
        return
      }
      setSelectedFile(file)
      setEditableTableData([])
      setConversionMessage(null)
      setSkippedRowsForDownload([])
      setFinancialSummary(null)
      setConversionProgress(0)
    } else {
      setSelectedFile(null)
    }
  }

  const handleFileTypeChange = (value: DocumentType) => {
    setSelectedFileType(value)
    setEditableTableData([])
    setConversionMessage(null)
    setSkippedRowsForDownload([])
    setFinancialSummary(null)
    setSelectedDateFormat(undefined) // Reset date format when doc type changes
    if (value !== "bankStatement") {
      setOpeningBalanceInput("")
    }
  }

  const handleConvertToTable = useCallback(async () => {
    if (!selectedFile) {
      toast({ title: "No File Selected", description: "Please select a file first.", variant: "destructive" })
      return
    }
    if (!selectedFileType) {
      toast({
        title: "Document Type Missing",
        description: "Please select the type of document.",
        variant: "destructive",
      })
      return
    }
    if (selectedFileType === "bankStatement" && openingBalanceInput.trim() === "") {
      toast({
        title: "Opening Balance Required",
        description: "Please enter the opening balance for the bank statement.",
        variant: "destructive",
      })
      return
    }

    setIsConverting(true)
    setEditableTableData([])
    setDisplayedTableData([])
    setProcessingBatches(false)
    setCurrentBatch(0)
    setTotalBatches(0)
    setBatchProgress(0)
    setConversionMessage(`Preparing ${selectedFile.name}...`)
    setConversionProgress(0)

    const allExtractedRows: string[][] = []
    let displayRows: string[][] = []

    try {
      const fileAsBuffer = await selectedFile.arrayBuffer()

      if (selectedFile.type === "application/pdf") {
        const pdf = await pdfjs.getDocument(fileAsBuffer).promise
        const numPages = pdf.numPages

        const BATCH_SIZE = 5
        const totalBatchCount = Math.ceil(numPages / BATCH_SIZE)
        setTotalBatches(totalBatchCount)
        setProcessingBatches(true)

        for (let batchIndex = 0; batchIndex < totalBatchCount; batchIndex++) {
          setCurrentBatch(batchIndex + 1)
          const startPage = batchIndex * BATCH_SIZE + 1
          const endPage = Math.min((batchIndex + 1) * BATCH_SIZE, numPages)

          setConversionMessage(
            `Processing batch ${batchIndex + 1} of ${totalBatchCount} (pages ${startPage}-${endPage})...`,
          )

          const batchRows: string[][] = []

          for (let i = startPage; i <= endPage; i++) {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 2 })
            const canvas = document.createElement("canvas")
            const context = canvas.getContext("2d")
            canvas.height = viewport.height
            canvas.width = viewport.width

            if (context) {
              await page.render({ canvasContext: context, viewport: viewport }).promise
              const pageDataUri = canvas.toDataURL("image/jpeg")

              const input: ExtractTabularDataInput = {
                documentDataUri: pageDataUri,
                mimeType: "image/jpeg",
                documentType: selectedFileType,
              }
              const result: ExtractTabularDataOutput = await extractDataFromDocument(input)

              if (result.extractedTable && result.extractedTable.length > 0) {
                const dataPortion = result.extractedTable.slice(
                  allExtractedRows.length === 0 && i === startPage ? 0 : 1,
                )
                batchRows.push(...dataPortion)
              }
            }

            const pageProgress = ((i - startPage + 1) / (endPage - startPage + 1)) * 100
            setBatchProgress(pageProgress)
          }

          allExtractedRows.push(...batchRows)

          if (batchRows.length > 0) {
            let processedBatchData = [...displayRows, ...batchRows]

            if (selectedFileType === "bankStatement") {
              processedBatchData = correctBankStatementColumns(processedBatchData, selectedDateFormat)
            }

            setDisplayedTableData([...processedBatchData])
            displayRows = processedBatchData

            setConversionMessage(
              `Batch ${batchIndex + 1} completed! Showing ${processedBatchData.length} rows so far...`,
            )
          }

          setConversionProgress(((batchIndex + 1) / totalBatchCount) * 100)

          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        if (allExtractedRows.length > 0) {
          let finalProcessedData = allExtractedRows
          if (selectedFileType === "bankStatement") {
            finalProcessedData = correctBankStatementColumns(finalProcessedData, selectedDateFormat)
          }
          setEditableTableData(finalProcessedData)
          setDisplayedTableData(finalProcessedData)
          setConversionMessage(
            `Successfully processed all ${numPages} pages from ${selectedFile.name}. Total rows: ${finalProcessedData.length}`,
          )
        }
      } else {
        setProcessingBatches(true)
        setTotalBatches(1)
        setCurrentBatch(1)

        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.readAsDataURL(selectedFile)
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = (error) => reject(error)
        })

        setBatchProgress(50)
        const input: ExtractTabularDataInput = {
          documentDataUri: dataUri,
          mimeType: selectedFile.type,
          documentType: selectedFileType,
        }
        const result: ExtractTabularDataOutput = await extractDataFromDocument(input)

        if (result.extractedTable && result.extractedTable.length > 0) {
          allExtractedRows.push(...result.extractedTable)
          setDisplayedTableData(result.extractedTable)
          setEditableTableData(result.extractedTable)
        }
        setBatchProgress(100)
        setConversionProgress(100)
      }

      if (allExtractedRows.length > 0) {
        setConversionMessage(
          `Successfully processed ${selectedFile.name}. Total rows extracted: ${allExtractedRows.length}`,
        )
      } else {
        setEditableTableData([])
        setDisplayedTableData([])
        setConversionMessage(`No table found in ${selectedFile.name}. Could not find tabular data.`)
      }
    } catch (aiError) {
      console.error(`Error processing ${selectedFile.name}:`, aiError)
      setConversionMessage(
        `Error processing ${selectedFile.name}. ${aiError instanceof Error ? aiError.message : "An unexpected error."}`,
      )
      setEditableTableData([])
      setDisplayedTableData([])
      setFinancialSummary(null)
      toast({
        title: "Processing Error",
        description: `Could not process the document. Please try again.`,
        variant: "destructive",
      })
    } finally {
      setIsConverting(false)
      setProcessingBatches(false)
      setCurrentBatch(0)
      setTotalBatches(0)
      setBatchProgress(0)
    }
  }, [selectedFile, selectedFileType, openingBalanceInput, selectedDateFormat, toast])

  const handleCellChange = (rowIndex: number, cellIndex: number, value: string) => {
    setDisplayedTableData((prevData) => {
      const newData = prevData.map((row) => [...row])

      const firstRow = newData[0]
      const firstRowLooksLikeHeader =
        firstRow &&
        firstRow.some(
          (cell) =>
            typeof cell === "string" &&
            isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
            !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
        )

      const targetRowIndexInDisplayedTable = firstRowLooksLikeHeader ? rowIndex + 1 : rowIndex

      if (newData[targetRowIndexInDisplayedTable]) {
        newData[targetRowIndexInDisplayedTable][cellIndex] = value
      }
      return newData
    })

    // Sync changes to editableTableData
    setEditableTableData((prevData) => {
      const newData = prevData.map((row) => [...row])

      const firstRow = newData[0]
      const firstRowLooksLikeHeader =
        firstRow &&
        firstRow.some(
          (cell) =>
            typeof cell === "string" &&
            isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
            !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
        )

      const targetRowIndexInEditableTable = firstRowLooksLikeHeader ? rowIndex + 1 : rowIndex

      if (newData[targetRowIndexInEditableTable]) {
        newData[targetRowIndexInEditableTable][cellIndex] = value
      }
      return newData
    })
  }

  const handleAddRow = () => {
    if (!selectedFileType) return

    const headers = displayHeaders
    const numCols = headers.length - (selectedFileType === "bankStatement" ? 1 : 0)
    const newRow = Array(numCols).fill("")

    setDisplayedTableData((prevData) => {
      if (!prevData || prevData.length === 0) {
        return [headers.slice(0, numCols), newRow]
      }
      return [...prevData, newRow]
    })

    setEditableTableData((prevData) => {
      if (!prevData || prevData.length === 0) {
        return [headers.slice(0, numCols), newRow]
      }
      return [...prevData, newRow]
    })
  }

  const handleDeleteRow = (rowIndexToDelete: number) => {
    setDisplayedTableData((prevData) => {
      const firstRow = prevData[0]
      const firstRowLooksLikeHeader =
        firstRow &&
        firstRow.some(
          (cell) =>
            typeof cell === "string" &&
            isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
            !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
        )
      const actualRowIndexToDeleteInDisplayedData = firstRowLooksLikeHeader ? rowIndexToDelete + 1 : rowIndexToDelete

      return prevData.filter((_, index) => index !== actualRowIndexToDeleteInDisplayedData)
    })

    setEditableTableData((prevData) => {
      const firstRow = prevData[0]
      const firstRowLooksLikeHeader =
        firstRow &&
        firstRow.some(
          (cell) =>
            typeof cell === "string" &&
            isNaN(Number.parseFloat(cell.replace(/[^0-9.-]/g, ""))) &&
            !/^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(cell.trim()),
        )
      const actualRowIndexToDeleteInPrevData = firstRowLooksLikeHeader ? rowIndexToDelete + 1 : rowIndexToDelete

      return prevData.filter((_, index) => index !== actualRowIndexToDeleteInPrevData)
    })
  }

  const handleSwapAmounts = () => {
    if (!editableTableData || selectedFileType !== "bankStatement") return

    const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid")
    const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received")

    const updatedTableData = editableTableData.map((row, rIndex) => {
      if (rIndex === 0) return row // Skip header row
      const newRow = [...row]
      const temp = newRow[paidColIndex]
      newRow[paidColIndex] = newRow[receivedColIndex]
      newRow[receivedColIndex] = temp
      return newRow
    })

    setEditableTableData(updatedTableData)
  }

  const handleExportToExcel = () => {
    if (!editableTableData || !selectedFileType) {
      toast({
        title: "No Data to Export",
        description: "No table data available or document type not set.",
        variant: "default",
      })
      return
    }

    const headersToUse = displayHeaders
    const dataRowsToExport = [...dataRowsForRendering]

    if (dataRowsToExport.length === 0 && headersToUse.length === 0) {
      toast({ title: "No Data Rows", description: "The table has no data rows to export.", variant: "default" })
      return
    }

    const sheetData = []
    let runningBalanceForExport = financialSummary?.openingBalance || 0

    if (selectedFileType === "bankStatement") {
      const paidColIdx = headersToUse.indexOf("Amount Paid")
      const receivedColIdx = headersToUse.indexOf("Amount Received")
      const dateColIdx = headersToUse.indexOf("Date")

      for (const row of dataRowsToExport) {
        const rowObject: { [key: string]: string } = {}
        headersToUse.forEach((header, index) => {
          let cellValue = String(row[index] || "")
          if (index === dateColIdx && cellValue) {
            // Assuming date is in YYYY-MM-DD
            const dateObj = dateFnsParse(cellValue, "yyyy-MM-dd", new Date())
            if (isDateValid(dateObj)) {
              cellValue = format(dateObj, "MM/dd/yyyy")
            } else {
              const attemptParseForDisplay = parseAndFormatDateToYYYYMMDD(String(row[index] || ""), selectedDateFormat)
              const parsedForDisplayObj = dateFnsParse(attemptParseForDisplay, "yyyy-MM-dd", new Date())
              if (isDateValid(parsedForDisplayObj)) {
                cellValue = format(parsedForDisplayObj, "MM/dd/yyyy")
              } else {
                cellValue = String(row[index] || "")
              }
            }
          }
          if (header !== "Calculated Balance") {
            rowObject[header] = cellValue
          }
        })

        const paid = Number.parseFloat(String(row[paidColIdx] || "0").replace(/[^0-9.-]/g, ""))
        const received = Number.parseFloat(String(row[receivedColIdx] || "0").replace(/[^0-9.-]/g, ""))
        runningBalanceForExport = runningBalanceForExport - paid + received
        rowObject["Calculated Balance"] = runningBalanceForExport.toFixed(2)
        sheetData.push(rowObject)
      }
    } else {
      const dateColIdx = headersToUse.indexOf("Date")
      for (const row of dataRowsToExport) {
        const rowObject: { [key: string]: string } = {}
        headersToUse.forEach((header, index) => {
          let cellValue = String(row[index] || "")
          if (index === dateColIdx && cellValue) {
            const dateObj = dateFnsParse(cellValue, "yyyy-MM-dd", new Date())
            if (isDateValid(dateObj)) {
              cellValue = format(dateObj, "MM/dd/yyyy")
            } else {
              const attemptParseForDisplay = parseAndFormatDateToYYYYMMDD(String(row[index] || ""), selectedDateFormat)
              const parsedForDisplayObj = dateFnsParse(attemptParseForDisplay, "yyyy-MM-dd", new Date())
              if (isDateValid(parsedForDisplayObj)) {
                cellValue = format(parsedForDisplayObj, "MM/dd/yyyy")
              } else {
                cellValue = String(row[index] || "")
              }
            }
          }
          rowObject[header] = cellValue
        })
        sheetData.push(rowObject)
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headersToUse })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      selectedFileType.charAt(0).toUpperCase() + selectedFileType.slice(1) + "Data",
    )
    const today = new Date().toISOString().split("T")[0]
    XLSX.writeFile(workbook, `${selectedFileType}_data_${today}.xlsx`)
    toast({ title: "Export Successful", description: `Data exported to ${selectedFileType}_data_${today}.xlsx` })
  }

  const handleOpenBankGlAccountDialog = () => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" })
      return
    }
    if (
      !dataRowsForRendering ||
      dataRowsForRendering.length === 0 ||
      !selectedFileType ||
      (selectedFileType !== "bankStatement" && selectedFileType !== "check")
    ) {
      toast({
        title: "Invalid Action",
        description: "No data to send or incorrect document type.",
        variant: "destructive",
      })
      return
    }
    setBankGlAccountToApply("")
    setIsBankGlAccountDialogOpen(true)
  }

  const handleConfirmSendWithBankGlAccount = async () => {
    if (!user || !selectedCompanyId) {
      toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" })
      return
    }
    const dataToSend = dataRowsForRendering
    if (
      !dataToSend ||
      dataToSend.length === 0 ||
      !selectedFileType ||
      (selectedFileType !== "bankStatement" && selectedFileType !== "check")
    ) {
      toast({
        title: "Invalid Action",
        description: "No data found or incorrect document type.",
        variant: "destructive",
      })
      return
    }
    if (!bankGlAccountToApply.trim()) {
      toast({
        title: "Bank GL Account Required",
        description: "Please select the Bank GL Account.",
        variant: "destructive",
      })
      return
    }

    setIsSendingToBank(true)
    setIsBankGlAccountDialogOpen(false)
    let sentCount = 0
    const localSkippedRows: SkippedRowData[] = []

    try {
      const batch = writeBatch(db)

      if (selectedFileType === "bankStatement") {
        const dateColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Date")
        const descColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Description")
        const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid")
        const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received")

        dataToSend.forEach((row) => {
          const dateStrRaw = String(row[dateColIndex] || "").trim()
          const dateStr = parseAndFormatDateToYYYYMMDD(dateStrRaw, selectedDateFormat)
          const description = String(row[descColIndex] || "").trim()
          let skipReason = ""

          if (!dateStr || !isDateValid(dateFnsParse(dateStr, "yyyy-MM-dd", new Date()))) {
            skipReason = `Invalid or missing date: "${dateStrRaw}". Parsed as: "${dateStr}". Expected YYYY-MM-DD.`
          }
          if (!description && !skipReason) {
            skipReason = "Missing transaction description."
          }

          const amountPaidStr = String(row[paidColIndex] || "0")
          const amountReceivedStr = String(row[receivedColIndex] || "0")
          const amountPaidNum = Number.parseFloat(cleanAmountString(amountPaidStr))
          const amountReceivedNum = Number.parseFloat(cleanAmountString(amountReceivedStr))

          if (
            (isNaN(amountPaidNum) || amountPaidNum === 0) &&
            (isNaN(amountReceivedNum) || amountReceivedNum === 0) &&
            !skipReason
          ) {
            skipReason = "Both Amount Paid and Amount Received are zero or invalid."
          }

          if (skipReason) {
            localSkippedRows.push({ originalRow: row, reason: skipReason })
            return
          }

          const newTx: Omit<TransactionData, "id" | "createdAt" | "updatedAt" | "updatedBy"> = {
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
          }
          if (newTx.amountPaid && newTx.amountPaid > 0 && newTx.amountReceived && newTx.amountReceived > 0) {
            newTx.amountReceived = null
          }
          const newTransactionDocRef = doc(collection(db, "transactions"))
          batch.set(newTransactionDocRef, { ...newTx, createdAt: serverTimestamp() })
          sentCount++
        })
        await logAction("export_transactions", "document_reader", ["documentType"])
      } else if (selectedFileType === "check") {
        const headers = displayHeaders
        const dateColIndex = headers.indexOf("Date")
        const checkNumColIndex = headers.indexOf("Check Number")
        const vendorColIndex = headers.indexOf("Vendor")
        const amountColIndex = headers.indexOf("Amount")
        const memoColIndex = headers.indexOf("Memo/Narration")

        dataToSend.forEach((row) => {
          const dateStrRaw = String(row[dateColIndex] || "").trim()
          const dateStr = parseAndFormatDateToYYYYMMDD(dateStrRaw, selectedDateFormat)
          const checkNum = String(row[checkNumColIndex] || "").trim()
          const vendor = String(row[vendorColIndex] || "").trim()
          const amountStr = String(row[amountColIndex] || "0")
          const memo = String(row[memoColIndex] || "").trim()
          let skipReason = ""

          if (!dateStr || !isDateValid(dateFnsParse(dateStr, "yyyy-MM-dd", new Date()))) {
            skipReason = `Invalid or missing date: "${dateStrRaw}". Parsed as: "${dateStr}". Ensure YYYY-MM-DD.`
          }
          const amountNum = Number.parseFloat(cleanAmountString(amountStr))
          if (isNaN(amountNum) || amountNum <= 0) {
            if (!skipReason) skipReason = `Invalid or zero amount: "${amountStr}".`
          }
          if (!vendor && !skipReason) {
            if (!skipReason) skipReason = "Missing Vendor/Payee for the check."
          }

          if (skipReason) {
            localSkippedRows.push({ originalRow: row, reason: skipReason })
            return
          }

          let txDescription = ""
          if (checkNum && memo) txDescription = `${checkNum} - ${memo}`
          else if (checkNum) txDescription = checkNum
          else if (memo) txDescription = memo
          else txDescription = `Check to ${vendor || "Unknown Vendor"}`

          const newTx: Omit<TransactionData, "id" | "createdAt" | "updatedAt" | "updatedBy"> = {
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
          }
          const newTransactionDocRef = doc(collection(db, "transactions"))
          batch.set(newTransactionDocRef, { ...newTx, createdAt: serverTimestamp() })
          sentCount++
        })
      }

      if (sentCount > 0) {
        await batch.commit()
        await logAction("import_transactions", "document_reader", ["bankName", "amountPaid", "amountReceived"])
      }

      setSendSummaryData({ sentCount, skippedCount: localSkippedRows.length })
      setSkippedRowsForDownload(localSkippedRows)
      setIsSendSummaryDialogOpen(true)
      if (sentCount > 0 && localSkippedRows.length === 0) {
        setEditableTableData([])
        if (selectedFileType === "bankStatement") setOpeningBalanceInput("")
        setSelectedFile(null)
        setSelectedDateFormat(undefined)
        const fileInput = document.getElementById("document-file") as HTMLInputElement
        if (fileInput) fileInput.value = ""
      }
    } catch (error) {
      console.error("Error sending transactions:", error)
      toast({
        title: "Send Error",
        description: "Could not send. " + (error instanceof Error ? error.message : ""),
        variant: "destructive",
      })
      setSendSummaryData({ sentCount: 0, skippedCount: dataToSend.length })
      setSkippedRowsForDownload(
        dataToSend.map((row) => ({ originalRow: row, reason: "Error during Firestore commit." })),
      )
      setIsSendSummaryDialogOpen(true)
    } finally {
      setIsSendingToBank(false)
      setBankGlAccountToApply("")
    }
  }

  const handleDownloadSkippedBankTransactions = () => {
    if (!skippedRowsForDownload || skippedRowsForDownload.length === 0 || !selectedFileType) {
      toast({ title: "No Skipped Data", description: "No skipped transactions to download.", variant: "default" })
      return
    }
    let headersForExport = displayHeaders
    if (!headersForExport || headersForExport.length === 0) {
      if (selectedFileType === "vendorBill") {
        headersForExport = DOCUMENT_COLUMNS_DEFINITION.vendorBill
      } else {
        headersForExport = DOCUMENT_COLUMNS_DEFINITION[selectedFileType]
      }
    }
    if (selectedFileType === "bankStatement") {
      headersForExport = headersForExport.filter((h) => h !== "Calculated Balance")
    }

    const dataToExport = skippedRowsForDownload.map((skippedItem) => {
      const rowDataWithReason = [...skippedItem.originalRow]
      while (rowDataWithReason.length < headersForExport.length) {
        rowDataWithReason.push("")
      }
      rowDataWithReason.length = headersForExport.length
      rowDataWithReason.push(skippedItem.reason)
      return rowDataWithReason
    })

    const finalHeaders = [...headersForExport, "Reason for Skipping"]

    const worksheet = XLSX.utils.aoa_to_sheet([finalHeaders, ...dataToExport])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, `Skipped_${selectedFileType}`)
    const today = new Date().toISOString().split("T")[0]
    XLSX.writeFile(workbook, `skipped_${selectedFileType}_${today}.xlsx`)
    toast({ title: "Download Successful", description: `Skipped ${selectedFileType} data exported.` })
  }

  const handleOpenYearUpdateDialog = () => {
    if (!selectedFileType || (selectedFileType !== "bankStatement" && selectedFileType !== "check")) return
    setYearToUpdate(new Date().getFullYear().toString())
    setIsYearUpdateDialogOpen(true)
  }

  const handleConfirmYearUpdate = () => {
    if (
      !editableTableData ||
      !selectedFileType ||
      (selectedFileType !== "bankStatement" && selectedFileType !== "check") ||
      !yearToUpdate.trim()
    ) {
      toast({
        title: "Invalid Action",
        description: "No data to update or year not specified.",
        variant: "destructive",
      })
      return
    }
    const newYear = Number.parseInt(yearToUpdate, 10)
    if (isNaN(newYear) || yearToUpdate.trim().length !== 4) {
      toast({ title: "Invalid Year", description: "Please enter a valid 4-digit year.", variant: "destructive" })
      return
    }

    const headers = displayHeaders
    const dateColIndex = headers.indexOf("Date")
    if (dateColIndex === -1) {
      toast({
        title: "Configuration Error",
        description: "Date column not found for this document type.",
        variant: "destructive",
      })
      return
    }

    const updatedTableData = editableTableData.map((row, rIndex) => {
      // Check if the first row is a header by comparing with expected headers, if so skip it
      if (
        rIndex === 0 &&
        headers.every((h, i) =>
          String(row[i] || "")
            .toLowerCase()
            .includes(h.toLowerCase()),
        )
      ) {
        return row
      }

      const newRow = [...row]
      const currentDateStrRaw = newRow[dateColIndex]
      if (currentDateStrRaw) {
        try {
          const parsedDateInternal = parseAndFormatDateToYYYYMMDD(currentDateStrRaw, selectedDateFormat) // Use selectedDateFormat
          const dateObj = dateFnsParse(parsedDateInternal, "yyyy-MM-dd", new Date())

          if (isDateValid(dateObj)) {
            const updatedDate = setYear(dateObj, newYear)
            newRow[dateColIndex] = format(updatedDate, "yyyy-MM-dd")
          }
        } catch (e) {
          console.warn(`Could not parse date for year update: ${currentDateStrRaw}`, e)
        }
      }
      return newRow
    })

    setEditableTableData(updatedTableData)
    toast({
      title: "Year Updated",
      description: `Transaction dates updated to year ${newYear}. Review changes before sending.`,
    })
    setIsYearUpdateDialogOpen(false)
  }

  const handleSwapAmountsInternal = () => {
    if (!editableTableData || selectedFileType !== "bankStatement") return

    const paidColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid")
    const receivedColIndex = DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received")

    const updatedTableData = editableTableData.map((row, rIndex) => {
      if (rIndex === 0) return row // Skip header row
      const newRow = [...row]
      const temp = newRow[paidColIndex]
      newRow[paidColIndex] = newRow[receivedColIndex]
      newRow[receivedColIndex] = temp
      return newRow
    })

    setEditableTableData(updatedTableData)
  }

  const commonButtonDisabled =
    isConverting ||
    isSendingToBank ||
    isBankGlAccountDialogOpen ||
    isSendSummaryDialogOpen ||
    isFetchingChartOfAccounts ||
    isYearUpdateDialogOpen
  const canSendToBank =
    (selectedFileType === "bankStatement" || selectedFileType === "check") &&
    dataRowsForRendering &&
    dataRowsForRendering.length > 0 &&
    chartOfAccounts.length > 0 &&
    (selectedFileType === "bankStatement" ? financialSummary !== null : true)
  const canBulkUpdateYear =
    (selectedFileType === "bankStatement" || selectedFileType === "check") &&
    editableTableData &&
    dataRowsForRendering.length > 0

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
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs">
                          Select the primary date format used in your document (e.g., MM/DD/YYYY). This helps parse
                          dates correctly if the AI can't standardize them.
                        </p>
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
                    {DATE_FORMAT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
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
            disabled={
              !selectedFile ||
              !selectedFileType ||
              commonButtonDisabled ||
              (selectedFileType === "bankStatement" && openingBalanceInput.trim() === "")
            }
            className="w-full sm:w-auto"
          >
            {isConverting ? <LoadingSpinner className="mr-2" /> : <UploadCloud className="mr-2 h-5 w-5" />}
            {isConverting ? "Converting..." : "Convert to Table"}
          </Button>
          {isConverting && <Progress value={conversionProgress} className="w-full h-2 mt-2" />}
        </div>

        {selectedFileType === "bankStatement" && financialSummary && editableTableData && (
          <Card className="shadow-lg mb-8">
            <CardHeader>
              <CardTitle>Bank Statement Summary (for currently displayed file)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Opening Balance</p>
                <p className="font-semibold text-lg">
                  {financialSummary.openingBalance.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Paid Out</p>
                <p className="font-semibold text-lg text-red-600">
                  {financialSummary.totalPaid.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Received In</p>
                <p className="font-semibold text-lg text-green-600">
                  {financialSummary.totalReceived.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Calculated Closing Balance</p>
                <p className="font-semibold text-lg">
                  {financialSummary.calculatedClosingBalance.toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isConverting && conversionProgress > 0 && (
          <Card className="mt-8 shadow-lg">
            <CardHeader>
              {" "}
              <CardTitle>Processing Document</CardTitle>{" "}
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-muted-foreground">{conversionMessage}</p>
            </CardContent>
          </Card>
        )}

        {editableTableData && (
          <Card className="mt-8 shadow-lg">
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Extracted & Editable Table Data</CardTitle>
                {conversionMessage && <CardDescription className="mt-1">{conversionMessage}</CardDescription>}
                {(!dataRowsForRendering || dataRowsForRendering.length === 0) &&
                  selectedFileType &&
                  editableTableData.length > 0 &&
                  !isConverting && (
                    <CardDescription className="text-orange-600 flex items-center mt-2">
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      AI extracted data, but it might not perfectly match expected format or be empty post-processing.
                      Review carefully.
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
                  disabled={
                    !editableTableData || dataRowsForRendering.length === 0 || !selectedFileType || commonButtonDisabled
                  }
                  variant="outline"
                  className="w-full sm:w-auto"
                >
                  <FileDown className="mr-2 h-4 w-4" /> Export to Excel
                </Button>
                {(selectedFileType === "bankStatement" || selectedFileType === "check") && (
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
              {dataRowsForRendering.length > 0 && displayHeaders.length > 0 ? (
                <ScrollArea className="h-[400px] w-full border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {displayHeaders.map((header, index) => (
                          <TableHead key={`header-${index}`}>{header}</TableHead>
                        ))}
                        <TableHead className="w-[50px]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        let currentCalculatedBalance = financialSummary?.openingBalance || 0
                        const paidColIndex =
                          selectedFileType === "bankStatement"
                            ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Paid")
                            : -1
                        const receivedColIndex =
                          selectedFileType === "bankStatement"
                            ? DOCUMENT_COLUMNS_DEFINITION.bankStatement.indexOf("Amount Received")
                            : -1

                        return dataRowsForRendering.map((row, rowIndex) => {
                          if (selectedFileType === "bankStatement") {
                            const paid = Number.parseFloat(String(row[paidColIndex] || "0").replace(/[^0-9.-]/g, ""))
                            const received = Number.parseFloat(
                              String(row[receivedColIndex] || "0").replace(/[^0-9.-]/g, ""),
                            )
                            if (!isNaN(paid) && !isNaN(received)) {
                              currentCalculatedBalance = currentCalculatedBalance - paid + received
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
                                  )
                                }
                                return (
                                  <TableCell key={`cell-${rowIndex}-${cellIndex}`}>
                                    <Input
                                      type={
                                        header.toLowerCase().includes("amount") ||
                                        header.toLowerCase().includes("price") ||
                                        header.toLowerCase().includes("gst") ||
                                        header.toLowerCase().includes("total") ||
                                        header.toLowerCase().includes("balance")
                                          ? "number"
                                          : "text"
                                      }
                                      value={row[cellIndex] || ""}
                                      onChange={(e) => handleCellChange(rowIndex, cellIndex, e.target.value)}
                                      className="h-8 text-sm"
                                      disabled={commonButtonDisabled}
                                    />
                                  </TableCell>
                                )
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
                          )
                        })
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

      <Dialog
        open={isBankGlAccountDialogOpen}
        onOpenChange={(isOpen) => {
          setIsBankGlAccountDialogOpen(isOpen)
          if (!isOpen) setBankGlAccountToApply("")
        }}
      >
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
                  <SelectValue
                    placeholder={
                      isFetchingChartOfAccounts
                        ? "Loading accounts..."
                        : chartOfAccounts.length === 0
                          ? "No GL accounts found"
                          : "Select GL Account"
                    }
                  />
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
            <Button
              variant="outline"
              onClick={() => {
                setIsBankGlAccountDialogOpen(false)
                setBankGlAccountToApply("")
              }}
              disabled={isSendingToBank}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSendWithBankGlAccount}
              disabled={
                isSendingToBank ||
                !bankGlAccountToApply.trim() ||
                isFetchingChartOfAccounts ||
                chartOfAccounts.length === 0
              }
            >
              {isSendingToBank ? <LoadingSpinner className="mr-2" /> : "Confirm & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isSendSummaryDialogOpen}
        onOpenChange={(isOpen) => {
          setIsSendSummaryDialogOpen(isOpen)
          if (!isOpen) {
            setSendSummaryData(null)
            setSkippedRowsForDownload([])
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-headline">Send to Bank Transactions Summary</DialogTitle>
            {sendSummaryData && <DialogDescription>Process complete. Review the summary below.</DialogDescription>}
          </DialogHeader>
          {sendSummaryData && (
            <div className="py-4 space-y-3">
              <p>
                Transactions successfully sent: <span className="font-semibold">{sendSummaryData.sentCount}</span>
              </p>
              <p>
                Transactions skipped: <span className="font-semibold">{sendSummaryData.skippedCount}</span>
              </p>
              {sendSummaryData.skippedCount > 0 && skippedRowsForDownload.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Skipped transactions had issues like invalid dates, missing descriptions or zero amounts. You can
                  download a list of these.
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
            <Button
              onClick={() => {
                setIsSendSummaryDialogOpen(false)
                setSendSummaryData(null)
                setSkippedRowsForDownload([])
              }}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isYearUpdateDialogOpen} onOpenChange={setIsYearUpdateDialogOpen}>
        <DialogContent className="sm:max-w-xs">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsYearUpdateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmYearUpdate} disabled={!yearToUpdate.trim()}>
              Update Year
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthGuard>
  )
}
