import {fixture as writingFixture,FONT_IDS} from '../writing-w0/fixtures.mjs';
import {makeFormat} from '../../js/dsf-writing-contract.js';
export function originalFixture(catalog) {
    const styles=Object.fromEntries(FONT_IDS.map((id,i)=>[`s${i}`,{fontRef:id,fontSize:20,fontWeight:i?700:400,lineHeight:1.8,letterSpacing:0,color:'#123456'}]));
    const line=(text,x,y,mode,styleRef)=>({x,y,width:mode==='vertical-rl'?36:300,height:mode==='vertical-rl'?500:36,writingMode:mode,textOrientation:'mixed',styleRef,runs:[{text}]});
    const pages=[{id:'page1',pageLabel:'1',renderKind:'fixedText',sourceAnchor:{kind:'fixed',blockId:'block1'},background:{color:'#fffdf8'},
        lines:[line('原本は変更しません。',24,24,'horizontal-tb','s0'),line('明朝とゴシック',24,64,'horizontal-tb','s1')]},
        {id:'page2',pageLabel:'2',renderKind:'fixedText',sourceAnchor:{kind:'fixed',blockId:'block2'},background:{color:'#fffdf8'},
            lines:[line('第二頁。縦書き「確認」',280,24,'vertical-rl','s1')]}];
    return {meta:{workId:'writing-w1-fixture',releaseId:'writing-w1-release',title:'Writing W1 架空の検証原稿',author:'DSF検証'},
        bundle:{index:{schemaVersion:2,layoutModel:'fixed-page-hybrid-1',canonicalPage:{width:360,height:640,aspectRatio:'9:16'},defaultLang:'ja',
            fonts:Object.fromEntries(catalog.map(c=>[c.id,{family:c.family,version:c.version,source:'registry',href:c.asset.url,sha256:c.asset.sha256}])),
            languages:{ja:{href:'content/ja.json',pageCount:2,sha256:'0'.repeat(64),pageDirection:'rtl'}}},manifests:{ja:{schemaVersion:1,language:'ja',styles,pages}}}};
}
export async function editableFixture(handle) {
    const {editable}=await writingFixture();editable.format=makeFormat('writing-editable',handle.baseHash);editable.document.baseContentHash=handle.baseHash;
    // A single text box with two fonts; both ordinary and historical runs survive export.
    for(const snapshot of [editable.document.pages,...editable.history.revisions.map(r=>r.pages)])if(snapshot.length) {
        const text=snapshot[0].objects[0],first=text.runs[0];
        if(text.text.length>1)text.runs=[{...first,end:1},{...first,start:1,fontId:FONT_IDS[1]}];
    }
    return editable;
}
