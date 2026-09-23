import {createSpaceSettingsNavigation} from './space-settings-navigation.js';
// View-only navigation over the existing dashboard surfaces.
const labels = {
 ja:{overview:'ダッシュボード',projects:'作品',activity:'公開状況・反応',settings:'スペースの設定',local:'このブラウザの作業コピー',recent:'最近の作品',create:'作品を作成',import:'DSPを取り込む',all:'作品をすべて見る',nav:'出版スペースの管理',hint:'作品を選んで、続きから編集できます。',publication:'公開設定を管理',localHint:'この端末に残っている復元用コピーです。出版スペースの一覧とは別に表示します。'},
 en:{overview:'Dashboard',projects:'Works',activity:'Publication & feedback',settings:'Space settings',local:'Browser working copies',recent:'Recent works',create:'Create a work',import:'Import DSP',all:'View all works',nav:'Manage publishing space',hint:'Choose a work to continue editing.',publication:'Manage publication',localHint:'Recovery copies on this device, separate from your publishing space.'}
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
  if(personal||spaceKind==='all')t.create=en?'Create in My space':'マイスペースに作成';
  if(spaceKind==='owned')t.create=en?'Create in this space':'このスペースに作成';
  root.querySelectorAll('[data-home-label]').forEach(el=>{el.textContent=t[el.dataset.homeLabel]||'';});
  root.querySelectorAll('[data-home-nav]').forEach(button=>{if(button.dataset.homeNav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  root.querySelectorAll('[data-home-views]').forEach(el=>{el.hidden=!el.dataset.homeViews.split(' ').includes(view);});
  settingsNavigation?.render(view==='settings');
  const storageNote=root.querySelector('.home-storage-note');if(storageNote)storageNote.textContent=spaceKind==='joined'?(en?'Only works shared with you are shown.':'あなたに共有されている作品だけを表示します。'):personal?(en?'These manuscripts belong to you. Existing published releases stay published; manage them under Publication & feedback.':'あなたの個人原稿です。既存の公開済み作品は公開が続きます。「公開状況・反応」で確認・管理できます。'):(en?'Changing a work’s space does not change its published status or sharing permissions.':'保存先の変更では、作品の公開状態や共有権限は変わりません。');
  root.querySelector('[data-home-title]').textContent=t[view];
  root.querySelector('[data-home-cloud-heading]').textContent=view==='overview'?t.recent:t.projects;
  root.querySelector('[data-home-navigation]').setAttribute('aria-label',t.nav);
  const local=root.querySelector('.home-browser-copies');if(view==='local')local.open=true;
 }
 function select(next){
  if(!Object.hasOwn(labels.ja,next)||!['overview','projects','activity','settings','local'].includes(next))return;
  view=next;render();onSelect?.(view);root.querySelector('.home-room-body')?.scrollTo?.(0,0);
  root.querySelector('[data-home-title]')?.focus({preventScroll:true});
 }
 root?.addEventListener('click',event=>{const button=event.target.closest('[data-home-nav]');if(button)select(button.dataset.homeNav);});
 render();return {render,select};
}
