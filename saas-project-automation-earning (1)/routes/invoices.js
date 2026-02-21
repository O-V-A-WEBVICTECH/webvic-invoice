/**
 * Invoice Routes
 * CRUD operations for invoices
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { authenticate, requirePlan } = require('../middleware/auth');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { sanitizeString } = require('../middleware/validate');
const { generateInvoicePDF } = require('../services/pdfService');
const { sendInvoiceEmail } = require('../services/emailService');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/invoices
 * Get all invoices for user
 */
router.get('/', asyncHandler(async (req, res) => {
    const { status, client_id, page = 1, limit = 20, sort = 'created_at', order = 'desc' } = req.query;
    
    let query = supabase
        .from('invoices')
        .select(`
            *,
            client:clients(id, name, email, company)
        `, { count: 'exact' })
        .eq('user_id', req.userId)
        .order(sort, { ascending: order === 'asc' })
        .range((page - 1) * limit, page * limit - 1);

    if (status) {
        query = query.eq('status', status);
    }

    if (client_id) {
        query = query.eq('client_id', client_id);
    }

    const { data: invoices, error, count } = await query;

    if (error) {
        throw new APIError('Failed to fetch invoices', 500);
    }

    res.json({
        success: true,
        invoices,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
        }
    });
}));

/**
 * GET /api/invoices/stats
 * Get invoice statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('status, total')
        .eq('user_id', req.userId);

    if (error) {
        throw new APIError('Failed to fetch statistics', 500);
    }

    const stats = {
        total_invoices: invoices.length,
        total_revenue: invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + parseFloat(i.total), 0),
        pending_amount: invoices.filter(i => i.status === 'pending').reduce((sum, i) => sum + parseFloat(i.total), 0),
        overdue_amount: invoices.filter(i => i.status === 'overdue').reduce((sum, i) => sum + parseFloat(i.total), 0),
        by_status: {
            draft: invoices.filter(i => i.status === 'draft').length,
            pending: invoices.filter(i => i.status === 'pending').length,
            paid: invoices.filter(i => i.status === 'paid').length,
            overdue: invoices.filter(i => i.status === 'overdue').length,
            cancelled: invoices.filter(i => i.status === 'cancelled').length
        }
    };

    res.json({ success: true, stats });
}));

/**
 * GET /api/invoices/:id
 * Get single invoice with items
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            client:clients(id, name, email, company, address, phone),
            items:invoice_items(id, description, quantity, unit_price, amount, sort_order)
        `)
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    res.json({ success: true, invoice });
}));

/**
 * POST /api/invoices
 * Create new invoice
 */
router.post('/', asyncHandler(async (req, res) => {
    const { client_id, items, due_date, notes, terms, tax_rate = 0, discount_amount = 0 } = req.body;

    // Check plan limits
    if (req.user.plan === 'free') {
        const { count } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.userId)
            .gte('created_at', new Date(new Date().setDate(1)).toISOString());

        if (count >= 5) {
            throw new APIError('Free plan limited to 5 invoices per month. Please upgrade.', 403, 'PLAN_LIMIT');
        }
    }

    // Verify client belongs to user
    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', client_id)
        .eq('user_id', req.userId)
        .single();

    if (clientError || !client) {
        throw new APIError('Client not found', 404);
    }

    // Generate invoice number
    const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.userId);

    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const taxAmount = subtotal * (tax_rate / 100);
    const total = subtotal + taxAmount - discount_amount;

    // Create invoice
    const invoiceId = uuidv4();
    const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
            id: invoiceId,
            user_id: req.userId,
            client_id,
            invoice_number: invoiceNumber,
            status: 'pending',
            due_date,
            subtotal,
            tax_rate,
            tax_amount: taxAmount,
            discount_amount,
            total,
            notes: sanitizeString(notes),
            terms: sanitizeString(terms)
        })
        .select()
        .single();

    if (invoiceError) {
        throw new APIError('Failed to create invoice', 500);
    }

    // Create invoice items
    const invoiceItems = items.map((item, index) => ({
        id: uuidv4(),
        invoice_id: invoiceId,
        description: sanitizeString(item.description),
        quantity: item.quantity,
        unit_price: item.price,
        amount: item.quantity * item.price,
        sort_order: index
    }));

    const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(invoiceItems);

    if (itemsError) {
        // Rollback invoice
        await supabase.from('invoices').delete().eq('id', invoiceId);
        throw new APIError('Failed to create invoice items', 500);
    }

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'INVOICE_CREATED',
        entity_type: 'invoice',
        entity_id: invoiceId,
        new_values: { invoice_number: invoiceNumber, total },
        ip_address: req.ip
    });

    res.status(201).json({
        success: true,
        message: 'Invoice created successfully',
        invoice: { ...invoice, items: invoiceItems }
    });
}));

/**
 * PUT /api/invoices/:id
 * Update invoice
 */
router.put('/:id', asyncHandler(async (req, res) => {
    const { items, due_date, notes, terms, status, tax_rate, discount_amount } = req.body;

    // Get existing invoice
    const { data: existing, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (fetchError || !existing) {
        throw new APIError('Invoice not found', 404);
    }

    // Can't edit paid invoices
    if (existing.status === 'paid' && status !== 'paid') {
        throw new APIError('Cannot modify a paid invoice', 400);
    }

    // Calculate new totals if items provided
    let updateData = { due_date, notes, terms, status, tax_rate, discount_amount };
    
    if (items) {
        const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        const taxAmount = subtotal * ((tax_rate || existing.tax_rate) / 100);
        const total = subtotal + taxAmount - (discount_amount || existing.discount_amount);
        
        updateData = { ...updateData, subtotal, tax_amount: taxAmount, total };

        // Delete old items and insert new
        await supabase.from('invoice_items').delete().eq('invoice_id', req.params.id);
        
        const newItems = items.map((item, index) => ({
            id: uuidv4(),
            invoice_id: req.params.id,
            description: sanitizeString(item.description),
            quantity: item.quantity,
            unit_price: item.price,
            amount: item.quantity * item.price,
            sort_order: index
        }));

        await supabase.from('invoice_items').insert(newItems);
    }

    // Update invoice
    const { data: invoice, error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) {
        throw new APIError('Failed to update invoice', 500);
    }

    res.json({ success: true, message: 'Invoice updated', invoice });
}));

/**
 * POST /api/invoices/:id/send
 * Send invoice to client via email
 */
router.post('/:id/send', requirePlan('pro', 'business'), asyncHandler(async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            client:clients(name, email),
            items:invoice_items(*)
        `)
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoice, req.user);

    // Send email
    await sendInvoiceEmail(invoice.client.email, invoice, pdfBuffer);

    // Update status to pending if draft
    if (invoice.status === 'draft') {
        await supabase
            .from('invoices')
            .update({ status: 'pending' })
            .eq('id', req.params.id);
    }

    res.json({ success: true, message: 'Invoice sent successfully' });
}));

/**
 * POST /api/invoices/:id/remind
 * Send payment reminder
 */
router.post('/:id/remind', requirePlan('pro', 'business'), asyncHandler(async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`*, client:clients(name, email)`)
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    if (invoice.status === 'paid') {
        throw new APIError('Invoice is already paid', 400);
    }

    // Send reminder email
    // await sendReminderEmail(invoice.client.email, invoice);

    // Update reminder count
    await supabase
        .from('invoices')
        .update({ 
            reminder_sent_at: new Date().toISOString(),
            reminder_count: invoice.reminder_count + 1
        })
        .eq('id', req.params.id);

    res.json({ success: true, message: 'Reminder sent successfully' });
}));

/**
 * POST /api/invoices/:id/mark-paid
 * Mark invoice as paid
 */
router.post('/:id/mark-paid', asyncHandler(async (req, res) => {
    const { payment_method = 'manual', notes } = req.body;

    const { data: invoice, error: fetchError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (fetchError || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    // Update invoice
    const { error } = await supabase
        .from('invoices')
        .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            paid_amount: invoice.total,
            payment_method
        })
        .eq('id', req.params.id);

    if (error) {
        throw new APIError('Failed to update invoice', 500);
    }

    // Record payment
    await supabase.from('payments').insert({
        id: uuidv4(),
        invoice_id: req.params.id,
        user_id: req.userId,
        amount: invoice.total,
        payment_method,
        status: 'completed',
        notes
    });

    res.json({ success: true, message: 'Invoice marked as paid' });
}));

/**
 * DELETE /api/invoices/:id
 * Delete invoice
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    const { data: invoice, error: fetchError } = await supabase
        .from('invoices')
        .select('id, status')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (fetchError || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    if (invoice.status === 'paid') {
        throw new APIError('Cannot delete a paid invoice', 400);
    }

    // Delete invoice (cascade will delete items)
    const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', req.params.id);

    if (error) {
        throw new APIError('Failed to delete invoice', 500);
    }

    res.json({ success: true, message: 'Invoice deleted' });
}));

/**
 * GET /api/invoices/:id/pdf
 * Download invoice as PDF
 */
router.get('/:id/pdf', asyncHandler(async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            client:clients(*),
            items:invoice_items(*)
        `)
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    const pdfBuffer = await generateInvoicePDF(invoice, req.user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.send(pdfBuffer);
}));

module.exports = router;
