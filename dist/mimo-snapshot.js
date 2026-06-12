import * as fs from 'node:fs';
const MAX_LABEL_LENGTH = 50;
function sanitizeLabel(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const sanitized = value
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        .replace(/\x1B[@-Z\\-_]/g, '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .replace(/[؜‎‏‪-‮⁦-⁩⁪-⁯]/g, '')
        .trim();
    if (!sanitized) {
        return null;
    }
    if (sanitized.length <= MAX_LABEL_LENGTH) {
        return sanitized;
    }
    return `${sanitized.slice(0, MAX_LABEL_LENGTH - 3)}...`;
}
function parseDateValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        const millis = value > 1e12 ? value : value * 1000;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
function parseUpdatedAt(value) {
    const date = parseDateValue(value);
    return date ? date.getTime() : null;
}
function parsePercentage(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(Math.min(100, Math.max(0, value)));
}
function parseBalance(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(value * 100) / 100;
}
export function getMimoSnapshot(config, now = Date.now()) {
    const snapshotPath = config.display.mimoSnapshotPath;
    if (!snapshotPath) {
        return null;
    }
    try {
        const raw = fs.readFileSync(snapshotPath, 'utf8');
        // Touch the file to update access time (signals Claude activity to daemon)
        try {
            const now = new Date();
            fs.utimesSync(snapshotPath, now, now);
        }
        catch {
            // Ignore touch errors
        }
        const parsed = JSON.parse(raw);
        const updatedAt = parseUpdatedAt(parsed.updated_at);
        if (updatedAt === null) {
            return null;
        }
        const freshnessMs = config.display.mimoFreshnessMs;
        if (now - updatedAt > freshnessMs) {
            return null;
        }
        const error = sanitizeLabel(parsed.error);
        if (error) {
            return {
                updated_at: parsed.updated_at,
                error,
            };
        }
        const usedPercentage = parsePercentage(parsed.used_percentage);
        const balance = parseBalance(parsed.balance);
        const planName = sanitizeLabel(parsed.plan_name);
        const usedAmount = sanitizeLabel(parsed.used_amount);
        const totalAmount = sanitizeLabel(parsed.total_amount);
        const balanceCurrency = sanitizeLabel(parsed.balance_currency);
        const expiresAt = parseDateValue(parsed.expires_at);
        if (usedPercentage === null
            && balance === null
            && !planName
            && !error) {
            return null;
        }
        return {
            updated_at: parsed.updated_at,
            plan_name: planName,
            used_percentage: usedPercentage,
            used_amount: usedAmount,
            total_amount: totalAmount,
            balance,
            balance_currency: balanceCurrency,
            expires_at: expiresAt?.toISOString() ?? null,
            error: null,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=mimo-snapshot.js.map