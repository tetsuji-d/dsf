/** Runtime-only association: delivery coordinates stay unchanged. */
export function collectReadingLineGroups(page) {
    const nodes = [...page.querySelectorAll(':scope > .viewer-fixed-text-line')];
    const box = n => ({x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width), h: parseFloat(n.style.height)});
    const groups = nodes.filter(n => n.dataset.readingLine && n.textContent.trim()).map(node => ({node, members: [node], box: box(node)}));
    for (const annotation of nodes.filter(n => n.dataset.readingAnnotation)) {
        const a = box(annotation); let best = null, score = Infinity;
        for (const group of groups) {
            if (group.node.dataset.readingStyle !== annotation.dataset.readingStyle) continue;
            const b = group.box, vertical = group.node.dataset.readingLine === 'vertical';
            const overlap = vertical ? Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) : Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
            const distance = vertical ? a.x+a.w/2-(b.x+b.w/2) : b.y+b.h/2-(a.y+a.h/2);
            if (overlap <= 0 || distance < 0 || distance > Math.max(24,(vertical?b.w:b.h)*2)) continue;
            if (distance < score) { score = distance; best = group; }
        }
        // Unknown annotation ownership stays visible, rather than dimming useful text.
        best?.members.push(annotation);
    }
    return groups;
}
