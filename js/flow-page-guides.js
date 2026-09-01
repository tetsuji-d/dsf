import { assertFlowDomWritingMode, resolveFlowDomTypography } from './flow-dom-measurer.js';

export const FLOW_PAGE_GUIDE_MODE_OFF = 'off';
export const FLOW_PAGE_GUIDE_MODE_RULED = 'ruled';

/**
 * Editor-only guide preference. Unknown values fail closed to no guide so a
 * future UI mode cannot accidentally alter an older editor surface.
 */
export function normalizeFlowPageGuideMode(value) {
    return value === FLOW_PAGE_GUIDE_MODE_RULED
        ? FLOW_PAGE_GUIDE_MODE_RULED
        : FLOW_PAGE_GUIDE_MODE_OFF;
}

/**
 * Resolve a canonical body-rule pitch from the same typography used by Flow
 * pagination. This result is paint-only: it never enters the Flow document or
 * the pagination input.
 */
export function resolveFlowPageRuleGuide(options = {}) {
    const mode = normalizeFlowPageGuideMode(options.mode);
    const languageKey = String(options.languageKey || 'ja');
    const writingMode = assertFlowDomWritingMode(options.writingMode, languageKey);
    const axis = writingMode === 'vertical-rl' ? 'vertical' : 'horizontal';
    if (mode === FLOW_PAGE_GUIDE_MODE_OFF) {
        return Object.freeze({ mode, writingMode, axis, linePitch: null });
    }
    const typography = resolveFlowDomTypography(
        languageKey,
        options.typography,
        writingMode,
    );
    const linePitch = Number((typography.fontSize * typography.lineHeight).toFixed(6));
    return Object.freeze({ mode, writingMode, axis, linePitch });
}
