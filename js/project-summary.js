export const PROJECT_SUMMARY_SCHEMA_VERSION = 1;
export const PROJECT_SUMMARY_MAX_BYTES = 32 * 1024;
export const PROJECT_SUMMARY_FIELDS = Object.freeze([
    'schemaVersion',
    'sourceProjectVersion',
    'projectId',
    'workId',
    'projectName',
    'title',
    'languages',
    'listThumbnail',
    'pageCount',
    'projectBytes',
    'lastUpdated',
    'hasPublishedDsf',
    'releaseId',
    'dsfStatus',
    'visibility',
    'dsfPublishedAt',
    'dsfLangs',
    'dsfPageCount',
    'dsfTotalBytes',
    'dsfResolution',
    'dsfQuality',
    'publication',
]);

const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 4096;
const MAX_LANGUAGES = 16;

function normalizeString(value, maxLength = MAX_TEXT_LENGTH) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeNonNegativeInteger(value) {
    return Math.floor(normalizeNonNegativeNumber(value));
}

function normalizeLanguages(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((language) => normalizeString(language, 32).toLowerCase())
        .filter(Boolean))]
        .slice(0, MAX_LANGUAGES);
}

function normalizeRemoteUrl(value) {
    const url = normalizeString(value, MAX_URL_LENGTH);
    return /^https:\/\//i.test(url) ? `https://${url.slice(8)}` : '';
}

function normalizeTimestamp(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (value && typeof value.toDate === 'function') return value;
    return null;
}

function normalizePublication(value) {
    if (!value || typeof value !== 'object') return null;
    const publication = {
        listedFrom: normalizeTimestamp(value.listedFrom),
        listedUntil: normalizeTimestamp(value.listedUntil),
        publicFrom: normalizeTimestamp(value.publicFrom),
        publicUntil: normalizeTimestamp(value.publicUntil),
        expiredAt: normalizeTimestamp(value.expiredAt),
        expireReason: normalizeString(value.expireReason, 64) || null,
    };
    return Object.values(publication).some((entry) => entry !== null) ? publication : null;
}

function getPublishedPageCount(project) {
    const languageCounts = project?.dsfPageCounts && typeof project.dsfPageCounts === 'object'
        ? Object.values(project.dsfPageCounts).map(normalizeNonNegativeInteger)
        : [];
    if (languageCounts.length) return Math.max(...languageCounts);
    return Array.isArray(project?.dsfPages) ? project.dsfPages.length : 0;
}

export function measureProjectSummaryBytes(summary) {
    return new TextEncoder().encode(JSON.stringify(summary)).byteLength;
}

export function assertProjectSummary(summary) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
        throw new TypeError('Project summary must be an object.');
    }
    if (summary.schemaVersion !== PROJECT_SUMMARY_SCHEMA_VERSION) {
        throw new TypeError(`Unsupported project summary schema: ${String(summary.schemaVersion)}`);
    }
    if (!normalizeString(summary.projectId)) {
        throw new TypeError('Project summary requires projectId.');
    }
    const allowedFields = new Set(PROJECT_SUMMARY_FIELDS);
    for (const field of Object.keys(summary)) {
        if (!allowedFields.has(field)) throw new TypeError(`Project summary must not contain ${field}.`);
    }
    for (const field of PROJECT_SUMMARY_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(summary, field)) {
            throw new TypeError(`Project summary requires ${field}.`);
        }
    }
    const byteLength = measureProjectSummaryBytes(summary);
    if (byteLength > PROJECT_SUMMARY_MAX_BYTES) {
        throw new TypeError(`Project summary exceeds ${PROJECT_SUMMARY_MAX_BYTES} bytes.`);
    }
    return summary;
}

export function createProjectSummary(project, options = {}) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
        throw new TypeError('Project summary source must be an object.');
    }

    const projectId = normalizeString(options.projectId || project.projectId);
    if (!projectId) throw new TypeError('Project summary requires projectId.');

    const dsfPageCount = getPublishedPageCount(project);
    const summary = {
        schemaVersion: PROJECT_SUMMARY_SCHEMA_VERSION,
        sourceProjectVersion: normalizeNonNegativeInteger(project.version),
        projectId,
        workId: normalizeString(project.workId),
        projectName: normalizeString(project.projectName),
        title: normalizeString(project.title),
        languages: normalizeLanguages(project.languages),
        listThumbnail: normalizeRemoteUrl(project.listThumbnail),
        pageCount: normalizeNonNegativeInteger(project.pageCount),
        projectBytes: normalizeNonNegativeInteger(project.projectBytes),
        lastUpdated: normalizeTimestamp(project.lastUpdated || project.updatedAt),
        hasPublishedDsf: dsfPageCount > 0,
        releaseId: normalizeString(project.releaseId),
        dsfStatus: normalizeString(project.dsfStatus || 'draft', 32) || 'draft',
        visibility: normalizeString(project.visibility || 'private', 32) || 'private',
        dsfPublishedAt: normalizeTimestamp(project.dsfPublishedAt),
        dsfLangs: normalizeLanguages(project.dsfLangs),
        dsfPageCount,
        dsfTotalBytes: normalizeNonNegativeInteger(project.dsfTotalBytes),
        dsfResolution: normalizeString(project.dsfResolution, 64),
        dsfQuality: normalizeNonNegativeNumber(project.dsfQuality),
        publication: normalizePublication(project.publication),
    };

    return assertProjectSummary(summary);
}
