if (!import.meta.env.DEV) throw new Error('Local UI fixture only');
const { renderAnnotationPreview, getAnnotationSelection, openAnnotationDialog } = await import('../../js/flow-annotation-ui.js');
const initial = {schemaVersion:1,sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'b',type:'paragraph',texts:{ja:'海辺の図書館で、私は小さな物語を読み始めた。\n夏の記憶は、いまも鮮やかに残っている。'}}]}]};
let source = structuredClone(initial), range = null, history = [];
const byId = id => document.getElementById(id);
const surfaces = [byId('source'),byId('canvas')];
const block = () => source.sections[0].blocks[0];
const status = message => { byId('status').textContent = message; };
function select(value) {range=value;byId('selected').textContent=value ? block().texts.ja.slice(value.start,value.end) || 'カーソル位置' : '文字を選択してください';byId('edit').disabled=!value;}
function render() {for(const surface of surfaces)renderAnnotationPreview(surface,block());byId('undo').disabled=!history.length;}
function open() {
    byId('context').hidden=true;
    if (!range) return;
    const opened = openAnnotationDialog({source,sectionId:'s',blockId:'b',range,onApply:next=>{history.push(source);source=next;render();status('試作の原稿・キャンバスに反映しました。');}});
    if(!opened)status('ルビ・圏点を付ける文字を選択してください。');
}
for(const surface of surfaces){
    surface.addEventListener('pointerup',event=>{
        let selected=getAnnotationSelection(surface);
        if(!selected || selected.start===selected.end){
            const base=event.target.closest('[data-base-start]');
            const offset=base && Number(base.dataset.baseStart);
            const a=base && block().annotations?.ja?.find(a=>a.start<=offset && offset<a.end);
            selected=a?{start:a.start,end:a.end}:selected;
        }
        select(selected);
    });
    surface.addEventListener('keyup',()=>select(getAnnotationSelection(surface)));
    surface.addEventListener('contextmenu',event=>{
        const selected=getAnnotationSelection(surface);if(selected && selected.start!==selected.end)select(selected);
        if(!range)return;event.preventDefault();const menu=byId('context');menu.hidden=false;
        menu.style.left=Math.min(event.clientX,innerWidth-menu.offsetWidth-10)+'px';menu.style.top=Math.min(event.clientY,innerHeight-menu.offsetHeight-10)+'px';menu.querySelector('button').focus();
    });
    surface.addEventListener('copy',event=>{const selection=getAnnotationSelection(surface);if(selection){event.preventDefault();event.clipboardData.setData('text/plain',block().texts.ja.slice(selection.start,selection.end));}});
}
byId('edit').onclick=open;byId('context').querySelector('button').onclick=open;
byId('sample').onclick=()=>{select({start:3,end:6});status('「図書館」を選択しました。');};
byId('writing').onchange=event=>{for(const surface of surfaces){surface.dataset.writing=event.target.value;surface.style.writingMode=event.target.value;}};
byId('undo').onclick=()=>{if(history.length){source=history.pop();render();status('直前の設定に戻しました。');}};
byId('reset').onclick=()=>{source=structuredClone(initial);history=[];select(null);render();status('試作を初期状態に戻しました。');};
document.addEventListener('pointerdown',e=>{if(!byId('context').contains(e.target))byId('context').hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')byId('context').hidden=true;});
render();
