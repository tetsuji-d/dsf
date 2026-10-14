import { makeFormat, describeBase } from '../../js/dsf-writing-contract.js';
export const SAMPLE_TEXT = '東京都「確認」、句読点。ぱぴぷぺぽ ABC 123 p.103 一〇三';
export const SECRET_TEXT = '削除済み秘密 蟹';
export const FONT_IDS = ['noto-sans-jp-2.004-h2', 'noto-serif-jp-2.003-h1'];
export async function fixture() {
    const bytes = s => new TextEncoder().encode(s);
    const files = [{ path: 'meta.json', mimeType: 'application/json', bytes: bytes('{"title":"架空のW0原本"}') },
        { path: 'content.json', mimeType: 'application/json', bytes: bytes('{"languages":["ja"]}') },
        { path: 'content/ja.json', mimeType: 'application/json', bytes: bytes('{"pages":[{"id":"page1"},{"id":"page2"}]}') }];
    const base = await describeBase(files);
    const context = { baseHash: base.sha256, pageKeys: new Set(['ja/page1','ja/page2']), fontIds: new Set(FONT_IDS) };
    const text = (value, fontId, id = 'text1') => ({ id, type: 'text', text: value, rect: [20,20,300,500], writingMode: 'vertical-rl', align: 'start',
        runs: [{ start: 0, end: value.length, fontId, weight: 400, size: 18, color: '#123456' }],
        layout: [...new Intl.Segmenter('ja', {granularity:'grapheme'}).segment(value)].map(s => ({start:s.index,end:s.index+s.segment.length,x:20,y:20+s.index*18})) });
    const stroke = {id:'stroke1',type:'stroke',tool:'brush',color:'#000000',opacity:1,baseWidth:3,geometryVersion:1,
        points:[{x:10,y:10,pressure:0.2,width:0.6},{x:20,y:30,pressure:0.8,width:2.4}]};
    const snapshot = (s) => [{ language:'ja',pageId:'page1',objects:[text(s,FONT_IDS[0]),stroke] },
        {language:'ja',pageId:'page2',objects:[text('第二頁',FONT_IDS[1],'text2')]}];
    const revision = (id,parentId,operation,pages) => ({id,parentId,operation,createdAt:'2026-10-11T00:00:00.000Z',pages});
    const history = {schemaVersion:1,revisions:[revision('r0',null,'開始',[]),revision('r1','r0','入力',snapshot(SECRET_TEXT)),
        revision('r2','r1','削除して入力',snapshot(SAMPLE_TEXT)),revision('r3','r0','別の枝',snapshot('別枝 鶴'))]};
    const editable = {format:makeFormat('writing-editable',base.sha256),document:{schemaVersion:1,documentId:'writing1',baseContentHash:base.sha256,headRevisionId:'r2',pages:snapshot(SAMPLE_TEXT)},history};
    return {files,base,context,editable,original:{format:makeFormat('original',base.sha256),document:null,history:null}};
}
