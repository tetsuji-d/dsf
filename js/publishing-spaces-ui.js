import { openPublishingSpaceCreation } from './publishing-space-create-dialog.js';
import { prepareSpaceImage } from './publishing-space-image.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = {
    ja: { title:'スペース', hint:'マイスペースで個人の原稿を作成し、出版スペースで作品を管理・発行できます。表示を切り替えても作品の保存先は変わりません。',
        settings:'基本情報を設定', description:'概要', website:'Webサイト', icon:'アイコン', banner:'背景画像', remove:'画像を削除', preview:'保存後の表示プレビュー', imageHint:'PNG・JPEG・WebP（20MBまで）。中央を切り抜き、アイコンは正方形、背景は3:1のWebPで保存します。', imageError:'画像を読み込めませんでした。別の画像を選択してください。', readImageError:'画像を取得できませんでした。再読み込みしてください。', blankDescription:'概要はまだありません。',
        all:'すべてのクラウド原稿', unassigned:'マイスペース', select:'表示するスペース', create:'出版スペースを開設', name:'スペース名',
        submit:'開設', cancel:'キャンセル', rename:'名前を変更', save:'変更を保存', login:'ログインすると出版スペースを開設・管理できます。',
        loading:'出版スペースを読み込み中…', unavailable:'保存先を確認できませんでした。再読み込みするか、「すべてのクラウド原稿」から開いてください。',
        retry:'再読み込み', empty:'出版スペースはまだありません。マイスペースで制作を始められます。',
        assignment:'保存先のスペース', moveError:'所属を変更できませんでした。最新の一覧を確認して、もう一度操作してください。',
        conflict:'別の画面で更新されています。最新の一覧を確認して、もう一度操作してください。',
        error:'保存できませんでした。接続を確認して再試行してください。', saved:'保存しました。', working:'保存中…',
        count:'原稿', owner:'所有者', space:'出版スペース', destination:'保存先：クラウド', noProjects:'この表示範囲に原稿はありません。',
    },
    en: { title:'Spaces', hint:'Create personal manuscripts in My space. Use publishing spaces to manage and publish works. Switching views does not move your works.',
        settings:'Edit space profile', description:'About', website:'Website', icon:'Icon', banner:'Background image', remove:'Remove image', preview:'Preview after saving', imageHint:'PNG, JPEG or WebP, up to 20 MB. Center-cropped to a square icon and a 3:1 background, then saved as WebP.', imageError:'Could not process this image. Choose another image.', readImageError:'Could not load the image. Please reload.', blankDescription:'No description yet.',
        all:'All cloud manuscripts', unassigned:'My space', select:'Space to display', create:'Create a publishing space', name:'Space name',
        submit:'Create', cancel:'Cancel', rename:'Rename', save:'Save changes', login:'Sign in to create and manage publishing spaces.',
        loading:'Loading publishing spaces…', unavailable:'Could not confirm save locations. Retry, or open All cloud manuscripts.',
        retry:'Retry', empty:'No publishing spaces yet. You can start creating in My space.',
        assignment:'Save location', moveError:'Could not change the space. Review the latest list and try again.',
        conflict:'Another window made changes. Review the latest list and try again.',
        error:'Could not save. Check your connection and retry.', saved:'Saved.', working:'Saving…',
        count:'manuscripts', owner:'Owner', space:'Publishing space', destination:'Saved in: Cloud', noProjects:'No manuscripts in this view.',
    },
};
export function createPublishingSpaceUI({ root, request, getLocale, getUid, onChange, switcherRoots = [], identityRoots = [], onSelect, storage = globalThis.localStorage, requestJoined = null }) {
    let uid = '', data = null, selected = 'unassigned', loading = false, failed = false, failureCode = '', busy = false, form = null, notice = '', generation = 0, pending = null, creation = null;
    let opening = false;
    let joined=[],joinedPending=null,joinedFailed=false,joinedCursor=null;
    const isJoined=()=>selected.startsWith('joined:');
    const spaceKey=s=>s.role==='owner'?s.id:'joined:'+s.id;
    const visibleSpaces=()=>[...(data?.spaces||[]),...joined];
    async function loadJoined(more=false){
        sync();if(!uid||!requestJoined||joinedPending)return joinedPending;
        const epoch=generation,afterSpaceId=more?joinedCursor:null;
        const task=(async()=>{
            try{const result=await requestJoined({kind:'listJoinedSpaces',afterSpaceId});sync();if(epoch!==generation)return;
                if(result.uid!==uid||!Array.isArray(result.items)||result.items.length>20||result.items.some(s=>typeof s.id!=='string'||!s.id.startsWith('space_')||/[\/\\%\s]/.test(s.id)||typeof s.name!=='string'||!['member','admin'].includes(s.role)))throw Error('SPACES_RESPONSE_INVALID');
                joined=more?[...joined,...result.items.filter(s=>!joined.some(j=>j.id===s.id))]:result.items;joinedCursor=result.nextCursor;joinedFailed=false;
            }catch{sync();if(epoch===generation){joinedFailed=true;joined=[];joinedCursor=null;}}
            finally{if(epoch===generation){joinedPending=null;render();onChange?.();}}
        })();joinedPending=task;return task;
    }
    let imageCache = new Map(), imageLoading = new Set(), imageFailed = new Set(), converting = false;
    const tr = () => copy[getLocale() === 'en' ? 'en' : 'ja'];
    const switchers = Array.from(switcherRoots).filter(Boolean);
    const selectionLabel = () => isJoined() ? active()?.name || (getLocale()==='en'?'Joined space':'参加スペース') : selected === 'unassigned' ? tr().unassigned : selected === 'all' ? tr().all : active()?.name || tr().all;


    function errorMessage(code, saving = false) {
        const en = getLocale() === 'en';
        if (code === 'SPACES_DISABLED') return en ? 'Publishing spaces are not enabled in this environment yet. Your cloud manuscripts are available below.' : 'この環境では出版スペースはまだ有効になっていません。クラウド原稿は下の一覧から開けます。';
        if (['AUTH_REQUIRED','AUTH_INVALID','AUTH_CHANGED'].includes(code)) return en ? 'Please sign in again to use publishing spaces.' : '出版スペースを利用するには、ログインし直してください。';
        if (code === 'ACCOUNT_UNAVAILABLE') return en ? 'This account cannot currently use publishing spaces.' : 'このアカウントでは現在、出版スペースを利用できません。';
        if (code === 'EDIT_FORBIDDEN') return en ? 'This account does not have permission to save changes.' : 'このアカウントには変更を保存する権限がありません。';
        if (code === 'SPACE_MEDIA_UNAVAILABLE') return en ? 'Image storage is unavailable. Your changes have not been saved. Please retry later.' : '画像の保存先を利用できません。変更は保存されていません。時間をおいて再試行してください。';
        if (code === 'INVALID_WEBSITE') return en ? 'Enter a website URL beginning with https:// or http://.' : 'Webサイトはhttps://またはhttp://で始まるURLを入力してください。';
        if (code === 'INVALID_IMAGE') return tr().imageError;
        if (code === 'SPACE_CONFLICT') return tr().conflict;
        return saving ? tr().error : tr().unavailable;
    }
    const key = () => 'dsf-publishing-space:' + uid;
    function active() { return visibleSpaces().find(s => spaceKey(s) === selected) || null; }
    const personalSpace = () => ({id:'unassigned',name:tr().unassigned,role:'owner',profile:data?.mySpaceProfile || {}});
    const profileTarget = () => selected==='unassigned' ? personalSpace() : active();
    function remember() { try { storage?.setItem(key(), selected); } catch {} }
    function sync() {
        const next = getUid() || '';
        if (next === uid) return;
        uid = next; generation++; joined=[];joinedPending=null;joinedFailed=false;joinedCursor=null; data = null; failed = false; failureCode = ''; loading = false; busy = false; pending = null; form = null; notice = ''; creation = null; imageCache.clear(); imageLoading.clear(); imageFailed.clear(); converting = false;
        try { selected = storage?.getItem(key()) || 'unassigned'; } catch { selected = 'unassigned'; }
    }
    function apply(value) {
        if (value.uid !== uid) throw new Error('AUTH_CHANGED');
        if (data && value.revision < data.revision) return;
        data = value; failed = false; failureCode = '';
        if (!isJoined()&&!['all', 'unassigned'].includes(selected) && !active()) selected = 'unassigned';
    }
    function selectSpace(value) {
        sync();
        if (busy || converting || opening || !['all','unassigned',...visibleSpaces().map(spaceKey)].includes(value)) return;
        selected = value; form = null; notice = ''; remember();
        render(); onChange?.(); onSelect?.();
    }
    function iconHtml(space, id) {
        const source = space && imageCache.get(space.id + ':icon:' + space.profile?.icon);
        return source ? '<img alt="" src="' + escape(source) + '">' : '<span aria-hidden="true">' + escape(space ? Array.from(space.name)[0] : id === 'unassigned' ? (getLocale()==='en'?'M':'私') : '▦') + '</span>';
    }
    function updateSwitcherIcons() {
        for (const host of [...switchers,...identityRoots.filter(Boolean)]) for (const icon of host.querySelectorAll('[data-space-avatar]')) {
            const id = icon.dataset.spaceAvatar;
            icon.innerHTML = iconHtml(id==='unassigned'?personalSpace():visibleSpaces().find(s=>s.id===id),id);
        }
    }
    function renderSwitchers() {
        for (const host of identityRoots.filter(Boolean)) {
            host.innerHTML='<span class="space-switcher-avatar" data-space-avatar="'+escape(active()?.id || selected)+'"></span><div><small>'+(selected==='unassigned'?(getLocale()==='en'?'Personal':'個人用'):tr().title)+'</small><strong>'+escape(uid ? selectionLabel() : (getLocale()==='en'?'Personal workspace':'個人の作業スペース'))+'</strong></div>';
        }
        const t = tr(), en = getLocale() === 'en';
        for (const [index,host] of switchers.entries()) {
            if (!host.querySelector('[data-space-trigger]')) {
                host.classList.add('space-switcher');
                host.innerHTML = '<button type="button" class="space-switcher-trigger" data-space-trigger><span class="space-switcher-avatar" data-space-avatar></span><span class="space-switcher-chevron" aria-hidden="true">⌄</span></button><div class="space-switcher-popup" popover="auto"></div>';
                const trigger = host.querySelector('[data-space-trigger]'), popup = host.querySelector('[popover]');
                popup.id = 'publishing-space-switcher-' + index;
                window.addEventListener('resize',()=>{if(popup.matches(':popover-open'))popup.hidePopover();});
                popup.setAttribute('role','dialog');trigger.setAttribute('popovertarget',popup.id);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',popup.id);
                trigger.onclick = () => {
                    const rect = trigger.getBoundingClientRect();
                    popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - Math.min(340, innerWidth - 16) - 8)) + 'px';
                    popup.style.top = (rect.bottom + 8) + 'px';
                };
                popup.addEventListener('toggle', () => {
                    const open = popup.matches(':popover-open'); trigger.setAttribute('aria-expanded',String(open));
                    if (open) {
                        if(failed&&!loading)void load({notify:true});
                        if(requestJoined)void loadJoined();
                        (popup.querySelector('[aria-pressed="true"]') || popup.querySelector('button'))?.focus();
                        for (const space of [personalSpace(),...visibleSpaces()]) loadImages(space,['icon']);
                    }
                });
                popup.addEventListener('keydown',event=>{
                    const buttons=[...popup.querySelectorAll('button:not(:disabled)')], i=buttons.indexOf(document.activeElement);
                    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key) && buttons.length) {
                        event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
                    }
                });
                popup.addEventListener('click', event => {
                    const choice=event.target.closest('[data-space-choice]'), create=event.target.closest('[data-switcher-create]'), retry=event.target.closest('[data-switcher-retry]'),joinedRetry=event.target.closest('[data-joined-retry]'),more=event.target.closest('[data-joined-more]');
                    if(joinedRetry||more){void loadJoined(!!more);return;}
                    if (!choice && !create && !retry) return;
                    popup.hidePopover();trigger.focus();
                    if (choice) selectSpace(choice.dataset.spaceChoice);
                    else if (create) void openCreation();
                    else void load({notify:true});
                });
            }
            const trigger=host.querySelector('[data-space-trigger]'), popup=host.querySelector('[popover]');
            const focused=document.activeElement?.dataset?.spaceChoice;
            trigger.title=t.select + ': ' + (uid ? selectionLabel() : t.title);
            trigger.setAttribute('aria-label',trigger.title);trigger.setAttribute('aria-expanded',String(popup.matches(':popover-open')));
            trigger.querySelector('[data-space-avatar]').dataset.spaceAvatar=active()?.id || selected;
            popup.setAttribute('aria-label',t.select);
            const locked=busy || converting || opening;
            popup.innerHTML='<h3>'+t.title+'</h3>' + (!uid ? '<p>'+t.login+'</p>' : failed ? '<p>'+errorMessage(failureCode)+'</p><button type="button" data-switcher-retry>'+t.retry+'</button><button type="button" class="space-switcher-choice" data-space-choice="all">'+t.all+'</button>' : !data ? '<p role="status">'+t.loading+'</p>' :
                '<div class="space-switcher-list">'+[{id:'unassigned',name:t.unassigned},...data.spaces,{id:'all',name:t.all}].map(space=>
                    '<button type="button" class="space-switcher-choice" data-space-choice="'+escape(space.id)+'" aria-pressed="'+String(selected===space.id)+'" '+(locked?'disabled':'')+'><span class="space-switcher-avatar" data-space-avatar="'+escape(space.id)+'"></span><span class="space-switcher-name">'+escape(space.name)+'</span><span aria-hidden="true" class="space-switcher-check">'+(selected===space.id?'✓':'')+'</span></button>').join('')+'</div><button type="button" class="space-switcher-create" data-switcher-create '+(locked?'disabled':'')+'>＋ '+t.create+'</button><p class="space-switcher-note">'+(en?'Choose a space to view its dashboard.':'スペースを選ぶとダッシュボードを表示します。')+'</p>');
            if(uid&&requestJoined){
                popup.insertAdjacentHTML('beforeend','<h4>'+ (en?'Joined spaces':'参加しているスペース') +'</h4>'+joined.map(space=>'<button type="button" class="space-switcher-choice" data-space-choice="'+escape(spaceKey(space))+'" aria-pressed="'+String(selected===spaceKey(space))+'"><span class="space-switcher-avatar" data-space-avatar="'+escape(space.id)+'"></span><span class="space-switcher-name">'+escape(space.name)+'<small> · '+(en?'Joined':'参加中')+'</small></span></button>').join('')+(joinedFailed?'<p role="status">'+(en?'Could not load joined spaces.':'参加スペースを取得できませんでした。')+'</p><button data-joined-retry>'+t.retry+'</button>':joinedPending?'<p role="status">'+t.loading+'</p>':!joined.length?'<p>'+(en?'No joined spaces yet.':'参加しているスペースはまだありません。')+'</p>':'')+(joinedCursor?'<button data-joined-more>'+(en?'Show more':'さらに表示')+'</button>':''));
            }
            updateSwitcherIcons();
            if (focused !== undefined) [...popup.querySelectorAll('[data-space-choice]')].find(b=>b.dataset.spaceChoice===focused)?.focus();
        }
    }
    function options(value, includeAll = false) {
        const t = tr();
        const rows = [...(includeAll ? [{ id:'all', name:t.all }] : []), {id:includeAll ? 'unassigned' : '', name:t.unassigned},
            ...(data?.spaces || [])];
        return rows.map(s => '<option value="' + escape(s.id) + '"' + (s.id === value ? ' selected' : '') + '>' + escape(s.name) + '</option>').join('');
    }
    async function load({ notify = false } = {}) {
        sync();
        if (!uid) { render(); return null; }
        if(requestJoined)void loadJoined();
        if (pending) return pending;
        const epoch = generation, beforeRevision = data?.revision; loading = true; render();
        const task = (async () => {
            try { const value = await request(); sync(); if (epoch === generation) apply(value); }
            catch (error) { sync(); if (epoch === generation && data?.revision === beforeRevision) { failed = true; failureCode = error.message; data = null; } }
            finally { if (epoch === generation) { loading = false; pending = null; render(); if (notify) onChange?.(); } }
            return data;
        })();
        pending = task;
        return task;
    }
    async function mutate(command) {
        sync();
        if (!uid || !data || busy || isJoined()) return false;
        const epoch = generation; busy = true; notice = ''; render();
        try {
            const value = await request({ ...command, baseRevision: command.baseRevision ?? data.revision }); sync();
            if (epoch !== generation) return false;
            apply(value);
            if (command.kind === 'create') { selected = command.spaceId; remember(); creation = null; }
            form = null; notice = tr().saved;
            return true;
        } catch (error) {
            sync(); if (epoch !== generation) return false;
            notice = errorMessage(error.message, true);
            if (error.message === 'SPACE_CONFLICT') { form = null; await load(); }
            return false;
        } finally {
            if (epoch === generation) { busy = false; render(); onChange?.(); }
        }
    }

    const safeWebsite = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
    function profileHtml(space, draft = null) {
        const t = tr(), profile = draft || space.profile || {};
        const img = slot => {
            const source = draft && Object.hasOwn(draft, slot) ? draft[slot] : imageCache.get(space.id + ':' + slot + ':' + space.profile?.[slot]);
            return source ? '<img alt="" src="' + escape(source) + '">' : '';
        };
        const url = safeWebsite(profile.website);
        return '<div class="space-profile"><div class="space-profile-banner" data-profile-image="banner">' + img('banner')
            + '</div><div class="space-profile-body"><div class="space-profile-icon" data-profile-image="icon">' + (img('icon') || '<span aria-hidden="true">' + escape((draft?.name || space.name).slice(0,1)) + '</span>')
            + '</div><h4>' + escape(draft?.name ?? space.name) + '</h4><p class="space-profile-description">' + escape(profile.description || t.blankDescription)
            + '</p>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(profile.website) + '</a>' : '') + '</div></div>';
    }
    function loadImages(space, slots = ['icon','banner']) {
        if (!space || space.role!=='owner') return;
        for (const slot of slots) {
            const hash = space.profile?.[slot], key = space.id + ':' + slot + ':' + hash;
            if (!hash || imageCache.has(key) || imageLoading.has(key) || imageFailed.has(key)) continue;
            const epoch = generation;
            imageLoading.add(key);
            request({kind:'readImage',spaceId:space.id==='unassigned'?null:space.id,slot}).then(value => {
                sync();
                if (epoch !== generation || value.uid !== uid) return;
                imageCache.set(key, value.dataUrl);
                updateSwitcherIcons();
                if (profileTarget()?.id === space.id) updatePreview();
            }).catch(() => {
                if (epoch === generation) { imageFailed.add(key); notice = tr().readImageError; const status = root.querySelector('[role=status]'); if (status) status.textContent = notice;
                    if (!root.querySelector('[data-space-retry-images]')) {
                        const button=document.createElement('button');button.type='button';button.dataset.spaceRetryImages='';button.textContent=tr().retry;
                        button.onclick=()=>{imageFailed.clear();notice='';render();};root.append(button);
                    } }
            }).finally(() => { if (epoch === generation) imageLoading.delete(key); });
        }
    }
    function updatePreview() {
        const element = root.querySelector('[data-space-preview]');
        if (element && profileTarget()) element.innerHTML = profileHtml(profileTarget(), form?.kind === 'profile' ? {...form.profile,name:form.value} : null);
    }
    function profileFields() {
        const t = tr(), draft = form.profile;
        return '<label class="space-profile-wide">' + t.description + '<textarea aria-label="' + t.description + '" name="description" maxlength="2000" rows="4">' + escape(draft.description) + '</textarea><small>0–2000</small></label>'
            + (selected==='unassigned'?'':'<label class="space-profile-wide">' + t.website + '<input name="website" type="url" maxlength="2048" placeholder="https://example.com" value="' + escape(draft.website) + '"></label>')
            + ['icon','banner'].map(slot => '<div class="space-image-field"><label>' + t[slot] + '<input type="file" data-space-image="' + slot + '" accept="image/png,image/jpeg,image/webp"></label><button type="button" data-space-remove="' + slot + '">' + t.remove + '</button></div>').join('')
            + '<p class="space-profile-wide">' + t.imageHint + '</p>';
    }
    async function openCreation() {
        sync(); if (!uid || !data || failed) return;
            if (opening || busy) return;
            const owner = uid; opening = true;
            try {
                const result = await openPublishingSpaceCreation({request,getLocale,isCurrent:() => getUid() === owner});
                sync(); if (!result || uid !== owner) return;
                apply(result.catalogue); selected = result.spaceId; remember(); form = null;
                notice = getLocale() === 'en' ? 'Your publishing space is ready. Set up its profile or add a manuscript.' : '出版スペースを開設しました。基本情報の設定や原稿の追加へ進めます。';
                render(); onChange?.(); onSelect?.();
            } finally { opening = false; renderSwitchers(); (switchers.find(h=>h.getBoundingClientRect().width)?.querySelector('[data-space-trigger]') || root.querySelector('[data-space-create]'))?.focus(); }
    }
    function render() {
        sync(); const t = tr();
        renderSwitchers();
        if (!root) return;
        if(isJoined()){
            const space=active();root.innerHTML='<h3>'+escape(space?.name||(getLocale()==='en'?'Joined space':'参加スペース'))+'</h3><p>'+(getLocale()==='en'?'You are viewing a space you joined. Profile changes are managed by its owner.':'参加している出版スペースです。基本情報の変更は所有者が行います。')+'</p>';return;
        }
        root.innerHTML = '<div class="publishing-space-heading"><div><h3>' + (selected==='unassigned'?t.unassigned:t.title) + '</h3><p>' + (selected==='unassigned'?(getLocale()==='en'?'A personal place for drafts, notes and photo books. New manuscripts are not published automatically.':'試作、ノート、写真集を作る個人の制作場所です。新しい原稿が自動で公開されることはありません。'):t.hint) + '</p></div></div>'
            + (!uid ? '<p>' + t.login + '</p>' : failed ? '<p role="status">' + errorMessage(failureCode) + '</p><button type="button" data-space-retry>' + t.retry + '</button>'
            : !data ? '<p role="status">' + t.loading + '</p>' :
            '<div class="publishing-space-controls">' + (switchers.length ? '' : '<label>' + t.select + '<select data-space-select ' + (busy ? 'disabled' : '') + '>' + options(selected, true) + '</select></label>')
            + (selected==='unassigned'?'':'<button type="button" data-space-create ' + (busy ? 'disabled' : '') + '>' + t.create + '</button>')
            + (profileTarget() ? '<button type="button" data-space-settings ' + (busy ? 'disabled' : '') + '>' + t.settings + '</button>' : '') + '</div>'
            + (profileTarget() ? '<div data-space-preview>' + profileHtml(profileTarget(), form?.kind === 'profile' ? {...form.profile,name:form.value} : null) + '</div>' : '')
            + (selected!=='unassigned'&&!data.spaces.length ? '<p>' + t.empty + '</p>' : '')
            + (form ? '<form data-space-form>' + (selected==='unassigned'?'':'<label>' + t.name + '<input name="name" required maxlength="80" autocomplete="off" value="' + escape(form.value) + '" ' + (busy ? 'disabled' : '') + '></label>')
                + (form.kind === 'profile' ? profileFields() : '')
                + '<button data-space-submit ' + (busy || converting ? 'disabled' : '') + '>' + (busy ? t.working : form.kind !== 'create' ? t.save : t.submit) + '</button>'
                + '<button type="button" data-space-cancel ' + (busy ? 'disabled' : '') + '>' + t.cancel + '</button></form>' : '')
            + '<p class="publishing-space-status" role="status">' + escape(notice || (loading ? t.loading : '')) + '</p>'
            + (imageFailed.size ? '<button type="button" data-space-retry-images>' + t.retry + '</button>' : ''));
        root.querySelector('[data-space-settings]')?.addEventListener('click', () => {
            form = {kind:'profile',revision:data.revision,value:profileTarget().name,profile:{description:profileTarget().profile?.description || '',website:profileTarget().profile?.website || ''}};
            render(); root.querySelector('input[name=name], textarea[name=description]')?.focus();
        });
        root.querySelectorAll('[data-space-form] input:not([type=file]), [data-space-form] textarea').forEach(input => input.addEventListener('input', () => {
            if (input.name === 'name') form.value = input.value;
            else if (form.kind === 'profile') form.profile[input.name] = input.value;
            updatePreview();
        }));
        root.querySelectorAll('[data-space-remove]').forEach(button => button.addEventListener('click', () => {
            form.profile[button.dataset.spaceRemove] = null; updatePreview();
        }));
        root.querySelectorAll('[data-space-image]').forEach(input => input.addEventListener('change', async () => {
            const draft = form, epoch = generation, file = input.files[0]; if (!file) return;
            converting = true; root.querySelector('[data-space-submit]').disabled = true;
            root.querySelectorAll('[data-space-image]').forEach(el => { el.disabled = true; });
            try { const source = await prepareSpaceImage(file, input.dataset.spaceImage); sync(); if (epoch === generation && form === draft) { form.profile[input.dataset.spaceImage] = source; updatePreview(); } }
            catch { if (epoch === generation && form === draft) { notice = tr().imageError; root.querySelector('[role=status]').textContent = notice; } }
            finally { if (epoch === generation) { converting = false; const button = root.querySelector('[data-space-submit]'); if (button) button.disabled = busy; root.querySelectorAll('[data-space-image]').forEach(el => { el.disabled = busy; }); } }
        }));
        if (busy) root.querySelectorAll('[data-space-form] input, [data-space-form] textarea, [data-space-form] button').forEach(el => { el.disabled = true; });
        if (converting) root.querySelectorAll('[data-space-image]').forEach(el => { el.disabled = true; });
        root.querySelector('[data-space-retry-images]')?.addEventListener('click', () => { imageFailed.clear(); notice = ''; render(); });
        loadImages(profileTarget());
        loadImages(personalSpace(),['icon']);
        root.querySelector('[data-space-select]')?.addEventListener('change', e => selectSpace(e.target.value));
        root.querySelector('[data-space-create]')?.addEventListener('click', openCreation);
        root.querySelector('[data-space-cancel]')?.addEventListener('click', () => { form = null; render(); });
        root.querySelector('[data-space-retry]')?.addEventListener('click', async () => { imageFailed.clear(); await load(); onChange?.(); });
        root.querySelector('[data-space-form]')?.addEventListener('submit', e => {
            e.preventDefault(); if (busy || converting) return; const name = selected==='unassigned'?tr().unassigned:new FormData(e.target).get('name').trim(); if (!name) return;
            const kind = form.kind; form.value = name;
            if (kind === 'create' && creation?.name !== name) creation = { name, id:'space_' + crypto.randomUUID() };
            void mutate({kind:selected==='unassigned'?'myProfile':kind, name, spaceId:selected==='unassigned'?null:kind === 'create' ? creation.id : selected, ...(kind === 'profile' ? {profile:form.profile,baseRevision:form.revision} : {})});
        });
    }
    function filter(projects) {
        sync();
        if(isJoined())return [];
        if (selected === 'all') return projects;
        if (!data || failed) return [];
        return projects.filter(p => (data.assignments[p.id] || 'unassigned') === selected);
    }
    function card(project) {
        sync(); if (!data || failed) return '';
        const id = data.assignments[project.id] || '';
        return '<label class="home-space-assignment">' + tr().assignment + '<select data-space-project="' + escape(project.id)
            + '" aria-label="' + escape(tr().assignment + ': ' + (project.projectName || project.title || project.id))
            + '" ' + (busy ? 'disabled' : '') + '>' + options(id) + '</select></label>';
    }
    function bind(container) {
        container?.querySelectorAll('[data-space-project]').forEach(select => select.addEventListener('change', async e => {
            e.stopPropagation();
            if (busy) { select.value = data?.assignments[select.dataset.spaceProject] || ''; return; }
            const projectId = select.dataset.spaceProject, spaceId = select.value || null;
            const expectedSpaceId = data?.assignments[projectId] || null;
            select.disabled = true;
            await mutate({kind:'assign', projectId, spaceId, expectedSpaceId});
        }));
    }
    return { load, render, filter, card, bind, select:selectSpace,
        openJoined:async id=>{sync();const beforeUid=uid;await loadJoined();if(beforeUid===getUid())selectSpace('joined:'+id);},
        retryIfFailed:()=>{sync();if(joinedFailed&&!joinedPending)void loadJoined();if(failed&&!pending)return load({notify:true});},
        joinedSelection:()=>{sync();return isJoined()?{id:selected.slice(7),...active()}:null;},
        destinations: () => { sync(); if(!data||failed||busy)return null;return {uid,spaces:data.spaces.map(s=>({id:s.id,name:s.name})),assignments:{...data.assignments}}; },
        selection: () => { sync(); return isJoined()?selected.slice(7):active()?.id || null; },
        assign: (projectId, spaceId, expectedSpaceId=data?.assignments[projectId] || null) => mutate({kind:'assign',projectId,spaceId,expectedSpaceId}),
        label: () => { sync(); return selectionLabel(); },
        viewKind: () => { sync(); return isJoined()?'joined':selected==='unassigned'?'personal':selected==='all'?'all':'owned'; },
        catalogueReady: () => { sync(); return !!data&&!failed; },
        destination: () => tr().destination,
    };
}
