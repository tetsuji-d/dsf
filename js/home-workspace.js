import {createSpaceSettingsNavigation} from './space-settings-navigation.js';
import {studioRollout} from './studio-rollout.js';
// View-only navigation over the existing dashboard surfaces.
const labels = {
 ja:{published:'リーズ（発行済みリード）',recentWork:'最近の作業',recent:'最近の作業',trash:'ゴミ箱',shared:'共有された編集用リード',notifications:'お知らせ',overview:'ダッシュボード',projects:'編集用リード',reads:'リーズ',activity:'公開状況・反応',settings:'スペースの設定',local:'ブラウザーの復元用コピー',create:'リードを作成',import:'編集用ファイルを開く',all:'編集用リードをすべて見る',nav:'出版スペースの管理',hint:'リードを選んで、続きから編集できます。',publication:'リーズで管理',localHint:'この端末に残っている復元用コピーです。出版スペースの一覧とは別に表示します。'},
 en:{published:'Published editions',recentWork:'Recent work',recent:'Recent work',trash:'Trash',shared:'Shared with me',notifications:'Notifications',overview:'Dashboard',projects:'Editable Reads',reads:'Reads',activity:'Publication & feedback',settings:'Space settings',local:'Browser recovery copies',create:'Create Read',import:'Open editable file',all:'View all Reads',nav:'Manage publishing space',hint:'Choose a Read to continue editing.',publication:'Manage publication',localHint:'Recovery copies on this device, separate from your publishing space.'}
};
export function createHomeWorkspace({root,getLocale,onSelect,features=studioRollout}) {
 let view='projects',spaceKind='all',hasTrash=false;
 const settingsNavigation=root?createSpaceSettingsNavigation({root,getLocale,sharingEnabled:features.invitations}):null;
 const available=next=>next==='shared'?features.personalSharing:next==='notifications'?features.notifications:next==='trash'?(features.trash||hasTrash):true;
 function render({spaceKind:nextKind=spaceKind,hasTrash:nextTrash=hasTrash}={}){
  spaceKind=nextKind;
  hasTrash=nextTrash;
  if(!available(view))view='projects';
  if(!root)return;
  const en=getLocale()==='en',personal=spaceKind==='personal';
  const t={...labels[en?'en':'ja']};root.dataset.homeView=view;root.dataset.spaceKind=spaceKind;
  if(personal){t.hint=en?'A personal place for drafts, notes and photo books.':'試作、ノート、写真集を作る個人の制作場所です。';t.settings=features.invitations?(en?'Settings & invitations':'設定・招待'):(en?'Settings':'設定');t.nav=en?'Manage My space':'マイスペースの管理';}
  root.querySelectorAll('[data-home-label]').forEach(el=>{el.textContent=t[el.dataset.homeLabel]||'';});
  root.querySelectorAll('[data-home-nav]').forEach(button=>{if(['shared','notifications','trash'].includes(button.dataset.homeNav))button.hidden=!available(button.dataset.homeNav);if(button.dataset.homeNav===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  root.querySelectorAll('[data-home-views]').forEach(el=>{el.hidden=!el.dataset.homeViews.split(' ').includes(view);});
  settingsNavigation?.render(view==='settings');
  const storageNote=root.querySelector('.home-storage-note');if(storageNote)storageNote.textContent=spaceKind==='joined'?(en?'Only Reads shared with you are shown.':'あなたに共有されているリードだけを表示します。'):personal?(en?'These editable Reads belong to you. Manage issued editions in Reads.':'あなたの編集用リードです。発行済みリードの公開状態は「リーズ」で管理します。'):(en?'Changing a Read’s space does not change its published status or sharing permissions.':'保存先の変更では、リードの公開状態や共有権限は変わりません。');
  root.querySelector('[data-home-title]').textContent=t[view];
  root.querySelector('[data-home-cloud-heading]').textContent=view==='overview'?t.recent:t.projects;
  root.querySelector('[data-home-navigation]').setAttribute('aria-label',t.nav);
  const local=root.querySelector('.home-browser-copies');if(view==='local'||view==='overview')local.open=true;
  window.dispatchEvent(new Event('home-start-refresh'));
 }
 function select(next){
  if(!available(next))return;
  if(!Object.hasOwn(labels.ja,next)||!['overview','projects','activity','settings','local','shared','notifications','trash','recent'].includes(next))return;
  view=next;render();onSelect?.(view);root.querySelector('.home-room-body')?.scrollTo?.(0,0);
  root.querySelector('[data-home-title]')?.focus({preventScroll:true});
 }
 root?.addEventListener('click',event=>{const button=event.target.closest('[data-home-nav]');if(button)select(button.dataset.homeNav);});
 render();return {render,select};
}
