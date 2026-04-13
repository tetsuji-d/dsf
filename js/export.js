import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { state } from './state.js';
import { blocksToPages } from './pages.js';
import { fetchAssetBlob, guessAssetExtension, shouldEmbedAsset } from './asset-fetch.js';
import {
    CANONICAL_PAGE_WIDTH,
    CANONICAL_PAGE_HEIGHT,
    META_PRESENTATION_ASPECT_RATIO
} from './page-geometry.js';

// --- Common Metadata Builder ---
function buildMetadata(formatStr) {
    const generator = "DSF Studio Pro v1.2";
    const dateStr = new Date().toISOString();
    return {
        version: "1.0.0",
        schemaVersion: 1,
        format: formatStr, // "dsp" or "dsf"
        title: state.title || "Untitled",
        author: state.user?.email || "Unknown Author",
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

    const projectData = {
        projectId: state.projectId,
        projectName: state.projectName || '',
        languageConfigs: state.languageConfigs,
        uiPrefs: state.uiPrefs,
        sections: exportSections,
        blocks: exportBlocks,
        pages: blocksToPages(exportBlocks) // Generate derived pages locally
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
    const zip = new JSZip();

    // 1. Mimetype
    zip.file("mimetype", "application/vnd.dsf.content+zip");

    // 2. Metadata
    const meta = buildMetadata("dsf");
    zip.file("meta.json", JSON.stringify(meta, null, 2));

    const assetsFolder = zip.folder("assets");
    const imagesFolder = assetsFolder.folder("images");
    const hasPublishedPages = Array.isArray(state.dsfPages) && state.dsfPages.length > 0;
    let exportPages = [];
    let exportDsfPages = [];

    if (hasPublishedPages) {
        exportDsfPages = JSON.parse(JSON.stringify(state.dsfPages));
        exportPages = exportDsfPages.map((page, index) => ({
            id: `dsf_${page.pageNum || index + 1}`,
            content: {
                backgrounds: { ...(page.urls || {}) },
                thumbnail: '',
                bubbles: {}
            }
        }));

        for (let pageIndex = 0; pageIndex < exportDsfPages.length; pageIndex++) {
            const dsfPage = exportDsfPages[pageIndex];
            const page = exportPages[pageIndex];
            const urlEntries = Object.entries(dsfPage.urls || {});
            for (const [lang, bgUrl] of urlEntries) {
                if (!shouldEmbedAsset(bgUrl)) continue;
                const blob = await fetchAssetBlob(bgUrl, `配信ページ ${pageIndex + 1} (${lang}) の背景画像`);
                const ext = guessAssetExtension(bgUrl);
                const filename = `page_${String(pageIndex + 1).padStart(3, '0')}_${lang}.${ext}`;
                const assetPath = `assets/images/${filename}`;
                imagesFolder.file(filename, blob);
                dsfPage.urls[lang] = assetPath;
                page.content.backgrounds[lang] = assetPath;
            }
        }
    } else {
        // Fallback: package the current editor pages when no published DSF exists yet.
        const pagesList = blocksToPages(state.blocks || []);
        exportPages = JSON.parse(JSON.stringify(pagesList));

        for (let pageIndex = 0; pageIndex < exportPages.length; pageIndex++) {
            const page = exportPages[pageIndex];
            const backgrounds = { ...(page.content?.backgrounds || {}) };
            if (!Object.keys(backgrounds).length && page.content?.background) {
                const fallbackLang = state.defaultLang || state.activeLang || 'ja';
                backgrounds[fallbackLang] = page.content.background;
            }

            const exportedBackgrounds = {};
            for (const [lang, bgUrl] of Object.entries(backgrounds)) {
                if (!shouldEmbedAsset(bgUrl)) continue;
                const blob = await fetchAssetBlob(bgUrl, `配信ページ ${pageIndex + 1} (${lang}) の背景画像`);
                const ext = guessAssetExtension(bgUrl);
                const filename = `page_${String(pageIndex + 1).padStart(3, '0')}_${lang}.${ext}`;
                const assetPath = `assets/images/${filename}`;
                imagesFolder.file(filename, blob);
                exportedBackgrounds[lang] = assetPath;
            }

            if (!page.content) page.content = {};
            page.content.backgrounds = exportedBackgrounds;
            if (page.content.background) {
                const fallbackLang = state.defaultLang || state.activeLang || 'ja';
                page.content.background = exportedBackgrounds[fallbackLang] || Object.values(exportedBackgrounds)[0] || '';
            }

            exportDsfPages.push({
                pageNum: pageIndex + 1,
                pageType: page.pageType || 'normal_image',
                urls: { ...exportedBackgrounds },
            });
        }
    }

    const contentData = {
        dsfPages: exportDsfPages,
        pages: exportPages
    };

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

    // 5. Generate ZIP ArrayBuffer
    const content = await zip.generateAsync({ type: "blob" });

    // 6. Trigger Download
    saveAs(content, filename);
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
        projectName: projectData.projectName || '',
        title: meta.title || "Untitled",
        languages: meta.languages || ["ja"],
        languageConfigs: projectData.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        uiPrefs: projectData.uiPrefs || null,
        sections: projectData.sections || [],
        blocks: projectData.blocks || []
    };
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
    if (contentData.pages) {
        for (const page of contentData.pages) {
            if (page.background && assetMap.has(page.background)) {
                page.background = assetMap.get(page.background);
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

    return {
        projectId: contentData.projectId || "local_import",
        title: meta.title || "Untitled",
        languageConfigs: contentData.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        languages: meta.languages || ["ja"],
        defaultLang: meta.defaultLang || "ja",
        dsfPages: contentData.dsfPages || [],
        pages: contentData.pages || []
    };
}
