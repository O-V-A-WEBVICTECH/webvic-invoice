/**
 * PDF Generation Service
 * Creates professional invoice PDFs using PDFKit
 */

const PDFDocument = require('pdfkit');

/**
 * Generate Invoice PDF
 * @param {Object} invoice - Invoice data with items and client
 * @param {Object} user - User/business data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateInvoicePDF(invoice, user) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ 
                margin: 50,
                size: 'A4'
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                resolve(pdfBuffer);
            });

            // Colors
            const primaryColor = '#667eea';
            const textColor = '#333333';
            const grayColor = '#666666';
            const lightGray = '#f5f5f5';

            // Header
            doc.fillColor(primaryColor)
               .fontSize(28)
               .font('Helvetica-Bold')
               .text('INVOICE', 50, 50);

            doc.fillColor(grayColor)
               .fontSize(10)
               .font('Helvetica')
               .text(invoice.invoice_number, 50, 85);

            // Business Info (Right side)
            doc.fillColor(textColor)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text(user.business_name || user.name, 350, 50, { align: 'right' });

            doc.fillColor(grayColor)
               .fontSize(10)
               .font('Helvetica')
               .text(user.email, 350, 68, { align: 'right' });

            if (user.address) {
                doc.text(user.address, 350, 83, { align: 'right' });
            }

            if (user.phone) {
                doc.text(user.phone, 350, 98, { align: 'right' });
            }

            // Divider
            doc.moveTo(50, 130)
               .lineTo(545, 130)
               .strokeColor(lightGray)
               .lineWidth(2)
               .stroke();

            // Bill To
            doc.fillColor(grayColor)
               .fontSize(10)
               .font('Helvetica')
               .text('BILL TO', 50, 150);

            doc.fillColor(textColor)
               .fontSize(12)
               .font('Helvetica-Bold')
               .text(invoice.client.name, 50, 168);

            doc.fillColor(grayColor)
               .fontSize(10)
               .font('Helvetica');

            if (invoice.client.company) {
                doc.text(invoice.client.company, 50, 185);
            }

            doc.text(invoice.client.email, 50, invoice.client.company ? 200 : 185);

            if (invoice.client.address) {
                doc.text(invoice.client.address, 50, invoice.client.company ? 215 : 200);
            }

            // Invoice Details (Right side)
            doc.fillColor(grayColor)
               .text('Issue Date:', 400, 150);
            doc.fillColor(textColor)
               .text(formatDate(invoice.issue_date || invoice.created_at), 470, 150);

            doc.fillColor(grayColor)
               .text('Due Date:', 400, 168);
            doc.fillColor(textColor)
               .font('Helvetica-Bold')
               .text(formatDate(invoice.due_date), 470, 168);

            doc.fillColor(grayColor)
               .font('Helvetica')
               .text('Status:', 400, 186);

            const statusColors = {
                draft: '#9ca3af',
                pending: '#f59e0b',
                paid: '#10b981',
                overdue: '#ef4444',
                cancelled: '#6b7280'
            };

            doc.fillColor(statusColors[invoice.status] || grayColor)
               .font('Helvetica-Bold')
               .text(invoice.status.toUpperCase(), 470, 186);

            // Items Table Header
            const tableTop = 260;
            const tableLeft = 50;

            doc.fillColor(primaryColor)
               .rect(tableLeft, tableTop, 495, 25)
               .fill();

            doc.fillColor('#ffffff')
               .fontSize(10)
               .font('Helvetica-Bold')
               .text('Description', tableLeft + 10, tableTop + 8)
               .text('Qty', 350, tableTop + 8)
               .text('Price', 400, tableTop + 8)
               .text('Amount', 470, tableTop + 8);

            // Items
            let yPosition = tableTop + 35;
            const items = invoice.items || [];

            items.forEach((item, index) => {
                const bgColor = index % 2 === 0 ? '#ffffff' : lightGray;
                
                doc.fillColor(bgColor)
                   .rect(tableLeft, yPosition - 5, 495, 25)
                   .fill();

                doc.fillColor(textColor)
                   .font('Helvetica')
                   .fontSize(10)
                   .text(item.description, tableLeft + 10, yPosition, { width: 280 })
                   .text(item.quantity.toString(), 350, yPosition)
                   .text(formatCurrency(item.unit_price), 400, yPosition)
                   .text(formatCurrency(item.amount), 470, yPosition);

                yPosition += 25;
            });

            // Totals
            yPosition += 20;

            doc.fillColor(grayColor)
               .text('Subtotal:', 400, yPosition);
            doc.fillColor(textColor)
               .text(formatCurrency(invoice.subtotal), 470, yPosition);

            if (invoice.tax_rate > 0) {
                yPosition += 18;
                doc.fillColor(grayColor)
                   .text(`Tax (${invoice.tax_rate}%):`, 400, yPosition);
                doc.fillColor(textColor)
                   .text(formatCurrency(invoice.tax_amount), 470, yPosition);
            }

            if (invoice.discount_amount > 0) {
                yPosition += 18;
                doc.fillColor(grayColor)
                   .text('Discount:', 400, yPosition);
                doc.fillColor('#10b981')
                   .text(`-${formatCurrency(invoice.discount_amount)}`, 470, yPosition);
            }

            // Total
            yPosition += 25;
            doc.fillColor(primaryColor)
               .rect(380, yPosition - 5, 165, 30)
               .fill();

            doc.fillColor('#ffffff')
               .fontSize(12)
               .font('Helvetica-Bold')
               .text('TOTAL:', 400, yPosition + 3)
               .text(formatCurrency(invoice.total), 470, yPosition + 3);

            // Notes
            if (invoice.notes) {
                yPosition += 60;
                doc.fillColor(grayColor)
                   .fontSize(10)
                   .font('Helvetica-Bold')
                   .text('Notes:', 50, yPosition);

                doc.fillColor(textColor)
                   .font('Helvetica')
                   .text(invoice.notes, 50, yPosition + 15, { width: 495 });
            }

            // Terms
            if (invoice.terms) {
                yPosition += 60;
                doc.fillColor(grayColor)
                   .font('Helvetica-Bold')
                   .text('Terms & Conditions:', 50, yPosition);

                doc.fillColor(textColor)
                   .font('Helvetica')
                   .text(invoice.terms, 50, yPosition + 15, { width: 495 });
            }

            // Footer
            doc.fillColor(grayColor)
               .fontSize(9)
               .text(
                   'Generated by InvoiceFlow | invoiceflow.com',
                   50,
                   780,
                   { align: 'center', width: 495 }
               );

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Format currency
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

/**
 * Format date
 */
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

module.exports = { generateInvoicePDF };
