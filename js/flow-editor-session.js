/** Runtime-only Flow editor selection. Never persisted into Project data. */

const selectionByGroup = new Map();

function keyFor(groupId) {
    return String(groupId || '');
}

export function getFlowEditorSelection(groupId) {
    const key = keyFor(groupId);
    const saved = selectionByGroup.get(key);
    return saved
        ? Object.freeze({ ...saved })
        : Object.freeze({ mode: 'source', groupId: key, sectionId: '', blockId: '' });
}

export function selectFlowSource(groupId, options = {}) {
    const key = keyFor(groupId);
    const previous = selectionByGroup.get(key) || {};
    const next = {
        mode: 'source',
        groupId: key,
        sectionId: String(options.sectionId ?? previous.sectionId ?? ''),
        blockId: String(options.blockId ?? previous.blockId ?? ''),
    };
    selectionByGroup.set(key, next);
    return Object.freeze({ ...next });
}

export function selectFlowGeneratedPage(groupId) {
    const key = keyFor(groupId);
    const previous = selectionByGroup.get(key) || {};
    const next = {
        mode: 'page',
        groupId: key,
        sectionId: String(previous.sectionId || ''),
        blockId: String(previous.blockId || ''),
    };
    selectionByGroup.set(key, next);
    return Object.freeze({ ...next });
}

export function isFlowSourceSelected(groupId) {
    return getFlowEditorSelection(groupId).mode === 'source';
}

export function resetFlowEditorSelections() {
    selectionByGroup.clear();
}
