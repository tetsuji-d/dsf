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
        text: "吹き出し"
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
    
    bubbleList.innerHTML = data.captions.map((caption, i) => `
        <div class="bubble-item ${i === activeBubbleIdx ? 'active' : ''}" onclick="selectBubble(${i})">
            <div class="bubble-item-header">
                <span style="font-weight:bold;">吹き出し #${i+1}</span>
                <button class="bubble-delete" onclick="event.stopPropagation();deleteBubble(${i})">削除</button>
            </div>
            <input type="text" 
                   value="${caption.text || ''}" 
                   onclick="event.stopPropagation()"
                   oninput="updateBubbleText(${i}, this.value)"
                   placeholder="テキストを入力"
                   style="width:100%;padding:6px;margin-top:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
            <div class="bubble-item-text">位置: (${Math.round(caption.x)}%, ${Math.round(caption.y)}%)</div>
        </div>
    `).join('');
}

window.refreshBubbleList = refreshBubbleList;
