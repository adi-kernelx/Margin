import rateLimit from 'express-rate-limit';

export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Auth-related rate limiter - stricter for login/signup attempts
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// File upload rate limiter - 20 uploads per hour
export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: 'Upload limit reached, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Share operations rate limiter - 50 per 15 minutes
export const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many share operations, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// OCR/Ingest rate limiter - 30 per 15 minutes
export const processLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Processing limit reached, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Search rate limiter - 60 per minute  
export const searchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: { error: 'Search rate limit reached, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Admin operations - very strict
export const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Admin rate limit reached.' },
    standardHeaders: true,
    legacyHeaders: false,
});
