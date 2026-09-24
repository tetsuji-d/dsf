/** Optional physical spine decoration; unrelated to the authoring block order. */
export function normalizeBookSpineDesign(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const color = (v, fallback) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
    return {
        title: typeof value.title === 'string' ? value.title.slice(0, 120) : '',
        author: typeof value.author === 'string' ? value.author.slice(0, 80) : '',
        backgroundColor: color(value.backgroundColor, '#173d42'),
        textColor: color(value.textColor, '#f4eddb'),
        fontSize: Math.max(6, Math.min(24, Number(value.fontSize) || 18)),
        ...(value.publisherSource === 'space' ? {publisherSource: 'space'} : {}),
        ...(typeof value.publisherName === 'string' ? { publisherName: value.publisherName.slice(0, 80) } : {}),
        ...(typeof value.publisherIcon === 'string' && value.publisherIcon.length <= 88000
            && (value.publisherIcon === '' || /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.publisherIcon)) ? { publisherIcon: value.publisherIcon } : {}),
    };
}
export function getBookSpinePresentation(value, { title = '', author = '', publisherName = '', width = 360 } = {}) {
    const design = normalizeBookSpineDesign(value);
    return {
        title: design?.title || title,
        author: design?.author || author,
        publisherName: design?.publisherName ?? publisherName,
        publisherIcon: design?.publisherIcon || '',
        backgroundColor: design?.backgroundColor || '#173d42',
        textColor: design?.textColor || '#f4eddb',
        fontSize: (design?.fontSize || 18) * width / 360,
        thickness: width * 32 / 360,
    };
}
export function renderBookSpine(element, design) {
    element.replaceChildren();
    const scale = design.thickness / 32;
    Object.assign(element.style, { background: design.backgroundColor, color: design.textColor,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
        gap: `${16 * scale}px`, padding: `${16 * scale}px 0`, boxSizing: 'border-box', overflow: 'hidden' });
    const text = (field, ratio, parent, maxHeight) => {
        if (!design[field]) return;
        const span = document.createElement('span');
        span.className = `book-spine-${field}`;
        span.textContent = design[field];
        Object.assign(span.style, {fontSize: `${design.fontSize * ratio}px`, writingMode: 'vertical-rl',
            textOrientation: 'mixed', lineHeight: '1.2', letterSpacing: '.12em',
            flex: '0 1 auto', minHeight: '0', maxHeight, maxWidth: '100%', overflow: 'hidden'});
        parent.append(span);
    };
    text('title', 1, element, '60%');
    const imprint = document.createElement('div');
    imprint.className = 'book-spine-imprint';
    Object.assign(imprint.style, {marginTop: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: `${12 * scale}px`, maxHeight: '36%', flex: '0 1 auto', minHeight: '0', width: '100%'});
    text('author', .7, imprint, `${120 * scale}px`);
    text('publisherName', .5, imprint, `${80 * scale}px`);
    if (design.publisherName || design.publisherIcon) {
        const badge = document.createElement('div');
        badge.className = 'book-spine-publisher-icon';
        Object.assign(badge.style, {width: `${24 * scale}px`, height: `${24 * scale}px`, flex: '0 0 auto',
            display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: `${3 * scale}px`,
            fontSize: `${design.fontSize * .7}px`, lineHeight: '1', background: '#ffffff22'});
        badge.textContent = Array.from(design.publisherName || '')[0] || '';
        if (design.publisherIcon) {
            const img = document.createElement('img'); img.alt = design.publisherName || '';
            img.style.cssText = 'width:100%;height:100%;object-fit:contain';
            img.addEventListener('error', () => { img.remove(); badge.textContent = Array.from(design.publisherName || '')[0] || ''; }, {once: true});
            img.src = design.publisherIcon; badge.replaceChildren(img);
        }
        imprint.append(badge);
    }
    element.append(imprint);
}
