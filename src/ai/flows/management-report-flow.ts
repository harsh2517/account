
'use server';
/**
 * @fileOverview A Genkit flow for generating an AI-powered management report.
 *
 * - generateManagementReport - A function that analyzes financial data and produces a narrative report.
 * - ManagementReportInput - The type for the input data (P&L and Balance Sheet summaries).
 * - ManagementReportOutput - The type for the structured report output.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// --- Input Schemas ---

const FinancialAccountSchema = z.object({
  name: z.string(),
  balance: z.number(),
  type: z.string(),
});

const ProfitAndLossInputSchema = z.object({
  accounts: z.array(FinancialAccountSchema),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netProfitLoss: z.number(),
});

const BalanceSheetInputSchema = z.object({
  assets: z.array(FinancialAccountSchema),
  liabilities: z.array(FinancialAccountSchema),
  equity: z.array(FinancialAccountSchema),
  totalAssets: z.number(),
  totalLiabilities: z.number(),
  totalEquity: z.number(),
});

const ManagementReportInputSchema = z.object({
  profitAndLoss: ProfitAndLossInputSchema,
  balanceSheet: BalanceSheetInputSchema,
});
export type ManagementReportInput = z.infer<typeof ManagementReportInputSchema>;


// --- Output Schema ---

const ManagementReportOutputSchema = z.object({
  executiveSummary: z.string().describe("A concise, high-level overview of the company's financial health and performance for the period. Max 3-4 sentences."),
  financialHighlights: z.array(z.string()).describe("A bulleted list of 3-5 key takeaways or interesting facts from the data (e.g., 'Revenue grew 15%', 'Expenses were 5% over budget')."),
  keyRatios: z.object({
    grossProfitMargin: z.string().describe("Calculated as (Total Income - Cost of Goods Sold) / Total Income. If COGS is not available, state 'N/A' and explain that COGS accounts are needed. Result as a percentage string, e.g., '45.2%'."),
    netProfitMargin: z.string().describe("Calculated as Net Profit / Total Income. Result as a percentage string."),
    currentRatio: z.string().describe("Calculated as Current Assets / Current Liabilities. Result as a number string, e.g., '2.1'."),
  }).describe("Key financial ratios calculated from the provided data."),
  detailedAnalysis: z.string().describe("A more in-depth paragraph-style analysis of the P&L and Balance Sheet. Discuss revenue streams, major expense categories, and the company's liquidity and solvency. Mention specific account balances where relevant."),
  recommendations: z.array(z.string()).describe("A bulleted list of 2-3 actionable recommendations based on the analysis (e.g., 'Consider reducing marketing spend', 'Look into refinancing high-interest debt')."),
});
export type ManagementReportOutput = z.infer<typeof ManagementReportOutputSchema>;


// --- Genkit Prompt and Flow ---

const managementReportPrompt = ai.definePrompt({
  name: 'managementReportPrompt',
  input: { schema: ManagementReportInputSchema },
  output: { schema: ManagementReportOutputSchema },
  prompt: `You are an expert financial analyst AI. Your task is to generate a clear, insightful, and professional management report based on the provided financial data. The report should be easy for a business owner to understand.

Analyze the following financial data for the period:

**Profit and Loss Data:**
{{{json profitAndLoss}}}

**Balance Sheet Data:**
{{{json balanceSheet}}}

Based on this data, perform the following actions:
1.  **Write an Executive Summary:** Provide a short, high-level summary of the company's performance and financial position.
2.  **Identify Financial Highlights:** Pull out the most important numbers or trends as bullet points.
3.  **Calculate Key Ratios:**
    *   **Gross Profit Margin**: To calculate this, you must identify "Cost of Goods Sold" (COGS) from the expense accounts. Assume accounts with types like 'Direct Expense' or names including 'COGS' or 'Cost of Sales' are COGS. Sum them up. If no such accounts exist, you MUST state that the Gross Profit Margin is Not Applicable (N/A) because COGS accounts could not be identified. Calculate as (Total Income - COGS) / Total Income.
    *   **Net Profit Margin**: Net Profit / Total Income.
    *   **Current Ratio**: To calculate this, you need to identify Current Assets and Current Liabilities from the Balance Sheet accounts. Assume accounts with type 'Current Asset' or 'Current Liability' fit these categories. Sum them up. Calculate as Total Current Assets / Total Current Liabilities. If either is zero or not present, state 'N/A'.
4.  **Provide a Detailed Analysis:** Elaborate on the summary. Discuss the composition of income and expenses. Comment on the company's assets, liabilities, and overall equity position.
5.  **Offer Actionable Recommendations:** Based on your analysis, suggest 2-3 concrete next steps the business owner could take.

Generate the entire response in the required JSON format.
`,
  config: {
    temperature: 0.2,
  },
});

const managementReportFlow = ai.defineFlow(
  {
    name: 'managementReportFlow',
    inputSchema: ManagementReportInputSchema,
    outputSchema: ManagementReportOutputSchema,
  },
  async (input: ManagementReportInput): Promise<ManagementReportOutput> => {
    const llmResponse = await managementReportPrompt(input);
    const output = llmResponse.output;

    if (!output) {
      throw new Error("AI failed to generate a report. The output was empty.");
    }

    // Basic validation to ensure the AI didn't just return empty fields
    if (!output.executiveSummary || output.financialHighlights.length === 0) {
        throw new Error("AI generated an incomplete report. Please try again.");
    }
    
    return output;
  }
);

export async function generateManagementReport(input: ManagementReportInput): Promise<ManagementReportOutput> {
  return managementReportFlow(input);
}
