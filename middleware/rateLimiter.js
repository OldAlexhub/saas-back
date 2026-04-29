import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function isDriverAppRequest(req) {
  const path = req.originalUrl || req.url || '';
  return path.startsWith('/api/v1/driver-app');
}

function normalizeLoginIdentity(req) {
  const body = req.body || {};
  const identity = body.identifier || body.email || body.driverId || body.phoneNumber || body.username || null;
  return identity ? String(identity).trim().toLowerCase() : 'anonymous';
}

export function loginRateLimitKey(req) {
  const route = isDriverAppRequest(req) ? 'driver-app' : 'admin';
  const ip = req.ip ? ipKeyGenerator(req.ip) : 'unknown-ip';
  return `${route}:${normalizeLoginIdentity(req)}:${ip}`;
}

export function createAuthLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? 5 * 60 * 1000,
    max: options.max ?? positiveInteger(process.env.AUTH_RATE_LIMIT_MAX, 20),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator ?? loginRateLimitKey,
    message: { message: 'Too many login attempts. Please try again in 5 minutes.' },
  });
}

export const authLimiter = createAuthLimiter();

export function createGeneralLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? 60 * 1000,
    max: options.max ?? positiveInteger(process.env.GENERAL_RATE_LIMIT_MAX, 3000),
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip ?? isDriverAppRequest,
    message: { message: 'API request volume exceeded the safety threshold. Please retry shortly.' },
  });
}

export const generalLimiter = createGeneralLimiter();
