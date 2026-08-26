import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { state } from './state.js';
import { blocksToPages } from './pages.js';
import { fetchAssetBlob, guessAssetExtension, shouldEmbedAsset } from './asset-fetch.js';
import {
    getRenderablePressPages,
    getSelectedPressLangs,
    getPressQualityProfile,
    getPressBookConfigForExport,
    getPressBookCompositionIssueMessages,
    getPressSpreadImageDsfMetadata,
    getFlowPortableDsfDownloadArtifact,
    renderPressSectionToWebP,
    resetPressRenderCancel,
    requestPressRenderCancel,
    throwIfPressRenderCancelled
} from './press.js';
import {
    CANONICAL_PAGE_WIDTH,
    CANONICAL_PAGE_HEIGHT,
    META_PRESENTATION_ASPECT_RATIO,
    getPressResolutionDims,
    resolvePressResolutionKey,
    clampPressPublishResolutionKey
} from './page-geometry.js';
import { normalizeBookSettings } from './page-labels.js';
import { hasFlowGroups } from './flow-project-model.js';
import {
    DSP_FLOW_META_SCHEMA_VERSION,
    applyDspMetadataFallbacks,
    assertSupportedDspEnvelope,
    hydrateProjectFromPersistence,
    prepareProjectForSave,
} from './project-persistence.js';

// --- Common Metadata Builder ---
function pickLocalizedMeta(key) {
    const langs = Array.isArray(state.languages) && state.languages.length ? state.languages : ['ja'];
    const defaultLang = state.defaultLang || langs[0] || 'ja';
    const value = state.meta?.[defaultLang]?.[key];
    if (value) return value;
    for (const lang of langs) {
        const next = state.meta?.[lang]?.[key];
        if (next) return next;
    }
    return '';
}

function pickLocalizedMetaMap(key) {
    const out = {};
    const source = state.meta || {};
    Object.entries(source).forEach(([lang, meta]) => {
        const value = meta?.[key];
        if (value) out[lang] = value;
    });
    return out;
}

function buildMetadata(formatStr, options = {}) {
    const generator = "DSF Studio v1.2";
    const dateStr = new Date().toISOString();
    const localizedMeta = state.meta || {};
    const linerNotes = pickLocalizedMetaMap('linerNotes');
    return {
        version: "1.0.0",
        schemaVersion: formatStr === 'dsp' && options.projectVersion === 6
            ? DSP_FLOW_META_SCHEMA_VERSION
            : 1,
        projectVersion: formatStr === 'dsp' ? (options.projectVersion || 5) : undefined,
        format: formatStr, // "dsp" or "dsf"
        projectId: state.projectId || "",
        workId: state.workId || "",
        releaseId: state.releaseId || "",
        title: state.title || pickLocalizedMeta('title') || "Untitled",
        author: pickLocalizedMeta('author') || state.user?.email || "Unknown Author",
        labelName: state.labelName || "",
        rating: state.rating || "all",
        license: state.license || "all-rights-reserved",
        meta: localizedMeta,
        linerNotes,
        languages: state.languages || ["ja"],
        defaultLang: state.defaultLang || "ja",
        created: state.created ? new Date(state.created).toISOString() : dateStr,
        modified: dateStr,
        generator: generator,
        presentation: {
            orientation: "portrait",
            aspectRatio: META_PRESENTATION_ASPECT_RATIO,
            spread: "auto",
            canonicalLogicalWidth: CANONICAL_PAGE_WIDTH,
            canonicalLogicalHeight: CANONICAL_PAGE_HEIGHT
        }
    };
}

// --- Build .dsp (Project Archive) ---
export async function buildDSP() {
    const zip = new JSZip();

    // 1. Mimetype
    zip.file("mimetype", "application/vnd.dsf.project+zip");

    // 2. Project Data Dump. The authoring snapshot is validated before any
    // archive work; Flow-generated pages are never part of this value.
    const initialProject = prepareProjectForSave({
        version: state.version || 5,
        projectId: state.projectId,
        workId: state.workId || '',
        releaseId: state.releaseId || null,
        projectName: state.projectName || '',
        title: state.title || '',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        textPaperPreset: state.textPaperPreset || 'white',
        meta: state.meta || {},
        languages: state.languages || ['ja'],
        defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
        languageConfigs: state.languageConfigs || {},
        uiPrefs: state.uiPrefs || null,
        bookMode: state.bookMode || state.book?.mode || 'simple',
        book: state.book || null,
        sections: state.sections || [],
        blocks: state.blocks || [],
        pages: state.pages || [],
    });
    const exportSections = JSON.parse(JSON.stringify(initialProject.sections || []));

    // Download images and modify paths
    const assetsFolder = zip.folder("assets");
    const originalsFolder = assetsFolder.folder("originals");
    const thumbsFolder = assetsFolder.folder("thumbs");

    let imgIndex = 0;

    for (const section of exportSections) {
        if (shouldEmbedAsset(section.background)) {
            const blob = await fetchAssetBlob(section.background, `ページ ${imgIndex + 1} の背景画像`);
            const ext = guessAssetExtension(section.background);
            const filename = `bg_${imgIndex}.${ext}`;
            originalsFolder.file(filename, blob);
            section.background = `assets/originals/${filename}`;
        }
        if (shouldEmbedAsset(section.thumbnail)) {
            const blob = await fetchAssetBlob(section.thumbnail, `ページ ${imgIndex + 1} のサムネイル`);
            const ext = guessAssetExtension(section.thumbnail);
            const filename = `thumb_${imgIndex}.${ext}`;
            thumbsFolder.file(filename, blob);
            section.thumbnail = `assets/thumbs/${filename}`;
        }
        imgIndex++;
    }

    // Reconcile the rewritten Fixed asset paths back into the opaque mixed
    // spine while preserving Flow groups and Fixed extension fields.
    const withArchiveAssets = prepareProjectForSave({
        ...initialProject,
        sections: exportSections,
    });
    const book = buildFixedBookConfig(
        withArchiveAssets.bookMode || withArchiveAssets.book?.mode || 'simple',
        withArchiveAssets.pages.length,
    );
    const projectData = prepareProjectForSave({
        ...withArchiveAssets,
        bookMode: book.mode,
        book,
    });

    // 3. Metadata. DSP schema v2 identifies Project v6 authoring archives;
    // published DSF metadata remains schema v1.
    const meta = buildMetadata('dsp', { projectVersion: projectData.version });
    zip.file('meta.json', JSON.stringify(meta, null, 2));

    zip.file("project.json", JSON.stringify(projectData, null, 2));

    // 4. Determine Filename
    const safeTitle = (meta.title || 'project').replace(/[\\/:*?"<>|]/g, '_');
    const defaultFilename = `${safeTitle}.dsp`;
    let filename = prompt("保存するファイル名を入力してください:", defaultFilename);

    if (filename === null) {
        return; // User cancelled
    }
    if (!filename.trim()) {
        filename = defaultFilename;
    } else if (!filename.toLowerCase().endsWith('.dsp')) {
        filename += '.dsp';
    }

    // 5. Generate ZIP ArrayBuffer
    const content = await zip.generateAsync({ type: "blob" });

    // 6. Trigger Download
    saveAs(content, filename);
}

// --- Build .dsf (Content/Publish Archive) ---
export async function buildDSF() {
    if (hasFlowGroups(state)) {
        const artifact = getFlowPortableDsfDownloadArtifact();
        const currentArtifact = getFlowPortableDsfDownloadArtifact();
        if (currentArtifact.packageSignature !== artifact.packageSignature
            || currentArtifact.sha256 !== artifact.sha256
            || currentArtifact.byteLength !== artifact.byteLength
            || currentArtifact.blob !== artifact.blob) {
            const error = new Error('Flow portable DSF changed before download. Run the Press verification again.');
            error.code = 'FLOW_PORTABLE_DOWNLOAD_STALE';
            throw error;
        }
        saveAs(currentArtifact.blob, currentArtifact.filename);
        return;
    }
    resetPressRenderCancel();
    const onEscKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            requestPressRenderCancel();
        }
    };
    window.addEventListener('keydown', onEscKey, true);
    try {
        const zip = new JSZip();

        // 1. Mimetype
        zip.file("mimetype", "application/vnd.dsf.content+zip");

        // 2. Metadata
        const meta = buildMetadata("dsf");
        zip.file("meta.json", JSON.stringify(meta, null, 2));

        const assetsFolder = zip.folder("assets");
        const imagesFolder = assetsFolder.folder("images");
        let exportPages = [];
        let exportDsfPages = [];

        const rawResKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value || '1080x1920');
        const exportResKey = clampPressPublishResolutionKey(rawResKey);
        const { width: targetW, height: targetH } = getPressResolutionDims(exportResKey);
        const langs = getSelectedPressLangs();
        const pages = getRenderablePressPages();
        const qualityProfile = getPressQualityProfile(exportResKey);

        if (!pages.length) {
            throw new Error('DSF に書き出すページがありません。');
        }
        const compositionMessages = getPressBookCompositionIssueMessages();
        if (compositionMessages.length) {
            throw new Error(compositionMessages.join('\n'));
        }

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            throwIfPressRenderCancelled();
            const section = pages[pageIndex];
            const exportedBackgrounds = {};
            const bytesByLang = {};
            let totalPageBytes = 0;

            for (const lang of langs) {
                throwIfPressRenderCancelled();
                const blob = await renderPressSectionToWebP(section, lang, targetW, targetH, pageIndex, pages);
                if (!blob) continue;
                const filename = `page_${String(pageIndex + 1).padStart(3, '0')}_${lang}.webp`;
                const assetPath = `assets/images/${filename}`;
                imagesFolder.file(filename, blob);
                exportedBackgrounds[lang] = assetPath;
                bytesByLang[lang] = blob.size;
                totalPageBytes += blob.size;
            }

            if (!Object.keys(exportedBackgrounds).length) {
                continue;
            }

            const pageType = section.type === 'text' ? 'normal_text' : 'normal_image';
            const spreadImage = getPressSpreadImageDsfMetadata(section, pageIndex, langs, pages);
            const exportPageContent = {
                backgrounds: { ...exportedBackgrounds },
                background: exportedBackgrounds[state.defaultLang] || Object.values(exportedBackgrounds)[0] || '',
                thumbnail: '',
                bubbles: {}
            };
            if (spreadImage) exportPageContent.spreadImage = spreadImage;
            const exportPage = {
                id: `dsf_${pageIndex + 1}`,
                role: 'normal',
                bodyKind: section.type === 'text' ? 'text' : 'image',
                pageType,
                content: exportPageContent
            };
            if (spreadImage) exportPage.spreadImage = spreadImage;
            exportPages.push({
                ...exportPage
            });

            const dsfPage = {
                pageNum: pageIndex + 1,
                pageType,
                urls: { ...exportedBackgrounds },
                bytesByLang: { ...bytesByLang },
                totalBytes: totalPageBytes,
            };
            if (spreadImage) dsfPage.spreadImage = spreadImage;
            exportDsfPages.push(dsfPage);
        }

        if (!exportDsfPages.length) {
            throw new Error('選択した言語に DSF 書き出し可能なページがありません。');
        }

        const contentData = {
            dsfPages: exportDsfPages,
            projectId: state.projectId || '',
            workId: state.workId || '',
            releaseId: state.releaseId || '',
            pages: exportPages,
            resolution: exportResKey,
            qualityMode: 'auto',
            qualityProfile: {
                image: Math.round(qualityProfile.image * 100),
                text: Math.round(qualityProfile.text * 100)
            },
            labelName: state.labelName || '',
            rating: state.rating || 'all',
            license: state.license || 'all-rights-reserved',
            meta: state.meta || {},
            languages: langs
        };
        Object.assign(contentData, getPressBookConfigForExport(exportDsfPages.length));

        zip.file("content.json", JSON.stringify(contentData, null, 2));

        // 4. Determine Filename
        const safeTitle = (meta.title || 'comic').replace(/[\\/:*?"<>|]/g, '_');
        const defaultFilename = `${safeTitle}.dsf`;
        let filename = prompt("配信データのエクスポート名を入力してください:", defaultFilename);

        if (filename === null) {
            return; // User cancelled
        }
        if (!filename.trim()) {
            filename = defaultFilename;
        } else if (!filename.toLowerCase().endsWith('.dsf')) {
            filename += '.dsf';
        }

        throwIfPressRenderCancelled();

        // 5. Generate ZIP ArrayBuffer
        const content = await zip.generateAsync({ type: "blob" });

        // 6. Trigger Download
        saveAs(content, filename);
    } finally {
        window.removeEventListener('keydown', onEscKey, true);
        resetPressRenderCancel();
    }
}

// --- Parse .dsp (Project Import) ---
export async function parseAndLoadDSP(file) {
    const zip = await JSZip.loadAsync(file);

    // Read meta.json
    const metaFile = zip.file("meta.json");
    if (!metaFile) throw new Error("Invalid .dsp file: meta.json missing");
    const metaStr = await metaFile.async("text");
    const meta = JSON.parse(metaStr);
    if (meta.format !== "dsp") throw new Error("Invalid format: not a .dsp file");

    // Read project.json
    const projectFile = zip.file("project.json");
    if (!projectFile) throw new Error("Invalid .dsp file: project.json missing");
    const projectStr = await projectFile.async("text");
    const projectData = JSON.parse(projectStr);
    // DSP v1 stored language metadata only in meta.json. Apply those values
    // before normalization so the v5 default ['ja'] does not mask translations.
    const projectWithMetaFallbacks = applyDspMetadataFallbacks(projectData, meta);
    const normalizedProject = hydrateProjectFromPersistence(projectWithMetaFallbacks);
    assertSupportedDspEnvelope(meta, normalizedProject.version);

    // Reconstruct Object URLs for assets
    const assetMap = new Map();
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir && relativePath.startsWith("assets/")) {
            // Determine Mime Type
            const ext = relativePath.split('.').pop().toLowerCase();
            let mime = "image/webp";
            if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
            else if (ext === "png") mime = "image/png";
            else if (ext === "gif") mime = "image/gif";

            // Generate Local Object URL
            const blob = await zipEntry.async("blob");
            const typedBlob = new Blob([blob], { type: mime });
            const url = URL.createObjectURL(typedBlob);
            assetMap.set(relativePath, url);
        }
    }

    const replaceAssetReferences = (value) => {
        if (Array.isArray(value)) return value.map(replaceAssetReferences);
        if (!value || typeof value !== 'object') return value;
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if ((key === 'background' || key === 'thumbnail') && typeof entry === 'string') {
                out[key] = assetMap.get(entry) || entry;
            } else if (key === 'backgrounds' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
                out[key] = Object.fromEntries(Object.entries(entry).map(([lang, url]) => [
                    lang,
                    typeof url === 'string' ? (assetMap.get(url) || url) : url,
                ]));
            } else {
                out[key] = replaceAssetReferences(entry);
            }
        }
        return out;
    };

    const restoredProject = hydrateProjectFromPersistence(replaceAssetReferences(normalizedProject));
    return {
        ...restoredProject,
        projectId: restoredProject.projectId || 'local_import',
        workId: restoredProject.workId || meta.workId || null,
        releaseId: restoredProject.releaseId || meta.releaseId || null,
        projectName: restoredProject.projectName || '',
        title: restoredProject.title || meta.title || 'Untitled',
        labelName: restoredProject.labelName || meta.labelName || '',
        rating: restoredProject.rating || meta.rating || 'all',
        license: restoredProject.license || meta.license || 'all-rights-reserved',
        meta: restoredProject.meta || meta.meta || {},
        languages: restoredProject.languages || meta.languages || ['ja'],
        defaultLang: restoredProject.defaultLang || meta.defaultLang || meta.languages?.[0] || 'ja',
        languageConfigs: restoredProject.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        uiPrefs: restoredProject.uiPrefs || null,
        bookMode: restoredProject.bookMode || restoredProject.book?.mode || 'simple',
        book: restoredProject.book || null,
    };
}

function buildFixedBookConfig(mode, pageCount) {
    return normalizeBookSettings({ mode }, mode, pageCount);
}

// --- Parse .dsf (Content/Publish Import) ---
export async function parseAndLoadDSF(file) {
    const zip = await JSZip.loadAsync(file);

    // Read meta.json
    const metaFile = zip.file("meta.json");
    if (!metaFile) throw new Error("Invalid .dsf/.dsp file: meta.json missing");
    const metaStr = await metaFile.async("text");
    const meta = JSON.parse(metaStr);

    // Read content.json (DSF) or fallback to project.json (DSP)
    let contentData = null;
    const contentFile = zip.file("content.json");
    if (contentFile) {
        const contentStr = await contentFile.async("text");
        contentData = JSON.parse(contentStr);
    } else {
        const projectFile = zip.file("project.json");
        if (projectFile) {
            const projectStr = await projectFile.async("text");
            contentData = JSON.parse(projectStr);
        } else {
            throw new Error("Invalid file: missing content.json or project.json");
        }
    }

    // Reconstruct Object URLs for assets
    const assetMap = new Map();
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (!zipEntry.dir && relativePath.startsWith("assets/")) {
            // Determine Mime Type
            const ext = relativePath.split('.').pop().toLowerCase();
            let mime = "image/webp";
            if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
            else if (ext === "png") mime = "image/png";
            else if (ext === "gif") mime = "image/gif";

            // Generate Local Object URL
            const blob = await zipEntry.async("blob");
            const typedBlob = new Blob([blob], { type: mime });
            const url = URL.createObjectURL(typedBlob);
            assetMap.set(relativePath, url);
        }
    }

    // Replace paths in pages
    const replacePageAssetPaths = (page) => {
        if (!page || typeof page !== 'object') return;
        if (page.background && assetMap.has(page.background)) {
            page.background = assetMap.get(page.background);
        }
        if (page.url && assetMap.has(page.url)) {
            page.url = assetMap.get(page.url);
        }
        if (page.src && assetMap.has(page.src)) {
            page.src = assetMap.get(page.src);
        }
        if (page.data && page.data.background && assetMap.has(page.data.background)) {
            page.data.background = assetMap.get(page.data.background);
        }
        if (page.content?.background && assetMap.has(page.content.background)) {
            page.content.background = assetMap.get(page.content.background);
        }
        if (page.content?.backgrounds && typeof page.content.backgrounds === 'object') {
            for (const [lang, path] of Object.entries(page.content.backgrounds)) {
                if (assetMap.has(path)) {
                    page.content.backgrounds[lang] = assetMap.get(path);
                }
            }
        }
        if (page.backgrounds && typeof page.backgrounds === 'object') {
            for (const [lang, path] of Object.entries(page.backgrounds)) {
                if (assetMap.has(path)) {
                    page.backgrounds[lang] = assetMap.get(path);
                }
            }
        }
        if (page.urls && typeof page.urls === 'object') {
            for (const [lang, path] of Object.entries(page.urls)) {
                if (assetMap.has(path)) {
                    page.urls[lang] = assetMap.get(path);
                }
            }
        }
    };

    if (contentData.pages) {
        for (const page of contentData.pages) {
            replacePageAssetPaths(page);
        }
    }

    if (contentData.dsfPages) {
        for (const page of contentData.dsfPages) {
            if (!page.urls || typeof page.urls !== 'object') continue;
            for (const [lang, path] of Object.entries(page.urls)) {
                if (assetMap.has(path)) {
                    page.urls[lang] = assetMap.get(path);
                }
            }
        }
    }

    const covers = contentData.book?.covers || contentData.covers;
    if (covers && typeof covers === 'object') {
        for (const [key, cover] of Object.entries(covers)) {
            if (typeof cover === 'string' && assetMap.has(cover)) {
                covers[key] = assetMap.get(cover);
            } else if (Array.isArray(cover)) {
                cover.forEach(replacePageAssetPaths);
            } else {
                replacePageAssetPaths(cover);
            }
        }
    }

    return {
        projectId: contentData.projectId || "local_import",
        workId: contentData.workId || meta.workId || null,
        releaseId: contentData.releaseId || meta.releaseId || null,
        title: meta.title || "Untitled",
        labelName: contentData.labelName || meta.labelName || '',
        rating: contentData.rating || meta.rating || 'all',
        license: contentData.license || meta.license || 'all-rights-reserved',
        meta: contentData.meta || meta.meta || {},
        languageConfigs: contentData.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        languages: meta.languages || ["ja"],
        defaultLang: meta.defaultLang || "ja",
        dsfPages: contentData.dsfPages || [],
        pages: contentData.pages || [],
        bookMode: contentData.bookMode || meta.bookMode || contentData.book?.mode || '',
        book: contentData.book || meta.book || null,
        covers: contentData.covers || meta.covers || null
    };
}
