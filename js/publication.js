export const FREE_LISTING_MAX_DAYS = 14;
export const FAR_FUTURE_LISTING_UNTIL = new Date(Date.UTC(9999, 11, 31, 14, 59, 0));

export const PLAN_TIERS = Object.freeze({
    FREE: 'free',
    PLUS: 'plus',
    PRO: 'pro',
    BUSINESS: 'business'
});

const PAID_TIERS = new Set([PLAN_TIERS.PLUS, PLAN_TIERS.PRO, PLAN_TIERS.BUSINESS]);
const SCHEDULING_TIERS = new Set([PLAN_TIERS.PRO, PLAN_TIERS.BUSINESS]);
const ACTIVE_PLAN_STATUSES = new Set(['active', 'trialing']);
const INACTIVE_PLAN_STATUSES = new Set(['past_due', 'canceled', 'cancelled', 'unpaid', 'incomplete', 'incomplete_expired']);

export function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

export function addDays(date, days) {
    const base = toDate(date) || new Date();
    return new Date(base.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);
}

export function normalizePlanTier(tier) {
    const value = String(tier || PLAN_TIERS.FREE).trim().toLowerCase();
    if (value === 'standard') return PLAN_TIERS.PLUS;
    if (value === 'enterprise') return PLAN_TIERS.BUSINESS;
    return Object.values(PLAN_TIERS).includes(value) ? value : PLAN_TIERS.FREE;
}

export function planIsCurrentlyPaid(account = {}, now = new Date()) {
    const tier = normalizePlanTier(account?.plan?.effectiveTier || account?.plan?.tier);
    if (!PAID_TIERS.has(tier)) return false;
    const status = String(account?.plan?.status || 'active').toLowerCase();
    if (INACTIVE_PLAN_STATUSES.has(status)) return false;
    if (!ACTIVE_PLAN_STATUSES.has(status)) return false;
    const periodEnd = toDate(account?.plan?.currentPeriodEnd);
    const t = toDate(now) || new Date();
    return !periodEnd || periodEnd.getTime() >= t.getTime();
}

export function getEffectivePlanTier(account = {}, now = new Date()) {
    const tier = normalizePlanTier(account?.plan?.effectiveTier || account?.plan?.tier);
    return planIsCurrentlyPaid(account, now) ? tier : PLAN_TIERS.FREE;
}

export function planAllowsUnlimitedListing(account = {}, now = new Date()) {
    if (typeof account?.entitlements?.canUseUnlimitedListing === 'boolean') {
        return account.entitlements.canUseUnlimitedListing === true && planIsCurrentlyPaid(account, now);
    }
    return PAID_TIERS.has(getEffectivePlanTier(account, now));
}

export function planAllowsPublicScheduling(account = {}, now = new Date()) {
    if (typeof account?.entitlements?.canSchedulePublicExpiry === 'boolean') {
        return account.entitlements.canSchedulePublicExpiry === true && planIsCurrentlyPaid(account, now);
    }
    return SCHEDULING_TIERS.has(getEffectivePlanTier(account, now));
}

export function getListingMaxDays(account = {}, now = new Date()) {
    return planAllowsUnlimitedListing(account, now) ? null : FREE_LISTING_MAX_DAYS;
}

export function getListingUntilForPlan(account = {}, listedFrom = new Date(), now = new Date()) {
    if (planAllowsUnlimitedListing(account, now)) return new Date(FAR_FUTURE_LISTING_UNTIL.getTime());
    return addDays(listedFrom, FREE_LISTING_MAX_DAYS);
}

export function isFarFuturePublicationDate(value) {
    const date = toDate(value);
    return !!date && date.getUTCFullYear() >= 9999;
}

function clampDateToLimit(value, limit) {
    const date = toDate(value);
    const upper = toDate(limit);
    if (!date || !upper) return date;
    return date.getTime() > upper.getTime() ? upper : date;
}

export function createPlanSnapshot(account = {}, now = new Date()) {
    return {
        tier: getEffectivePlanTier(account, now),
        status: String(account?.plan?.status || 'active').toLowerCase(),
        cancelAtPeriodEnd: account?.plan?.cancelAtPeriodEnd === true,
        evaluatedAt: toDate(now) || new Date()
    };
}

export function createDefaultPublication(account = {}, now = new Date(), previous = {}) {
    return reconcilePublicationForPlan(previous, previous?.status || 'draft', account, now);
}

export function reconcilePublicationForPlan(previous = {}, status = 'draft', account = {}, now = new Date()) {
    const t = toDate(now) || new Date();
    const listedFrom = toDate(previous.listedFrom) || t;
    const listedUntil = getListingUntilForPlan(account, listedFrom, t);
    const canSchedule = planAllowsPublicScheduling(account, t);
    const isVisibleStatus = status === 'public' || status === 'unlisted';
    const publicFrom = isVisibleStatus
        ? (toDate(previous.publicFrom) || t)
        : toDate(previous.publicFrom);
    const publicUntil = canSchedule
        ? clampDateToLimit(previous.publicUntil, listedUntil)
        : null;
    const publication = {
        listedFrom,
        listedUntil,
        publicFrom,
        publicUntil,
        expiredAt: null,
        expireReason: null,
        planSnapshot: createPlanSnapshot(account, t)
    };
    const reason = getPublicationExpireReason(publication, status, t);
    publication.expiredAt = reason ? t : null;
    publication.expireReason = reason;
    return publication;
}

export function updatePublicationForStatus(previous = {}, status = 'draft', account = {}, now = new Date()) {
    return reconcilePublicationForPlan(previous, status, account, now);
}

export function getPublicationExpireReason(publication = {}, status = 'public', now = new Date()) {
    const listedFrom = toDate(publication.listedFrom);
    const listedUntil = toDate(publication.listedUntil);
    const publicUntil = toDate(publication.publicUntil);
    const t = toDate(now) || new Date();

    if (listedFrom && listedFrom.getTime() > t.getTime()) return 'listing';
    if (listedUntil && listedUntil.getTime() < t.getTime()) return 'listing';

    if (status === 'public' || status === 'unlisted') {
        if (publicUntil && publicUntil.getTime() < t.getTime()) return 'public';
    }
    return null;
}

export function getPublicationInactiveReason(publication = {}, status = 'public', now = new Date()) {
    const expiredReason = getPublicationExpireReason(publication, status, now);
    if (expiredReason) return expiredReason;
    const publicFrom = toDate(publication.publicFrom);
    const t = toDate(now) || new Date();
    if ((status === 'public' || status === 'unlisted') && publicFrom && publicFrom.getTime() > t.getTime()) {
        return 'public_scheduled';
    }
    return null;
}

export function isPublicationActive(publication = {}, status = 'public', now = new Date()) {
    return !getPublicationInactiveReason(publication, status, now);
}

export function formatPublicationDate(value, locale = 'ja-JP') {
    const date = toDate(value);
    if (!date || isFarFuturePublicationDate(date)) return '';
    return date.toLocaleDateString(locale);
}
