function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLanguage(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeHttpsUrl(value) {
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    if (!candidate) return '';

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
        return candidate;
    } catch {
        return '';
    }
}

function firstLanguage(values) {
    if (!Array.isArray(values)) return '';
    for (const value of values) {
        const language = normalizeLanguage(value);
        if (language) return language;
    }
    return '';
}

function getLocalizedHttpsUrl(values, language, { allowAnyLanguage = false } = {}) {
    if (!isRecord(values)) return '';

    if (language) {
        const matchingKey = Object.keys(values).find((key) => normalizeLanguage(key) === language);
        const matchingUrl = matchingKey ? normalizeHttpsUrl(values[matchingKey]) : '';
        if (matchingUrl) return matchingUrl;
    }

    if (!language || allowAnyLanguage) {
        for (const value of Object.values(values)) {
            const url = normalizeHttpsUrl(value);
            if (url) return url;
        }
    }

    return '';
}

function resolveDefaultLanguage(project) {
    const declared = normalizeLanguage(project.defaultLang);
    if (declared) return declared;

    const published = firstLanguage(project.dsfLangs);
    if (published) return published;

    const authoring = firstLanguage(project.languages);
    if (authoring) return authoring;

    const firstDsfPage = Array.isArray(project.dsfPages) ? project.dsfPages[0] : null;
    const urls = isRecord(firstDsfPage) ? firstDsfPage.urls : null;
    if (!isRecord(urls)) return '';
    return normalizeLanguage(Object.keys(urls)[0]);
}

function selectFirstPublishedPage(project, language) {
    return selectPublishedPageAtIndex(project, language, 0);
}

function selectPublishedPageAtIndex(project, language, pageIndex) {
    if (!Array.isArray(project.dsfPages) || project.dsfPages.length === 0) return '';
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= project.dsfPages.length) return '';
    const firstPage = project.dsfPages[pageIndex];

    // Some early v1 snapshots stored the page URL directly.
    const directUrl = normalizeHttpsUrl(firstPage);
    if (directUrl) return directUrl;
    if (!isRecord(firstPage)) return '';

    const localizedUrl = getLocalizedHttpsUrl(firstPage.urls, language, { allowAnyLanguage: true });
    if (localizedUrl) return localizedUrl;

    // A generic URL is safe to use when the legacy page did not have a language map.
    return normalizeHttpsUrl(firstPage.url);
}

function selectBackground(container, language) {
    if (!isRecord(container)) return '';
    return getLocalizedHttpsUrl(container.backgrounds, language)
        || normalizeHttpsUrl(container.background);
}

function normalizePreviewImageUrl(value) {
    const publicUrl = normalizeHttpsUrl(value);
    if (publicUrl) return publicUrl;
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    return /^(?:blob:|data:image\/)/i.test(candidate) ? candidate : '';
}

function selectBackgroundFromCollection(collection, language) {
    if (!Array.isArray(collection)) return '';
    for (const item of collection) {
        if (!isRecord(item)) continue;
        const contentUrl = selectBackground(item.content, language);
        if (contentUrl) return contentUrl;
        const directUrl = selectBackground(item, language);
        if (directUrl) return directUrl;
    }
    return '';
}

function selectThumbnail(container) {
    if (!isRecord(container)) return '';
    return normalizeHttpsUrl(container.thumbnail)
        || normalizeHttpsUrl(container.listThumbnail);
}

function selectReleaseThumbnail(release) {
    if (!isRecord(release)) return '';
    return normalizeHttpsUrl(release.thumbnail);
}

function selectReleaseV1CoverThumbnail(release) {
    if (!isRecord(release) || !Array.isArray(release.dsfPages) || release.dsfPages.length === 0) return '';
    const configuredC1Index = release.book?.covers?.c1?.pageIndex;
    const c1Index = Number.isInteger(configuredC1Index)
        && configuredC1Index >= 0
        && configuredC1Index < release.dsfPages.length
        ? configuredC1Index
        : 0;
    return selectPublishedPageAtIndex(release, resolveDefaultLanguage(release), c1Index);
}

function normalizeManagedOwnerUid(value) {
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    return candidate && !candidate.includes('/') ? candidate : '';
}

function normalizeStorageBucket(value) {
    if (typeof value !== 'string') return '';
    const candidate = value.trim();
    return candidate && !candidate.includes('/') ? candidate : '';
}

function isPublicationThumbnailObjectPath(value, ownerUid) {
    if (typeof value !== 'string') return false;
    const escapedUid = ownerUid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^users/${escapedUid}/dsf/publication-thumbnails/[a-f0-9]{64}\\.webp$`).test(value);
}

function isManagedR2PublicationThumbnail(parsed, ownerUid, publicBaseUrl) {
    if (typeof publicBaseUrl !== 'string' || !publicBaseUrl.trim()) return false;
    let base;
    try {
        base = new URL(publicBaseUrl.trim());
    } catch {
        return false;
    }
    if (base.protocol !== 'https:' || !base.hostname || base.username || base.password || base.search || base.hash) return false;
    if (parsed.origin !== base.origin || parsed.search || parsed.hash) return false;

    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    if (!parsed.pathname.startsWith(basePath)) return false;
    let objectPath;
    try {
        objectPath = decodeURIComponent(parsed.pathname.slice(basePath.length));
    } catch {
        return false;
    }
    return isPublicationThumbnailObjectPath(objectPath, ownerUid);
}

function isManagedFirebasePublicationThumbnail(parsed, ownerUid, bucket) {
    if (!bucket || parsed.hostname !== 'firebasestorage.googleapis.com' || parsed.hash) return false;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match) return false;
    let pathBucket;
    let objectPath;
    try {
        pathBucket = decodeURIComponent(match[1]);
        objectPath = decodeURIComponent(match[2]);
    } catch {
        return false;
    }
    if (pathBucket !== bucket || !isPublicationThumbnailObjectPath(objectPath, ownerUid)) return false;

    const altValues = parsed.searchParams.getAll('alt');
    if (altValues.length !== 1 || altValues[0] !== 'media') return false;
    for (const key of parsed.searchParams.keys()) {
        if (key !== 'alt' && key !== 'token') return false;
    }
    const tokenValues = parsed.searchParams.getAll('token');
    return tokenValues.length <= 1 && (tokenValues.length === 0 || Boolean(tokenValues[0]));
}

/** True only for a content-addressed publication thumbnail in owner-managed storage. */
export function isManagedPublicationThumbnailUrl(value, options = {}) {
    const ownerUid = normalizeManagedOwnerUid(options.ownerUid);
    if (!ownerUid) return false;
    const candidate = normalizeHttpsUrl(value);
    if (!candidate) return false;
    const parsed = new URL(candidate);
    return isManagedR2PublicationThumbnail(parsed, ownerUid, options.r2PublicBaseUrl)
        || isManagedFirebasePublicationThumbnail(
            parsed,
            ownerUid,
            normalizeStorageBucket(options.firebaseStorageBucket),
        );
}

/** Return the optional author-selected listing image, never a local preview URL. */
export function selectProjectPublicationThumbnailOverride(project) {
    if (!isRecord(project)) return '';
    return normalizeHttpsUrl(project.publicationThumbnailUrl);
}

function selectAuthoringPreviewBackground(candidate, language, { allowLocal = false } = {}) {
    if (!isRecord(candidate)) return '';
    const containers = [candidate.content, candidate].filter(isRecord);
    const publicUrl = containers
        .map((container) => selectBackground(container, language))
        .find(Boolean) || '';
    if (publicUrl || !allowLocal) return publicUrl;

    for (const container of containers) {
        const localized = isRecord(container.backgrounds)
            ? Object.entries(container.backgrounds).find(([key]) => normalizeLanguage(key) === language)?.[1]
            : '';
        const localUrl = normalizePreviewImageUrl(localized)
            || normalizePreviewImageUrl(container.background);
        if (localUrl) return localUrl;
    }
    return '';
}

/**
 * Select the current authoring C1 preview without consulting a previous Release.
 * Canonical Project v6 blocks win over compatibility pages/sections. If the
 * first renderable block is Flow, no later Fixed image may replace that C1.
 */
export function selectProjectAuthoringCoverThumbnail(project, options = {}) {
    if (!isRecord(project)) return '';
    const language = resolveDefaultLanguage(project);
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    const firstRenderableBlock = blocks.find((block) => (
        isRecord(block) && (block.kind === 'page' || block.kind === 'flow')
    ));

    if (firstRenderableBlock) {
        if (firstRenderableBlock.kind === 'flow') return '';
        return selectAuthoringPreviewBackground(firstRenderableBlock, language, options);
    }

    const compatibilityCandidate = Array.isArray(project.pages) && project.pages.length
        ? project.pages[0]
        : (Array.isArray(project.sections) ? project.sections[0] : null);
    return selectAuthoringPreviewBackground(compatibilityCandidate, language, options);
}

/**
 * Select only the actual first page image used as the default publication cover.
 * A later image page must never silently replace a fixed-text C1 cover.
 */
export function selectProjectCoverThumbnail(project, options = {}) {
    if (!isRecord(project)) return '';
    const language = resolveDefaultLanguage(project);
    const publishedPage = selectFirstPublishedPage(project, language);
    if (publishedPage) return publishedPage;

    const candidates = [
        Array.isArray(project.pages) ? project.pages[0] : null,
        Array.isArray(project.blocks) ? project.blocks[0] : null,
        Array.isArray(project.sections) ? project.sections[0] : null,
    ];
    for (const candidate of candidates) {
        if (!isRecord(candidate)) continue;
        const background = selectBackground(candidate.content, language)
            || selectBackground(candidate, language);
        if (background) return background;
        if (options.allowLocal === true) {
            const container = isRecord(candidate.content) ? candidate.content : candidate;
            const localized = isRecord(container.backgrounds)
                ? Object.entries(container.backgrounds).find(([key]) => normalizeLanguage(key) === language)?.[1]
                : '';
            const local = normalizePreviewImageUrl(localized)
                || normalizePreviewImageUrl(container.background);
            if (local) return local;
        }
    }
    return '';
}

function selectThumbnailFromCollection(collection) {
    if (!Array.isArray(collection)) return '';
    for (const item of collection) {
        if (!isRecord(item)) continue;
        const contentUrl = selectThumbnail(item.content);
        if (contentUrl) return contentUrl;
        const directUrl = selectThumbnail(item);
        if (directUrl) return directUrl;
    }
    return '';
}

/**
 * Selects an HTTPS-only listing image without mutating the project.
 *
 * Priority:
 * 1. Explicit Release snapshot supplied by the caller; v1 may derive C1 from
 *    that Release, while v2 never falls through to mutable Project settings
 * 2. Current v2 Project release snapshot
 * 3. Author-selected publication thumbnail
 * 4. First published v1 DSF page for the default language
 * 5. High-resolution authoring background (pages, blocks, then sections)
 * 6. Existing HTTPS thumbnail/listThumbnail fields
 *
 * Local-only data/blob URLs and insecure HTTP URLs are never returned.
 */
export function selectProjectListingThumbnail(project, options = {}) {
    if (!isRecord(project)) return '';
    const language = resolveDefaultLanguage(project);

    // A Release owns the immutable publication snapshot. Project preferences
    // may change later and must not rewrite an already-created release card.
    if (isRecord(options.release)) {
        const releaseThumbnail = selectReleaseThumbnail(options.release);
        if (releaseThumbnail) return releaseThumbnail;
        if (Number(options.release.dsfSchemaVersion) !== 2) {
            return selectReleaseV1CoverThumbnail(options.release);
        }
        return '';
    }

    // DSF v2 has no dsfPages array. Press stores the generated/selected C1
    // thumbnail on the owner Project as the current release snapshot.
    if (Number(project.dsfSchemaVersion) === 2) {
        const currentReleaseThumbnail = normalizeHttpsUrl(project.thumbnail);
        if (currentReleaseThumbnail) return currentReleaseThumbnail;
    }

    const publicationOverride = selectProjectPublicationThumbnailOverride(project);
    if (publicationOverride) return publicationOverride;

    const publishedPage = selectFirstPublishedPage(project, language);
    if (publishedPage) return publishedPage;

    for (const collection of [project.pages, project.blocks, project.sections]) {
        const background = selectBackgroundFromCollection(collection, language);
        if (background) return background;
    }

    const projectThumbnail = selectThumbnail(project);
    if (projectThumbnail) return projectThumbnail;

    for (const collection of [project.pages, project.blocks, project.sections]) {
        const thumbnail = selectThumbnailFromCollection(collection);
        if (thumbnail) return thumbnail;
    }

    return '';
}
