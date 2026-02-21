/**
 * Email Service
 * Handles sending emails via Resend or SMTP
 */

const nodemailer = require('nodemailer');

// Create transporter based on provider
let transporter;

if (process.env.EMAIL_PROVIDER === 'resend') {
    // Using Resend
    transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: {
            user: 'resend',
            pass: process.env.RESEND_API_KEY
        }
    });
} else {
    // Using SMTP
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

/**
 * Send invoice email with PDF attachment
 */
async function sendInvoiceEmail(toEmail, invoice, pdfBuffer) {
    const fromName = process.env.EMAIL_FROM_NAME || 'InvoiceFlow';
    const fromEmail = process.env.EMAIL_FROM || 'invoices@invoiceflow.com';

    const mailOptions = {
        from: `${fromName} <${fromEmail}>`,
        to: toEmail,
        subject: `Invoice ${invoice.invoice_number} from ${invoice.user_name || 'InvoiceFlow'}`,
        html: getInvoiceEmailTemplate(invoice),
        attachments: [
            {
                filename: `${invoice.invoice_number}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }
        ]
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Invoice email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Failed to send invoice email:', error);
        throw error;
    }
}

/**
 * Send payment reminder email
 */
async function sendReminderEmail(toEmail, invoice) {
    const fromName = process.env.EMAIL_FROM_NAME || 'InvoiceFlow';
    const fromEmail = process.env.EMAIL_FROM || 'invoices@invoiceflow.com';

    const daysOverdue = Math.floor((Date.now() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24));

    const mailOptions = {
        from: `${fromName} <${fromEmail}>`,
        to: toEmail,
        subject: `Payment Reminder: Invoice ${invoice.invoice_number}`,
        html: getReminderEmailTemplate(invoice, daysOverdue)
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Reminder email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Failed to send reminder email:', error);
        throw error;
    }
}

/**
 * Send welcome email
 */
async function sendWelcomeEmail(toEmail, userName) {
    const fromName = process.env.EMAIL_FROM_NAME || 'InvoiceFlow';
    const fromEmail = process.env.EMAIL_FROM || 'hello@invoiceflow.com';

    const mailOptions = {
        from: `${fromName} <${fromEmail}>`,
        to: toEmail,
        subject: 'Welcome to InvoiceFlow! 🚀',
        html: getWelcomeEmailTemplate(userName)
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Welcome email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        throw error;
    }
}

/**
 * Invoice email template
 */
function getInvoiceEmailTemplate(invoice) {
    const paymentUrl = `${process.env.FRONTEND_URL}/pay/${invoice.id}`;
    const dueDate = new Date(invoice.due_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Invoice ${invoice.invoice_number}</h1>
        </div>
        
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hello ${invoice.client?.name || 'there'},
            </p>
            
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Please find attached invoice <strong>${invoice.invoice_number}</strong> for your recent services.
            </p>
            
            <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                    <span style="color: #666;">Amount Due:</span>
                    <strong style="color: #333; font-size: 24px;">$${invoice.total.toFixed(2)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #666;">Due Date:</span>
                    <strong style="color: #333;">${dueDate}</strong>
                </div>
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
                <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 600; font-size: 16px;">
                    Pay Now
                </a>
            </div>
            
            <p style="color: #999; font-size: 14px; text-align: center;">
                A PDF copy of this invoice is attached for your records.
            </p>
        </div>
        
        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">
            Sent via <a href="https://invoiceflow.com" style="color: #667eea;">InvoiceFlow</a>
        </p>
    </div>
</body>
</html>
    `;
}

/**
 * Reminder email template
 */
function getReminderEmailTemplate(invoice, daysOverdue) {
    const paymentUrl = `${process.env.FRONTEND_URL}/pay/${invoice.id}`;
    const isOverdue = daysOverdue > 0;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: ${isOverdue ? '#ef4444' : '#f59e0b'}; border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">
                ${isOverdue ? '⚠️ Payment Overdue' : '⏰ Payment Reminder'}
            </h1>
        </div>
        
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hello ${invoice.client?.name || 'there'},
            </p>
            
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
                ${isOverdue 
                    ? `This is a friendly reminder that invoice <strong>${invoice.invoice_number}</strong> is now <strong>${daysOverdue} days overdue</strong>.`
                    : `This is a friendly reminder that invoice <strong>${invoice.invoice_number}</strong> is due soon.`
                }
            </p>
            
            <div style="background: ${isOverdue ? '#fef2f2' : '#fffbeb'}; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid ${isOverdue ? '#fecaca' : '#fde68a'};">
                <div style="text-align: center;">
                    <span style="color: #666;">Amount Due:</span>
                    <div style="color: #333; font-size: 32px; font-weight: bold; margin: 8px 0;">
                        $${invoice.total.toFixed(2)}
                    </div>
                </div>
            </div>
            
            <div style="text-align: center; margin: 32px 0;">
                <a href="${paymentUrl}" style="display: inline-block; background: ${isOverdue ? '#ef4444' : '#f59e0b'}; color: white; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 600; font-size: 16px;">
                    Pay Now
                </a>
            </div>
            
            <p style="color: #999; font-size: 14px; text-align: center;">
                If you've already sent payment, please disregard this email.
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

/**
 * Welcome email template
 */
function getWelcomeEmailTemplate(userName) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to InvoiceFlow! 🚀</h1>
        </div>
        
        <div style="background: white; padding: 40px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Hey ${userName}! 👋
            </p>
            
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
                Thanks for signing up for InvoiceFlow. We're excited to help you get paid faster!
            </p>
            
            <h3 style="color: #333; margin-top: 32px;">Get Started:</h3>
            
            <ul style="color: #666; font-size: 16px; line-height: 2;">
                <li>Add your first client</li>
                <li>Create and send your first invoice</li>
                <li>Set up your business profile</li>
                <li>Explore automatic payment reminders</li>
            </ul>
            
            <div style="text-align: center; margin: 32px 0;">
                <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 600; font-size: 16px;">
                    Go to Dashboard
                </a>
            </div>
            
            <p style="color: #999; font-size: 14px;">
                Questions? Just reply to this email - we're here to help!
            </p>
        </div>
    </div>
</body>
</html>
    `;
}

module.exports = {
    sendInvoiceEmail,
    sendReminderEmail,
    sendWelcomeEmail
};
