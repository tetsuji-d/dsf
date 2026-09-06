import { ASSET_MAX_LONG_EDGE, getAssetUsage } from './project-assets.js';
export function createProjectAssetPanel({ state, prepareImage, addAsset, useAsset, renameAsset, dropAsset }) {
    let busy = false;
    let status = '';
    let initialized = false;
    let projectKey = '';
    let menu = null;
    let dragged = null;
    const dragType = 'application/x-dsf-project-asset';
    const closeMenu = () => { menu?.remove(); menu = null; };
    function showMenu(event, asset, card) {
        event.preventDefault(); closeMenu();
        const key = identity();
        const selected = state.blocks?.[state.activeBlockIdx];
        menu = element('div', '', 'project-asset-menu');
        menu.setAttribute('role', 'menu');
        for (const [kind, text] of [
            ['apply', label('選択画像ページに適用', 'Use on selected image page')],
            ['add', selected?.kind === 'flow' ? label('Flow全体の後に画像ページを追加', 'Add image page after Flow') : label('画像ページとして追加', 'Add image page')],
            ['rename', label('名前を変更', 'Rename')]
        ]) {
            const button = element('button', text); button.type = 'button'; button.setAttribute('role', 'menuitem');
            button.disabled = busy || (kind === 'apply' && !(selected?.kind === 'page' && selected.content?.pageKind !== 'text'));
            button.onclick = () => {
                closeMenu();
                if (identity() !== key || state.blocks?.[state.activeBlockIdx] !== selected) return;
                if (kind === 'rename') {
                    const name = prompt(label('画像名', 'Image name'), asset.name);
                    if (name?.trim() && identity() === key) renameAsset(asset.id, name.trim().slice(0,512));
                } else useAsset(asset.id, kind);
            };
            menu.append(button);
        }
        document.body.append(menu);
        const rect = card.getBoundingClientRect();
        menu.style.left = `${Math.max(0, Math.min(event.clientX || rect.left, innerWidth-menu.offsetWidth))}px`;
        menu.style.top = `${Math.max(0, Math.min(event.clientY || rect.bottom, innerHeight-menu.offsetHeight))}px`;
        menu.querySelector('button:not(:disabled)')?.focus();
    }
    const element = (tag, text, className) => {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (className) el.className = className;
        return el;
    };
    const en = () => document.documentElement.lang?.startsWith('en');
    const label = (ja, english) => en() ? english : ja;
    const identity = () => [state.projectId, state.localProjectId, state.uid, state.workId].join('|');
    function render() {
        const grid = document.getElementById('asset-grid');
        if (!grid) return;
        if (!initialized) {
            initialized = true;
            const search = element('input');
            search.type = 'search'; search.id = 'asset-search';
            search.setAttribute('aria-label', '画像名で検索 / Search images');
            search.placeholder = label('画像名で検索', 'Search images');
            search.addEventListener('input', render);
            const note = element('p', '', 'asset-status'); note.id = 'asset-status'; note.setAttribute('role', 'status');
            grid.before(search, note);
            document.addEventListener('pointerdown', e => { if (!menu?.contains(e.target)) closeMenu(); });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
            document.addEventListener('scroll', closeMenu, true);
            const area = document.querySelector('.asset-upload-area');
            area.append(element('small', label('画像をここにドロップ', 'Drop images here')));
            area.addEventListener('dragover', e => {
                if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
                e.preventDefault(); e.stopPropagation(); area.classList.add('drag-over');
            });
            area.addEventListener('dragleave', e => { if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over'); });
            area.addEventListener('drop', e => {
                e.preventDefault(); e.stopPropagation(); area.classList.remove('drag-over');
                upload({ target: { files: Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/')) } });
            });
            document.addEventListener('dragover', e => {
                if (!Array.from(e.dataTransfer?.types || []).includes(dragType)) return;
                e.preventDefault(); e.stopImmediatePropagation(); e.dataTransfer.dropEffect = 'copy';
            }, true);
            document.addEventListener('drop', e => {
                if (!Array.from(e.dataTransfer?.types || []).includes(dragType)) return;
                e.preventDefault(); e.stopImmediatePropagation();
                const source = dragged; dragged = null;
                if (!source || source.key !== identity() || busy) return;
                dropAsset(source.id, e.target);
            }, true);

        }
        const key = identity();
        if (key !== projectKey) { closeMenu(); projectKey = key; status = ''; document.getElementById('asset-search').value = ''; }
        document.getElementById('asset-status').textContent = status || label('このプロジェクトの画像 · WebP／長辺最大7680px', 'Project images · WebP / up to 7680px');
        document.querySelector('.asset-upload-area button').disabled = busy;
        const query = document.getElementById('asset-search').value.toLocaleLowerCase();
        grid.replaceChildren();
        for (const asset of state.projectAssets || []) {
            if (!asset.name.toLocaleLowerCase().includes(query)) continue;
            const card = element('div', '', 'project-asset-card');
            const img = element('img'); img.src = asset.thumbnail; img.alt = asset.name; img.loading = 'lazy';
            card.append(img, element('strong', asset.name), element('small', `${asset.width} × ${asset.height} · ${asset.byteLength < 1048576 ? `${(asset.byteLength / 1024).toFixed(1)} KB` : `${(asset.byteLength / 1048576).toFixed(2)} MB`} · WebP`));
            if (getAssetUsage(state.blocks, asset)) card.append(element('small', label('使用中', 'In use')));
            card.tabIndex = 0; card.setAttribute('aria-haspopup', 'menu');
            card.title = label('右クリックで画像の操作', 'Right-click for image actions');
            card.addEventListener('contextmenu', e => showMenu(e, asset, card));
            card.addEventListener('keydown', e => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) showMenu(e, asset, card);
            });
            img.draggable = false; card.draggable = true;
            card.addEventListener('dragstart', e => {
                if (busy) { e.preventDefault(); return; }
                closeMenu(); dragged = { id: asset.id, key: identity() };
                e.dataTransfer.clearData(); e.dataTransfer.setData(dragType, asset.id);
                e.dataTransfer.effectAllowed = 'copy';
            });
            card.addEventListener('dragend', () => { dragged = null; });
            grid.append(card);
        }
        if (!grid.childElementCount) grid.append(element('p', label('画像がありません。「画像を追加」から取り込めます。', 'No images. Add images to this project.')));
    }
    async function upload(event) {
        const input = event?.target;
        const files = Array.from(input?.files || []);
        if (!files.length || busy) return;
        state.localProjectId ||= crypto.randomUUID();
        const key = identity(); busy = true;
        let completed = 0;
        try {
            for (const file of files) {
                if (identity() !== key) break;
                status = label(`WebPに変換中 ${completed + 1}/${files.length}`, `Converting to WebP ${completed + 1}/${files.length}`); render();
                const prepared = await prepareImage(file, { uid: null, maxLongEdge: ASSET_MAX_LONG_EDGE });
                if (identity() !== key) break;
                addAsset({ name: file.name.slice(0, 512), ...prepared });
                completed++;
            }
            if (identity() === key) status = label(`${completed}件を追加しました`, `Added ${completed} images`);
        } catch {
            if (identity() === key) status = label(`${completed}件追加済み。次の画像を取り込めませんでした。画像形式・容量（変換後25MB以下）を確認してください。`, `Added ${completed}. Could not import the next image. Check its format and size (up to 25 MB after conversion).`);
        } finally { busy = false; if (input) input.value = ''; render(); }
    }
    return { render, upload, use: id => useAsset(id, 'apply') };
}
