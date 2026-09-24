import { getBookSpinePresentation, renderBookSpine } from './book-spine-design.js';

/** A temporary closed-book surface. Only a completed flip changes reading position. */
export function createViewerCoverTurn({canvas, stage, width, height, getTurn, render, getTitle, getSpineDesign, getAuthor, getPublisher, text, onGesture}) {
    let turn = null, pointer = null, wheel = null, wheelTimer = 0, animation = null;
    const status = document.createElement('div');
    status.className = 'viewer-cover-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    document.body.append(status);
    const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
    function message(key) { status.textContent = text(key); status.hidden = false; }
    function draw(value) {
        if (!turn) return;
        turn.p = Math.max(0, Math.min(1, value));
        turn.layer.dataset.progress = turn.p.toFixed(3);
        turn.book.style.transform = `rotateY(${turn.sign * 180 * turn.p}deg) scale(${1 - turn.shrink * Math.sin(Math.PI * turn.p)})`;
    }
    function clearTurn(commit = false) {
        const old = turn;
        turn = null;
        animation?.cancel(); animation = null;
        if (old) {
            old.layer.remove();
            stage.style.opacity = old.opacity;
        }
        document.body.classList.remove('viewer-cover-turn-active');
        status.hidden = true;
        if (commit) old?.commit();
    }
    function cancel() {
        pointer = null; wheel = null; clearTimeout(wheelTimer);
        clearTurn();
    }
    function begin(delta) {
        const spec = getTurn(delta);
        if (!spec) return false;
        const rect = canvas.getBoundingClientRect();
        const layer = document.createElement('div');
        layer.className = 'viewer-cover-turn';
        layer.setAttribute('aria-hidden', 'true');
        Object.assign(layer.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, visibility: 'hidden'});
        const scale = document.createElement('div'), book = document.createElement('div');
        scale.className = 'vct-scale'; book.className = 'vct-book';
        for (const node of [scale, book]) Object.assign(node.style, {width: `${width}px`, height: `${height}px`});
        scale.style.transform = `scale(${rect.width / width})`;
        scale.append(book); layer.append(scale);
        for (const [side, surface] of [['front', spec.from], ['back', spec.to]]) {
            const face = document.createElement('div');
            face.className = `vct-face vct-${side}`;
            face.innerHTML = render(surface);
            book.append(face);
        }
        const design = getBookSpinePresentation(getSpineDesign?.(), { title: getTitle(), author: getAuthor?.() || '', publisherName: getPublisher?.() || '', width });
        const thickness = design.thickness, spineRight = spec.fromFront === spec.rtl;
        book.style.setProperty('--vct-thickness', `${thickness}px`);
        for (const right of [false, true]) {
            const edge = document.createElement('div');
            const spine = right === spineRight;
            edge.className = 'vct-edge' + (spine ? ' vct-spine' : '');
            edge.style.left = `${(right ? width : 0) - thickness / 2}px`;
            edge.style.transform = `rotateY(${right ? 90 : -90}deg)`;
            if (spine) {
                renderBookSpine(edge, design);
            }
            book.append(edge);
        }
        const current = { ...spec, delta, sign: (spec.rtl ? 1 : -1) * delta, p: 0, shrink: 1 - .94 / (1 + .94 * rect.width / 3000), layer, book, ready: false, opacity: stage.style.opacity };
        turn = current;
        document.body.append(layer);
        document.body.classList.add('viewer-cover-turn-active');
        message('preparing'); draw(0);
        // Load both covers before hiding the real surface, including uncached local images.
        const images = [...layer.querySelectorAll('.vct-face img')];
        let timer;
        current.loaded = Promise.race([
            Promise.all(images.map(img => img.complete && img.naturalWidth ? Promise.resolve() : img.decode())),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cover timeout')), 4000); })
        ]).then(() => {
            if (turn !== current) return false;
            current.ready = true; layer.style.visibility = ''; stage.style.opacity = '0';
            if (current.p === .5) status.hidden = true;
            else message('turning');
            return true;
        }).catch(() => {
            if (turn === current) { clearTurn(); message('unavailable'); }
            return false;
        }).finally(() => clearTimeout(timer));
        return true;
    }
    async function settle(to) {
        const current = turn;
        if (!current || current.settling) return;
        current.settling = true;
        if (!await current.loaded || turn !== current) return;
        const from = current.p;
        const duration = reduced() ? 0 : Math.max(140, Math.abs(to - from) * 850);
        const pose = p => `rotateY(${current.sign * 180 * p}deg) scale(${1 - current.shrink * Math.sin(Math.PI * p)})`;
        const running = current.book.animate([{transform: pose(from)}, {transform: pose(to)}], {duration, easing: 'ease-in-out', fill: 'forwards'});
        animation = running;
        try { await running.finished; } catch { return; }
        if (turn !== current) return;
        draw(to); animation = null; running.cancel(); current.settling = false;
        if (to === 0 || to === 1) clearTurn(to === 1);
        else status.hidden = true;
    }
    function step(delta) {
        if (pointer?.started || wheel) return true;
        if (turn) { if (!turn.settling) void settle(delta === turn.delta ? 1 : 0); return true; }
        if (!begin(delta)) return false;
        void settle(.5); return true;
    }
    function move(gesture, dx) {
        if (!turn || gesture.latched) return;
        const p = gesture.p + dx * turn.sign / Math.max(180, canvas.clientWidth * .8);
        if ((gesture.p < .5 && p >= .5) || (gesture.p > .5 && p <= .5)) {
            draw(.5); gesture.latched = true; status.hidden = true;
        } else draw(p);
    }
    function release(gesture) {
        if (!turn) return;
        const p = turn.p;
        const to = gesture.p === 0 ? (p > .12 ? .5 : 0)
            : gesture.p === 1 ? (p < .88 ? .5 : 1)
            : p < .38 ? 0 : p > .62 ? 1 : .5;
        void settle(to);
    }
    function consume(e) { e.preventDefault(); e.stopImmediatePropagation(); onGesture(); }
    function pointerDown(e) {
        if (!e.isPrimary) { if (pointer) cancel(); return false; }
        if (e.button !== 0 || !e.target.closest?.('#viewer-canvas')) return false;
        if (!turn && !getTurn(1) && !getTurn(-1)) return false;
        if (turn?.settling || wheel) { consume(e); return true; }
        pointer = {id: e.pointerId, x: e.clientX, y: e.clientY, p: turn?.p ?? 0, started: false, latched: false};
        return !!turn;
    }
    function pointerMove(e) {
        if (pointer?.id !== e.pointerId) return false;
        const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
        if (!pointer.started) {
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { pointer = null; return false; }
            if (Math.abs(dx) < 12) return false;
            const rtl = turn?.rtl ?? (getTurn(1) || getTurn(-1))?.rtl;
            if (!turn && !begin((dx > 0 ? 1 : -1) * (rtl ? 1 : -1))) { pointer = null; return false; }
            pointer.started = true;
            try { canvas.setPointerCapture(e.pointerId); } catch { /* released pointer */ }
        }
        consume(e); move(pointer, dx); return true;
    }
    function pointerUp(e) {
        if (pointer?.id !== e.pointerId) return false;
        const gesture = pointer; pointer = null;
        if (!gesture.started) return false;
        consume(e); release(gesture); return true;
    }
    function pointerCancel(e) {
        if (pointer?.id !== e.pointerId) return false;
        const gesture = pointer; pointer = null;
        if (gesture.started) { consume(e); release(gesture); return true; }
        return false;
    }
    function handleWheel(e) {
        if (e.ctrlKey) { if (turn) cancel(); return false; }
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.25 || pointer) return false;
        const spec = turn || getTurn(1) || getTurn(-1);
        if (!spec && !wheel) return false;
        const dx = -e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientWidth : 1);
        if (!turn && !wheel && !getTurn((dx > 0 ? 1 : -1) * (spec.rtl ? 1 : -1))) return false;
        consume(e); clearTimeout(wheelTimer);
        // All momentum events belong to this burst, including ones received while snapping.
        wheelTimer = setTimeout(() => { const gesture = wheel; wheel = null; if (gesture && !gesture.consumed) release(gesture); }, 260);
        if (!wheel) wheel = {p: turn?.p ?? 0, dx: 0, latched: false, consumed: !!turn?.settling};
        if (turn?.settling || wheel.consumed) { wheel.consumed = true; return true; }
        wheel.dx += dx;
        if (!turn && !begin((wheel.dx > 0 ? 1 : -1) * (spec.rtl ? 1 : -1))) return true;
        move(wheel, wheel.dx); return true;
    }
    window.addEventListener('resize', cancel);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
    window.visualViewport?.addEventListener('resize', cancel);
    new ResizeObserver(() => {
        if (!turn) return;
        const rect = canvas.getBoundingClientRect();
        if (Math.abs(rect.width - parseFloat(turn.layer.style.width)) > 1 || Math.abs(rect.height - parseFloat(turn.layer.style.height)) > 1) cancel();
    }).observe(canvas);
    return {step, pointerDown, pointerMove, pointerUp, pointerCancel, handleWheel, cancel, get active() { return !!turn; }};
}
