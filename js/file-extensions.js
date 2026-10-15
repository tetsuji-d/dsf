// Filename policy only. Archive identifiers, MIME types and schema stay unchanged.
export const READ_EXTENSIONS = Object.freeze(['.dsfr', '.dsf']);
export const PROJECT_EXTENSIONS = Object.freeze(['.dsfp', '.dsp']);
export const FILE_EXTENSIONS = Object.freeze([...READ_EXTENSIONS, ...PROJECT_EXTENSIONS]);
export function matchesFileExtension(name, extensions) {
    return (Array.isArray(extensions) ? extensions : [extensions])
        .some(ext => String(name || '').toLowerCase().endsWith(ext));
}
export function dsfFilename(name = 'read') {
    return normalizeFilename(name, 'read', /\.(dsfr|dsf)$/i, '.dsfr');
}
export function projectFilename(name = 'project') {
    return normalizeFilename(name, 'project', /\.(dsfp|dsp)$/i, '.dsfp');
}
function normalizeFilename(name, fallback, suffix, extension) {
    const clean = String(name || fallback).replace(/[\\/:*?"<>|]/g, '_').trim();
    const base = clean.replace(suffix, '').replace(/[. ]+$/, '') || fallback;
    return base + extension;
}
