import {createSpaceSettingsNavigation} from './space-settings-navigation.js';
// View-only navigation over the existing dashboard surfaces.
const labels = {
 ja:{shared:'共有された作品',notifications:'お知らせ',overview:'ダッシュボード',projects:'作品',activity:'公開状況・反応',settings:'スペースの設定',local:'最近の作業（この端末）',recent:'最近の作品',create:'作品を作成',import:'DSPファイルを開く',all:'作品をすべて見る',nav:'出版スペースの管理',hint:'作品を選んで、続きから編集できます。',publication:'公開設定を管理',localHint:'この端末に残っている復元用コピーです。出版スペースの一覧とは別に表示します。'},
 en:{shared:'Shared with me',notifications:'Notifications',overview:'Dashboard',projects:'Works',activity:'Publication & feedback',settings:'Space settings',local:'Recent work on this device',recent:'Recent works',create:'Create a work',import:'Open DSP file',all:'View all works',nav:'Manage publishing space',hint:'Choose a work to continue editing.',publication:'Manage publication',localHint:'Recovery copies on this device, separate from your publishing space.'}
};
export function createHomeWorkspace({root,getLocale,onSelect}) {
 let view='overview',spaceKind='all';
 const settingsNavigation=root?createSpaceSettingsNavigation({root,getLocale}):null;
 function render({spaceKind:nextKind=spaceKind}={}){
  spaceKind=nextKind;
  if(!root)return;
  const en=getLocale()==='en',personal=spaceKind==='personal';
  const t={...labels[en?'en':'ja']};root.dataset.homeView=view;root.dataset.spaceKind=spaceKind;
  if(personal){t.hint=en?'A personal place for drafts, notes and photo books.':'試作、ノート、写真集を作る個人の制作場所です。';t.settings=en?'Settings & invitations':'設定・招待';t.nav=en?'Manage My space':'マイスペースの管理';}
  if(personal||spaceKind==='all')t.create=en?'New project':'新規作成';
  if(spaceKind==='owned')t.create=en?'New in this space':'このスペースで新規作成';
  root.querySelectorAll('[data-home-label]').forEach(el=>{el.textContent=t[el.dataset.homeLabel]||'';});
  root.querySelectorAll('[data-home-nav]').forEach(button=>{if(button.dataset.homeNav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  root.querySelectorAll('[data-home-views]').forEach(el=>{el.hidden=!el.dataset.homeViews.split(' ').includes(view);});
  settingsNavigation?.render(view==='settings');
  const storageNote=root.querySelector('.home-storage-note');if(storageNote)storageNote.textContent=spaceKind==='joined'?(en?'Only works shared with you are shown.':'あなたに共有されている作品だけを表示します。'):personal?(en?'These manuscripts belong to you. Existing published releases stay published; manage them under Publication & feedback.':'あなたの個人原稿です。既存の公開済み作品は公開が続きます。「公開状況・反応」で確認・管理できます。'):(en?'Changing a work’s space does not change its published status or sharing permissions.':'保存先の変更では、作品の公開状態や共有権限は変わりません。');
  root.querySelector('[data-home-title]').textContent=t[view];
  root.querySelector('[data-home-cloud-heading]').textContent=view==='overview'?t.recent:t.projects;
  root.querySelector('[data-home-navigation]').setAttribute('aria-label',t.nav);
  const local=root.querySelector('.home-browser-copies');if(view==='local'||view==='overview')local.open=true;
  window.dispatchEvent(new Event('home-start-refresh'));
 }
 function select(next){
  if(!Object.hasOwn(labels.ja,next)||!['overview','projects','activity','settings','local','shared','notifications'].includes(next))return;
  view=next;render();onSelect?.(view);root.querySelector('.home-room-body')?.scrollTo?.(0,0);
  root.querySelector('[data-home-title]')?.focus({preventScroll:true});
 }
 root?.addEventListener('click',event=>{const button=event.target.closest('[data-home-nav]');if(button)select(button.dataset.homeNav);});
 render();return {render,select};
}
