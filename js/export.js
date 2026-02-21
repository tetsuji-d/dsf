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

    // 4. Generate ZIP ArrayBuffer
    const content = await zip.generateAsync({ type: "blob" });

    // 5. Trigger Download
    const filename = `${meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'project'}.dsp`;
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

    // 4. Generate ZIP ArrayBuffer
    const content = await zip.generateAsync({ type: "blob" });

    // 5. Trigger Download
    const filename = `${meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'comic'}.dsf`;
    saveAs(content, filename);
}
