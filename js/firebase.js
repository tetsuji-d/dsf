/**
 * firebase.js — Firebase初期化・クラウド保存/読込・自動保存
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { state } from './state.js';

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyBj3U-wFkNsWlW1d4OHayerECMIRyhQ40o",
    authDomain: "vmnn-26345.firebaseapp.com",
    projectId: "vmnn-26345",
    storageBucket: "vmnn-26345.firebasestorage.app",
    messagingSenderId: "16688261830",
    appId: "1:16688261830:web:c218463dd6429774eb3c77",
    measurementId: "G-N6J9C3XCVQ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// --- 自動保存 ---
let autoSaveTimer = null;
let saveStatus = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'

/**
 * 保存ステータスを更新してUIに反映する
 */
function updateSaveIndicator(status, message) {
    saveStatus = status;
    const el = document.getElementById('save-status');
    if (!el) return;

    const icons = { idle: '', saving: '💾', saved: '✓', error: '⚠' };
    const colors = { idle: '#999', saving: '#f0ad4e', saved: '#34c759', error: '#ff3b30' };

    el.textContent = `${icons[status]} ${message || ''}`;
    el.style.color = colors[status];
}

/**
 * 自動保存をトリガーする（2秒デバウンス）
 */
export function triggerAutoSave() {
    if (!state.projectId) return;

    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    updateSaveIndicator('idle', '未保存');

    autoSaveTimer = setTimeout(async () => {
        await performSave();
    }, 2000);
}

/**
 * 実際の保存処理
 */
async function performSave() {
    if (!state.projectId) return;

    updateSaveIndicator('saving', '保存中...');

    try {
        await setDoc(doc(db, "works", state.projectId), {
            title: state.title || '',
            sections: state.sections,
            languages: state.languages,
            languageConfigs: state.languageConfigs,
            lastUpdated: new Date()
        });
        updateSaveIndicator('saved', '保存済み');
        console.log(`[DSF] Auto-saved project: ${state.projectId}`);
    } catch (e) {
        console.error("[DSF] Auto-save failed:", e);
        updateSaveIndicator('error', '保存失敗');
    }
}

/**
 * 手動保存（プロジェクトIDを新規設定して保存）
 */
export async function saveAsProject() {
    const pid = prompt("プロジェクト名を入力してください:", state.projectId || "");
    if (!pid) return;

    state.projectId = pid;
    await performSave();
}

/**
 * 画像を圧縮・リサイズするヘルパー関数
 * @param {File} file - 入力ファイル
 * @param {number} maxWidth - 最大幅
 * @param {number} quality - 画質 (0.0 - 1.0)
 * @returns {Promise<Blob>} - 圧縮されたBlob (image/webp)
 */
function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas to Blob failed"));
                }, 'image/webp', quality);
            };
            img.onerror = (e) => reject(e);
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

/**
 * 切り抜き位置・スケールを反映してサムネイルを再生成・アップロードする
 * @param {string} bgUrl - 現在の背景画像URL
 * @param {object} pos - {x, y, scale}
 * @param {function} refresh - 画面更新コールバック
 */
export async function generateCroppedThumbnail(bgUrl, pos, refresh) {
    if (!bgUrl) return;

    try {
        const timestamp = Date.now();
        // オリジナルファイル名はURLから推測（簡易的）
        const filename = "cropped_" + timestamp;
        const thumbPath = `dsf/thumbs/${timestamp}_${filename}_thumb.webp`;

        // Canvasで描画
        const img = new Image();
        img.crossOrigin = "anonymous"; // CORS対応トライ
        img.src = bgUrl;

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        // サムネイルサイズ (9:16)
        const targetW = 320;
        // height = 320 * (16/9) = 568.88...
        const targetH = Math.round(targetW * (16 / 9));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // 白背景（透明画像対策）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);

        // 描画
        // オリジナルキャンバス(360x640)に対する比率
        const baseW = 360;
        const baseH = 640;
        const ratio = targetW / baseW; // 320/360 = 0.888...

        // pos.x, pos.y は 360x640 基準の移動量
        // pos.scale は拡大率
        // imgは width:100%, height:100%, object-fit:cover 相当で描画されている
        // つまり、imgの描画サイズは baseW x baseH (のアスペクト比維持)

        ctx.save();

        // 中心基準で変形するため、中心へ移動
        ctx.translate(targetW / 2, targetH / 2);
        ctx.translate(pos.x * ratio, pos.y * ratio);
        ctx.scale(pos.scale, pos.scale);

        // imgを描画。object-fit:cover の挙動を再現する必要がある。
        // imgのアスペクト比と枠のアスペクト比を比較
        const imgAspect = img.width / img.height;
        const frameAspect = baseW / baseH;

        let drawW, drawH;
        if (imgAspect > frameAspect) {
            // 画像が横長 -> 縦を合わせる
            drawH = targetH;
            drawW = targetH * imgAspect;
        } else {
            // 画像が縦長 -> 横を合わせる
            drawW = targetW;
            drawH = targetW / imgAspect;
        }

        // 中心に描画
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

        ctx.restore();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));

        // アップロード
        const thumbRef = ref(storage, thumbPath);
        const snap = await uploadBytes(thumbRef, blob);
        const thumbUrl = await getDownloadURL(snap.ref);

        state.sections[state.activeIdx].thumbnail = thumbUrl;
        console.log("[DSF] Thumbnail updated:", thumbUrl);

        refresh(); // update thumbnails if logical
        triggerAutoSave();

    } catch (e) {
        console.warn("[DSF] Thumbnail generation failed (likely CORS):", e);
        // エラーでも処理は止めない（サムネ生成失敗だけなので）
    }
}

/**
 * 画像をFirebase Storageにアップロードし、セクションの背景に設定する
 * クライアント側でWebP変換・サムネイル生成を行う
 * @param {HTMLInputElement} input - ファイル入力要素
 * @param {function} refresh - 画面更新コールバック
 */
export async function uploadToStorage(input, refresh) {
    const file = input.files[0];
    if (!file) return;

    const originalText = document.getElementById('text-label').innerText;
    document.getElementById('text-label').innerText = "処理中...";

    try {
        // 1. 画像圧縮 (メイン: max 1280px, サムネイル: max 320px)
        // 並列処理で高速化
        const [mainBlob, thumbBlob] = await Promise.all([
            compressImage(file, 1280, 0.8),
            compressImage(file, 320, 0.8)
        ]);

        const timestamp = Date.now();
        // オリジナル拡張子は無視して .webp に統一
        const filename = file.name.replace(/\.[^/.]+$/, "");

        const mainPath = `dsf/${timestamp}_${filename}.webp`;
        const thumbPath = `dsf/thumbs/${timestamp}_${filename}_thumb.webp`;

        document.getElementById('text-label').innerText = "アップロード中...";

        // 2. アップロード
        const mainRef = ref(storage, mainPath);
        const thumbRef = ref(storage, thumbPath);

        const [mainSnap, thumbSnap] = await Promise.all([
            uploadBytes(mainRef, mainBlob),
            uploadBytes(thumbRef, thumbBlob)
        ]);

        // 3. URL取得
        const [mainUrl, thumbUrl] = await Promise.all([
            getDownloadURL(mainSnap.ref),
            getDownloadURL(thumbSnap.ref)
        ]);

        // 4. ステート更新
        state.sections[state.activeIdx].background = mainUrl;
        state.sections[state.activeIdx].thumbnail = thumbUrl; // サムネイル保存

        refresh();
        triggerAutoSave();

        document.getElementById('text-label').innerText = "完了！";
        setTimeout(() => {
            document.getElementById('text-label').innerText = originalText;
        }, 2000);
    } catch (e) {
        console.error(e);
        alert("保存失敗: " + e.message);
        document.getElementById('text-label').innerText = originalText;
    } finally {
        console.log("[DSF] Upload process finished.");
        input.value = ''; // Reset input to allow same file selection
    }
}

/**
 * Firestoreからセクションデータを読み込む
 * @param {string} pid - プロジェクトID
 * @param {function} refresh - 画面更新コールバック
 */
export async function loadProject(pid, refresh) {
    const snap = await getDoc(doc(db, "works", pid));
    if (snap.exists()) {
        const data = snap.data();
        state.projectId = pid;
        state.title = data.title || '';
        state.sections = data.sections;
        state.languages = data.languages && data.languages.length > 0 ? data.languages : ['ja'];
        state.activeLang = state.languages[0];
        state.activeIdx = 0;
        state.activeBubbleIdx = null;
        refresh();
    }
}
