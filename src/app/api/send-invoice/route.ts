import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parse as dateFnsParse } from 'date-fns';

// This function generates the PDF on the server.
const generateInvoicePDF = (invoice, companyName, userEmail) => {
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  let currentY = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(companyName || 'Your Company', 20, currentY);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(userEmail || '', 20, currentY + 7);
  
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
  
  return doc.output('arraybuffer');
};


export async function POST(request: Request) {
  const { invoice, customerEmail, companyName, userEmail } = await request.json();

  if (!invoice || !customerEmail) {
    return NextResponse.json({ success: false, error: 'Missing invoice data or customer email' }, { status: 400 });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const pdfAttachment = generateInvoicePDF(invoice, companyName, userEmail);

    const mailOptions = {
      from: `"Accountooze.AI" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `Invoice from ${companyName || 'Your Company'}`,
      html: `
        <div>
          <h2>Invoice from ${companyName || 'Your Company'}</h2>
          <p>Please find your invoice attached.</p>
          <p>Thank you for your business!</p>
        </div>
      `,
      attachments: [
        {
          filename: `Invoice-${invoice.invoiceNumber || invoice.id.substring(0, 5)}.pdf`,
          content: Buffer.from(pdfAttachment),
          contentType: 'application/pdf',
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending invoice email:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send invoice email' },
      { status: 500 }
    );
  }
}
