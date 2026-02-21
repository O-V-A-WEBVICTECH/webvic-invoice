/**
 * Client Routes
 * CRUD operations for clients
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { authenticate, requirePlan } = require('../middleware/auth');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { sanitizeString } = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/clients
 * Get all clients for user
 */
router.get('/', asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, search, sort = 'created_at', order = 'desc' } = req.query;

    let query = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .eq('user_id', req.userId)
        .eq('is_active', true)
        .order(sort, { ascending: order === 'asc' })
        .range((page - 1) * limit, page * limit - 1);

    if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`);
    }

    const { data: clients, error, count } = await query;

    if (error) {
        throw new APIError('Failed to fetch clients', 500);
    }

    res.json({
        success: true,
        clients,
        pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
        }
    });
}));

/**
 * GET /api/clients/:id
 * Get single client with invoice history
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const { data: client, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (error || !client) {
        throw new APIError('Client not found', 404);
    }

    // Get invoice summary
    const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, total, due_date, created_at')
        .eq('client_id', req.params.id)
        .order('created_at', { ascending: false });

    const stats = {
        total_invoices: invoices?.length || 0,
        total_billed: invoices?.reduce((sum, i) => sum + parseFloat(i.total), 0) || 0,
        total_paid: invoices?.filter(i => i.status === 'paid').reduce((sum, i) => sum + parseFloat(i.total), 0) || 0,
        outstanding: invoices?.filter(i => ['pending', 'overdue'].includes(i.status)).reduce((sum, i) => sum + parseFloat(i.total), 0) || 0
    };

    res.json({
        success: true,
        client,
        invoices,
        stats
    });
}));

/**
 * POST /api/clients
 * Create new client
 */
router.post('/', asyncHandler(async (req, res) => {
    const { name, email, company, phone, address, notes } = req.body;

    // Check plan limits for free users
    if (req.user.plan === 'free') {
        const { count } = await supabase
            .from('clients')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', req.userId)
            .eq('is_active', true);

        if (count >= 2) {
            throw new APIError('Free plan limited to 2 clients. Please upgrade.', 403, 'PLAN_LIMIT');
        }
    }

    // Check for duplicate email
    const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', req.userId)
        .eq('email', email.toLowerCase())
        .single();

    if (existing) {
        throw new APIError('A client with this email already exists', 400, 'DUPLICATE_CLIENT');
    }

    // Create client
    const { data: client, error } = await supabase
        .from('clients')
        .insert({
            id: uuidv4(),
            user_id: req.userId,
            name: sanitizeString(name),
            email: email.toLowerCase(),
            company: sanitizeString(company),
            phone: sanitizeString(phone),
            address: sanitizeString(address),
            notes: sanitizeString(notes)
        })
        .select()
        .single();

    if (error) {
        throw new APIError('Failed to create client', 500);
    }

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'CLIENT_CREATED',
        entity_type: 'client',
        entity_id: client.id,
        new_values: { name, email },
        ip_address: req.ip
    });

    res.status(201).json({
        success: true,
        message: 'Client created successfully',
        client
    });
}));

/**
 * PUT /api/clients/:id
 * Update client
 */
router.put('/:id', asyncHandler(async (req, res) => {
    const { name, email, company, phone, address, notes } = req.body;

    // Verify client belongs to user
    const { data: existing, error: fetchError } = await supabase
        .from('clients')
        .select('id')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .single();

    if (fetchError || !existing) {
        throw new APIError('Client not found', 404);
    }

    // Check for duplicate email if email changed
    if (email) {
        const { data: duplicate } = await supabase
            .from('clients')
            .select('id')
            .eq('user_id', req.userId)
            .eq('email', email.toLowerCase())
            .neq('id', req.params.id)
            .single();

        if (duplicate) {
            throw new APIError('Another client with this email already exists', 400);
        }
    }

    // Update client
    const updateData = {};
    if (name) updateData.name = sanitizeString(name);
    if (email) updateData.email = email.toLowerCase();
    if (company !== undefined) updateData.company = sanitizeString(company);
    if (phone !== undefined) updateData.phone = sanitizeString(phone);
    if (address !== undefined) updateData.address = sanitizeString(address);
    if (notes !== undefined) updateData.notes = sanitizeString(notes);

    const { data: client, error } = await supabase
        .from('clients')
        .update(updateData)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) {
        throw new APIError('Failed to update client', 500);
    }

    res.json({
        success: true,
        message: 'Client updated successfully',
        client
    });
}));

/**
 * DELETE /api/clients/:id
 * Soft delete client (set is_active = false)
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    // Check for existing invoices
    const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', req.params.id)
        .eq('user_id', req.userId);

    if (count > 0) {
        // Soft delete - keep for invoice history
        const { error } = await supabase
            .from('clients')
            .update({ is_active: false })
            .eq('id', req.params.id)
            .eq('user_id', req.userId);

        if (error) {
            throw new APIError('Failed to delete client', 500);
        }

        return res.json({
            success: true,
            message: 'Client archived (has invoice history)'
        });
    }

    // Hard delete if no invoices
    const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId);

    if (error) {
        throw new APIError('Failed to delete client', 500);
    }

    res.json({
        success: true,
        message: 'Client deleted successfully'
    });
}));

module.exports = router;
