/**
 * Authentication Routes
 * Handles user registration, login, logout, and password reset
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { generateTokens, authenticate } = require('../middleware/auth');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { validations } = require('../middleware/validate');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', validations.register, asyncHandler(async (req, res) => {
    const { email, password, name, business_name } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

    if (existingUser) {
        throw new APIError('An account with this email already exists', 400, 'EMAIL_EXISTS');
    }

    // Hash password
    const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const { data: user, error } = await supabase
        .from('users')
        .insert({
            id: uuidv4(),
            email: email.toLowerCase(),
            password_hash: passwordHash,
            name,
            business_name: business_name || name,
            plan: 'free',
            is_active: true
        })
        .select('id, email, name, business_name, plan')
        .single();

    if (error) {
        console.error('Registration error:', error);
        throw new APIError('Failed to create account', 500);
    }

    // Generate tokens
    const tokens = generateTokens(user.id);

    // Log audit
    await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'USER_REGISTERED',
        entity_type: 'user',
        entity_id: user.id,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    });

    res.status(201).json({
        success: true,
        message: 'Account created successfully',
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            business_name: user.business_name,
            plan: user.plan
        },
        tokens
    });
}));

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login', validations.login, asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Get user
    const { data: user, error } = await supabase
        .from('users')
        .select('id, email, password_hash, name, business_name, plan, is_active')
        .eq('email', email.toLowerCase())
        .single();

    if (error || !user) {
        throw new APIError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
        throw new APIError('Account is deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
        // Log failed attempt
        await supabase.from('audit_logs').insert({
            user_id: user.id,
            action: 'LOGIN_FAILED',
            entity_type: 'user',
            entity_id: user.id,
            ip_address: req.ip,
            user_agent: req.get('user-agent')
        });

        throw new APIError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Update last login
    await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);

    // Generate tokens
    const tokens = generateTokens(user.id);

    // Store refresh token hash
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
    await supabase.from('refresh_tokens').insert({
        user_id: user.id,
        token_hash: refreshTokenHash,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Log successful login
    await supabase.from('audit_logs').insert({
        user_id: user.id,
        action: 'LOGIN_SUCCESS',
        entity_type: 'user',
        entity_id: user.id,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    });

    res.json({
        success: true,
        message: 'Login successful',
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            business_name: user.business_name,
            plan: user.plan
        },
        tokens
    });
}));

/**
 * POST /api/auth/logout
 * User logout - invalidate refresh token
 */
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    // Revoke all refresh tokens for user
    await supabase
        .from('refresh_tokens')
        .update({ is_revoked: true })
        .eq('user_id', req.userId);

    // Log logout
    await supabase.from('audit_logs').insert({
        user_id: req.userId,
        action: 'LOGOUT',
        entity_type: 'user',
        entity_id: req.userId,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    });

    res.json({
        success: true,
        message: 'Logged out successfully'
    });
}));

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new APIError('Refresh token required', 400);
    }

    // Verify refresh token format
    const jwt = require('jsonwebtoken');
    let decoded;
    
    try {
        decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
        throw new APIError('Invalid refresh token', 401);
    }

    if (decoded.type !== 'refresh') {
        throw new APIError('Invalid token type', 401);
    }

    // Check if token is revoked
    const { data: tokenRecords } = await supabase
        .from('refresh_tokens')
        .select('*')
        .eq('user_id', decoded.userId)
        .eq('is_revoked', false);

    if (!tokenRecords || tokenRecords.length === 0) {
        throw new APIError('Token has been revoked', 401);
    }

    // Generate new tokens
    const tokens = generateTokens(decoded.userId);

    res.json({
        success: true,
        tokens
    });
}));

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
    const { email } = req.body;

    // Always return success to prevent email enumeration
    res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link.'
    });

    // Check if user exists (async, after response)
    const { data: user } = await supabase
        .from('users')
        .select('id, email, name')
        .eq('email', email.toLowerCase())
        .single();

    if (user) {
        // Generate reset token and send email
        // In production, implement proper email sending
        console.log(`Password reset requested for: ${email}`);
    }
}));

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
    const { data: user, error } = await supabase
        .from('users')
        .select('id, email, name, business_name, address, phone, plan, plan_expires_at, created_at')
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

module.exports = router;
