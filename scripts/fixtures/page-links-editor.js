import { createFlowGroupBlock } from '../../js/flow-project-model.js';
import { createGraphicObject } from '../../js/graphic-object-model.js';

export async function pageLinksEditorFixture() {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const c = canvas.getContext('2d'); c.fillStyle = '#d5e9e5'; c.fillRect(0, 0, 320, 180);
    c.fillStyle = '#3b786c'; c.beginPath(); c.arc(160, 90, 55, 0, Math.PI * 2); c.fill();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp'));
    const url = URL.createObjectURL(blob);
    const image = createGraphicObject('image', 'review_image', 'ja', { assetId: 'review_asset', name: 'キャプション付きの図' });
    image.frame = { x: 50, y: 100, width: 260, height: 146, rotation: 0 };
    image.caption = { texts: { ja: '観察記録の図' }, position: 'bottom', fontSize: 14, gap: 8, color: '#263c38', align: 'left' };
    const text = createGraphicObject('text', 'review_text', 'ja', { name: '参照元の文字' });
    text.texts.ja = '波の仕組みを参照してください。'; text.frame = { x: 35, y: 330, width: 290, height: 160, rotation: 0 };
    const middle=Array.from({length:3},(_,i)=>{const object=createGraphicObject('text',`review_middle_text_${i}`,'ja');object.texts.ja=`観察ノート ${i+2}\n\n波の形と動きを記録します。`;object.frame={x:35,y:90,width:290,height:440,rotation:0};return {id:`review_middle_${i}`,kind:'page',content:{pageKind:'image',background:'',backgrounds:{},bubbles:[],graphicObjects:[object],objectOrder:[object.id]}};});
    return {
        title: 'ページリンク UI確認用（架空原稿）', projectName: 'ページリンク UI確認用',
        blocks: [createFlowGroupBlock({ id: 'review_flow', writingMode: 'horizontal-tb', sourceLanguage: 'ja', document: {
            id: 'review_document', schemaVersion: 2, sections: [{ id: 'review_section', blocks: [
                { id: 'review_heading', type: 'heading', level: 1, texts: { ja: '波の仕組み' } },
                { id: 'review_paragraph', type: 'paragraph', texts: { ja: '寄せては返す波を見つめ、気づいたことを記録します。文字を選択して、リボンから移動先アンカーを登録できます。設定画面でも対象の文字を選び直せます。' } },
            ] }],
        } }), ...middle, { id: 'review_graphic_page', kind: 'page', content: { pageKind: 'image', background: '', backgrounds: {}, bubbles: [], graphicObjects: [image, text], objectOrder: [image.id, text.id] } }],
        assets: [{ id: 'review_asset', name: '架空の図', mimeType: 'image/webp', width: 320, height: 180, byteLength: blob.size, background: url, thumbnail: url }],
    };
}
