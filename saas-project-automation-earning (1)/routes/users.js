/**
 * User Routes
 * User profile and settings management
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { sanitizeString } = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/users/profile
 * Get user profile
 */
router.get('/profile', asyncHandler(async (req, res) => {
    const { data: user, error } = await supabase
        .from('users')
        .select('id, email, name, business_name, address, phone, logo_url, plan, plan_expires_at, payment_terms, created_at')
        .eq('id', req.userId)
        .single();

    if (error || !user) {
        throw new APIError('User not found', 404);
    }

    res.json({
        success: true,
        user
    });
}));

/**
 * PUT /api/users/profile
 * Update user profile
 */
router.put('/profile', asyncHandler(async (req, res) => {
    const { name, business_name, address, phone, payment_terms } = req.body;

    const updateData = {};
    if (name) updateData.name = sanitizeString(name);
    if (business_name !== undefined) updateData.business_name = sanitizeString(business_name);
    if (address !== undefined) updateData.address = sanitizeString(address);
    if (phone !== undefined) updateData.phone = sanitizeString(phone);
    if (payment_terms) updateData.payment_terms = parseInt(payment_terms);

    const { data: user, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', req.userId)
        .select('id, email, name, business_name, address, phone, plan, payment_terms')
        .single();

    if (error) {
        throw new APIError('Failed to update profile', 500);
    }

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'PROFILE_UPDATED',
        entity_type: 'user',
        entity_id: req.userId,
        new_values: updateData,
        ip_address: req.ip
    });

    res.json({
        success: true,
        message: 'Profile updated successfully',
        user
    });
}));

/**
 * PUT /api/users/password
 * Change password
 */
router.put('/password', asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        throw new APIError('Current and new password required', 400);
    }

    if (new_password.length < 8) {
        throw new APIError('New password must be at least 8 characters', 400);
    }

    // Get current password hash
    const { data: user, error } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', req.userId)
        .single();

    if (error || !user) {
        throw new APIError('User not found', 404);
    }

    // Verify current password
    const isValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isValid) {
        throw new APIError('Current password is incorrect', 400);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const newPasswordHash = await bcrypt.hash(new_password, salt);

    // Update password
    await supabase
        .from('users')
        .update({ password_hash: newPasswordHash })
        .eq('id', req.userId);

    // Revoke all refresh tokens
    await supabase
        .from('refresh_tokens')
        .update({ is_revoked: true })
        .eq('user_id', req.userId);

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'PASSWORD_CHANGED',
        entity_type: 'user',
        entity_id: req.userId,
        ip_address: req.ip
    });

    res.json({
        success: true,
        message: 'Password changed successfully. Please login again.'
    });
}));

/**
 * DELETE /api/users/account
 * Delete user account
 */
router.delete('/account', asyncHandler(async (req, res) => {
    const { password } = req.body;

    if (!password) {
        throw new APIError('Password required to delete account', 400);
    }

    // Verify password
    const { data: user } = await supabase
        .from('users')
        .select('password_hash, stripe_subscription_id')
        .eq('id', req.userId)
        .single();

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
        throw new APIError('Password is incorrect', 400);
    }

    // Cancel Stripe subscription if exists
    if (user.stripe_subscription_id) {
        const Stripe = require('stripe');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        
        try {
            await stripe.subscriptions.del(user.stripe_subscription_id);
        } catch (err) {
            console.error('Failed to cancel Stripe subscription:', err);
        }
    }

    // Soft delete - anonymize user data
    await supabase
        .from('users')
        .update({
            email: `deleted_${req.userId}@deleted.com`,
            name: 'Deleted User',
            business_name: null,
            address: null,
            phone: null,
            is_active: false,
            password_hash: 'DELETED'
        })
        .eq('id', req.userId);

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'ACCOUNT_DELETED',
        entity_type: 'user',
        entity_id: req.userId,
        ip_address: req.ip
    });

    res.json({
        success: true,
        message: 'Account deleted successfully'
    });
}));

/**
 * GET /api/users/dashboard-stats
 * Get dashboard statistics
 */
router.get('/dashboard-stats', asyncHandler(async (req, res) => {
    // Get invoice stats
    const { data: invoices } = await supabase
        .from('invoices')
        .select('status, total, created_at')
        .eq('user_id', req.userId);

    // Get client count
    const { count: clientCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.userId)
        .eq('is_active', true);

    // Calculate stats
    const now = new Date();
    const thisMonth = invoices?.filter(i => 
        new Date(i.created_at).getMonth() === now.getMonth() &&
        new Date(i.created_at).getFullYear() === now.getFullYear()
    ) || [];

    const lastMonth = invoices?.filter(i => {
        const date = new Date(i.created_at);
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1);
        return date.getMonth() === lastMonthDate.getMonth() &&
               date.getFullYear() === lastMonthDate.getFullYear();
    }) || [];

    const thisMonthRevenue = thisMonth.filter(i => i.status === 'paid').reduce((sum, i) => sum + parseFloat(i.total), 0);
    const lastMonthRevenue = lastMonth.filter(i => i.status === 'paid').reduce((sum, i) => sum + parseFloat(i.total), 0);

    const revenueGrowth = lastMonthRevenue > 0 
        ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
        : thisMonthRevenue > 0 ? 100 : 0;

    res.json({
        success: true,
        stats: {
            total_revenue: invoices?.filter(i => i.status === 'paid').reduce((sum, i) => sum + parseFloat(i.total), 0) || 0,
            pending_amount: invoices?.filter(i => i.status === 'pending').reduce((sum, i) => sum + parseFloat(i.total), 0) || 0,
            overdue_amount: invoices?.filter(i => i.status === 'overdue').reduce((sum, i) => sum + parseFloat(i.total), 0) || 0,
            total_invoices: invoices?.length || 0,
            total_clients: clientCount || 0,
            this_month_revenue: thisMonthRevenue,
            revenue_growth: parseFloat(revenueGrowth),
            pending_count: invoices?.filter(i => i.status === 'pending').length || 0,
            overdue_count: invoices?.filter(i => i.status === 'overdue').length || 0
        }
    });
}));

/**
 * GET /api/users/activity
 * Get recent activity/audit log
 */
router.get('/activity', asyncHandler(async (req, res) => {
    const { limit = 20 } = req.query;

    const { data: activities, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw new APIError('Failed to fetch activity', 500);
    }

    res.json({
        success: true,
        activities
    });
}));

module.exports = router;
