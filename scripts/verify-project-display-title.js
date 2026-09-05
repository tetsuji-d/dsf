import assert from 'node:assert/strict';
import {
    resolveProjectCanonicalTitle,
    resolveProjectDefaultTitle,
    resolveProjectDisplayTitle,
    resolveProjectName,
} from '../js/project-display-title.js';

const multilingual = {
    projectName: 'Internal manuscript 42',
    title: 'Legacy representative title',
    defaultLang: 'ja',
    languages: ['ja', 'en-us', 'en-gb', 'fr'],
    meta: {
        ja: { title: '日本語作品名' },
        'en-us': { title: 'US title' },
        'en-gb': { title: 'UK title' },
        fr: { title: 'Titre français' },
    },
};

assert.equal(resolveProjectName(multilingual), 'Internal manuscript 42');
assert.equal(resolveProjectDisplayTitle(multilingual, { locale: 'ja' }), '日本語作品名');
assert.equal(resolveProjectDisplayTitle(multilingual, { locale: 'en-gb' }), 'UK title');
assert.equal(resolveProjectDisplayTitle(multilingual, { locale: 'EN_us' }), 'US title');
assert.equal(
    resolveProjectDisplayTitle(multilingual, { locale: 'en' }),
    'US title',
    'A generic locale must choose the first configured regional sibling.',
);
assert.equal(
    resolveProjectDisplayTitle({ ...multilingual, languages: ['ja', 'en-gb', 'en-us', 'fr'] }, { locale: 'en' }),
    'UK title',
    'Regional sibling selection must follow author-declared language order.',
);
assert.equal(
    resolveProjectDisplayTitle(multilingual, { locale: 'de' }),
    '日本語作品名',
    'A missing requested locale must fall back to the default language before root title.',
);
assert.equal(resolveProjectDefaultTitle(multilingual), '日本語作品名');
assert.equal(resolveProjectCanonicalTitle(multilingual), '日本語作品名');

assert.equal(
    resolveProjectDisplayTitle({
        title: 'Root title',
        defaultLang: 'ja',
        languages: ['ja', 'en'],
        meta: { en: { title: 'English title' } },
    }, { locale: 'de' }),
    'Root title',
    'A representative root string must precede an arbitrary-language fallback.',
);
assert.equal(
    resolveProjectDisplayTitle({
        title: '',
        defaultLang: 'ja',
        languages: ['ja', 'en'],
        meta: { en: { title: 'English title' } },
    }, { locale: 'de' }),
    'English title',
);

const legacyObjectTitle = {
    projectName: 'Legacy editor label',
    title: { ja: '旧日本語題', 'en-gb': 'Legacy UK title' },
    defaultLang: 'ja',
    languages: ['ja', 'en-gb'],
};
assert.equal(resolveProjectDisplayTitle(legacyObjectTitle, { locale: 'en' }), 'Legacy UK title');
assert.equal(resolveProjectDefaultTitle(legacyObjectTitle), '旧日本語題');
assert.equal(
    resolveProjectDisplayTitle({
        ...legacyObjectTitle,
        meta: { ja: { title: '現在の日本語題' } },
    }, { locale: 'ja' }),
    '現在の日本語題',
    'Current meta title must win over the legacy object title for the same locale.',
);

assert.equal(
    resolveProjectDisplayTitle({
        title: '  Cafe\u0301  ',
        projectName: '  Editing label  ',
    }),
    'Café',
    'Display text must be trimmed and NFC-normalized.',
);
assert.equal(resolveProjectName({ projectName: '  Editing label  ' }), 'Editing label');

const projectNameOnly = { projectName: '20290901FLOWテスト', title: '', meta: {}, defaultLang: 'ja' };
assert.equal(resolveProjectDisplayTitle(projectNameOnly, { locale: 'ja' }), '');
assert.equal(
    resolveProjectDisplayTitle(projectNameOnly, { locale: 'ja', includeProjectName: true }),
    '20290901FLOWテスト',
    'projectName fallback must remain explicit so public and private surfaces cannot mix it accidentally.',
);
assert.equal(resolveProjectDefaultTitle(projectNameOnly), '');
assert.equal(resolveProjectCanonicalTitle(projectNameOnly, { includeProjectName: true }), '20290901FLOWテスト');

assert.equal(resolveProjectDisplayTitle(null, { includeProjectName: true }), '');
assert.equal(resolveProjectDisplayTitle({ title: 42, projectName: ['invalid'] }, { includeProjectName: true }), '');

console.log('Project display title contract verification passed.');
