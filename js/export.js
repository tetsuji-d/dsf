import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { state } from './state.js';
import { blocksToPages } from './pages.js';

// --- Utility: Get Blob from URL ---
async function fetchImageBlob(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.blob();
    } catch (e) {
        console.warn(`[DSF] Failed to fetch image blob: ${url}`, e);
        return null; // Return null if fetching fails (e.g. CORS issues for external non-firebase URLs)
    }
}

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
            aspectRatio: "9:16",
            spread: "auto"
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
        if (section.background && section.background.startsWith("http")) {
            const blob = await fetchImageBlob(section.background);
            if (blob) {
                const ext = section.background.split('?')[0].split('.').pop() || "webp"; // Best guess extension
                const filename = `bg_${imgIndex}.${ext}`;
                originalsFolder.file(filename, blob);
                section.background = `assets/originals/${filename}`;
            }
        }
        if (section.thumbnail && section.thumbnail.startsWith("http")) {
            const blob = await fetchImageBlob(section.thumbnail);
            if (blob) {
                const ext = section.thumbnail.split('?')[0].split('.').pop() || "webp";
                const filename = `thumb_${imgIndex}.${ext}`;
                thumbsFolder.file(filename, blob);
                section.thumbnail = `assets/thumbs/${filename}`;
            }
        }
        imgIndex++;
    }

    // Replace image paths in block backgrounds too if applicable
    let blockImgIndex = 0;
    for (const block of exportBlocks) {
        if (block.type === 'image' && block.background && block.background.startsWith("http")) {
            const blob = await fetchImageBlob(block.background);
            if (blob) {
                const ext = block.background.split('?')[0].split('.').pop() || "webp";
                const filename = `block_bg_${blockImgIndex}.${ext}`;
                originalsFolder.file(filename, blob);
                block.background = `assets/originals/${filename}`;
            }
            blockImgIndex++;
        }
    }

    const projectData = {
        projectId: state.projectId,
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

    // 3. Content Data (Flattened Pages)
    // We only care about pages for DSF, sections and blocks are stripped out
    const pagesList = blocksToPages(state.blocks || []);
    const exportPages = JSON.parse(JSON.stringify(pagesList));

    const assetsFolder = zip.folder("assets");
    const imagesFolder = assetsFolder.folder("images");

    let imgIndex = 0;

    for (const page of exportPages) {
        if (page.type === 'image') {
            // Check page.background or look inside page.assets if refactored
            let bgUrl = page.background;

            // Just for robustness depending on how blocksToPages maps the background
            if (!bgUrl && page.data && page.data.background) {
                bgUrl = page.data.background;
            }

            if (bgUrl && bgUrl.startsWith("http")) {
                const blob = await fetchImageBlob(bgUrl);
                if (blob) {
                    const ext = bgUrl.split('?')[0].split('.').pop() || "webp";
                    const filename = `page_${imgIndex}.${ext}`;
                    imagesFolder.file(filename, blob);
                    page.background = `assets/images/${filename}`; // Or page.assets = { image: "..." }
                    if (page.data) page.data.background = `assets/images/${filename}`;
                }
            }
        }
        imgIndex++;
    }

    const contentData = {
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
        title: meta.title || "Untitled",
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
        }
    }

    return {
        projectId: contentData.projectId || "local_import",
        title: meta.title || "Untitled",
        languageConfigs: contentData.languageConfigs || { ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' } },
        languages: meta.languages || ["ja"],
        defaultLang: meta.defaultLang || "ja",
        pages: contentData.pages || []
    };
}
