'use server';
/**
 * @fileOverview A FREE version flow for extracting tabular data using user's Gemini API key
 * This maintains the exact same structure and prompting as the premium version
 * but uses the user's API key from localStorage instead of the .env file
 */

import { z } from 'zod';

const ExtractTabularDataInputSchema = z.object({
  documentDataUri: z
    .string()
    .describe(
      "The document content as a data URI. It must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  mimeType: z.string().describe("The MIME type of the document (e.g., 'application/pdf', 'image/jpeg', 'image/png')."),
  documentType: z.enum(["bankStatement", "vendorBill", "check"]).describe("The type of document being processed, e.g., 'bankStatement', 'vendorBill', or 'check'."),
  geminiApiKey: z.string().describe("The user's Gemini API key from localStorage")
});
export type ExtractTabularDataInput = z.infer<typeof ExtractTabularDataInputSchema>;

const ExtractedRowSchema = z.array(z.string().describe("A cell value within the row, as a string.")).describe("Represents a single row in the extracted table.");

const ExtractTabularDataOutputSchema = z.object({
  extractedTable: z.array(ExtractedRowSchema)
    .describe("An array of arrays, where each inner array represents a row, and its elements are the cell values as strings. Returns an empty array if no table is found or data cannot be extracted."),
  message: z.string().optional().describe("An optional message from the AI, e.g., if no table was found or if there were issues.")
});
export type ExtractTabularDataOutput = z.infer<typeof ExtractTabularDataOutputSchema>;

async function callGeminiAPIWithUserKey(apiKey: string, prompt: string, imageData: string): Promise<any> {
  // Use the NEW model name
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  
  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageData.split(',')[1]
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.2
    }
  };

  try {
    const response = await fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData.error?.message || ''}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}

// Function to parse Gemini response (maintains same structure as premium version)
function parseGeminiResponse(response: any): ExtractTabularDataOutput {
  try {
    // Extract text from Gemini response
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text) {
      return { extractedTable: [], message: "No response from Gemini API" };
    }

    // Try to find JSON in the response text (same as premium version)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const parsedData = JSON.parse(jsonMatch[0]);
        
        // Handle the expected response format (same as premium)
        if (parsedData.extractedTable && Array.isArray(parsedData.extractedTable)) {
          // Ensure all inner elements are strings, as AI might occasionally return numbers
          const validatedTable = parsedData.extractedTable.map((row: any) =>
            Array.isArray(row) ? row.map((cell: any) => String(cell ?? "")) : []
          );
          return {
            extractedTable: validatedTable,
            message: parsedData.message
          };
        }
      } catch (e) {
        console.error("Error parsing JSON from Gemini response:", e);
        // Fall through to text parsing
      }
    }

    // If no JSON found, try to extract table from text (fallback)
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length > 0) {
      // Simple table extraction logic
      const tableData = lines.map(line => {
        // Try to split by common delimiters
        if (line.includes('|')) return line.split('|').map(cell => cell.trim());
        if (line.includes(',')) return line.split(',').map(cell => cell.trim());
        return [line.trim()];
      });
      
      return { 
        extractedTable: tableData, 
        message: "Extracted table data from text response (format may need adjustment)" 
      };
    }

    return { 
      extractedTable: [], 
      message: "Could not extract table data from Gemini response. The AI might not have returned valid JSON." 
    };
    
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    return { 
      extractedTable: [], 
      message: `Error parsing response: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

// Main extraction function (maintains same interface as premium version)
export async function extractDataFromDocument(input: ExtractTabularDataInput): Promise<ExtractTabularDataOutput> {
  try {
    // Use the exact same prompt as the premium version
    const prompt = `You are an expert AI assistant specialized in extracting structured tabular data from document pages.
The document you are analyzing has been identified by the user as a '${input.documentType}'. Use this information to help guide your table extraction.

Your task is to:
1. Identify all prominent tables or tabular structures relevant to the '${input.documentType}' on this single page.
2. Extract the data from these tables with HIGH ACCURACY.
3. Consolidate all extracted rows into a SINGLE table.
4. Represent this final table as a JSON array of arrays, where each inner array corresponds to a row, and each string element within an inner array corresponds to a cell in that row.

   **Specific instructions if the documentType is 'bankStatement':**
   - The output table ('extractedTable') MUST be an array of arrays.
   - The first inner array MUST be a header row. A standard header would be ["Date", "Description", "Amount Paid", "Amount Received", "Balance"]. However, if the source document does not contain a "Balance" column, you MUST use the header ["Date", "Description", "Amount Paid", "Amount Received"]. Be flexible and match the headers to what is present in the document.
   - You MUST ONLY include rows that represent actual transactions (debits or credits) that affect the account balance.
   - You MUST EXCLUDE any summary rows, total lines, "balance brought forward" lines, or any other non-transactional text from the output.
   - For each transaction, populate the columns:
     - "Date": The transaction date.
     - "Description": The full transaction description.
     - "Amount Paid": The debit amount, as a number string (e.g., "100.00"). If not applicable, use "0" or an empty string.
     - "Amount Received": The credit amount, as a number string (e.g., "500.00"). If not applicable, use "0" or an empty string.
     - "Balance": The running balance, as a number string. Only include this column in the header and data if it is clearly present in the source document.
   - For any single transaction, only ONE of 'Amount Paid' or 'Amount Received' can contain a non-zero value.

  **Specific instructions if the documentType is 'vendorBill':**
  - The output table ('extractedTable') MUST be an array of arrays.
  - The first inner array MUST be a header row containing these exact string values: ["Date", "Vendor Name", "Customer Name", "Bill Number", "Description", "Unit Price", "Quantity", "Amount", "Total GST", "Total Amount"].
  - For each line item in the bill, create a corresponding row in your output.
  - "Date": The main date of the bill. This will be the same for all line items from the same bill.
  - "Vendor Name": The name of the vendor. This will be the same for all line items.
  - "Customer Name": The name of the customer the bill is for. This will be the same for all line items.
  - "Bill Number": The invoice or bill number. This will be the same for all line items.
  - "Description": The description of the specific line item.
  - "Unit Price": The price per unit for the line item.
  - "Quantity": The quantity for the line item.
  - "Amount": The total amount for the line item (Quantity * Unit Price).
  - "Total GST": The total tax amount for the ENTIRE bill. This value will be the same in every row. If not present, use "0".
  - "Total Amount": The final, total amount of the ENTIRE bill. This value will be the same in every row.

   **Specific instructions if the documentType is 'check':**
   - The output table ('extractedTable') MUST be an array of arrays. The first inner array MUST be a header row containing these exact string values: ["Date", "Check Number", "Payee", "Payer", "Amount", "Memo/Narration"].
   - Subsequent inner arrays must represent a single check.
   - For each check, populate the columns:
     - "Date": The date written on the check.
     - "Check Number": The check number, usually found in the top right.
     - "Payee": The recipient of the check (the "Pay to the order of" field).
     - "Payer": The person or company whose name is printed on the check, who is issuing the payment.
     - "Amount": The numerical amount of the check. It is critical to extract this value accurately.
     - "Memo/Narration": The text in the memo or "For" line.

5. If no clear tabular data can be identified on this page, return an empty array for 'extractedTable' and provide a brief explanation in the 'message' field.

Output Format Example for a Bank Statement:
{
  "extractedTable": [
    ["Date", "Description", "Amount Paid", "Amount Received", "Balance"],
    ["2023-08-03", "CHV43124 HIGHWA", "100.00", "", "28689.66"]
  ]
}

Focus on ACCURACY and maintaining the structure of the table with the EXACT headers specified.`;

    // Call Gemini API with user's API key
    const response = await callGeminiAPIWithUserKey(input.geminiApiKey, prompt, input.documentDataUri);
    
    // Parse the response using the same logic as premium version
    return parseGeminiResponse(response);
    
  } catch (error) {
    console.error("Error in extractDataFromDocument: ", error);
    let errorMessage = "An unexpected error occurred during data extraction.";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    // Return the same error format as premium version
    return {
      extractedTable: [],
      message: `Error: ${errorMessage}`
    };
  }
}