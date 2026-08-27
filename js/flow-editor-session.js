/** Runtime-only Flow editor selection. Never persisted into Project data. */

const selectionByGroup = new Map();

function keyFor(groupId) {
    return String(groupId || '');
}

function createEmptySelection(groupId) {
    return {
        mode: 'source',
        groupId,
        sectionId: '',
        blockId: '',
        languageKey: '',
        graphemeOffset: null,
        utf16Offset: null,
        affinity: 'nearest',
    };
}

function optionalOffset(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

export function getFlowEditorSelection(groupId) {
    const key = keyFor(groupId);
    const saved = selectionByGroup.get(key);
    return saved
        ? Object.freeze({ ...saved })
        : Object.freeze(createEmptySelection(key));
}

export function selectFlowSource(groupId, options = {}) {
    const key = keyFor(groupId);
    const previous = selectionByGroup.get(key) || createEmptySelection(key);
    const sectionId = String(options.sectionId ?? previous.sectionId ?? '');
    const blockId = String(options.blockId ?? previous.blockId ?? '');
    const languageKey = String(options.languageKey ?? previous.languageKey ?? '');
    const preservesPoint = previous.sectionId === sectionId
        && previous.blockId === blockId
        && (!languageKey || !previous.languageKey || previous.languageKey === languageKey);
    const next = {
        mode: 'source',
        groupId: key,
        sectionId,
        blockId,
        languageKey,
        graphemeOffset: options.graphemeOffset !== undefined
            ? optionalOffset(options.graphemeOffset)
            : preservesPoint ? previous.graphemeOffset : null,
        utf16Offset: options.utf16Offset !== undefined
            ? optionalOffset(options.utf16Offset)
            : preservesPoint ? previous.utf16Offset : null,
        affinity: String(options.affinity || (preservesPoint ? previous.affinity : '') || 'nearest'),
    };
    selectionByGroup.set(key, next);
    return Object.freeze({ ...next });
}

export function selectFlowGeneratedPage(groupId) {
    const key = keyFor(groupId);
    const previous = selectionByGroup.get(key) || createEmptySelection(key);
    const next = {
        mode: 'page',
        groupId: key,
        sectionId: String(previous.sectionId || ''),
        blockId: String(previous.blockId || ''),
        languageKey: String(previous.languageKey || ''),
        graphemeOffset: previous.graphemeOffset ?? null,
        utf16Offset: previous.utf16Offset ?? null,
        affinity: String(previous.affinity || 'nearest'),
    };
    selectionByGroup.set(key, next);
    return Object.freeze({ ...next });
}

/** Keep a semantic source caret while the generated page remains visible. */
export function selectFlowDirectEditing(groupId, options = {}) {
    const key = keyFor(groupId);
    const previous = selectionByGroup.get(key) || createEmptySelection(key);
    const next = {
        mode: 'direct',
        groupId: key,
        sectionId: String(options.sectionId ?? previous.sectionId ?? ''),
        blockId: String(options.blockId ?? previous.blockId ?? ''),
        languageKey: String(options.languageKey ?? previous.languageKey ?? ''),
        graphemeOffset: options.graphemeOffset !== undefined
            ? optionalOffset(options.graphemeOffset)
            : previous.graphemeOffset,
        utf16Offset: options.utf16Offset !== undefined
            ? optionalOffset(options.utf16Offset)
            : previous.utf16Offset,
        affinity: String(options.affinity || previous.affinity || 'nearest'),
    };
    selectionByGroup.set(key, next);
    return Object.freeze({ ...next });
}

export function isFlowSourceSelected(groupId) {
    return getFlowEditorSelection(groupId).mode === 'source';
}

export function isFlowDirectEditing(groupId) {
    return getFlowEditorSelection(groupId).mode === 'direct';
}

export function resetFlowEditorSelections() {
    selectionByGroup.clear();
}
