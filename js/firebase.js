/**
 * firebase.js — Firebase初期化・クラウド保存/読込
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
const db = getFirestore(app);
const storage = getStorage(app);

/**
 * 画像をFirebase Storageにアップロードし、セクションの背景に設定する
 * @param {HTMLInputElement} input - ファイル入力要素
 * @param {function} refresh - 画面更新コールバック
 */
export async function uploadToStorage(input, refresh) {
    const file = input.files[0];
    if (!file) return;

    const originalText = document.getElementById('text-label').innerText;
    document.getElementById('text-label').innerText = "画像をアップロード中...";

    const storageRef = ref(storage, `dsf/${Date.now()}_${file.name}`);
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);

        state.sections[state.activeIdx].background = url;
        refresh();

        alert("画像のアップロードと反映が完了しました！");
    } catch (e) {
        alert("保存失敗: " + e.message);
    } finally {
        document.getElementById('text-label').innerText = originalText;
        console.log("[DSF] Upload process finished.");
    }
}

/**
 * 現在のセクションデータをFirestoreに保存する
 */
export async function saveToCloud() {
    const pid = document.getElementById('project-id').value;
    if (!pid) return alert("作品IDを入力してください");

    const btn = document.querySelector('button[onclick="saveToCloud()"]');
    const originalText = btn.innerText;
    btn.innerText = "保存中...";
    btn.disabled = true;

    console.log(`[DSF] Attempting to save project ${pid} to Firestore...`);

    try {
        await setDoc(doc(db, "works", pid), { sections: state.sections, lastUpdated: new Date() });
        console.log("[DSF] Save successful!");
        alert("クラウドに全てのデータを同期しました！\n(保存成功: " + new Date().toLocaleTimeString() + ")");
    } catch (e) {
        console.error("[DSF] Save failed:", e);
        let msg = "保存に失敗しました。\n";
        if (e.code === 'permission-denied') {
            msg += "権限がありません (Permission Denied)。\nFirebaseのセキュリティルールを確認してください。";
        } else if (e.code === 'resource-exhausted') {
            msg += "割り当て超過です (Quota Exceeded)。\nBlazeプランへの移行が正しく反映されていない可能性があります。";
        } else {
            msg += "エラー詳細: " + e.message;
        }
        alert(msg);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

/**
 * Firestoreからセクションデータを読み込む
 * @param {function} refresh - 画面更新コールバック
 */
export async function loadFromCloud(refresh) {
    const pid = document.getElementById('project-id').value;
    const snap = await getDoc(doc(db, "works", pid));
    if (snap.exists()) {
        state.sections = snap.data().sections;
        refresh();
        alert("読込が完了しました。");
    } else {
        alert("作品が見つかりません。作品IDを確認してください。");
    }
}
