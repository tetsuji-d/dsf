import { ASSET_MAX_LONG_EDGE, getAssetUsage } from './project-assets.js';
export function createProjectAssetPanel({ state, prepareImage, addAsset, useAsset }) {
    let busy = false;
    let status = '';
    let initialized = false;
    let projectKey = '';
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
        }
        const key = identity();
        if (key !== projectKey) { projectKey = key; status = ''; document.getElementById('asset-search').value = ''; }
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
            const active = state.blocks?.[state.activeBlockIdx];
            for (const [kind, text] of [['apply', label('選択画像ページに適用', 'Use on selected image page')], ['add', active?.kind === 'flow' ? label('Flow全体の後に画像ページを追加', 'Add image page after Flow') : label('画像ページとして追加', 'Add image page')]]) {
                const button = element('button', text, 'btn-sm'); button.type = 'button';
                button.disabled = busy || (kind === 'apply' && !(active?.kind === 'page' && active.content?.pageKind !== 'text'));
                button.addEventListener('click', () => useAsset(asset.id, kind)); card.append(button);
            }
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
    return { render, upload };
}
