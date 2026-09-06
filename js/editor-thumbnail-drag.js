/** Pointer-based thumbnail dragging. All mutations are delegated to canonical spine operations. */
export function bindEditorThumbnailDrag({ root, begin, resolve, commit, finish, moveByKey }) {
    let drag = null, frame = 0, suppressUntil = 0;
    const marker = document.createElement('div');
    marker.className = 'editor-drop-marker';
    const badge = document.createElement('div');
    badge.className = 'editor-drag-badge';
    badge.setAttribute('role', 'status');
    const clearHint = () => { marker.remove(); };
    const stop = () => {
        cancelAnimationFrame(frame); frame = 0;
        if (drag?.active) suppressUntil = Date.now() + 300;
        root.querySelectorAll('.editor-unit-dragging').forEach(el => el.classList.remove('editor-unit-dragging'));
        marker.remove(); badge.remove();
        document.body.classList.remove('editor-thumbnail-dragging');
        drag = null;
        finish?.();
    };
    const paint = () => {
        frame = 0;
        if (!drag?.active) return;
        const { x, y } = drag;
        const hit = document.elementFromPoint(x, y);
        const scrollArea = hit?.closest('#page-strip-thumbs, #thumb-container, #flow-canvas-viewport');
        if (scrollArea) {
            const rect = scrollArea.getBoundingClientRect();
            const delta = x < rect.left + 32 ? -12 : x > rect.right - 32 ? 12 : 0;
            if (delta) { scrollArea.scrollLeft += delta; frame = requestAnimationFrame(paint); }
        }
        clearHint();
        drag.target = resolve(hit, x, y, drag.context);
        badge.textContent = drag.target?.label || drag.context.label;
        Object.assign(badge.style, { left: Math.max(8, Math.min(x + 16, innerWidth - 240)) + 'px',
            top: Math.max(8, Math.min(y + 16, innerHeight - 50)) + 'px' });
        if (!drag.target) return;
        const { rect, orientation = 'vertical', point } = drag.target;
        marker.dataset.dropKind = drag.target.kind;
        marker.dataset.blockId = point?.blockId || '';
        marker.dataset.offset = String(point?.utf16Offset ?? '');
        Object.assign(marker.style, { left: rect.left + 'px', top: rect.top + 'px',
            width: (orientation === 'horizontal' ? Math.max(16, rect.width) : 3) + 'px',
            height: (orientation === 'horizontal' ? 3 : Math.max(16, rect.height)) + 'px' });
        document.body.appendChild(marker);
    };
    root.addEventListener('pointerdown', event => {
        const thumb = event.target.closest('.thumb-wrap[data-editor-unit-id]');
        if (!thumb || event.button !== 0 || event.isPrimary === false || drag) return;
        if (event.target.closest('button, input, select')) return;
        if (event.pointerType === 'touch' && !event.target.closest('.thumb-drag-grip')) return;
        const context = begin(thumb);
        if (!context) return;
        drag = { context, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: event.clientX, y: event.clientY, active: false, target: null };
        // Prevent native image dragging and text selection; clicks still select pages.
        if (event.pointerType !== 'touch') event.preventDefault();
    });
    root.addEventListener('dragstart', event => {
        if (event.target.closest('.thumb-wrap[data-editor-unit-id]')) event.preventDefault();
    });
    document.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 7) return;
        event.preventDefault();
        if (!drag.active) {
            drag.active = true;
            root.querySelectorAll('.thumb-wrap[data-editor-unit-id]').forEach(el => {
                if (el.dataset.editorUnitId === drag.context.id) el.classList.add('editor-unit-dragging');
            });
            document.body.classList.add('editor-thumbnail-dragging');
            document.body.appendChild(badge);
        }
        if (!frame) frame = requestAnimationFrame(paint);
    }, { passive: false });
    document.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (drag.active) {
            event.preventDefault();
            // Resolve afresh at release, including after scrolling or pagination.
            const target = resolve(document.elementFromPoint(event.clientX, event.clientY),
                event.clientX, event.clientY, drag.context);
            try { if (target) commit(target, drag.context); } finally { stop(); }
        } else stop();
    });
    document.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); stop(); }
        if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const thumb = event.target.closest('.thumb-wrap[data-editor-unit-id]');
        if (thumb) { event.preventDefault(); moveByKey?.(thumb, event.key); }
    });
    root.addEventListener('click', event => {
        if (Date.now() < suppressUntil && event.target.closest('.thumb-wrap')) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }, true);
    return { cancel: stop };
}
