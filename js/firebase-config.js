import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Firebase設定
const firebaseConfig = {
    apiKey: "AIzaSyBj3U-wFKnsWlwId4OHAyerEGMiRYhQN0o",
    authDomain: "vmnn-26345.firebaseapp.com",
    projectId: "vmnn-26345",
    storageBucket: "vmnn-26345.firebasestorage.app",
    messagingSenderId: "166808261830",
    appId: "1:166808261830:web:c218463dd04297749eb3c7",
    measurementId: "G-N639C3XCVQ"
};

// 初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// グローバルに公開
window.firebaseDB = db;
window.firebaseStorage = storage;

// Firestoreメソッド
window.firestoreDoc = doc;
window.firestoreSetDoc = setDoc;
window.firestoreGetDoc = getDoc;

// Storageメソッド
window.storageRef = ref;
window.storageUploadBytes = uploadBytes;
window.storageGetDownloadURL = getDownloadURL;

console.log("Firebase initialized successfully");
