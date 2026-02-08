// ========== 吹き出し管理 ==========
let activeBubbleIdx = null;
let isDragging = false;
let isResizing = false;
let dragStartX = 0;
let dragStartY = 0;
let bubbleStartX = 0;
let bubbleStartY = 0;
let bubbleStartWidth = 0;
let bubbleStartHeight = 0;

function addBubble() {
    const data = getCurrentData();
    if (!data.captions) data.captions = [];
    
    data.captions.push({
        x: 50,
        y: 30,
        width: 120,
        height: 80,
        text: "テキストを入力",
        type: "bottom" // bottom, top, left, right, none
    });
    
    activeBubbleIdx = data.captions.length - 1;
    refresh();
}

window.addBubble = addBubble;

function deleteBubble(index) {
    if (confirm("この吹き出しを削除しますか?")) {
        const data = getCurrentData();
        data.captions.splice(index, 1);
        activeBubbleIdx = null;
        refresh();
    }
}

window.deleteBubble = deleteBubble;

function selectBubble(index) {
    activeBubbleIdx = index;
    refresh();
}

window.selectBubble = selectBubble;

function updateBubbleText(index, text) {
    const data = getCurrentData();
    if (data.captions[index]) {
        data.captions[index].text = text;
        refresh();
    }
}

window.updateBubbleText = updateBubbleText;

function updateBubbleType(index, type) {
    const data = getCurrentData();
    if (data.captions[index]) {
        data.captions[index].type = type;
        // キャンバスの吹き出しだけを再描画
        refreshCanvas();
    }
}

window.updateBubbleType = updateBubbleType;

// ========== ドラッグ操作 ==========
function startBubbleDrag(event, index) {
    event.preventDefault();
    event.stopPropagation();
    
    activeBubbleIdx = index;
    isDragging = true;
    
    const canvas = document.getElementById('canvas-view');
    const rect = canvas.getBoundingClientRect();
    
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    
    const data = getCurrentData();
    bubbleStartX = data.captions[index].x;
    bubbleStartY = data.captions[index].y;
    
    document.addEventListener('mousemove', onBubbleDrag);
    document.addEventListener('mouseup', stopBubbleDrag);
    
    refresh();
}

window.startBubbleDrag = startBubbleDrag;

function onBubbleDrag(event) {
    if (!isDragging) return;
    
    const canvas = document.getElementById('canvas-view');
    const rect = canvas.getBoundingClientRect();
    
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    
    const deltaXPercent = (deltaX / rect.width) * 100;
    const deltaYPercent = (deltaY / rect.height) * 100;
    
    const data = getCurrentData();
    data.captions[activeBubbleIdx].x = Math.max(0, Math.min(100, bubbleStartX + deltaXPercent));
    data.captions[activeBubbleIdx].y = Math.max(0, Math.min(100, bubbleStartY + deltaYPercent));
    
    // リアルタイム更新
    const bubble = document.getElementById(`bubble-${activeBubbleIdx}`);
    if (bubble) {
        bubble.style.left = data.captions[activeBubbleIdx].x + '%';
        bubble.style.top = data.captions[activeBubbleIdx].y + '%';
    }
}

function stopBubbleDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', onBubbleDrag);
    document.removeEventListener('mouseup', stopBubbleDrag);
}

// ========== リサイズ操作 ==========
function startBubbleResize(event, index) {
    event.preventDefault();
    event.stopPropagation();
    
    activeBubbleIdx = index;
    isResizing = true;
    
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    
    const data = getCurrentData();
    bubbleStartWidth = data.captions[index].width || 120;
    bubbleStartHeight = data.captions[index].height || 80;
    
    document.addEventListener('mousemove', onBubbleResize);
    document.addEventListener('mouseup', stopBubbleResize);
}

window.startBubbleResize = startBubbleResize;

function onBubbleResize(event) {
    if (!isResizing) return;
    
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    
    const data = getCurrentData();
    data.captions[activeBubbleIdx].width = Math.max(60, bubbleStartWidth + deltaX);
    data.captions[activeBubbleIdx].height = Math.max(40, bubbleStartHeight + deltaY);
    
    // リアルタイム更新
    const bubble = document.getElementById(`bubble-${activeBubbleIdx}`);
    if (bubble) {
        bubble.style.width = data.captions[activeBubbleIdx].width + 'px';
        bubble.style.height = data.captions[activeBubbleIdx].height + 'px';
    }
}

function stopBubbleResize() {
    isResizing = false;
    document.removeEventListener('mousemove', onBubbleResize);
    document.removeEventListener('mouseup', stopBubbleResize);
    refresh(); // 最終的な状態を保存
}

// ========== 吹き出しリスト更新 ==========
function refreshBubbleList() {
    const data = getCurrentData();
    const bubbleList = document.getElementById('bubble-list');
    
    if (!data.captions || data.captions.length === 0) {
        bubbleList.innerHTML = '<p style="font-size:12px;color:#999;">吹き出しがありません</p>';
        return;
    }
    
    // 既存の要素を保持してイベントリスナーを維持
    bubbleList.innerHTML = '';
    
    data.captions.forEach((caption, i) => {
        const item = document.createElement('div');
        item.className = `bubble-item ${i === activeBubbleIdx ? 'active' : ''}`;
        item.onclick = () => selectBubble(i);
        
        // ヘッダー
        const header = document.createElement('div');
        header.className = 'bubble-item-header';
        header.innerHTML = `<span style="font-weight:bold;">吹き出し #${i+1}</span>`;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'bubble-delete';
        deleteBtn.textContent = '削除';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteBubble(i);
        };
        header.appendChild(deleteBtn);
        item.appendChild(header);
        
        // タイプ選択
        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = 'width:100%;padding:6px;margin:6px 0;border:1px solid #ddd;border-radius:4px;font-size:12px;';
        typeSelect.innerHTML = `
            <option value="bottom" ${(caption.type || 'bottom') === 'bottom' ? 'selected' : ''}>下向き</option>
            <option value="top" ${caption.type === 'top' ? 'selected' : ''}>上向き</option>
            <option value="left" ${caption.type === 'left' ? 'selected' : ''}>左向き</option>
            <option value="right" ${caption.type === 'right' ? 'selected' : ''}>右向き</option>
            <option value="none" ${caption.type === 'none' ? 'selected' : ''}>吹き出し口なし</option>
        `;
        typeSelect.onclick = (e) => e.stopPropagation();
        typeSelect.onchange = (e) => {
            e.stopPropagation();
            updateBubbleType(i, e.target.value);
        };
        item.appendChild(typeSelect);
        
        // テキスト入力
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = caption.text || '';
        textInput.placeholder = 'テキストを入力';
        textInput.style.cssText = 'width:100%;padding:6px;margin-top:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;';
        textInput.onclick = (e) => e.stopPropagation();
        textInput.oninput = (e) => {
            // refresh()を呼ばずに直接更新
            data.captions[i].text = e.target.value;
            const bubbleTextElem = document.querySelector(`#bubble-${i} .bubble-text`);
            if (bubbleTextElem) {
                bubbleTextElem.textContent = e.target.value;
            }
        };
        item.appendChild(textInput);
        
        // 位置情報
        const position = document.createElement('div');
        position.className = 'bubble-item-text';
        position.textContent = `位置: (${Math.round(caption.x)}%, ${Math.round(caption.y)}%)`;
        item.appendChild(position);
        
        bubbleList.appendChild(item);
    });
}

window.refreshBubbleList = refreshBubbleList;
