/** Localize the static print surface before it is installed in its isolated frame. */
export function localizePrintTemplate(html, en) {
    if (!en) return html;
    const labels = {
        '印刷のヒント':'Printing tips',
        'サムネイルを折りたたむ':'Collapse thumbnails','サムネイルを展開':'Expand thumbnails','裏表紙の前に白紙':'Blanks before back covers: ',
        '倍率100%・余白なし・ヘッダーとフッターなしで印刷してください。':'Use 100% scale, no margins, and no headers or footers.',
        'テキストページの用紙色を印刷':'Print text page paper color',
        '用紙色だけを除外します。文字・画像・図形の色は維持します。画像に焼き込まれた紙色は除去しません。':'Only paper color is omitted. Text, images and shapes retain their colors.',
        '印刷するページを選択してください。':'Select pages to print.',
        'ページ番号の指定を確認してください。':'Check the page range.',
        '余白・塗り足しが大きすぎます。設定を小さくしてください。':'Margins or bleed are too large. Reduce the values.',
        '9:16を維持して各配置枠にフィット。余白は用紙の端から指定します。':'Fit each page at 9:16. Margins are measured from paper edges.',
        '片面：用紙の表だけに印刷':'Single-sided printing',
        '両面・長辺綴じ：長い辺を軸にめくる':'Duplex: turn around the long edge',
        '両面・短辺綴じ：短い辺を軸にめくる':'Duplex: turn around the short edge',
        '中綴じ冊子：両面印刷した用紙を重ねて二つ折り':'Booklet: stack duplex sheets and fold in half',
        '横向き・短辺綴じで両面印刷し、中央で折ります。プリンター側の冊子設定はオフにします。':'Print landscape, short-edge duplex. Fold centrally. Disable printer booklet layout.',
        '印刷ダイアログでも同じ綴じ方向を指定します。図は各面を正立で表示します。':'Use the same duplex edge in the print dialog. Both faces are shown upright.',
        '両面の実行はプリンター側で設定します。':'Enable duplex in the printer dialog.',
        '折り目に寄せて配置。ページ間隔は0、上・下・小口の三方を裁断します。左右の余白の大きい方で共通寸法を決めます。':'Align to the fold with no gutter. Trim the top, bottom and outer edge.',
        '9:16の仕上がりの外側に塗り足しとトンボの空間を確保します。':'Reserve bleed and crop marks outside the 9:16 trim size.',
        '用紙の余白を残します。塗り足しは「9:16に裁断」で使用できます。':'Keep paper margins. Bleed is available with Trim to 9:16.',
        '画像端の画素を延長します。模様によって筋状に見えます。':'Border pixels are extended and may appear streaked.',
        '本文の組版はそのまま。ブラウザーの印刷画面でPDF保存も選べます。':'Layout is preserved. Save as PDF from the browser print dialog.',
        '端の延長は画像の続きを生成しません。出力時はガイドを除外します。':'Edge extension does not generate new image content. Guides are excluded from output.',
        '選択ページは作品順に配置します。冊子の白紙補完も選択後のページ数が基準です。':'Selected pages keep their original order. Booklet padding uses the selected count.',
        '表紙を含む作品順の番号です。':'Numbers follow document order, including covers.',
        '以内のページ番号を入力してください':' is the last available page',
        '印刷 / PDF保存':'Print / Save PDF','印刷ページの選択':'Select print pages','用紙上のページ配置':'Page layout on paper',
        '余白ガイド（確認用）':'Show layout guides','ページ枠線':'Page border','ページ間隔':'Page gap','塗り足し幅':'Bleed width','端の色を延長':'Extend edge colors',
        '9:16に裁断':'Trim to 9:16','余白を残す':'Keep margins','仕上げ方':'Finishing',
        '両面・長辺綴じ':'Duplex: long edge','両面・短辺綴じ':'Duplex: short edge','両面・長辺':'Long-edge duplex','両面・短辺':'Short-edge duplex',
        '冊子（二つ折り）':'Folded booklet','中綴じ冊子':'Saddle-stitch','両面・冊子':'Duplex / booklet','通常・割り付け':'Normal / multiple up',
        '印刷方法':'Print mode','両面設定':'Duplex','読む方向':'Binding','右綴じ':'Right binding','左綴じ':'Left binding',
        '用紙と配置':'Paper and layout','用紙サイズ':'Paper size','用紙の向き':'Orientation','1面のページ数':'Pages per side',
        'ページ番号':'Page numbers','全ページ':'All pages','指定ページ':'Selected pages','すべて選択':'Select all','印刷ページ':'Print pages','印刷対象':'Print range',
        '対象ページなし':'No pages selected','前の印刷面':'Previous side','次の印刷面':'Next side','印刷設定':'Print settings','準備中…':'Preparing…','閉じる':'Close',
        '青破線：仕上がり・折り目 ／ 橙：塗り足し領域（確認用）':'Blue: trim / fold. Orange: bleed (guides only)',
        '折り目・綴じ側':'Fold / spine','斜線：裁断部分':'Hatched: trimmed area','青破線：裁断位置':'Blue: trim','橙枠：':'Orange: ',
        '作品内ページ':'Document page','ページを選択':' pages selected','ページを補い、':' blank pages, ','末尾に白紙':'Add trailing blanks: ',
        '枚へ面付けします。':' sheets imposed.','印刷用紙':'Sheets','補完白紙':'Blank','配置不可':'Cannot fit','仕上がり':'Trim size','塗り足し':'Bleed','トンボ':'Crop marks',
        '言語':'Language','余白':'Margins','用紙':'Paper','片面':'Single-sided','対象':'Range','解除':'Clear','ページ':' pages','例：':'e.g. ',
        '上 ${t}':'Top ${t}','下 ${b}':'Bottom ${b}','左 ${faceLeft}':'Left ${faceLeft}','右 ${faceRight}':'Right ${faceRight}',
        "?'裏':'表'":"?'Back':'Front'",'>上<input':'>Top<input','>下<input':'>Bottom<input','>左<input':'>Left<input','>右<input':'>Right<input',
        '>縦</option>':'>Portrait</option>','>横</option>':'>Landscape</option>','>なし</option>':'>None</option>',
    };
    // One pass: translated output is never processed as another key.
    const keys=Object.keys(labels).sort((a,b)=>b.length-a.length);
    const pattern=new RegExp(keys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
    return html.replace(pattern,key=>labels[key]);
}
