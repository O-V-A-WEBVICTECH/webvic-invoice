/**
 * Validation Middleware
 * Uses express-validator for input validation
 */

const { validationResult, body, param, query } = require('express-validator');
const xss = require('xss');

/**
 * Process validation results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    
    next();
};

/**
 * Sanitize string input
 */
const sanitizeString = (value) => {
    if (typeof value !== 'string') return value;
    return xss(value.trim());
};

/**
 * Common validation rules
 */
const rules = {
    // Auth validations
    email: body('email')
        .isEmail()
        .withMessage('Please provide a valid email')
        .normalizeEmail()
        .customSanitizer(sanitizeString),

    password: body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain uppercase, lowercase, and number'),

    name: body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters')
        .customSanitizer(sanitizeString),

    // Client validations
    clientName: body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Client name must be between 2 and 100 characters')
        .customSanitizer(sanitizeString),

    clientEmail: body('email')
        .isEmail()
        .withMessage('Please provide a valid client email')
        .normalizeEmail(),

    // Invoice validations
    invoiceItems: body('items')
        .isArray({ min: 1 })
        .withMessage('Invoice must have at least one item'),

    invoiceItem: body('items.*.description')
        .trim()
        .isLength({ min: 1, max: 200 })
        .withMessage('Item description is required')
        .customSanitizer(sanitizeString),

    invoiceQuantity: body('items.*.quantity')
        .isFloat({ min: 0.01, max: 9999 })
        .withMessage('Quantity must be between 0.01 and 9999'),

    invoicePrice: body('items.*.price')
        .isFloat({ min: 0, max: 999999.99 })
        .withMessage('Price must be between 0 and 999999.99'),

    dueDate: body('due_date')
        .isISO8601()
        .withMessage('Please provide a valid due date')
        .custom((value) => {
            if (new Date(value) < new Date()) {
                throw new Error('Due date cannot be in the past');
            }
            return true;
        }),

    // ID validations
    uuid: param('id')
        .isUUID()
        .withMessage('Invalid ID format'),

    // Pagination
    page: query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),

    limit: query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),

    // Status
    invoiceStatus: body('status')
        .optional()
        .isIn(['draft', 'pending', 'paid', 'overdue', 'cancelled'])
        .withMessage('Invalid invoice status'),
};

/**
 * Validation chains for different routes
 */
const validations = {
    register: [rules.email, rules.password, rules.name, validate],
    login: [rules.email, body('password').notEmpty(), validate],
    
    createClient: [rules.clientName, rules.clientEmail, validate],
    updateClient: [rules.uuid, validate],
    
    createInvoice: [
        rules.invoiceItems,
        body('client_id').isUUID().withMessage('Valid client ID required'),
        rules.dueDate,
        validate
    ],
    
    updateInvoice: [rules.uuid, validate],
    
    pagination: [rules.page, rules.limit, validate],
};

module.exports = {
    validate,
    sanitizeString,
    rules,
    validations
};
