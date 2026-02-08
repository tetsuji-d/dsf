// ========== エクスポート機能 ==========

function exportProject() {
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.id || 'dsf-project'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert("プロジェクトをJSONでエクスポートしました");
}

window.exportProject = exportProject;

function generateEmbed() {
    const projectId = project.id || 'demo-project';
    
    // ビューワー用の埋め込みコード
    const embedCode = `<!-- DSF Viewer Embed Code -->
<div id="dsf-viewer-${projectId}" style="width:100%;max-width:600px;margin:0 auto;"></div>
<script src="https://YOUR-DOMAIN.com/dsf-viewer.js"></script>
<script>
  DSFViewer.init({
    containerId: 'dsf-viewer-${projectId}',
    projectId: '${projectId}',
    firebaseConfig: {
      apiKey: 'YOUR-API-KEY',
      projectId: 'YOUR-PROJECT-ID'
    },
    defaultLanguage: 'ja',
    enableLanguageSwitch: true,
    theme: 'light' // 'light' or 'dark'
  });
</script>

<!-- 使い方: -->
<!-- 1. このコードをウェブサイトに貼り付け -->
<!-- 2. YOUR-DOMAIN.comをあなたのドメインに変更 -->
<!-- 3. Firebase設定を実際の値に変更 -->
<!-- 4. プロジェクトIDが正しいか確認 -->
`;
    
    document.getElementById('embed-code').value = embedCode;
    document.getElementById('embed-modal').classList.add('show');
}

window.generateEmbed = generateEmbed;

function copyEmbed() {
    const textarea = document.getElementById('embed-code');
    textarea.select();
    document.execCommand('copy');
    alert("埋め込みコードをクリップボードにコピーしました");
}

window.copyEmbed = copyEmbed;

function closeEmbedModal() {
    document.getElementById('embed-modal').classList.remove('show');
}

window.closeEmbedModal = closeEmbedModal;

// ========== ビューワー用データ生成 ==========
function generateViewerData() {
    // ビューワーで使いやすい形式に変換
    return {
        id: project.id,
        metadata: project.metadata,
        languages: project.languages,
        sections: project.sections.map(section => ({
            id: section.id,
            type: section.type,
            data: section.languages // 全言語データを含む
        }))
    };
}

window.generateViewerData = generateViewerData;

// ========== 簡易ビューワープレビュー ==========
function previewViewer() {
    const viewerWindow = window.open('', 'DSF Viewer Preview', 'width=450,height=800');
    const viewerData = generateViewerData();
    
    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>DSF Viewer Preview</title>
    <style>
        body { margin: 0; background: #f0f0f0; font-family: sans-serif; }
        #viewer { max-width: 600px; margin: 0 auto; background: #fff; }
        .section { width: 100%; aspect-ratio: 9/16; position: relative; border-bottom: 1px solid #ddd; }
        .section img { width: 100%; height: 100%; object-fit: cover; }
        .bubble { position: absolute; background: white; border: 2px solid #000; border-radius: 20px; padding: 10px; }
        .controls { position: fixed; top: 10px; right: 10px; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); }
        .text-section { padding: 40px; font-size: 16px; line-height: 1.8; }
    </style>
</head>
<body>
    <div class="controls">
        <select id="lang-select" onchange="switchLanguage(this.value)">
            ${project.languages.map(lang => `<option value="${lang}">${lang.toUpperCase()}</option>`).join('')}
        </select>
    </div>
    <div id="viewer"></div>
    <script>
        const data = ${JSON.stringify(viewerData)};
        let currentLang = '${project.languages[0]}';
        
        function render() {
            const viewer = document.getElementById('viewer');
            viewer.innerHTML = data.sections.map(section => {
                const langData = section.data[currentLang];
                if (section.type === 'text') {
                    return \`<div class="section text-section">\${langData.content || ''}</div>\`;
                }
                
                let bubbles = '';
                if (langData.captions) {
                    bubbles = langData.captions.map(cap => 
                        \`<div class="bubble" style="top:\${cap.y}%;left:\${cap.x}%">\${cap.text}</div>\`
                    ).join('');
                }
                
                return \`
                    <div class="section">
                        <img src="\${langData.background}" alt="Section">
                        \${bubbles}
                    </div>
                \`;
            }).join('');
        }
        
        function switchLanguage(lang) {
            currentLang = lang;
            render();
        }
        
        render();
    </script>
</body>
</html>
    `;
    
    viewerWindow.document.write(html);
    viewerWindow.document.close();
}

window.previewViewer = previewViewer;
