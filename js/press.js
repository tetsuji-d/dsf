/**
 * press.js — Press Room ロジック
 * DSP → DSF レンダリング・R2アップロード・Firestore発行
 */
import {
    doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state } from './state.js';
import { db, uploadPressPage } from './firebase.js';

// ─── Press Room 入室 ─────────────────────────────────────────────────────────

/** Press Room に入ったときにページサムネイルと言語タブを描画する */
export function enterPressRoom() {
    _renderPageThumbs();
    _renderLangTabs();
    _updatePublishBtn();
    _updateSizeEstimate();
    // 解像度・品質変更時に予想容量を更新
    document.getElementById('press-resolution')?.addEventListener('change', _updateSizeEstimate);
    document.getElementById('press-quality')?.addEventListener('input', _updateSizeEstimate);
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
        const thumb = section.thumbnail
            || section.backgrounds?.[lang]
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

function _updateSizeEstimate() {
    const el = document.getElementById('press-size-estimate');
    if (!el) return;
    const resStr = document.getElementById('press-resolution')?.value || '1080x1920';
    const quality = parseInt(document.getElementById('press-quality')?.value || '85') / 100;
    const [w, h] = resStr.split('x').map(Number);
    const pages = _getRenderablePages();
    const langCount = (state.languages || ['ja']).length;
    // WebP の推定: ピクセル数 × 品質係数 × 圧縮比（経験値）
    // 写真系 WebP は品質85%で約 0.5〜1.5 bytes/pixel、平均 0.8 として計算
    const bytesPerPixel = 0.3 + quality * 0.7; // 品質0→0.3, 品質1→1.0
    const perPage = w * h * bytesPerPixel;
    const totalBytes = perPage * pages.length * langCount;
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    el.textContent = `≈ ${totalMB} MB`;
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
    const resStr  = document.getElementById('press-resolution')?.value || '1080x1920';
    const [targetW, targetH] = resStr.split('x').map(Number);

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

    setProgress('準備中...');

    try {
        const dsfPages = [];
        let pageNum = 0;
        let totalBytes = 0;
        const total = pages.length * langs.length;
        let done = 0;

        for (const section of pages) {
            pageNum++;
            const langUrls = {};

            for (const lang of langs) {
                const bgUrl = section.backgrounds?.[lang] || section.background;
                if (!bgUrl) continue;

                setProgress(`レンダリング中 ${++done}/${total}`);

                const blob = await _renderPageToWebP(
                    bgUrl, section.imagePosition, targetW, targetH, quality
                );
                totalBytes += blob.size;

                const path = `users/${state.uid}/dsf/${state.projectId}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
            }

            dsfPages.push({
                pageNum,
                pageType: 'normal_image',
                urls: langUrls,
            });
        }

        setProgress('Firestoreに保存中...');

        // Firestoreに DSF メタデータを保存
        await setDoc(
            doc(db, 'users', state.uid, 'projects', state.projectId),
            {
                dsfPages,
                dsfStatus:      'draft',
                dsfPublishedAt: serverTimestamp(),
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
    // fetch で Blob 取得 → objectURL 経由で描画（Canvas CORS taint を回避）
    const res = await fetch(bgUrl);
    if (!res.ok) throw new Error(`画像取得失敗: ${res.status} ${bgUrl}`);
    const imgBlob = await res.blob();
    const objectUrl = URL.createObjectURL(imgBlob);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload  = resolve;
        img.onerror = () => reject(new Error(`画像ロード失敗: ${bgUrl}`));
        img.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 基準フレームは 360×640。ターゲット解像度に合わせてスケール
    const baseW = 360;
    const ratio = targetW / baseW;

    const safePos = {
        x:        Number.isFinite(Number(pos?.x))        ? Number(pos.x)        : 0,
        y:        Number.isFinite(Number(pos?.y))        ? Number(pos.y)        : 0,
        scale:    Math.max(0.1, Number.isFinite(Number(pos?.scale))    ? Number(pos.scale)    : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
    };

    ctx.save();
    ctx.translate(targetW / 2, targetH / 2);
    ctx.translate(safePos.x * ratio, safePos.y * ratio);
    ctx.rotate((safePos.rotation * Math.PI) / 180);
    ctx.scale(safePos.scale, safePos.scale);

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
    URL.revokeObjectURL(objectUrl);

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
