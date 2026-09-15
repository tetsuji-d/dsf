/** H1 help metadata: UI-only; never executes authoring commands. */
import { getUILang } from './i18n-studio.js';
const item = (id, selector, ja, en, related = []) => ({id, selector, ja, en, related});
// Localized tuples: name, summary, steps, prerequisites, shortcuts, search aliases.
export const studioHelpItems = [
 item('content-language','#lang-tabs-top button,#lang-tabs-mobile button',
 ['本文言語','表示・編集する本文の言語を選びます。UI言語とは別の設定です。','本文言語からEN-GBなどを選び、通常表示でその言語を編集します。未翻訳は入力し、要確認の翻訳は内容を確認してください。','作品を開いてエディターへ移動してください。','','英語だけ 横書き 翻訳 原文 English'],
 ['Content language','Choose the language of your content, independently of the interface language.','Choose EN-GB or another content language, then use Normal view to edit it. Enter missing translations and review outdated translations.','Open a project in the editor.','','English only translation source'],['compare','ui-language']),
 item('compare','#flow-compare-normal,#flow-compare-split',
 ['通常・分割表示','通常は選択言語、分割は原文と翻訳を並べて表示します。','本文言語を選び、「分割」で比較します。「通常」で選択言語の表示へ戻します。','Flowの原稿を選択してください。','','比較 翻訳 single view'],
 ['Normal and split view','Normal shows the selected language; Split compares source and translation.','Select a content language and choose Split to compare. Choose Normal to return to one language.','Select a Flow manuscript.','','compare translation single view'],['content-language']),
 item('ui-language','[data-auth-trigger],[data-ui-language]',
 ['UI言語','メニューや操作説明を日本語・英語に切り替えます。','プロフィールを開き、表示言語から日本語またはEnglishを選びます。本文の言語は変わりません。','ログイン前でもプロフィールから設定できます。','','JA EN プロフィール'],
 ['Interface language','Switch menus and help between Japanese and English.','Open your profile and choose Japanese or English under Language. Your content language does not change.','Available in the profile menu even when signed out.','','JA EN profile'],['content-language']),
 item('search','#btn-flow-search',
 ['検索・置換','Flowの見出し・段落本文を検索し、個別または全件を置換します。','検索バーで文字列・言語・範囲を指定します。置換は↔で開き、変更件数を確認して適用します。全置換も1回のUndoで戻せます。','Flow原稿が対象です。画像・キャプション・ルビの読みは検索対象外です。','Ctrl/Cmd+F · Ctrl+H','探す 変更 全置換'],
 ['Find and replace','Search Flow headings and paragraphs; replace one match or all matches.','Set the query, language and scope. Open replacement with ↔ and check the count before applying. One Undo restores a replace-all operation.','Targets Flow text, not images, captions or ruby readings.','Ctrl/Cmd+F · Ctrl+H','search replace all'],['undo']),
 item('inline-align','[data-ribbon-original="flow-placement-inline"],#flow-placement-inline',
 ['行内の文字揃え','各行の中で文字を先頭・中央・末尾などへ揃えます。','対象の本文を選択してから文字揃えを指定します。縦書きでは先頭は上、末尾は下です。','Flow本文を選択してください。再組版・IME変換中は操作が制限されることがあります。','','上揃え 下揃え 中央 行揃え'],
 ['Text alignment within lines','Align text within each line to its start, center or end.','Select the text, then choose alignment. In vertical writing, start is top and end is bottom.','Select Flow text. Recomposition or IME composition may temporarily restrict editing.','','top bottom center alignment'],['block-align']),
 item('block-align','[data-ribbon-original="flow-placement-block"],#flow-placement-block,#ribbon-flow-placement-scope,#flow-placement-scope',
 ['行のまとまり配置・範囲','行のまとまりを本文領域内で配置します。行内の文字揃えとは別の操作です。','適用範囲を確認してから配置を選びます。「このページ」は選択ページ、「このFlow」はFlow全体に適用します。','生成されたFlowページを選択し、組版の完了を待ってください。','','左右 配置 ページ 範囲'],
 ['Text block placement and scope','Position the block of lines inside the text area. This is separate from alignment within lines.','Check the scope before selecting placement. This page applies to the selected page; This Flow applies across the Flow.','Select a generated Flow page and wait for composition to finish.','','left right scope page placement'],['inline-align']),
 item('undo','#btn-undo,#btn-redo',
 ['元に戻す・やり直す','直前の編集を戻したり、戻した編集をやり直します。','元に戻す、またはやり直すを選びます。操作できる履歴がない場合は無効です。','戻せる編集履歴が必要です。','Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z','Undo Redo'],
 ['Undo and redo','Revert an edit or restore an undone edit.','Choose Undo or Redo. The control is disabled when no corresponding history is available.','Requires an available history entry.','Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z','history'],['search']),
 item('save','#btn-save',
 ['プロジェクトの保存','編集を続けるための原稿を保存します。Horizonへの発行とは別です。','保存を実行し、保存済みの表示を確認します。画面を再読み込みする前にも確認してください。','クラウド保存にはログインが必要です。','Ctrl/Cmd+S','クラウド 保存済み'],
 ['Save project','Save the editable project. This is separate from publishing to Horizon.','Save and confirm the saved status, including before reloading the page.','Cloud saving requires sign-in.','Ctrl/Cmd+S','cloud saved'],['publish','preview']),
 item('preview','#btn-editor-preview',
 ['Viewerプレビュー','編集中の内容を読者向けのViewerで確認します。','プレビューを選び、準備完了後に開くViewerで確認します。プレビューだけでは公開されません。','ページと画像の準備が必要です。準備失敗時は表示された理由を確認してください。','','確認 閲覧'],
 ['Viewer preview','Inspect your current work in the reader.','Choose Preview and inspect the Viewer once preparation completes. Preview does not publish your work.','Pages and images must be ready. Check the displayed reason if preparation fails.','','reader inspect'],['publish','print']),
 item('print','#ribbon-print',
 ['印刷・PDF','用紙に合わせて固定レイアウトを印刷します。','用紙、対象言語・ページ、余白、割り付けを確認し、印刷／PDF保存へ進みます。','プレビューの準備が必要です。両面印刷はプリンター側の設定も確認してください。','','冊子 両面 トンボ'],
 ['Print and PDF','Print the fixed layout on your chosen paper.','Check paper, language, pages, margins and imposition, then choose Print / Save PDF.','Preview must be ready. Also check printer settings for duplex printing.','','booklet duplex crop marks'],['preview']),
 item('publish','.room-tab[data-room="press"],#press-publish-cloud-btn',
 ['Horizonへの発行','プレスで配信データを検証し、Horizonへ下書き保存します。','プレスで言語と検証結果を確認して下書き保存します。読者への公開はWorksで行います。プログラム読み込み失敗時は原稿を保存してから再読み込みしてください。','ログインと配信準備・DSF検証の完了が必要です。プレスの各検証欄に失敗理由が表示されます。','','DSF 書き出し 公開 エラー'],
 ['Publish to Horizon','Validate delivery data in Press and save a draft to Horizon.','Check languages and validation in Press, then save a draft. Publish to readers from Works. If a program fails to load, save your project before reloading.','Requires sign-in and successful delivery preparation and DSF validation. Read failure details in Press.','','DSF export release error'],['save','preview'])
];
export const helpText = entry => entry[getUILang() === 'en' ? 'en' : 'ja'];
export function findHelpEntry(element) {
 return studioHelpItems.find(entry => element?.closest?.(entry.selector)) || null;
}
export function helpAvailability(entry, control = null) {
 const targets = [...document.querySelectorAll(entry.selector)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
 const en = getUILang() === 'en';
 if (!targets.length) return {target:null, text:en?'Control not visible. Open the relevant room or expand the ribbon/menu.':'操作場所は現在非表示です。該当ルーム、リボン、メニューを開いてください。'};
 const target = control || targets.find(el => !el.matches(':disabled,[aria-disabled="true"]')) || targets[0];
 const disabled = target.matches(':disabled,[aria-disabled="true"]');
 return {target,text:disabled ? (en?'Currently unavailable. ':'現在は操作できません。') + (target.dataset.disabledReason || helpText(entry)[3]) : (en?'Control is available.':'操作場所が表示されています。')};
}
export function helpTooltip(element) {
 const entry = findHelpEntry(element); if (!entry) return null;
 const text = helpText(entry);
 const unavailable=element.matches(':disabled,[aria-disabled="true"]');
 return [text[0],text[1],unavailable ? helpAvailability(entry, element).text : '',text[4]].filter(Boolean).join(' — ');
}
