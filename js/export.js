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

function buildMetadata(formatStr) {
    const generator = "DSF Studio v1.2";
    const dateStr = new Date().toISOString();
    const localizedMeta = state.meta || {};
    const linerNotes = pickLocalizedMetaMap('linerNotes');
    return {
        version: "1.0.0",
        schemaVersion: 1,
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

    // 2. Metadata
    const meta = buildMetadata("dsp");
    zip.file("meta.json", JSON.stringify(meta, null, 2));

    // 3. Project Data Dump
    // Clone sections and blocks to modify image paths without mutating global state
    const exportSections = JSON.parse(JSON.stringify(state.sections || []));
    const exportBlocks = JSON.parse(JSON.stringify(state.blocks || []));

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

    // Replace image paths in block backgrounds too if applicable
    let blockImgIndex = 0;
    for (const block of exportBlocks) {
        if (block.type === 'image' && shouldEmbedAsset(block.background)) {
            const blob = await fetchAssetBlob(block.background, `画像ブロック ${blockImgIndex + 1} の背景画像`);
            const ext = guessAssetExtension(block.background);
            const filename = `block_bg_${blockImgIndex}.${ext}`;
            originalsFolder.file(filename, blob);
            block.background = `assets/originals/${filename}`;
            blockImgIndex++;
        }
    }

    const projectPages = blocksToPages(exportBlocks);
    const book = buildFixedBookConfig(state.bookMode || state.book?.mode || 'simple', projectPages.length);
    const projectData = {
        projectId: state.projectId,
        workId: state.workId || '',
        releaseId: state.releaseId || null,
        projectName: state.projectName || '',
        title: state.title || '',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        meta: state.meta || {},
        languageConfigs: state.languageConfigs,
        uiPrefs: state.uiPrefs,
        bookMode: book.mode,
        book,
        sections: exportSections,
        blocks: exportBlocks,
        pages: projectPages // Generate derived pages locally
    };

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
                const blob = await renderPressSectionToWebP(section, lang, targetW, targetH);
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
            exportPages.push({
                id: `dsf_${pageIndex + 1}`,
                role: 'normal',
                bodyKind: section.type === 'text' ? 'text' : 'image',
                pageType,
                content: {
                    backgrounds: { ...exportedBackgrounds },
                    background: exportedBackgrounds[state.defaultLang] || Object.values(exportedBackgrounds)[0] || '',
                    thumbnail: '',
                    bubbles: {}
                }
            });

            exportDsfPages.push({
                pageNum: pageIndex + 1,
                pageType,
                urls: { ...exportedBackgrounds },
                bytesByLang: { ...bytesByLang },
                totalBytes: totalPageBytes,
            });
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

    // Replace paths in state objects
    if (projectData.sections) {
        for (const section of projectData.sections) {
            if (section.background && assetMap.has(section.background)) section.background = assetMap.get(section.background);
            if (section.thumbnail && assetMap.has(section.thumbnail)) section.thumbnail = assetMap.get(section.thumbnail);
        }
    }
    if (projectData.blocks) {
        for (const block of projectData.blocks) {
            if (block.type === 'image' && block.background && assetMap.has(block.background)) {
                block.background = assetMap.get(block.background);
            }
        }
    }

    return {
        projectId: projectData.projectId || "local_import",
        workId: projectData.workId || meta.workId || null,
        releaseId: projectData.releaseId || meta.releaseId || null,
        projectName: projectData.projectName || '',
        title: meta.title || "Untitled",
        labelName: projectData.labelName || meta.labelName || '',
        rating: projectData.rating || meta.rating || 'all',
        license: projectData.license || meta.license || 'all-rights-reserved',
        meta: projectData.meta || meta.meta || {},
        languages: meta.languages || ["ja"],
        languageConfigs: projectData.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        uiPrefs: projectData.uiPrefs || null,
        bookMode: projectData.bookMode || projectData.book?.mode || 'simple',
        book: projectData.book || null,
        sections: projectData.sections || [],
        blocks: projectData.blocks || []
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
