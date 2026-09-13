/** Canonical page coordinates; no text layout or authoring mutations. */
export function calculateReadingGuideSegments(line, exclusions = []) {
    const vertical = line.vertical;
    const cross = vertical ? line.x - 1.5 : line.y + line.height + 1.5;
    let intervals = [[vertical ? line.y : line.x, vertical ? line.y + line.height : line.x + line.width]];
    for (const box of exclusions) {
        // Include stroke clearance so even an adjacent ruby is never painted over.
        const lo = (vertical ? box.x : box.y) - .8;
        const hi = (vertical ? box.x + box.width : box.y + box.height) + .8;
        if (cross < lo || cross > hi) continue;
        const start = (vertical ? box.y : box.x) - .8;
        const end = (vertical ? box.y + box.height : box.x + box.width) + .8;
        intervals = intervals.flatMap(([a, b]) => end <= a || start >= b ? [[a, b]]
            : [[a, Math.min(b, start)], [Math.max(a, end), b]].filter(([x, y]) => y > x));
    }
    return intervals.filter(([a, b]) => b - a >= 1).map(([a, b]) => vertical
        ? {x1: cross, y1: a, x2: cross, y2: b}
        : {x1: a, y1: cross, x2: b, y2: cross});
}

export function paintViewerReadingGuides(stage, {enabled, mode}) {
    if (!stage) return;
    for (const page of stage.querySelectorAll('.viewer-fixed-text-page')) {
        page.querySelector(':scope > .reader-line-overlay')?.remove();
        if (!enabled) continue;
        const lines = [...page.querySelectorAll(':scope > .viewer-fixed-text-line')];
        const pageRect = page.getBoundingClientRect();
        const scaleX = pageRect.width / parseFloat(page.style.width);
        const scaleY = pageRect.height / parseFloat(page.style.height);
        if (!scaleX || !scaleY) continue;
        // Measure body text and annotations in the same coordinate space. Body
        // font boxes may tile with no gap; only ruby/emphasis boxes exclude segments.
        const bounds = element => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const rects = [];
            while (walker.nextNode()) {
                const range = document.createRange(); range.selectNodeContents(walker.currentNode);
                rects.push(...range.getClientRects());
            }
            const clip = element.getBoundingClientRect();
            const visible = rects.map(r => ({left: Math.max(r.left, clip.left), top: Math.max(r.top, clip.top),
                right: Math.min(r.right, clip.right), bottom: Math.min(r.bottom, clip.bottom)}))
                .filter(r => r.right > r.left && r.bottom > r.top);
            if (!visible.length) return null;
            const left = Math.min(...visible.map(r => r.left)), top = Math.min(...visible.map(r => r.top));
            return {x: (left - pageRect.left) / scaleX, y: (top - pageRect.top) / scaleY,
                width: (Math.max(...visible.map(r => r.right)) - left) / scaleX,
                height: (Math.max(...visible.map(r => r.bottom)) - top) / scaleY};
        };
        const boxes = lines.map(bounds);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('reader-line-overlay');
        svg.setAttribute('viewBox', `0 0 ${parseFloat(page.style.width)} ${parseFloat(page.style.height)}`);
        svg.setAttribute('aria-hidden', 'true');
        lines.forEach((element, index) => {
            const active = element.classList.contains('reading-line-active');
            if (!boxes[index] || !element.dataset.readingLine || (mode !== 'all' && !active)) return;
            const segments = calculateReadingGuideSegments({...boxes[index], vertical: element.dataset.readingLine === 'vertical'}, boxes.filter((box, i) => box && i !== index && !lines[i].dataset.readingLine));
            for (const segment of segments) {
                const path = document.createElementNS(svg.namespaceURI, 'line');
                for (const [key, value] of Object.entries(segment)) path.setAttribute(key, value);
                path.dataset.active = String(active);
                path.dataset.readingLine = element.dataset.readingLine;
                svg.append(path);
            }
        });
        page.append(svg);
    }
}
