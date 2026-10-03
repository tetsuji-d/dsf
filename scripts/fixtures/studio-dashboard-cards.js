import {describeStudioWork,installStudioWorkStatus} from '/js/studio-work-status.js';
import {renderHomeStatCard} from '/js/home-stat-card.js';
import {createHomeWorkspace} from '/js/home-workspace.js';
import {installStudioPwa} from '/js/studio-pwa.js';
let locale='ja',open=true;
const cover='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#1e4259"/><path d="M0 105 Q45 70 90 105V160H0" fill="#94bbc5"/><text x="45" y="42" text-anchor="middle" fill="white" font-family="serif" font-size="12">潮騒の図書館</text></svg>');
const getLocale=()=>locale,read=()=>describeStudioWork({open,title:'潮騒の図書館',thumbnail:cover,save:{cloudCurrent:true}});
const actions={onResume:()=>document.querySelector('#action').textContent='編集画面へ移動',onSave:async()=>{},onExport:async()=>{}};
installStudioWorkStatus({host:document.querySelector('#home-current-work'),getLocale,read,...actions,onClose:()=>{open=false;window.dispatchEvent(new Event('studio-work-status'));}});
const workspace=createHomeWorkspace({root:document.querySelector('#home-room'),getLocale,onSelect:view=>document.querySelector('#action').textContent='表示先: '+view});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stats(){document.querySelector('#home-dashboard-stats').innerHTML=[['library_books','発行済み作品','Published editions',2,'activity'],['public','公開中','Public',2,'activity'],['rate_review','レビュー','Reviews',3,'activity'],['folder','プロジェクト','Projects',8,'projects']].map(([icon,ja,en,value,view])=>renderHomeStatCard({icon,label:locale==='en'?en:ja,value,view,en:locale==='en',escape})).join('');}
installStudioPwa({getLocale,work:{read,...actions}});stats();
document.querySelector('#fixture-language').onclick=()=>{locale=locale==='ja'?'en':'ja';workspace.render();stats();document.dispatchEvent(new Event('studio-ui-language-change'));};
