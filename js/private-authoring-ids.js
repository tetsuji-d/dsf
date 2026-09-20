// Preserve legacy Japanese IDs without accepting separators, URL escapes or traversal.
export function isPrivateAuthoringId(value) {
    return typeof value === 'string' && /^[\p{L}\p{N}\p{M}_-]{1,128}$/u.test(value)
        && new TextEncoder().encode(value).length <= 512;
}
