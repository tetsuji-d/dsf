// ========== グローバルステート ==========
let project = {
    id: "",
    metadata: {
        title: "Untitled Project",
        author: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    languages: ["ja", "en"], // デフォルト言語
    sections: []
};

let activeIdx = 0; // 現在選択中のセクション
let activeLang = "ja"; // 現在選択中の言語

// ========== 初期化 ==========
window.addEventListener('DOMContentLoaded', () => {
    // デフォルトセクションを追加
    addSection();
    refresh();
    // サムネイルサイズを復元
    setTimeout(restoreThumbSize, 100);
});

// ========== セクション管理 ==========
function addSection() {
    const newSection = {
        id: `sec_${Date.now()}`,
        type: "image", // cover / image / text
        languages: {}
    };
    
    // 各言語のデータを初期化
    project.languages.forEach(lang => {
        newSection.languages[lang] = {
            title: "",
            background: lang === "ja" ? "https://picsum.photos/id/10/600/1066" : "https://picsum.photos/id/20/600/1066",
            content: "",
            writingMode: "horizontal-tb",
            captions: []
        };
    });
    
    project.sections.push(newSection);
    activeIdx = project.sections.length - 1;
    refresh();
}

window.addSection = addSection;

function deleteSection() {
    if (project.sections.length <= 1) {
        alert("最後のセクションは削除できません");
        return;
    }
    if (confirm("このセクションを削除しますか?")) {
        project.sections.splice(activeIdx, 1);
        activeIdx = Math.max(0, activeIdx - 1);
        refresh();
    }
}

window.deleteSection = deleteSection;

function moveSection(direction) {
    const newIdx = activeIdx + direction;
    if (newIdx < 0 || newIdx >= project.sections.length) return;
    
    [project.sections[activeIdx], project.sections[newIdx]] = 
    [project.sections[newIdx], project.sections[activeIdx]];
    
    activeIdx = newIdx;
    refresh();
}

window.moveSection = moveSection;

// ========== セクションタイプ変更 ==========
function changeSectionType(type) {
    const section = project.sections[activeIdx];
    section.type = type;
    refresh();
}

window.changeSectionType = changeSectionType;

// ========== 言語管理 ==========
function switchLang(lang) {
    activeLang = lang;
    refresh();
}

window.switchLang = switchLang;

function addLanguage() {
    document.getElementById('lang-modal').classList.add('show');
}

window.addLanguage = addLanguage;

function confirmAddLanguage() {
    const code = document.getElementById('new-lang-code').value.trim();
    const name = document.getElementById('new-lang-name').value.trim();
    
    if (!code || !name) {
        alert("言語コードと言語名を入力してください");
        return;
    }
    
    if (project.languages.includes(code)) {
        alert("この言語は既に追加されています");
        return;
    }
    
    // 言語を追加
    project.languages.push(code);
    
    // 既存の全セクションに新言語データを追加
    project.sections.forEach(section => {
        section.languages[code] = {
            title: "",
            background: "https://picsum.photos/id/30/600/1066",
            content: "",
            writingMode: "horizontal-tb",
            captions: []
        };
    });
    
    closeLangModal();
    refresh();
    alert(`${name} (${code}) を追加しました`);
}

window.confirmAddLanguage = confirmAddLanguage;

function closeLangModal() {
    document.getElementById('lang-modal').classList.remove('show');
    document.getElementById('new-lang-code').value = '';
    document.getElementById('new-lang-name').value = '';
}

window.closeLangModal = closeLangModal;

function removeLanguage(lang) {
    if (project.languages.length <= 1) {
        alert("最後の言語は削除できません");
        return;
    }
    
    if (confirm(`言語 "${lang}" を削除しますか?`)) {
        project.languages = project.languages.filter(l => l !== lang);
        
        // 全セクションから削除
        project.sections.forEach(section => {
            delete section.languages[lang];
        });
        
        // アクティブ言語が削除された場合は最初の言語に切り替え
        if (activeLang === lang) {
            activeLang = project.languages[0];
        }
        
        refresh();
    }
}

window.removeLanguage = removeLanguage;

// ========== データ更新 ==========
function getCurrentData() {
    const section = project.sections[activeIdx];
    return section.languages[activeLang];
}

function updateBackground(url) {
    getCurrentData().background = url;
    refresh();
}

window.updateBackground = updateBackground;

function updateWritingMode(mode) {
    getCurrentData().writingMode = mode;
    refresh();
}

window.updateWritingMode = updateWritingMode;

function updateContent(text) {
    getCurrentData().content = text;
    refresh();
}

window.updateContent = updateContent;

function updateTitle(text) {
    getCurrentData().title = text;
    refresh();
}

window.updateTitle = updateTitle;

// ========== 画像アップロード ==========
async function uploadImage(input) {
    const file = input.files[0];
    if (!file) return;
    
    try {
        const storageRef = window.storageRef(
            window.firebaseStorage, 
            `images/${Date.now()}_${file.name}`
        );
        
        const snapshot = await window.storageUploadBytes(storageRef, file);
        const url = await window.storageGetDownloadURL(snapshot.ref);
        
        updateBackground(url);
        alert("画像をアップロードしました");
    } catch (error) {
        console.error("Upload error:", error);
        alert("アップロード失敗: " + error.message);
    }
}

window.uploadImage = uploadImage;

// ========== Firebase保存/読込 ==========
async function saveToCloud() {
    const projectId = document.getElementById('project-id').value.trim();
    if (!projectId) {
        alert("プロジェクトIDを入力してください");
        return;
    }
    
    try {
        project.id = projectId;
        project.metadata.updatedAt = new Date().toISOString();
        
        const docRef = window.firestoreDoc(window.firebaseDB, "projects", projectId);
        await window.firestoreSetDoc(docRef, project);
        
        alert("保存しました!");
    } catch (error) {
        console.error("Save error:", error);
        alert("保存失敗: " + error.message);
    }
}

window.saveToCloud = saveToCloud;

async function loadFromCloud() {
    const projectId = document.getElementById('project-id').value.trim();
    if (!projectId) {
        alert("プロジェクトIDを入力してください");
        return;
    }
    
    try {
        const docRef = window.firestoreDoc(window.firebaseDB, "projects", projectId);
        const docSnap = await window.firestoreGetDoc(docRef);
        
        if (docSnap.exists()) {
            project = docSnap.data();
            activeIdx = 0;
            activeLang = project.languages[0] || "ja";
            refresh();
            alert("読み込みました!");
        } else {
            alert("プロジェクトが見つかりません");
        }
    } catch (error) {
        console.error("Load error:", error);
        alert("読込失敗: " + error.message);
    }
}

window.loadFromCloud = loadFromCloud;

// ========== UI更新 ==========
function refresh() {
    refreshCanvas();
    refreshThumbs();
    refreshControls();
    refreshLangTabs();
}

function refreshCanvas() {
    const section = project.sections[activeIdx];
    const data = getCurrentData();
    const mainImg = document.getElementById('main-img');
    const bubbleLayer = document.getElementById('bubble-layer');
    const textLayer = document.getElementById('text-layer');
    
    // 背景画像
    if (section.type === 'text') {
        mainImg.style.display = 'none';
        textLayer.style.background = '#f9f9f9';
    } else {
        mainImg.style.display = 'block';
        mainImg.src = data.background || '';
        textLayer.style.background = 'transparent';
    }
    
    // 吹き出し描画
    bubbleLayer.innerHTML = (data.captions || []).map((caption, i) => {
        const type = caption.type || 'bottom';
        let bubblePath = '';
        
        // 丸い吹き出しの形状
        if (type === 'bottom') {
            bubblePath = `
                <path d="M 20 20 Q 10 20, 10 30 L 10 50 Q 10 60, 20 60 L 50 60 L 55 75 L 60 60 L 100 60 Q 110 60, 110 50 L 110 30 Q 110 20, 100 20 Z" 
                      fill="white" stroke="black" stroke-width="2"/>
            `;
        } else if (type === 'top') {
            bubblePath = `
                <path d="M 20 20 L 55 5 L 60 20 L 100 20 Q 110 20, 110 30 L 110 50 Q 110 60, 100 60 L 20 60 Q 10 60, 10 50 L 10 30 Q 10 20, 20 20 Z" 
                      fill="white" stroke="black" stroke-width="2"/>
            `;
        } else if (type === 'left') {
            bubblePath = `
                <path d="M 20 20 Q 10 20, 10 30 L 10 35 L -5 40 L 10 45 L 10 50 Q 10 60, 20 60 L 100 60 Q 110 60, 110 50 L 110 30 Q 110 20, 100 20 Z" 
                      fill="white" stroke="black" stroke-width="2"/>
            `;
        } else if (type === 'right') {
            bubblePath = `
                <path d="M 20 20 Q 10 20, 10 30 L 10 50 Q 10 60, 20 60 L 100 60 Q 110 60, 110 50 L 110 45 L 125 40 L 110 35 L 110 30 Q 110 20, 100 20 Z" 
                      fill="white" stroke="black" stroke-width="2"/>
            `;
        } else {
            // 吹き出し口なし
            bubblePath = `
                <rect x="10" y="20" width="100" height="40" rx="10" ry="10" 
                      fill="white" stroke="black" stroke-width="2"/>
            `;
        }
        
        return `
        <div class="bubble-svg ${i === activeBubbleIdx ? 'active' : ''}" 
             id="bubble-${i}"
             style="top:${caption.y}%; left:${caption.x}%; width:${caption.width || 120}px; height:${caption.height || 80}px;"
             onmousedown="startBubbleDrag(event, ${i})">
            <svg width="100%" height="100%" viewBox="0 0 120 80" preserveAspectRatio="none">
                ${bubblePath}
            </svg>
            <div class="bubble-text ${data.writingMode === 'vertical-rl' ? 'v-text' : ''}">${caption.text || ''}</div>
            <div class="resize-handle" onmousedown="startBubbleResize(event, ${i})"></div>
        </div>
    `;
    }).join('');
    
    // テキストレイヤー (テキストセクション用)
    if (section.type === 'text') {
        textLayer.innerHTML = `<div class="text-content ${data.writingMode === 'vertical-rl' ? 'v-text' : ''}">${data.content || ''}</div>`;
    } else if (section.type === 'cover') {
        textLayer.innerHTML = `<div class="cover-title">${data.title || ''}</div>`;
    } else {
        textLayer.innerHTML = '';
    }
}

function refreshThumbs() {
    const container = document.getElementById('thumb-container');
    container.innerHTML = project.sections.map((section, i) => {
        const data = section.languages[activeLang] || {};
        const typeLabel = {cover: '表紙', image: '画像', text: 'テキスト'}[section.type] || section.type;
        
        return `
            <div class="thumb-wrap ${i === activeIdx ? 'active' : ''}" onclick="activeIdx=${i};refresh()">
                <img class="thumb-canvas" src="${data.background || 'https://via.placeholder.com/600x1066/eee/999?text=No+Image'}">
                <div class="thumb-label">#${i+1}</div>
                <div class="thumb-type">${typeLabel}</div>
            </div>
        `;
    }).join('');
    
    // サムネイルサイズを復元
    const savedSize = localStorage.getItem('dsf-thumb-size');
    if (savedSize) {
        resizeThumbs(savedSize);
    }
}

function refreshControls() {
    const section = project.sections[activeIdx];
    const data = getCurrentData();
    
    // セクションタイプ
    document.getElementById('section-type').value = section.type;
    
    // 画像コントロールの表示/非表示
    document.getElementById('image-controls').style.display = section.type === 'text' ? 'none' : 'block';
    document.getElementById('bubble-controls').style.display = section.type === 'image' ? 'block' : 'none';
    
    // フォーム値
    document.getElementById('prop-bg').value = data.background || '';
    document.getElementById('prop-mode').value = data.writingMode || 'horizontal-tb';
    document.getElementById('prop-content').value = data.content || '';
    document.getElementById('prop-title').value = data.title || '';
    
    // ラベル変更
    const contentLabel = document.getElementById('content-label');
    if (section.type === 'text') {
        contentLabel.textContent = '本文';
    } else if (section.type === 'cover') {
        contentLabel.textContent = 'サブタイトル';
    } else {
        contentLabel.textContent = 'キャプション';
    }
    
    // 吹き出しリスト
    refreshBubbleList();
}

function refreshLangTabs() {
    const langTabs = document.getElementById('lang-tabs');
    langTabs.innerHTML = project.languages.map(lang => `
        <div class="lang-tab ${lang === activeLang ? 'active' : ''}" onclick="switchLang('${lang}')">
            ${lang.toUpperCase()}
            ${project.languages.length > 1 ? `<span class="remove" onclick="event.stopPropagation();removeLanguage('${lang}')">×</span>` : ''}
        </div>
    `).join('');
}

function resizeThumbs(val) {
    const wraps = document.querySelectorAll('.thumb-wrap');
    wraps.forEach(w => w.style.width = val + '%');
    // サイズを保存
    localStorage.setItem('dsf-thumb-size', val);
}

// 初期化時にサイズを復元
function restoreThumbSize() {
    const savedSize = localStorage.getItem('dsf-thumb-size');
    if (savedSize) {
        const slider = document.querySelector('input[type="range"]');
        if (slider) {
            slider.value = savedSize;
            resizeThumbs(savedSize);
        }
    }
}

window.resizeThumbs = resizeThumbs;
window.restoreThumbSize = restoreThumbSize;
window.refresh = refresh;
window.refreshCanvas = refreshCanvas;
