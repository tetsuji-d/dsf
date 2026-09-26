import { BOOK_EDGE_PROJECTION } from './book-volume.js';

/** Two lightweight surfaces, never one DOM element per page. */
export function createBookEdges(parent) {
    const root = document.createElement('div');
    root.className = 'viewer-book-edges';
    root.setAttribute('aria-hidden', 'true');
    for (const side of ['left', 'right']) {
        const edge = document.createElement('div');
        edge.className = `book-page-edge book-page-edge-${side}`;
        root.append(edge);
    }
    parent.prepend(root);
    return root;
}
export function paintBookEdges(root, state, {scale, height, leftX = 0, rightX}) {
    root.hidden = !state;
    if (!state) return;
    root.dataset.thickness = state.thickness.toFixed(3);
    root.dataset.left = state.left.toFixed(3);
    root.dataset.right = state.right.toFixed(3);
    for (const [i, side] of ['left', 'right'].entries()) {
        const edge = root.children[i], width = state[side] * BOOK_EDGE_PROJECTION * scale;
        edge.hidden = width < .15;
        // Keep the paper block inside both cover edges; thickness must not shift it down.
        const inset = Math.min(1.5 * scale, height / 2);
        Object.assign(edge.style, {width: `${width}px`, height: `${Math.max(0,height-inset*2)}px`,
            left: `${side === 'left' ? leftX - width : rightX}px`, top: `${inset}px`});
        edge.style.setProperty('--edge-slope', `${Math.min(5, width * .3)}px`);
    }
}
