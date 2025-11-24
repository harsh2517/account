
'use server';
/**
 * @fileOverview A Genkit flow for extracting tabular data from documents (PDFs, images).
 *
 * - extractDataFromDocument - A function that attempts to extract tabular data from a document.
 * - ExtractTabularDataInput - The type for the input to the extractDataFromDocument function (includes documentDataUri, mimeType, documentType).
 * - ExtractTabularDataOutput - The type for the output from the extractDataFromDocument function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractTabularDataInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "The document content as a data URI. It must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ).nullable(),
  rawText: z.string().describe("Raw text extracted from a document via OCR.").nullable(),
  mimeType: z.string().describe("The MIME type of the document (e.g., 'application/pdf', 'image/jpeg', 'image/png')."),
  documentType: z.enum(["bankStatement", "vendorBill", "check", "creditCard"]).describe("The type of document being processed, e.g., 'bankStatement', 'vendorBill', 'check', or 'creditCard'."),
  statementYear: z.string().optional().describe("The year of the statement, used as context for parsing dates without a year."),
});
export type ExtractTabularDataInput = z.infer<typeof ExtractTabularDataInputSchema>;

const ExtractedRowSchema = z.array(z.string().describe("A cell value within the row, as a string.")).describe("Represents a single row in the extracted table.");

const ExtractTabularDataOutputSchema = z.object({
  extractedTable: z.array(ExtractedRowSchema)
    .describe("An array of arrays, where each inner array represents a row, and its elements are the cell values as strings. Returns an empty array if no table is found or data cannot be extracted."),
  message: z.string().optional().describe("An optional message from the AI, e.g., if no table was found or if there were issues.")
});
export type ExtractTabularDataOutput = z.infer<typeof ExtractTabularDataOutputSchema>;

// Bank Statement Prompt
const bankStatementPrompt = ai.definePrompt({
  name: 'bankStatementPrompt',
  input: { schema: ExtractTabularDataInputSchema },
  output: { schema: ExtractTabularDataOutputSchema },
  prompt: `You are an expert bank statement processor. Your task is to read a scanned PDF statement and convert it into a clean, tabular format.
If a statement year of '{{{statementYear}}}' is provided, use it as the primary context for all dates.

Analyze the provided document page: {{media url=documentDataUri}}

Your process must be:
1.  **Extract Transactions:** Identify the main transactions table on the page and extract all individual debit and credit rows with HIGH ACCURACY.
2.  **Format Data:**
    *   The output 'extractedTable' MUST be an array of arrays.
    *   The first inner array MUST be a header row. If the source has a 'Balance' column, use ["Date", "Description", "Amount Paid", "Amount Received", "Balance"]. Otherwise, use ["Date", "Description", "Amount Paid", "Amount Received"].
    *   The date format for the output must be YYYY-MM-DD.
    *   ONLY include rows that represent actual transactions (debits or credits). EXCLUDE summary rows, totals, "balance brought forward" lines, and any other non-transactional text.
    *   For any single transaction, only ONE of 'Amount Paid' or 'Amount Received' should have a non-zero value.
3.  **Final Output:** Provide the final, clean, and accurate list of transactions in the specified JSON format. If you cannot find a table, return an empty array for 'extractedTable' and a message explaining why.

CRITICAL: IGNORE any pages or sections that only show images of scanned checks. Do not extract data from images of checks.
`,
  config: { temperature: 0.1 },
});

// Credit Card Statement Prompt
const creditCardPrompt = ai.definePrompt({
    name: 'creditCardPrompt',
    input: { schema: ExtractTabularDataInputSchema },
    output: { schema: ExtractTabularDataOutputSchema },
    prompt: `You are an expert credit card statement processor.
If a statement year of '{{{statementYear}}}' is provided, use it as the primary context for all dates.

Analyze the provided credit card statement page: {{media url=documentDataUri}}

Your task is to:
1.  Identify the main transaction table on the page.
2.  Extract the data with HIGH ACCURACY.
3.  The output 'extractedTable' MUST be an array of arrays.
4.  The first inner array MUST be a header row: ["Transaction Date", "Description", "Amount"].
5.  For each transaction line, create a row and populate the columns:
    *   "Transaction Date": The date of the transaction. If both a 'Transaction Date' and a 'Post Date' are present for a transaction, you MUST use the 'Transaction Date'.
    *   "Description": The full transaction description or merchant name.
    *   "Amount": The transaction amount. Purchases and debits should be POSITIVE numbers. Payments and credits should be NEGATIVE numbers.
6.  ONLY include rows that represent actual transactions. EXCLUDE summary information, interest charges listed in a separate summary box, payment information boxes, or any other non-transactional text.
7.  If no transaction table is found, return an empty array for 'extractedTable' and a message explaining why.
`,
    config: { temperature: 0.1 },
});

// Vendor Bill Prompt
const vendorBillPrompt = ai.definePrompt({
  name: 'vendorBillPrompt',
  input: { schema: ExtractTabularDataInputSchema },
  output: { schema: ExtractTabularDataOutputSchema },
  prompt: `You are an AI assistant specialized in extracting structured data from vendor bills.

Analyze the provided vendor bill: {{media url=documentDataUri}}

Your task is to:
1. Identify and extract all line items from the bill.
2. The output table ('extractedTable') MUST be an array of arrays.
3. The first inner array MUST be a header row with these exact values: ["Date", "Vendor Name", "Customer Name", "Bill Number", "Description", "Unit Price", "Quantity", "Amount", "Total GST", "Total Amount"].
4. For each line item, create a row and populate the columns: "Date", "Vendor Name", "Customer Name", "Bill Number" will be the same for all lines from the same bill. "Description", "Unit Price", "Quantity", and "Amount" are for the specific line item. "Total GST" and "Total Amount" are for the ENTIRE bill and will be the same in every row. Use "0" if a value is not present.
5. If no table is found, return an empty array for 'extractedTable'.
`,
  config: { temperature: 0.2 },
});

// Check Prompt
const checkPrompt = ai.definePrompt({
  name: 'checkPrompt',
  input: { schema: ExtractTabularDataInputSchema },
  output: { schema: ExtractTabularDataOutputSchema },
  prompt: `You are an AI assistant expert at extracting information from financial checks.

Analyze the provided check image: {{media url=documentDataUri}}

Your task is to:
1. Extract the key details from the check with HIGH ACCURACY.
2. The output table ('extractedTable') MUST be an array of arrays.
3. The first inner array MUST be a header row with these exact values: ["Date", "Check Number", "Payee", "Payer", "Amount", "Memo/Narration"].
4. The subsequent inner array must represent the single check with all fields populated. It is CRITICAL to extract the "Amount" accurately.
5. If any field is not present or readable, leave it as an empty string. Do not guess.

Please provide the extracted data in the specified JSON format.
`,
  config: { temperature: 0.1 },
});


// New OCR+AI Prompt
const ocrPlusAiPrompt = ai.definePrompt({
    name: 'ocrPlusAiPrompt',
    input: { schema: z.object({ rawText: z.string(), documentType: z.string(), statementYear: z.string().optional() }) },
    output: { schema: ExtractTabularDataOutputSchema },
    prompt: `You are an expert at structuring raw, messy text data from OCR into a clean table.
The document type is '{{{documentType}}}'. Use this to determine the correct columns. If a 'statementYear' of '{{{statementYear}}}' is provided, use it as the primary context for all dates, especially for dates that do not include a year.

Analyze the following raw text:
---
{{{rawText}}}
---

Your task is to:
1.  Parse this text and identify the main table of transactions or line items.
2.  Extract the data with HIGH ACCURACY.
3.  Structure the data into a JSON array of arrays, where each inner array is a row.
4.  **The first inner array MUST be a header row matching the requirements for the '{{{documentType}}}' specified below.**
5. The output date format for all dates MUST be YYYY-MM-DD.

**Bank Statement Requirements:**
- Header: ["Date", "Description", "Amount Paid", "Amount Received", "Balance"] (or without "Balance" if not present).
- Rows: Only actual transaction rows. Exclude summaries, totals, etc.
- Amounts: Look for columns indicating debits and credits. Debits go into "Amount Paid". Credits go into "Amount Received". For a single transaction, only ONE of these columns can contain a non-zero value.
- Dates: Must be in YYYY-MM-dd format. Use the provided statementYear as context if the year is missing from a date.

**Credit Card Requirements:**
- Header: ["Transaction Date", "Description", "Amount"]
- Rows: Only actual transaction rows. Purchases are POSITIVE, payments/credits are NEGATIVE. If a row shows separate 'Transaction Date' and 'Post Date' columns, you MUST use the 'Transaction Date'.
- Dates: Must be in YYYY-MM-dd format.

**Vendor Bill Requirements:**
- Header: ["Date", "Vendor Name", "Customer Name", "Bill Number", "Description", "Unit Price", "Quantity", "Amount", "Total GST", "Total Amount"]
- Rows: One row per line item. Bill-level details are repeated.
- Dates: Must be in YYYY-MM-dd format.

**Check Requirements:**
- Header: ["Date", "Check Number", "Payee", "Payer", "Amount", "Memo/Narration"]
- One data row representing the single check.
- Dates: Must be in YYYY-MM-dd format.

If no tabular data can be reliably extracted, return an empty 'extractedTable'.`,
    config: { temperature: 0.1 },
});


const extractTabularDataFlow = ai.defineFlow(
  {
    name: 'extractTabularDataFlow',
    inputSchema: ExtractTabularDataInputSchema,
    outputSchema: ExtractTabularDataOutputSchema,
  },
  async (input: ExtractTabularDataInput): Promise<ExtractTabularDataOutput> => {
    try {
      let llmResponse;
      
      // We are now prioritizing the multimodal path for better accuracy.
      // If we have an image, we use it. We only fall back to text if there's no image.
      if (input.documentDataUri) {
        // Original multimodal path
        switch (input.documentType) {
          case "bankStatement":
            llmResponse = await bankStatementPrompt(input);
            break;
          case "creditCard":
            llmResponse = await creditCardPrompt(input);
            break;
          case "vendorBill":
            llmResponse = await vendorBillPrompt(input);
            break;
          case "check":
            llmResponse = await checkPrompt(input);
            break;
          default:
            return {
              extractedTable: [],
              message: "Unsupported document type provided."
            };
        }
      } else if (input.rawText) {
          // Fallback to text-only if no image URI is provided
          llmResponse = await ocrPlusAiPrompt({ 
              rawText: input.rawText, 
              documentType: input.documentType,
              statementYear: input.statementYear 
          });
      } else {
        return {
          extractedTable: [],
          message: "No document data provided (neither image nor text)."
        };
      }


      if (llmResponse.output && Array.isArray(llmResponse.output.extractedTable)) {
        // Ensure all inner elements are strings, as AI might occasionally return numbers
        const validatedTable = llmResponse.output.extractedTable.map(row =>
          Array.isArray(row) ? row.map(cell => String(cell ?? "")) : []
        );
        return {
          extractedTable: validatedTable,
          message: llmResponse.output.message
        };
      }
      // If AI output is not as expected, return an empty table with a message.
      return { 
        extractedTable: [], 
        message: llmResponse.output?.message || "AI model did not return a valid table structure. The output format might be incorrect." 
      };
    } catch (error) {
      console.error("Error in extractTabularDataFlow: ", error);
      let errorMessage = "An unexpected error occurred during data extraction.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      // Return an empty table and an error message if the flow itself errors.
      return {
        extractedTable: [],
        message: `Flow error: ${errorMessage}`
      };
    }
  }
);

export async function extractDataFromDocument(input: ExtractTabularDataInput): Promise<ExtractTabularDataOutput> {
  return extractTabularDataFlow(input);
}
