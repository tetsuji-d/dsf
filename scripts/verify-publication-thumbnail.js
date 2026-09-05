import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actionTypes, dispatch, state } from '../js/state.js';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const stateSource = read('js/state.js');
const appSource = read('js/app.js');
const firebaseSource = read('js/firebase.js');
const exportSource = read('js/export.js');
const pressSource = read('js/press.js');
const draftSource = read('js/flow-press-horizon-draft-write.js');
const worksTransitionSource = read('js/works-publication-transition.js');
const studioHtml = read('studio.html');
const i18nSource = read('js/i18n-studio.js');

assert.match(stateSource, /publicationThumbnailUrl:\s*''/,
    'Project state must distinguish an empty default-cover preference from a custom image');
assert.match(
    stateSource,
    /case actionTypes\.LOAD_PROJECT:[\s\S]*?const projectPayload = \{[\s\S]*?publicationThumbnailUrl:\s*''[\s\S]*?\.\.\.\(payload \|\| \{\}\)/,
    'LOAD_PROJECT must clear a previous custom thumbnail when an older Project omits the field',
);
state.publicationThumbnailUrl = 'https://media.example.test/previous-project-thumbnail.webp';
dispatch({
    type: actionTypes.LOAD_PROJECT,
    payload: { projectName: 'legacy-project-without-publication-thumbnail' },
});
assert.equal(
    state.publicationThumbnailUrl,
    '',
    'loading an older Project must not carry over the previously opened Project thumbnail',
);

for (const id of [
    'ps-publication-thumbnail-preview',
    'ps-publication-thumbnail-image',
    'ps-publication-thumbnail-placeholder',
    'ps-publication-thumbnail-choose',
    'ps-publication-thumbnail-reset',
    'ps-publication-thumbnail-input',
    'ps-publication-thumbnail-status',
]) {
    assert.equal((studioHtml.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1,
        `Project Settings must contain one #${id}`);
}
assert.match(studioHtml, /id="ps-publication-thumbnail-input"[^>]+type="file"[^>]+accept="image\/\*"/);

for (const key of [
    'ps_section_publication_thumbnail',
    'ps_publication_thumbnail_description',
    'ps_publication_thumbnail_default_status',
    'ps_publication_thumbnail_custom_status',
    'ps_publication_thumbnail_invalid_file',
]) {
    assert.equal((i18nSource.match(new RegExp(`${key}:`, 'g')) || []).length >= 2, true,
        `${key} must have JA and EN UI strings`);
}

assert.match(appSource, /storePublicationThumbnailFile\(_psPublicationThumbnailFile\)/,
    'Project Settings must convert and store a selected image before applying it');
assert.match(appSource, /selectProjectAuthoringCoverThumbnail\(state, \{ allowLocal: true \}\)/,
    'the default-cover preview must use current authoring C1 and support local Blob URLs');
assert.match(appSource, /setStudioUILang[\s\S]*renderProjectPublicationThumbnailSettings\(\)/,
    'language switching must preserve the dynamic thumbnail state');
assert.match(appSource, /_clearProjectThumbnailTemporaryPreview[\s\S]*ps-publication-thumbnail-input/,
    'closing or reopening the dialog must clear the file input');

const projectSettingsSaveStart = appSource.indexOf('window.saveProjectSettings = async () => {');
const projectSettingsSaveEnd = appSource.indexOf('// ===== Room Navigation', projectSettingsSaveStart);
assert.notEqual(projectSettingsSaveStart, -1, 'Project Settings save handler must exist');
assert.notEqual(projectSettingsSaveEnd, -1, 'Project Settings save handler boundary must exist');
const projectSettingsSaveSource = appSource.slice(projectSettingsSaveStart, projectSettingsSaveEnd);
assert.ok(
    projectSettingsSaveSource.indexOf('if (_psPublicationThumbnailSaving) return;')
        < projectSettingsSaveSource.indexOf('const draft = _capturePsInputsToDraft();'),
    'a second Project Settings save must be rejected before inputs are captured again',
);
assert.equal((projectSettingsSaveSource.match(/await flushSave\(\)/g) || []).length, 1,
    'Project Settings must perform exactly one immediate serialized project save');
assert.equal(projectSettingsSaveSource.includes('triggerAutoSave()'), false,
    'Project Settings must not enqueue a redundant two-second autosave after flushing');
assert.equal(projectSettingsSaveSource.includes('ensureProjectIdentity()'), false,
    'saving local-only Project Settings must not silently create a cloud Project identity');
assert.match(projectSettingsSaveSource, /dialog\?\.setAttribute\('aria-busy', 'true'\)[\s\S]*dialog\?\.setAttribute\('inert', ''\)[\s\S]*saveButton\.disabled = true/,
    'the modal must prevent edits and duplicate submission during thumbnail and project persistence');
assert.match(projectSettingsSaveSource, /await storePublicationThumbnailFile\(_psPublicationThumbnailFile\);[\s\S]*_clearProjectThumbnailTemporaryPreview\(\);[\s\S]*await flushSave\(\)/,
    'a selected thumbnail must become a stable stored URL before the project snapshot is flushed');
assert.match(projectSettingsSaveSource, /await flushSave\(\);\s*_assertProjectSettingsPersistenceCompleted\(\);\s*persistenceCompleted = true;/,
    'the modal success path must require the existing local/cloud save indicator to confirm completion');
assert.match(projectSettingsSaveSource, /catch \(error\)[\s\S]*alert\(error\?\.message \|\| String\(error\)\);[\s\S]*finally[\s\S]*removeAttribute\('inert'\)/,
    'a persistence failure must restore the controls and show an error');
assert.ok(
    projectSettingsSaveSource.indexOf('if (!persistenceCompleted) return;')
        < projectSettingsSaveSource.indexOf("modal.style.display = 'none'"),
    'Project Settings must remain open unless persistence completed',
);
assert.match(appSource, /function _assertProjectSettingsPersistenceCompleted\(\)[\s\S]*state\.projectId && state\.uid \? 'Cloud' : 'Local'[\s\S]*PROJECT_SETTINGS_PERSISTENCE_FAILED/,
    'the completion check must distinguish cloud projects from local-only projects');
assert.match(firebaseSource, /export async function flushSave\(\)[\s\S]*clearTimeout\(autoSaveTimer\)[\s\S]*await performSave\(\)/,
    'the immediate save boundary must cancel the debounce timer');
assert.match(firebaseSource, /async function performSave\(\)[\s\S]*if \(activeSavePromise\) return activeSavePromise;[\s\S]*while \(saveRequested\)/,
    'an in-flight save must serialize the Project Settings snapshot instead of racing it');

assert.match(firebaseSource, /PUBLICATION_THUMBNAIL_WIDTH = 720/);
assert.match(firebaseSource, /PUBLICATION_THUMBNAIL_HEIGHT = 1280/);
assert.match(firebaseSource, /PUBLICATION_THUMBNAIL_MAX_SOURCE_BYTES = 25 \* 1024 \* 1024/);
assert.match(firebaseSource, /users\/\$\{uid\}\/dsf\/publication-thumbnails\/\$\{digest\}\.webp/,
    'custom and rendered thumbnails must use content-addressed owner storage');
assert.match(firebaseSource, /ensurePublicationThumbnailCloudUrl[\s\S]*fetchAssetBlob\(candidate, '作品サムネイル'\)/,
    'an imported DSP Blob URL must be recoverable even before it has an IDB mapping');
assert.match(
    firebaseSource,
    /ensurePublicationThumbnailCloudUrl[\s\S]*isManagedPublicationThumbnailUrl\(candidate,\s*\{[\s\S]*ownerUid:\s*state\.uid,[\s\S]*r2PublicBaseUrl:\s*import\.meta\.env\.VITE_R2_PUBLIC_URL,[\s\S]*firebaseStorageBucket:\s*firebaseConfig\.storageBucket/,
    'an existing HTTPS thumbnail must be verified as owner-managed before it can reach a release',
);
assert.match(firebaseSource, /if\s*\(!isManaged\)[\s\S]*throw new Error\(/,
    'an arbitrary third-party HTTPS thumbnail must fail closed');

assert.match(
    exportSource,
    /const\s+filename\s*=\s*`publication-thumbnail\.\$\{ext\}`;[\s\S]*?assetsFolder\.file\(filename, blob\);[\s\S]*?publicationThumbnailUrl\s*=\s*`assets\/\$\{filename\}`;/,
    'DSP export must embed the custom publication thumbnail and persist its archive-relative asset path',
);
assert.match(exportSource, /key === 'publicationThumbnailUrl'/,
    'DSP import must restore the embedded publication thumbnail URL');
assert.match(exportSource, /sha256DsfBytes\(await typedBlob\.arrayBuffer\(\)\)[\s\S]*localKey = `dsp_asset_\$\{digest\}`[\s\S]*window\.localImageMap\[url\] = localKey/,
    'DSP import assets must survive local recent-project restoration without duplicating identical blobs');
assert.match(exportSource, /title:\s*hasAuthoringTitle[\s\S]*meta\.title !== 'Untitled'/,
    'DSP import must not turn an archive filename fallback into a publishable work title');

const flowThumbnailResolverSource = pressSource.slice(
    pressSource.indexOf('async function _resolveFlowReleaseThumbnail(upload)'),
    pressSource.indexOf('async function _resolveV1ReleaseThumbnail('),
);
const flowImageThumbnailBranchSource = flowThumbnailResolverSource.slice(
    flowThumbnailResolverSource.indexOf("if (page?.renderKind === 'image')"),
    flowThumbnailResolverSource.indexOf("if (page?.renderKind === 'fixedText')"),
);
const v1ThumbnailResolverSource = pressSource.slice(
    pressSource.indexOf('async function _resolveV1ReleaseThumbnail('),
    pressSource.indexOf('async function _writePressFlowHorizonDraftMetadata('),
);

assert.match(pressSource, /storePublicationThumbnailBlob,[\s\S]*PUBLICATION_THUMBNAIL_WIDTH,[\s\S]*PUBLICATION_THUMBNAIL_HEIGHT,[\s\S]*} from '\.\/firebase\.js'/,
    'Press must reuse the canonical 720x1280 publication-thumbnail dimensions');
assert.match(
    pressSource,
    /async function _renderSectionPublicationThumbnail\([\s\S]*renderPressSectionToWebP\([\s\S]*PUBLICATION_THUMBNAIL_WIDTH,[\s\S]*PUBLICATION_THUMBNAIL_HEIGHT,[\s\S]*storePublicationThumbnailBlob\(blob\)/,
    'an image C1 must be re-rendered from author source into owner-managed 720x1280 listing WebP storage',
);
assert.match(flowThumbnailResolverSource, /const custom = await _resolveConfiguredPublicationThumbnail\(\);\s*if \(custom\) return custom;/,
    'a custom listing thumbnail must take precedence over the Flow C1 default');
assert.match(flowImageThumbnailBranchSource, /page\.sourceAnchor\.blockId/,
    'Flow image thumbnail resolution must start from the verified C1 fixed block identity');
assert.match(flowImageThumbnailBranchSource, /file\.language === language[\s\S]*file\.blockId === blockId[\s\S]*file\.pageIndex === pageIndex/,
    'Flow image thumbnail resolution must bind the exact language, block, and delivery page');
assert.match(flowImageThumbnailBranchSource, /'storagePath',[\s\S]*'publicUrl',[\s\S]*'mimeType',[\s\S]*'byteLength',[\s\S]*'sha256',[\s\S]*'cacheControl',[\s\S]*receipt\[key\] === imageFile\[key\]/,
    'Flow C1 must retain the complete verified handoff/upload receipt binding');
assert.match(flowImageThumbnailBranchSource, /return _renderSectionPublicationThumbnail\([\s\S]*\(\) => _assertCurrentFlowHorizonDraftIdentity\(upload\)/,
    'Flow image C1 must render author source while keeping the current handoff signature guarded');
assert.doesNotMatch(flowImageThumbnailBranchSource, /return\s+(?:imageFile(?:\?\.)?\.publicUrl|publicUrl)\s*;/,
    'Flow must not reuse the full Release body WebP URL as its listing thumbnail');
assert.match(pressSource, /renderDsfFixedTextThumbnailWebP\(/,
    'a fixedText C1 must create only a listing WebP while DSF body text remains fixedText');
assert.match(pressSource, /style\?\.fontWeight === 'normal'[\s\S]*\? 400[\s\S]*style\?\.fontWeight === 'bold'[\s\S]*\? 700/,
    'Press must load certified font weights accepted by the fixedText contract');
assert.match(pressSource, /storePublicationThumbnailBlob\(blob\)/,
    'a rendered fixedText cover thumbnail must be content-addressed and uploaded');
assert.match(pressSource, /const thumbnail = await _resolveFlowReleaseThumbnail\(upload\);[\s\S]*createFlowPressHorizonDraftWrite\(\{/,
    'Flow metadata must be written only after a verified thumbnail is ready');
assert.match(v1ThumbnailResolverSource, /if \(customThumbnail\) return customThumbnail;/,
    'a custom listing thumbnail must take precedence over the v1 C1 default');
assert.match(v1ThumbnailResolverSource, /_getPublicationCoverPageIndex\(pages\.length\)[\s\S]*const section = pages\[pageIndex\]/,
    'v1 must resolve C1 from author source instead of the uploaded DSF page URLs');
assert.match(v1ThumbnailResolverSource, /return _renderSectionPublicationThumbnail\(section, defaultLanguage, pageIndex, pages\)/,
    'v1 must generate a dedicated listing WebP from the C1 source and default language');
assert.doesNotMatch(v1ThumbnailResolverSource, /\.urls|normalizeHttpsUrl/,
    'v1 listing thumbnail resolution must not reuse a full Release body WebP URL');
assert.match(pressSource, /const thumbnail = await _resolveV1ReleaseThumbnail\(pages, langs, customPublicationThumbnail\)/,
    'v1 must await the custom image or dedicated C1 listing thumbnail before metadata writes');

assert.match(
    draftSource,
    /const projectFields = \{[\s\S]*?\n\s*thumbnail,[\s\S]*?\n\s*dsfPages:/,
    'Flow draft Project metadata must carry the release thumbnail snapshot',
);
assert.match(
    draftSource,
    /workPatch: \{[\s\S]*?\n\s*thumbnail,[\s\S]*?\n\s*languages:/,
    'Flow draft Work metadata must carry the release thumbnail snapshot',
);
assert.match(
    draftSource,
    /releaseDocument: \{[\s\S]*?\n\s*thumbnail,[\s\S]*?\n\s*dsfPages:/,
    'Flow draft Release metadata must carry the immutable release thumbnail snapshot',
);
assert.match(worksTransitionSource, /selectProjectListingThumbnail\(project, \{ release \}\)/,
    'the public index must use the immutable Release thumbnail before Project preferences');

console.log('Publication title/thumbnail integration verification passed.');
