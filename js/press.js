/**
 * press.js — Press Room ロジック
 * DSP → DSF レンダリング・R2アップロード・Firestore発行
 */
import {
    doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db, uploadPressPage } from './firebase.js';
import { loadImageForCanvas } from './asset-fetch.js';
import { t } from './i18n-studio.js';
import {
    CANONICAL_PAGE_WIDTH,
    getPressResolutionDims,
    resolvePressResolutionKey,
    clampPressPublishResolutionKey
} from './page-geometry.js';

let _estimateTimer = null;
let _estimateRunId = 0;

// ─── Press Room 入室 ─────────────────────────────────────────────────────────

/** Press Room に入ったときにページサムネイルと言語タブを描画する */
export function enterPressRoom() {
    _renderPageThumbs();
    _renderLangTabs();
    _updatePublishBtn();
    _queueSizeEstimate();
    document.getElementById('press-resolution')?.addEventListener('change', _queueSizeEstimate);
    document.getElementById('press-quality')?.addEventListener('input', _queueSizeEstimate);
}

function _renderPageThumbs() {
    const container = document.getElementById('press-page-thumbs');
    if (!container) return;

    const pages = _getRenderablePages();
    if (!pages.length) {
        container.innerHTML = '<p class="press-empty">ページがありません</p>';
        return;
    }

    container.innerHTML = pages.map((section, i) => {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumb = section.backgrounds?.[lang]
            || section.thumbnail
            || section.background
            || '';
        const label = String(i + 1);
        return `<div class="press-thumb-item">
            ${thumb
                ? `<img src="${_esc(thumb)}" alt="${label}" loading="lazy">`
                : `<div class="press-thumb-empty"><span class="material-icons">image</span></div>`}
            <div class="press-thumb-label">${label}</div>
        </div>`;
    }).join('');
}

function _renderLangTabs() {
    const container = document.getElementById('press-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-lang-tab ${code === (state.activeLang || langs[0]) ? 'active' : ''}"
            data-lang="${code}"
            onclick="togglePressLang('${code}')">${code.toUpperCase()}</button>`
    ).join('');
}

function _queueSizeEstimate() {
    clearTimeout(_estimateTimer);
    _estimateTimer = setTimeout(() => { _updateSizeEstimate(); }, 120);
}

function _getSelectedPressLangs() {
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    return selectedLangs.length ? selectedLangs : (state.languages || ['ja']);
}

async function _updateSizeEstimate() {
    const el = document.getElementById('press-size-estimate');
    if (!el) return;

    const runId = ++_estimateRunId;
    el.textContent = t('press_estimating_size');

    const resKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const { width: w, height: h } = getPressResolutionDims(resKey);
    const quality = parseInt(document.getElementById('press-quality')?.value || '85') / 100;
    const pages = _getRenderablePages();
    const langs = _getSelectedPressLangs();

    const tasks = [];
    for (const section of pages) {
        for (const lang of langs) {
            const bgUrl = section.backgrounds?.[lang] || section.background;
            if (!bgUrl) continue;
            tasks.push({
                section,
                lang,
                bgUrl,
                pos: section.imagePositions?.[lang] || section.imagePosition,
            });
        }
    }

    if (!tasks.length) {
        el.textContent = '≈ 0.0 MB';
        return;
    }

    const sampleCount = Math.min(4, tasks.length);
    const sampleTasks = [];
    if (tasks.length <= sampleCount) {
        sampleTasks.push(...tasks);
    } else {
        for (let i = 0; i < sampleCount; i++) {
            const index = Math.round((tasks.length - 1) * (i / (sampleCount - 1)));
            sampleTasks.push(tasks[index]);
        }
    }

    try {
        let totalSampleBytes = 0;
        for (const task of sampleTasks) {
            const blob = await _renderPageToWebP(task.bgUrl, task.pos, w, h, quality);
            totalSampleBytes += blob.size;
            if (runId !== _estimateRunId) return;
        }
        const avgBytes = totalSampleBytes / sampleTasks.length;
        const estimatedBytes = avgBytes * tasks.length;
        if (runId !== _estimateRunId) return;
        el.textContent = `≈ ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    } catch (err) {
        console.warn('[Press] size estimate failed:', err);
        if (runId !== _estimateRunId) return;
        el.textContent = '—';
    }
}

function _updatePublishBtn() {
    const btn = document.getElementById('press-publish-cloud-btn');
    if (!btn) return;
    btn.disabled = !state.uid;
    btn.title = state.uid ? '' : 'ログインが必要です';
}

/** Press Room の言語タブをトグル（複数選択可） */
window.togglePressLang = (code) => {
    const tab = document.querySelector(`.press-lang-tab[data-lang="${code}"]`);
    if (tab) tab.classList.toggle('active');
    _queueSizeEstimate();
};

// ─── レンダリング & 発行 ─────────────────────────────────────────────────────

/** Press Room の「クラウドに発行」ボタンから呼ばれる */
window.publishToCloud = async () => {
    if (!state.uid) {
        alert('ログインしてください');
        return;
    }
    if (!state.projectId) {
        alert('プロジェクトをクラウドに保存してから発行してください');
        return;
    }

    const pages = _getRenderablePages();
    if (!pages.length) {
        alert('レンダリングするページがありません');
        return;
    }

    // 設定取得
    const quality = parseInt(document.getElementById('press-quality')?.value || '85') / 100;
    const rawResKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const publishResKey = clampPressPublishResolutionKey(rawResKey);
    if (publishResKey !== rawResKey) {
        console.info('[Press] Publish resolution clamped to minimum publish size:', publishResKey, '(UI was', rawResKey + ')');
    }
    const { width: targetW, height: targetH } = getPressResolutionDims(publishResKey);
    const resStr = publishResKey;

    // 選択言語取得（アクティブなタブ）
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    const langs = selectedLangs.length ? selectedLangs : (state.languages || ['ja']);

    // プログレス表示
    const btn = document.getElementById('press-publish-cloud-btn');
    const origLabel = btn?.innerHTML;
    const setProgress = (msg) => {
        if (btn) btn.innerHTML = `<span class="material-icons">hourglass_top</span><span>${msg}</span>`;
    };
    const resetBtn = () => { if (btn && origLabel) btn.innerHTML = origLabel; };

    setProgress(t('press_preparing'));

    try {
        const dsfPages = [];
        let pageNum = 0;
        let totalBytes = 0;
        const total = pages.length * langs.length;
        let done = 0;
        const renderStamp = Date.now();

        for (const section of pages) {
            pageNum++;
            const langUrls = {};

            for (const lang of langs) {
                const bgUrl = section.backgrounds?.[lang] || section.background;
                if (!bgUrl) continue;

                done++;
                setProgress(t('press_rendering_progress', { done, total }));

                const blob = await _renderPageToWebP(
                    bgUrl, section.imagePositions?.[lang] || section.imagePosition, targetW, targetH, quality
                );
                totalBytes += blob.size;

                const path = `users/${state.uid}/dsf/${state.projectId}/${renderStamp}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
            }

            dsfPages.push({
                pageNum,
                pageType: 'normal_image',
                urls: langUrls,
            });
        }

        setProgress(t('press_saving_firestore'));

        // Firestoreに DSF メタデータを保存
        await setDoc(
            doc(db, 'users', state.uid, 'projects', state.projectId),
            {
                dsfPages,
                dsfStatus:      'draft',
                dsfPublishedAt: serverTimestamp(),
                dsfRenderStamp: renderStamp,
                dsfResolution:  resStr,
                dsfQuality:     Math.round(quality * 100),
                dsfLangs:       langs,
                dsfTotalBytes:  totalBytes,
            },
            { merge: true }
        );

        console.log(`[Press] Published ${dsfPages.length} pages → draft`);
        resetBtn();

        // Works Room へ遷移
        window.switchRoom('works');

    } catch (e) {
        console.error('[Press] publishToCloud error:', e);
        alert('発行中にエラーが発生しました:\n' + (e?.message || String(e)));
        resetBtn();
    }
};

// ─── レンダリング処理 ────────────────────────────────────────────────────────

async function _renderPageToWebP(bgUrl, pos, targetW, targetH, quality) {
    // Pages Functions 経由で画像を同一オリジン取得し、Canvas CORS taint を回避する
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 元画像');

    const canvas = document.createElement('canvas');
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 基準フレームは正規論理ページ（page-geometry）。ターゲット解像度に合わせてスケール
    const baseW = CANONICAL_PAGE_WIDTH;
    const ratio = targetW / baseW;

    const safePos = {
        x:        Number.isFinite(Number(pos?.x))        ? Number(pos.x)        : 0,
        y:        Number.isFinite(Number(pos?.y))        ? Number(pos.y)        : 0,
        scale:    Math.max(0.1, Number.isFinite(Number(pos?.scale))    ? Number(pos.scale)    : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX:    !!pos?.flipX,
    };

    ctx.save();
    ctx.translate(targetW / 2, targetH / 2);
    ctx.translate(safePos.x * ratio, safePos.y * ratio);
    ctx.rotate((safePos.rotation * Math.PI) / 180);
    ctx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    // object-fit: cover と同じ挙動
    const imgAspect   = img.width  / img.height;
    const frameAspect = targetW    / targetH;
    let drawW, drawH;
    if (imgAspect > frameAspect) {
        drawH = targetH;
        drawW = targetH * imgAspect;
    } else {
        drawW = targetW;
        drawH = targetW / imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    revoke();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('WebP 変換失敗（canvas.toBlob が null を返しました）');
    return blob;
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function _getRenderablePages() {
    return (state.sections || []).filter(s => s.type === 'image');
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
