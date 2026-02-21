/**
 * Payment Routes
 * Handles Stripe payments and subscriptions
 */

const express = require('express');
const Stripe = require('stripe');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, APIError } = require('../middleware/errorHandler');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/payments/create-checkout-session
 * Create Stripe checkout session for subscription
 */
router.post('/create-checkout-session', asyncHandler(async (req, res) => {
    const { plan, billing_period = 'monthly' } = req.body;

    const priceIds = {
        pro: {
            monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
            yearly: process.env.STRIPE_PRICE_PRO_YEARLY
        },
        business: {
            monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
            yearly: process.env.STRIPE_PRICE_BUSINESS_YEARLY
        }
    };

    if (!priceIds[plan] || !priceIds[plan][billing_period]) {
        throw new APIError('Invalid plan or billing period', 400);
    }

    // Get or create Stripe customer
    let stripeCustomerId = req.user.stripe_customer_id;

    if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
            email: req.user.email,
            name: req.user.name,
            metadata: {
                user_id: req.userId
            }
        });
        stripeCustomerId = customer.id;

        // Save customer ID
        await supabase
            .from('users')
            .update({ stripe_customer_id: stripeCustomerId })
            .eq('id', req.userId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price: priceIds[plan][billing_period],
                quantity: 1
            }
        ],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}&success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/pricing?cancelled=true`,
        metadata: {
            user_id: req.userId,
            plan
        },
        subscription_data: {
            metadata: {
                user_id: req.userId,
                plan
            }
        },
        allow_promotion_codes: true
    });

    res.json({
        success: true,
        sessionId: session.id,
        url: session.url
    });
}));

/**
 * POST /api/payments/create-invoice-payment
 * Create payment link for a specific invoice
 */
router.post('/create-invoice-payment/:invoiceId', asyncHandler(async (req, res) => {
    // Get invoice
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`*, client:clients(name, email)`)
        .eq('id', req.params.invoiceId)
        .eq('user_id', req.userId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    if (invoice.status === 'paid') {
        throw new APIError('Invoice is already paid', 400);
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(invoice.total * 100), // Convert to cents
        currency: 'usd',
        metadata: {
            invoice_id: invoice.id,
            user_id: req.userId,
            invoice_number: invoice.invoice_number
        },
        description: `Invoice ${invoice.invoice_number}`,
        receipt_email: invoice.client.email
    });

    // Save payment intent ID
    await supabase
        .from('invoices')
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq('id', invoice.id);

    res.json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        amount: invoice.total
    });
}));

/**
 * GET /api/payments/subscription
 * Get current subscription status
 */
router.get('/subscription', asyncHandler(async (req, res) => {
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', req.userId)
        .eq('status', 'active')
        .single();

    if (!subscription) {
        return res.json({
            success: true,
            subscription: null,
            plan: 'free'
        });
    }

    // Get from Stripe for latest info
    if (subscription.stripe_subscription_id) {
        const stripeSubscription = await stripe.subscriptions.retrieve(
            subscription.stripe_subscription_id
        );

        return res.json({
            success: true,
            subscription: {
                ...subscription,
                current_period_end: new Date(stripeSubscription.current_period_end * 1000),
                cancel_at_period_end: stripeSubscription.cancel_at_period_end
            },
            plan: subscription.plan
        });
    }

    res.json({
        success: true,
        subscription,
        plan: subscription.plan
    });
}));

/**
 * POST /api/payments/cancel-subscription
 * Cancel subscription at period end
 */
router.post('/cancel-subscription', asyncHandler(async (req, res) => {
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', req.userId)
        .eq('status', 'active')
        .single();

    if (!subscription?.stripe_subscription_id) {
        throw new APIError('No active subscription found', 404);
    }

    // Cancel at period end
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true
    });

    res.json({
        success: true,
        message: 'Subscription will be cancelled at the end of the billing period'
    });
}));

/**
 * POST /api/payments/resume-subscription
 * Resume a cancelled subscription
 */
router.post('/resume-subscription', asyncHandler(async (req, res) => {
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', req.userId)
        .single();

    if (!subscription?.stripe_subscription_id) {
        throw new APIError('No subscription found', 404);
    }

    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: false
    });

    res.json({
        success: true,
        message: 'Subscription resumed successfully'
    });
}));

/**
 * GET /api/payments/invoices
 * Get Stripe invoices for subscription
 */
router.get('/billing-history', asyncHandler(async (req, res) => {
    if (!req.user.stripe_customer_id) {
        return res.json({ success: true, invoices: [] });
    }

    const invoices = await stripe.invoices.list({
        customer: req.user.stripe_customer_id,
        limit: 24
    });

    const formattedInvoices = invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_paid / 100,
        status: inv.status,
        date: new Date(inv.created * 1000),
        pdf_url: inv.invoice_pdf,
        hosted_url: inv.hosted_invoice_url
    }));

    res.json({
        success: true,
        invoices: formattedInvoices
    });
}));

/**
 * POST /api/payments/update-payment-method
 * Create setup intent for updating payment method
 */
router.post('/update-payment-method', asyncHandler(async (req, res) => {
    if (!req.user.stripe_customer_id) {
        throw new APIError('No billing account found', 404);
    }

    const setupIntent = await stripe.setupIntents.create({
        customer: req.user.stripe_customer_id,
        payment_method_types: ['card']
    });

    res.json({
        success: true,
        clientSecret: setupIntent.client_secret
    });
}));

module.exports = router;
