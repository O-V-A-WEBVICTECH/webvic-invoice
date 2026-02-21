/**
 * Webhook Routes
 * Handles Stripe webhooks for payment events
 */

const express = require('express');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 */
router.post('/stripe', asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('Received webhook event:', event.type);

    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutComplete(event.data.object);
            break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            await handleSubscriptionUpdate(event.data.object);
            break;

        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object);
            break;

        case 'invoice.paid':
            await handleInvoicePaid(event.data.object);
            break;

        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object);
            break;

        case 'payment_intent.succeeded':
            await handlePaymentIntentSucceeded(event.data.object);
            break;

        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
}));

/**
 * Handle successful checkout
 */
async function handleCheckoutComplete(session) {
    const userId = session.metadata.user_id;
    const plan = session.metadata.plan;

    if (!userId) {
        console.error('No user_id in checkout session metadata');
        return;
    }

    // Update user's plan
    await supabase
        .from('users')
        .update({
            plan,
            stripe_subscription_id: session.subscription
        })
        .eq('id', userId);

    console.log(`User ${userId} upgraded to ${plan}`);
}

/**
 * Handle subscription update
 */
async function handleSubscriptionUpdate(subscription) {
    const userId = subscription.metadata.user_id;
    const plan = subscription.metadata.plan;

    if (!userId) {
        // Try to find user by customer ID
        const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('stripe_customer_id', subscription.customer)
            .single();

        if (!user) {
            console.error('Could not find user for subscription:', subscription.id);
            return;
        }
    }

    const status = subscription.status;
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    // Upsert subscription record
    await supabase
        .from('subscriptions')
        .upsert({
            id: uuidv4(),
            user_id: userId,
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer,
            plan: plan || 'pro',
            status: status === 'active' || status === 'trialing' ? 'active' : status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: currentPeriodEnd.toISOString(),
            cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null
        }, {
            onConflict: 'stripe_subscription_id'
        });

    // Update user plan
    if (status === 'active' || status === 'trialing') {
        await supabase
            .from('users')
            .update({
                plan: plan || 'pro',
                plan_expires_at: currentPeriodEnd.toISOString()
            })
            .eq('stripe_customer_id', subscription.customer);
    }

    console.log(`Subscription ${subscription.id} updated to status: ${status}`);
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription) {
    // Update subscription status
    await supabase
        .from('subscriptions')
        .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString()
        })
        .eq('stripe_subscription_id', subscription.id);

    // Downgrade user to free
    await supabase
        .from('users')
        .update({
            plan: 'free',
            stripe_subscription_id: null
        })
        .eq('stripe_customer_id', subscription.customer);

    console.log(`Subscription ${subscription.id} cancelled`);
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaid(invoice) {
    // Log payment
    await supabase.from('audit_logs').insert({
        action: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        entity_type: 'subscription',
        new_values: {
            invoice_id: invoice.id,
            amount: invoice.amount_paid / 100,
            customer: invoice.customer
        }
    });

    console.log(`Invoice ${invoice.id} paid successfully`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
    // Find user and update subscription status
    await supabase
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('stripe_customer_id', invoice.customer);

    // Log failure
    await supabase.from('audit_logs').insert({
        action: 'SUBSCRIPTION_PAYMENT_FAILED',
        entity_type: 'subscription',
        new_values: {
            invoice_id: invoice.id,
            customer: invoice.customer
        }
    });

    // TODO: Send email notification to user

    console.log(`Payment failed for invoice ${invoice.id}`);
}

/**
 * Handle successful payment intent (for invoice payments)
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
    const invoiceId = paymentIntent.metadata.invoice_id;
    const userId = paymentIntent.metadata.user_id;

    if (!invoiceId) {
        // Not an invoice payment, might be subscription
        return;
    }

    // Mark invoice as paid
    await supabase
        .from('invoices')
        .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            paid_amount: paymentIntent.amount / 100,
            payment_method: 'stripe'
        })
        .eq('id', invoiceId);

    // Record payment
    await supabase.from('payments').insert({
        id: uuidv4(),
        invoice_id: invoiceId,
        user_id: userId,
        amount: paymentIntent.amount / 100,
        payment_method: 'stripe',
        stripe_payment_id: paymentIntent.id,
        status: 'completed'
    });

    console.log(`Invoice ${invoiceId} paid via Stripe`);
}

module.exports = router;
