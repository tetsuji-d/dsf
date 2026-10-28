import { editionUrl } from './edition-policy.js';

export const EDITION_SORTS = ['issued-desc', 'issued-asc', 'title-asc', 'title-desc', 'label-asc', 'label-desc'];
export function editionShareUrl(row, origin) {
    if (row.shareUrl) return row.shareUrl;
    return row.legacy ? '' : editionUrl(row.state.editionId, origin);
}

const searchText = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
/** Local presentation only: never relabel, renumber or mutate an issued edition. */
export function selectEditionRows(rows, { query = '', sort = 'issued-desc', locale = 'ja', origin } = {}) {
    const terms = searchText(query).split(/\s+/u).filter(Boolean);
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const selected = rows.filter(row => {
        const text = searchText([row.title, row.state.editionLabel, editionShareUrl(row, origin)].join(' '));
        return terms.every(term => text.includes(term));
    });
    const [field, direction] = (EDITION_SORTS.includes(sort) ? sort : 'issued-desc').split('-');
    return selected.sort((a, b) => {
        const av = field === 'issued' ? a.sort || 0 : field === 'label' ? a.state.editionLabel || '' : a.title || '';
        const bv = field === 'issued' ? b.sort || 0 : field === 'label' ? b.state.editionLabel || '' : b.title || '';
        // Missing dates/labels always follow known values, in either direction.
        if (!!av !== !!bv) return av ? -1 : 1;
        const order = field === 'issued' ? av - bv : collator.compare(av, bv);
        return (direction === 'desc' ? -order : order)
            || collator.compare(a.title || '', b.title || '')
            || collator.compare(a.state.editionLabel || '', b.state.editionLabel || '')
            || String(a.state.editionId).localeCompare(String(b.state.editionId));
    });
}
