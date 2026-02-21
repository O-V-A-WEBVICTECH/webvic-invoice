/**
 * Request Logger Middleware
 */

const requestLogger = (req, res, next) => {
    const start = Date.now();

    // Log when response is finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
            userId: req.userId || 'anonymous',
            timestamp: new Date().toISOString()
        };

        // Color-coded console output
        const statusColor = res.statusCode >= 500 ? '\x1b[31m' : // red
                           res.statusCode >= 400 ? '\x1b[33m' : // yellow
                           res.statusCode >= 300 ? '\x1b[36m' : // cyan
                           '\x1b[32m'; // green

        if (process.env.NODE_ENV === 'development') {
            console.log(
                `${statusColor}${req.method}\x1b[0m ${req.originalUrl} ` +
                `${statusColor}${res.statusCode}\x1b[0m ${duration}ms`
            );
        }

        // In production, you'd send this to a logging service
        // like DataDog, LogRocket, or CloudWatch
    });

    next();
};

module.exports = { requestLogger };
