
'use server';
/**
 * @fileOverview A Genkit flow for reconciling a bank statement by finding discrepancies.
 *
 * - reconcileBankStatement - A function that takes an uploaded document, a list of current transactions,
 *   and balances to find and suggest corrections.
 * - ReconcileStatementInput - The type for the input to the reconcileBankStatement function.
 * - ReconcileStatementOutput - The type for the output from the reconcileBankStatement function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractedRowSchema = z.array(z.string()).describe("Represents a single row in a transaction table.");

const ReconcileStatementInputSchema = z.object({
  documentDataUri: z.string().describe("The bank statement document as a data URI, including MIME type and Base64 encoding.").nullable(),
  rawText: z.string().nullable().describe("Raw text extracted from a document via OCR."),
  currentTransactions: z.array(ExtractedRowSchema).describe("The current list of extracted transactions, as an array of arrays. This table might have a 'Balance' column, which the AI should ignore and not reproduce."),
  openingBalance: z.number().describe("The opening balance from the statement."),
  closingBalance: z.number().describe("The closing balance from the statement."),
  discrepancyAmount: z.number().describe("The calculated discrepancy (Calculated Closing Balance - Statement Closing Balance). The AI's goal is to correct the transactions to make this zero."),
});
export type ReconcileStatementInput = z.infer<typeof ReconcileStatementInputSchema>;


const CorrectedTransactionRowSchema = z.array(z.string()).describe("A corrected transaction row containing ONLY Date, Description, Amount Paid, and Amount Received.");

const ReconcileStatementOutputSchema = z.object({
  correctedTransactions: z.array(CorrectedTransactionRowSchema).describe("The FULL, corrected list of transactions that should result in the correct closing balance. This table MUST only contain columns for 'Date', 'Description', 'Amount Paid', 'Amount Received' in that order."),
  explanation: z.string().describe("A brief explanation of the changes made (e.g., corrected amount, found missing transaction)."),
});
export type ReconcileStatementOutput = z.infer<typeof ReconcileStatementOutputSchema>;

const reconcilePrompt = ai.definePrompt({
  name: 'reconcileBankStatementPrompt',
  input: { schema: ReconcileStatementInputSchema },
  output: { schema: ReconcileStatementOutputSchema },
  prompt: `You are an expert financial analyst and data reconciliation specialist. Your task is to find and correct errors in a list of transactions that were extracted from a bank statement, so that they correctly reconcile.

You will be given:
1.  The original bank statement document as an image ('documentDataUri').
2.  The raw text extracted from the document via OCR ('rawText'), which may be for your reference.
3.  A list of transactions currently extracted from that statement ('currentTransactions'). This list is INCORRECT and may contain a "Balance" column.
4.  The 'openingBalance' from the statement.
5.  The 'closingBalance' from the statement.
6.  The 'discrepancyAmount', which is the current error that needs to be resolved to zero.

**Your Goal:** Find the errors in 'currentTransactions' that account for the exact 'discrepancyAmount' and return a completely corrected list of transactions.

**Chain of Thought - Follow these steps precisely:**

1.  **Analyze the Goal:** My primary goal is to make the discrepancy of {{{discrepancyAmount}}} become zero. I need to find errors in the 'currentTransactions' that perfectly explain this amount.
2.  **Document as Source of Truth:** I will treat the image of the bank statement (\`documentDataUri\`) as the absolute source of truth. The \`rawText\` is a helpful reference, but the image is primary. I must consider all pages provided in the image.
3.  **Identify Error Type:** I will hypothesize the type of error based on the discrepancy amount.
    *   If the discrepancy is a positive number (e.g., $50.00), it means my calculated balance is too high. This could be due to a missed debit, an overstated credit, or a debit entered as a credit.
    *   If the discrepancy is a negative number (e.g., -$100.00), it means my calculated balance is too low. This could be due to a missed credit, an overstated debit, or a credit entered as a debit.
    *   A small, odd difference (e.g., $9.90) might indicate a transcription error (e.g., $12.30 was entered as $21.30).
4.  **Scan the Document for Clues:** I will meticulously scan the original document (\`documentDataUri\`) for a transaction amount that exactly matches or is related to the \`discrepancyAmount\`. I will pay close attention to dates and descriptions.
5.  **Compare Document to Table:** I will go through the \`currentTransactions\` table line-by-line and compare each entry against the transactions visible in the document image.
    *   Is there a transaction on the document that is completely missing from the table?
    *   Is there a transaction in the table where the amount is different from what's on the document?
    *   Is a debit (payment/withdrawal) in the document listed as a credit (deposit) in the table, or vice-versa?
    *   Is there a summary row (like 'Total Debits') incorrectly included as a transaction in the table?
6.  **Formulate the Correction:** Once I have identified the error(s), I will formulate the correction. For example:
    *   "Found a missing debit of $50.00 on 2023-08-15 for 'AMZN Mktp'."
    *   "Corrected the amount for 'Shell Gas' from $45.50 to $54.50, a difference of -$9.00."
    *   "Removed a summary row incorrectly listed as a transaction."
7.  **Rebuild the Transaction Table:** I will construct the \`correctedTransactions\` table from scratch based on the transactions I can verify in the document. This new table MUST:
    *   Be a complete and full list of all valid transactions for the entire period shown in the document. Do not remove valid transactions from any month just to make the final balance match.
    *   Contain ONLY columns for ["Date", "Description", "Amount Paid", "Amount Received"].
    *   DO NOT include the 'Balance' column in your output. The system will recalculate it.
    *   Have amounts formatted as number strings (e.g., "123.45").
    *   When calculated (\`openingBalance\` + credits - debits), result PRECISELY in the \`closingBalance\`.
8.  **Provide Explanation:** My 'explanation' will be a clear, concise summary of the main correction(s) I made to resolve the discrepancy.

**DOCUMENT IMAGE (Source of Truth):**
{{media url=documentDataUri}}

**REFERENCE OCR TEXT:**
{{{rawText}}}

**CURRENT (INCORRECT) DATA:**
- Opening Balance: {{{openingBalance}}}
- Expected Closing Balance: {{{closingBalance}}}
- Current Transactions Table: {{{json currentTransactions}}}
- **Discrepancy to Resolve: {{{discrepancyAmount}}}**

Now, begin your analysis and generate the \`correctedTransactions\` and \`explanation\`.
`,
  config: {
    temperature: 0.1,
  },
});

const reconcileBankStatementFlow = ai.defineFlow(
  {
    name: 'reconcileBankStatementFlow',
    inputSchema: ReconcileStatementInputSchema,
    outputSchema: ReconcileStatementOutputSchema,
  },
  async (input: ReconcileStatementInput): Promise<ReconcileStatementOutput> => {
    const llmResponse = await reconcilePrompt(input);
    const output = llmResponse.output;
    
    if (!output || !output.correctedTransactions) {
      throw new Error("AI failed to generate a corrected transaction list.");
    }
    
    // Optional: Add a validation step here to recalculate the balance with the AI's output
    // to ensure it did its job correctly before returning.

    return output;
  }
);

// This function is not directly exported because of 'use server' constraints.
// It is wrapped or used within a file that can handle server actions.
async function reconcileBankStatement(input: ReconcileStatementInput): Promise<ReconcileStatementOutput> {
  return reconcileBankStatementFlow(input);
}
export { reconcileBankStatement };
