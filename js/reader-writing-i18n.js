import {getPlatformLanguage,subscribePlatformLanguage} from './ui-language.js';

// UI copy only. Manuscripts, object text, filenames and saved operation names are never rewritten.
const EN={
    '消しゴム':'Eraser','消しゴムの設定':'Eraser settings','書き込みを消しました。':'Writing erased.',
    '書き込みだけを消します。元のページは変わりません。':'Erases only Writing. The original page stays unchanged.',
    'なぞった部分の書き込みを消して、元のページを表示します。ロックした書き込みは残ります。':'Rub over Writing to reveal the original page. Locked objects are preserved.',
    'Reader／Writingをオフライン用に準備':'Prepare Reader / Writing for offline use',
    '準備状態を確認しています…':'Checking offline resources…',
    '準備済み。通信なしでReaderを開き、書き込み・保存できます。':'Ready. Open Reader, write and save without internet.',
    '準備が必要です。接続して準備を実行してください。':'Preparation is needed. Connect and prepare offline resources.',
    '準備状態を確認できませんでした。接続して準備を実行してください。':'Could not verify readiness. Connect and prepare offline resources.',
    '準備に失敗しました。接続と空き容量を確認してください。前回の準備と下書きは保持しています。':'Preparation failed. Check the connection and free space. Previous offline resources and drafts are kept.',
    'アプリが更新されています。書き込みをDSFRに保存してReaderを開き直してください。':'The app has updated. Save your writing as DSFR and reopen Reader.',
    '元のファイルを自動で上書きすることはありません。保存せず戻っても、書き込みはReaderと端末内の下書きに残ります。':'The original file is not overwritten automatically. Returning without a file export keeps your Writing in Reader and the local draft.',
    '保存・共有':'Save / share',
    'ダウンロードで保存':'Save by downloading',
    '共有メニューが使えない場合はこちら':'Use this if the share menu is unavailable.',
    '「ダウンロードで保存」を押してください。ブラウザーの設定に応じて、保存先の選択画面が開くか、ダウンロードフォルダに保存されます。':'Choose Save by downloading. Depending on your browser settings, you can choose a location or the file will be saved in Downloads.',
    'ファイルに保存しました':'I saved the file',
    '保存したのでReaderに戻る':'I saved it — return to Reader',
    '保存ファイルを用意しました。保存後、この画面に戻ってください。':'Your file is ready. Return here after saving it.',
    '「保存・共有」を押し、次の画面で「“ファイル”に保存」を選んでください。':'Choose Save / share, then choose Save to Files on the next screen.',
    'ダウンロード後にプレビューが開いた場合は、「次の方法で開く」または共有ボタンから「“ファイル”に保存」を選んでください。':'If a preview opens after downloading, use Open in or the share button, then choose Save to Files.',
    '上書きしたい場合は、元と同じフォルダ・ファイル名で保存し、置き換え確認が出たら承認してください。':'To replace the original, save in the same folder with the same filename and confirm Replace if prompted.',
    '保存先で保存を完了してください。この画面では保存結果を確認できません。':'Finish saving at the destination. This screen cannot verify whether the file was saved.',
    '共有をキャンセルしました。書き込みは保持されています。':'Sharing was cancelled. Your Writing is preserved.',
    '共有を開けませんでした。「ダウンロードで保存」をお使いください。書き込みは保持されています。':'Could not open sharing. Choose Save by downloading. Your Writing is preserved.',
    '保存の確認を受け付けました。書き込みを続けられます。':'You confirmed saving the file. You can continue writing.',
    'Writingを準備しています…':'Preparing Writing…',
    '道具バーを表示':'Show tools',
    '道具を隠す。長押しでReaderに戻る':'Hide tools. Hold to return to Reader',
    '道具を表示。長押しでReaderに戻る':'Show tools. Hold to return to Reader',
    '書き込みを保存しますか？':'Save your Writing?',
    '元のファイルは上書きされません。保存せず戻っても、書き込みはReaderと端末内の下書きに残ります。':'The original file is not overwritten. Returning without a file export keeps your Writing in Reader and the local draft.',
    '編集用DSFRを保存':'Save editable DSFR','ファイルに保存せず戻る':'Return without a file export','書き込みを続ける':'Continue Writing',
    '保存ファイルを準備しています…':'Preparing the file…','ダウンロードしてReaderに戻る':'Download and return to Reader',
    '保存ファイルの準備ができました。ダウンロードを押してください。':'Your file is ready. Choose Download to continue.',
    '以前のWriting画面が開いています。必要な内容をDSFに保存してから、その画面を閉じて再試行してください。':'An older Writing screen is still open. Export any changes to DSF, close it, then try again.',
    'このDSFは今回の読込対象外の形式です。形式2またはWriting形式3のDSFを選んでください。元のファイルは変更していません。':'This DSF format is not supported. Choose a format 2 or Writing format 3 file. The original file is unchanged.',
    'このDSFの原本書体は、Writing形式へのコピーにまだ対応していません。元のファイルは変更していません。':'The original font cannot yet be copied into Writing format. The original file is unchanged.',
    'これは編集用DSPの構造です。Writingでは配信用DSFを開いてください。':'This is an authoring DSP file. Open a distribution DSF in Writing.',
    'DSFをまだ開けていません。接続を閉じるとReaderへ戻れます。':'No DSF is open yet. Close the connection to return to Reader.',
    'Writingを読み込めませんでした。':'Could not load Writing.','Writingの表示設定を読み込めませんでした。':'Could not load the Writing styles.','Writingを開始できませんでした。':'Could not start Writing.','Readerに戻せませんでした。書き込みは保持しています。':'Could not return to Reader. Your Writing is preserved.',
    '共有用':'Shared','編集用':'Editable','サンプルを開くと、8ページの原本に自由に書き込めます。':'Open the sample to write on eight practice pages.',
    'この確認ページでは、ファイルと書き込みを端末内で扱います。まず「サンプルを開く」で試せます。':'This preview stores files and Writing on your device. Choose Open sample to try it.',
    '試し方・書体ライセンス':'Instructions / font licenses','使用書体とライブラリのライセンス':'Font and library licenses',
    '矩形選択':'Rectangle selection','囲んだ書き込みをまとめて選択。選択した筆跡をドラッグして移動できます。':'Enclose objects to select them together. Drag selected ink to move the group.','選択・移動':'Select / move','選択':'Select','ボールペン':'Ballpoint','筆ペン':'Brush pen','サインペン':'Felt-tip','蛍光マーカー':'Highlighter','修正液':'Whiteout','文字':'Text','線':'Line','矢印':'Arrow','四角':'Rectangle','楕円':'Ellipse','筆跡':'Stroke','図形':'Shape','線・図形':'Lines / shapes',
    '設定':'Settings','キャンセル':'Cancel','閉じる':'Close','適用':'Apply','確定':'Done','保存':'Save','コピー':'Copy','切り取り':'Cut','貼り付け':'Paste','複製':'Duplicate','削除':'Delete','ロック':'Lock','ロック解除':'Unlock','元に戻す':'Undo','やり直す':'Redo','↶ 元に戻す':'↶ Undo','↷ やり直す':'↷ Redo',
    '線の太さ':'Line width','墨の量':'Ink amount','少ない：カスレ ／ 多い：滲み（疑似表現）':'Less: dry strokes / more: simulated ink bleed',
    '正方形・正円（Ctrl）':'Square / circle (Ctrl)','端点をスナップ':'Snap endpoints','先端の形':'Endpoint shape','開いた矢印':'Open arrow','三角':'Triangle','丸':'Circle','ひし形':'Diamond','始点につける':'Start','終点につける':'End','線の種類':'Line style','実線':'Solid','破線':'Dashed','点線':'Dotted','一点鎖線':'Dash-dot',
    '書体':'Font','サイズ':'Size','文字サイズ':'Text size','文字の太さ':'Font weight','太さ':'Weight','標準':'Regular','太字':'Bold','縦書き':'Vertical','色':'Color','その他の色':'Custom color','文字色':'Text color','文字を小さく':'Decrease text size','文字を大きく':'Increase text size','代表的な文字サイズ':'Common text sizes','代表サイズ':'Presets',
    'テキストボックス':'Text box','枠線':'Border','枠線の色':'Border color','枠線の太さ':'Border width','塗りつぶし':'Fill','塗りつぶしの色':'Fill color','文字を追加':'Add text','文字を編集':'Edit text','文字を配置しました。':'Text added.','書き込む文字':'Text to insert','配置する':'Insert','ここに文字を入力':'Type here','ページ上のテキストボックス':'Text box on page','文字の書式と確定':'Text formatting and confirmation','テキストボックスを移動':'Move text box','テキストボックスの大きさを変更':'Resize text box',
    '文字サイズを1〜360の数値で入力してください。':'Enter a text size from 1 to 360.','枠線の太さを0.1〜8 mmで入力してください。':'Enter a border width from 0.1 to 8 mm.','書体と文字を確認中…':'Checking font and characters…',
    'ブラック':'Black','ホワイト':'White','グレー':'Gray','レッド':'Red','ブルー':'Blue','グリーン':'Green','オレンジ':'Orange','ピンク':'Pink','パープル':'Purple','スカイブルー':'Sky blue','ブラウン':'Brown','ネイビー':'Navy','ターコイズ':'Turquoise',
    'ビビッド':'Vivid','ブライト':'Bright','パステル':'Pastel','マイルド':'Mild','くすみ':'Muted','アース':'Earth','ディープ':'Deep',
    'レモン':'Lemon','ライム':'Lime','アクア':'Aqua','ホットピンク':'Hot pink','タンジェリン':'Tangerine','サンフラワー':'Sunflower','コーラル':'Coral','フューシャ':'Fuchsia','バイオレット':'Violet','シアン':'Cyan','クリーム':'Cream','ピーチ':'Peach','ベビーピンク':'Baby pink','ラベンダー':'Lavender','ミント':'Mint','バター':'Butter','アプリコット':'Apricot','ローズ':'Rose','ライラック':'Lilac','パウダーブルー':'Powder blue','ダスティピンク':'Dusty pink','モーヴ':'Mauve','スモーキーブルー':'Smoky blue','セージ':'Sage','グレージュ':'Greige','オリーブ':'Olive','オーカー':'Ochre','サンド':'Sand','テラコッタ':'Terracotta','ココア':'Cocoa','ボルドー':'Bordeaux','プラム':'Plum','インディゴ':'Indigo','フォレスト':'Forest','スレート':'Slate',
    '選択した書き込みの操作':'Selected object actions','選択した書き込みの設定':'Selected object settings','選択した書き込みの変更を「適用」で確定します。':'Choose Apply to confirm changes to the selected object.','選択に設定を適用':'Apply settings to selection','選択を削除':'Delete selection','変更をキャンセルして閉じる':'Cancel changes and close','パネルを閉じる':'Close panel','色・道具の設定':'Tool settings','色・設定':'Color / settings',
    '書体・サイズ':'Font / size','対象を選択':'Select an object','ページ上の書き込みを選択':'Select an object on the page','色・太さなどを調整':'Adjust color, width and style','設定を開く':'Open settings',
    '両端の点をドラッグして再編集。近くの端点にスナップします。':'Drag either endpoint to edit. Endpoints snap to nearby points.','8個のハンドルで再編集。Ctrlで正方形・正円。':'Resize with the eight handles. Hold Ctrl for a square or circle.','動きの速さと向きで起筆・送筆・収筆を疑似表現します。':'Stroke speed and direction simulate the brush entry, movement and release.','不透明の白を重ねます。選択して削除・Undoできます。':'Adds opaque white ink. Select to delete, or undo.',
    '現在の設定による見本':'Sample with current settings','ボールペンの太さ':'Ballpoint width','色のパレット':'Color palette','道具':'Tools','ペン':'Pens','非表示':'Hidden','道具を表示':'Show tools','上端に触れて道具を表示':'Touch the top edge to show tools','ペンを選ぶ':'Choose a pen','ページ上の道具':'Drawing tool','ペン → 道具 → 非表示':'Pens → Tools → Hide',
    'レイヤー':'Layers','レイヤー・重ね順':'Layers / stacking order','現在のページ · 上ほど手前。原稿本体は最背面に固定されています。':'Current page · Top items appear in front. The original page stays behind all Writing objects.','書き込みの重ね順':'Writing stacking order','最前面':'Bring to front','一つ手前':'Bring forward','一つ奥':'Send backward','最背面':'Send to back','このページに書き込みはありません。':'No Writing objects on this page.','ドラッグして重ね順を変更。上下キーでも移動できます。':'Drag to reorder. You can also use the Up and Down keys.',
    '複数の書き込みの設定':'Multiple object settings','混在':'Mixed','色は混在しています':'Mixed colors','変更した色・太さだけを一括適用します。文字は色のみ変更します。':'Only changed color and width are applied. Text receives color only.','書き込みを押して選択。空いている場所からドラッグしてまとめて選択できます。':'Tap an object to select it. Drag from an empty area to select a group.','履歴':'History','書き込みと履歴':'Objects and history','書き込み一覧':'Writing objects','この履歴に戻る':'Restore this point','— 選択なし —':'— No selection —','開始時点':'Starting point','現在':'Current','共有用：履歴なし・編集ロック':'Shared copy: no history, editing locked','書き込みの取り消しと表示':'Undo, redo and view controls','履歴を復元しました。':'History restored.',
    '重ね順を変更':'Change stacking order','ドラッグで重ね順を変更':'Reorder by dragging','道具の設定を変更':'Change object style','ポイントを編集':'Edit control point','書き込みを移動':'Move object','書き込みを削除':'Delete object','書き込みを切り取り':'Cut object','書き込みを複製':'Duplicate object','書き込みを貼り付け':'Paste object','オブジェクトをロック':'Lock object','ロックを解除':'Unlock object','見開きへの書き込みを追加しました。':'Writing added across the spread.','書き込みをコピーしました。ページの長押しから貼り付けできます。':'Object copied. Long-press the page to paste.',
    'DSFの保存':'Save DSF','DSFを開く':'Open DSF','サンプルを開く':'Open sample','オフライン準備':'Prepare offline','入力用書体の準備':'Prepare input fonts','編集用DSFを作成':'Create editable DSF','共有用DSFを作成':'Create shared DSF','編集用は履歴つき。共有用は現在の書き込みをロックし、履歴を含めません。':'Editable files include history. Shared files lock the current Writing and exclude history.','DSFをダウンロード':'Download DSF','編集用DSFをダウンロード':'Download editable DSF','共有用DSFをダウンロード':'Download shared DSF','作成したDSFを開き直す':'Reopen created DSF','端末内の下書き':'Local drafts','下書きを開く':'Open draft','端末内の下書きは自動保存されます。':'Drafts are saved automatically on this device.','端末内の下書きに保存中…':'Saving local draft…','この端末に下書き保存済み · DSFへの書き出しは別操作です。':'Draft saved on this device · Export to save a DSF file.','下書きを開きました。':'Draft opened.','共有用DSFを表示中。編集・下書き保存は行いません。':'Viewing a shared DSF. Editing and draft saving are disabled.','共有用 · 書き込みロック':'Shared · Writing locked','Writing · 原本を保護':'Writing · Original protected',
    '検証情報':'Diagnostics','作成ファイルを検証フォルダーへ保存':'Save created file to test folder','準備中…':'Preparing…','書き込みモード':'Writing mode','原本の上に、あなたの書き込みを。':'Your notes, on top of the original.','開発プレビュー':'Development preview','ステージング確認版':'Staging preview','Writing操作':'Writing controls',
    'ページ':'Page','前のページ':'Previous page','次のページ':'Next page','言語':'Content language','見開き':'Spread','表示モード':'View mode','閲覧':'Read','書き込み':'Writing','原本を保ったまま重ねて書く':'Write over the original','移動は「閲覧」で':'Switch to Read to pan','拡大':'Zoom','全体':'Fit','ページ全体を表示':'Fit page','ページを幅いっぱいに拡大':'Fit page to width','DSFを開いて始める':'Open a DSF to start',
    'Writingページ。ペンはドラッグ、文字はクリックで追加':'Writing page. Drag to draw, click to add text.','Writingページ。文字はクリックまたはドラッグで枠を作り、直接入力。再編集はダブルクリックまたは設定から。':'Writing page. Click or drag a text box and type. Double-click or use Settings to edit again.',
    '閲覧モード：書き込みは表示したまま、描画を停止しています。':'Read mode: Writing stays visible; drawing is paused.','書き込みを選び、移動・端点編集・ハンドルでのサイズ変更ができます。':'Select an object to move it, edit endpoints or resize with handles.','文字を置く位置をページ上でクリックしてください。':'Click the page where you want to add text.','白い修正液を重ねます。原本を消す操作ではありません。':'Overlays white ink without erasing the original.','ゆっくり、速く、方向を変えて。入りと抜きのある筆跡を試してください。':'Vary your speed and direction to try expressive brush strokes.','ペン先を選んでドラッグ。線は端点へスナップ、Ctrlで正方形・正円になります。':'Choose a tool and drag. Lines snap to endpoints; Ctrl constrains squares and circles.','ページめくりは前後ボタン・矢印キー、書き込み中は2本指、閲覧中は1本指スワイプ。':'Turn pages with navigation buttons or arrow keys. Swipe with two fingers while writing, or one finger while reading.',
    'DSFを開くか、サンプルで書き込みを試してください。':'Open a DSF, or try Writing with the sample.','既存DSFを検証してWriting用コピーを準備しています…':'Validating DSF and preparing a Writing copy…','既存DSFからWriting用コピーを開きました。元のファイルは変更されません。保存は形式3になります。':'Opened a Writing copy of the DSF. The original file is unchanged. Exports use format 3.',
    'サンプル読込':'Load sample','DSF読込':'Load DSF','下書き復元':'Restore draft','言語切替':'Switch content language','編集用DSF作成':'Create editable DSF','共有用DSF作成':'Create shared DSF','作成したDSFの再読込':'Reopen created DSF','Readerから読込':'Load from Reader','Readerへ戻る準備':'Prepare to return to Reader','検証フォルダーへの保存':'Save to test folder',
    '処理が完了するまでお待ちください。':'Please wait for the current operation to finish.','入力中の文字を配置するか、キャンセルしてください。':'Finish or cancel the text edit first.','入力中の文字を配置するか、キャンセルしてからReaderへ戻ってください。':'Finish or cancel the text edit before returning to Reader.','書き込みを保存・書き出し':'Save / export Writing','書き込みの設定':'Writing settings','書き込みの履歴':'Writing history','Readerに戻る':'Return to Reader','書き込み / Writing':'Writing','書き込みを終了してReaderに戻る':'Finish Writing and return to Reader','共有用DSFは書き込みロックされています':'Writing is locked in shared DSF files',
    'オフライン準備では、画面と入力用の2書体をこの端末に保存します。':'Offline preparation stores this screen and two input fonts on this device.','準備した入力用書体は通信なしでも使えます。Reader画面のオフライン起動は引き続き検証中です。':'Prepared input fonts work offline. Offline startup of the Reader is still being tested.','入力用2書体をこの端末に保存しました。Reader画面のオフライン起動は引き続き検証中です。':'Two input fonts are saved on this device. Offline Reader startup is still being tested.','画面と入力用2書体の準備が完了しました。この端末で通信を切って書き込み・保存を試せます。':'This screen and two input fonts are ready. You can test writing and saving offline on this device.',
    '文字を1〜2,000文字で入力してください。':'Enter 1–2,000 characters.','文字が枠に収まりません。右下のハンドルで枠を広げるか、文字サイズを小さくしてください。':'Text does not fit. Enlarge the box with the lower-right handle, or reduce the text size.','ページ内に収まりません。文字を短くするか、サイズ・配置位置を変更してください。':'Text does not fit on the page. Shorten it or change its size or position.','この書体に含まれない文字があります。文字または書体を変更してください。':'Some characters are unavailable in this font. Change the text or font.','入力用書体を取得できません。オンラインで「オフライン準備」を実行してから入力してください。':'The input font is unavailable. Prepare fonts online before typing.','別のタブで下書きが更新されました。このタブの変更はDSFに書き出して保管してください。':'Another tab updated this draft. Export this tab’s changes to DSF to keep them.','端末内に保存できませんでした。画面を閉じる前にDSFへ書き出してください。':'Could not save on this device. Export to DSF before closing.','未保存の下書きがあります。先にDSFを作成して保管してください。':'There is an unsaved draft. Export it to DSF first.','このオブジェクトはロックされています。レイヤーで解除してください。':'This object is locked. Unlock it in Layers.','試作版の履歴・データ上限です。現在の内容は保持しています。':'The prototype data limit was reached. Your current content is preserved.','共有用DSFは書き込みがロックされています。':'Writing is locked in shared DSF files.'
};
export function writingUiText(source,language='en'){
    if(language!=='en')return source;
    if(source==='文字の書式')return 'Text format';
    if(source==='道具を非表示')return 'Hide tools';
    if(source==='道具ドロワー：下へスワイプで開く、上へスワイプで閉じる')return 'Tool drawer: swipe down to open, up to close';
    if(source==='上下にスワイプして道具を出し入れ')return 'Swipe down or up to open or close tools';
    if(source==='左右にスワイプして道具を選択')return 'Swipe horizontally to choose a tool';
    const s=source.trim(),pad=value=>source.slice(0,source.indexOf(s))+value+source.slice(source.indexOf(s)+s.length);
    if(Object.hasOwn(EN,s))return pad(EN[s]);
    let m;
    if((m=s.match(/^(.+)の設定$/))&&EN[m[1]])return pad(`${EN[m[1]]} settings`);
    if((m=s.match(/^(.+)を追加$/))&&EN[m[1]])return pad(`Add ${EN[m[1]].toLowerCase()}`);
    if((m=s.match(/^(.+) \/ (\d+)色$/)))return pad(`${EN[m[1]]||m[1]} / ${m[2]} colors`);
    if((m=s.match(/^(.+)を使用中。道具を表示$/))&&EN[m[1]])return pad(`${EN[m[1]]} active. Show tools`);
    if((m=s.match(/^道具の表示：(.+)。押すと(.+)$/)))return pad(`${EN[m[1]]||m[1]}. Show ${EN[m[2]]||m[2]}`);
    if((m=s.match(/^(.+)が完了しました。$/))&&EN[m[1]])return pad(`${EN[m[1]]} completed.`);
    if((m=s.match(/^(.+)…$/))&&EN[m[1]])return pad(`${EN[m[1]]}…`);
    if((m=s.match(/^(.+) ページ · 書き込み (\d+) 件$/)))return pad(`Page ${m[1]} · ${m[2]} objects`);
    if((m=s.match(/^本全体で直近 (\d+) \/ 30 操作。/)))return pad(`Recent ${m[1]} / 30 operations across the book. Editing after Undo clears Redo. Trimming old history keeps your current objects.`);
    if((m=s.match(/^作成済み · ([\d.]+) KB。/)))return pad(`Created · ${m[1]} KB. Download to keep a file.${s.includes('履歴')?' Your editable draft and history are preserved.':''}`);
    if((m=s.match(/^処理できませんでした（(.+)）。現在の内容は保持しています。$/)))return pad(`Could not complete the operation (${m[1]}). Your current content is preserved.`);
    // Only UI-generated composite labels pass through here, never document text.
    if(s.includes(' · ')||s.includes('：'))return pad(s.split(/( · |：)/).map(v=>EN[v]||v).join('').replaceAll('：',': '));
    if(s.includes('。 '))return pad(s.split('。 ').map((v,i,a)=>writingUiText(v+(i<a.length-1?'。':''),language)).join(' '));
    return source;
}

// Scope the observer to chrome and exclude all rendered/user data, including thumbnails.
const EXCLUDED='#original,#layer,.rw-other-original,.rw-other-layer,.rw-object,#title,#drafts,#objects,#history,#evidence,#receipt,.layer-thumb,.layer-select,[data-writing-user-label],script,style';
export function installWritingLocale(root,{onChange=()=>{},signal}={}){
    let language=getPlatformLanguage('viewer');const originals=new WeakMap();
    const excluded=node=>!!(node.nodeType===1?node:node.parentElement)?.closest(EXCLUDED);
    function translate(node,key,read,write){
        let values=originals.get(node);if(!values){values={};originals.set(node,values);}
        const current=read(),old=values[key],source=old&&current===old.output?old.source:current;
        const output=writingUiText(source,language);values[key]={source,output};if(current!==output)write(output);
    }
    function visit(node){
        if(excluded(node))return;
        if(node.nodeType===3){translate(node,'text',()=>node.nodeValue,v=>node.nodeValue=v);return;}
        if(node.nodeType===1)for(const key of ['aria-label','title','placeholder'])if(node.hasAttribute(key))translate(node,key,()=>node.getAttribute(key),v=>node.setAttribute(key,v));
        for(const child of node.childNodes)visit(child);
    }
    const observer=new MutationObserver(records=>{
        for(const r of records){if(r.type==='childList')for(const node of r.addedNodes)visit(node);else visit(r.target);}
    });
    visit(root);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder']});
    const unsubscribe=subscribePlatformLanguage(next=>{language=next;(root.host||root.documentElement||root).lang=next;visit(root);onChange(next);});
    (root.host||root.documentElement||root).lang=language;
    const dispose=()=>{observer.disconnect();unsubscribe();};signal?.addEventListener('abort',dispose,{once:true});
    return {t:source=>writingUiText(source,language),get language(){return language;},dispose};
}
