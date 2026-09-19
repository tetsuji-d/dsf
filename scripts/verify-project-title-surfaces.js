import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studioHtml = readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');

assert.match(studioHtml, /class="ribbon-project-name-label"[^>]+data-i18n="label_project_name"/);
assert.match(studioHtml, /id="prop-title-lang-badge"/);
assert.match(studioHtml, /class="ribbon-work-title-field"[^>]+for="prop-title"/);
assert.match(appSource, /propTitleLangBadge\.textContent = titleLanguageName/);
assert.match(appSource, /propTitle\.placeholder = getUILang\(\)==='en'\?t\('placeholder_work_title'\):\(titleLanguageProps\.placeholders\?\.title/);
assert.match(
    appSource,
    /const representativeTitle = nextMeta\?\.\[defaultLang\]\?\.title\s+\|\| \(lang === defaultLang \? '' : \(state\.title \|\| ''\)\);/,
);
assert.doesNotMatch(
    appSource,
    /const representativeTitle = nextMeta\?\.\[defaultLang\]\?\.title \|\| v/,
    'editing a non-default title must not leak it into the root compatibility title',
);

assert.match(worksSource, /const explicitWorkTitle = resolveProjectDisplayTitle\(p, \{ locale: getUILang\(\) \}\)/);
assert.match(worksSource, /const displayTitle = explicitWorkTitle \|\| projectName \|\| t\('works_untitled'\)/);
assert.match(worksSource, /works-name-context/);
assert.match(appSource, /function renderHomeWorkCard[\s\S]+const explicitWorkTitle = resolveProjectDisplayTitle\(work, \{ locale: getUILang\(\) \}\)/);
assert.match(appSource, /function renderHomeWorkCard[\s\S]+const title = explicitWorkTitle \|\| projectName \|\| work\.id \|\| t\('works_untitled'\)/);
assert.match(appSource, /home-work-name-context/);

for (const key of [
    'label_project_name',
    'label_work_title',
    'label_work_title_for_language',
    'home_work_title',
    'home_work_title_unset',
    'works_project_name',
    'works_title_fallback',
]) {
    const occurrences = i18nSource.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(occurrences.length, 2, `${key} must exist in both JA and EN dictionaries`);
}

for (const selector of [
    '.ribbon-project-name-label',
    '.ribbon-work-title-field',
    '.ribbon-work-title-lang',
    '.works-name-context',
]) {
    assert.ok(cssSource.includes(selector), `${selector} styling must exist`);
}

console.log('Project title surface verification passed.');
