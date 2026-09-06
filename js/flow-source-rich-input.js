/** Editable source surface with a textarea-compatible selection API; readings are never source text. */
import { renderAnnotationPreview } from './flow-annotation-ui.js';

function baseNodes(root) {
    const walker=root.ownerDocument.createTreeWalker(root,4);
    const result=[];
    while(walker.nextNode()) if(!walker.currentNode.parentElement?.closest('[data-annotation-text]')) result.push(walker.currentNode);
    return result;
}
function plainText(root) { return baseNodes(root).map(n=>n.data).join(''); }
function position(root,node,offset) {
    if(!node || !(root===node || root.contains(node)))return null;
    const range=root.ownerDocument.createRange();range.selectNodeContents(root);
    try {range.setEnd(node,offset);}catch{return null;}
    const content=range.cloneContents();content.querySelectorAll('[data-annotation-text]').forEach(e=>e.remove());
    return content.textContent.length;
}
function selection(root) {
    const s=root.ownerDocument.getSelection();
    const anchor=position(root,s?.anchorNode,s?.anchorOffset),focus=position(root,s?.focusNode,s?.focusOffset);
    return anchor===null || focus===null ? (root._savedSelection || {start:0,end:0,direction:'none'})
        : {start:Math.min(anchor,focus),end:Math.max(anchor,focus),direction:focus<anchor?'backward':'none'};
}
function setSelection(root,start,end,direction='none') {
    const nodes=baseNodes(root);
    if(!nodes.length){root.appendChild(root.ownerDocument.createTextNode(''));nodes.push(root.firstChild);}
    const find=offset=>{for(const node of nodes){if(offset<=node.length)return {node,offset};offset-=node.length;}return {node:nodes.at(-1),offset:nodes.at(-1).length};};
    const a=find(start),b=find(end),s=root.ownerDocument.getSelection();
    if(direction==='backward')s.setBaseAndExtent(b.node,b.offset,a.node,a.offset);else s.setBaseAndExtent(a.node,a.offset,b.node,b.offset);
    root._savedSelection={start,end,direction};
}
export function refreshFlowRichInput(root,block,language) {
    if(!root?.dataset.flowRichInput || root._composing)return;
    const range=selection(root),focused=root.ownerDocument.activeElement===root;
    renderAnnotationPreview(root,block,language);
    root.querySelectorAll('[data-annotation-text]').forEach(e=>e.setAttribute('contenteditable','false'));
    if(focused)setSelection(root,Math.min(range.start,root.value.length),Math.min(range.end,root.value.length),range.direction);
}
export function installFlowRichInput(textarea,block,language) {
    const root=textarea.ownerDocument.createElement('div');
    for(const attr of textarea.attributes)if(!['rows','placeholder'].includes(attr.name))root.setAttribute(attr.name,attr.value);
    root.contentEditable='true';root.setAttribute('role','textbox');root.setAttribute('aria-multiline','true');
    root.dataset.flowRichInput='true';root.classList.add('flow-rich-source-input');root.lang=language;
    Object.defineProperties(root,{
        value:{get:()=>plainText(root),set:text=>{root.textContent=text;}},
        selectionStart:{get:()=>selection(root).start},selectionEnd:{get:()=>selection(root).end},selectionDirection:{get:()=>selection(root).direction},
    });
    root.setSelectionRange=(a,b,d)=>setSelection(root,a,b,d);
    const replace=text=>{
        const range=selection(root),value=root.value;
        root.textContent=value.slice(0,range.start)+text+value.slice(range.end);
        setSelection(root,range.start+text.length,range.start+text.length);
        root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
    };
    root.addEventListener('beforeinput',event=>{
        if(event.isComposing || root._composing)return;
        if(['insertParagraph','insertLineBreak'].includes(event.inputType)){event.preventDefault();replace('\n');}
        else if(event.inputType.startsWith('format') || event.inputType==='insertFromDrop')event.preventDefault();
    });
    root.addEventListener('paste',event=>{event.preventDefault();replace((event.clipboardData?.getData('text/plain')||'').replace(/\r\n?/g,'\n'));});
    root.addEventListener('copy',event=>{const range=selection(root);event.preventDefault();event.clipboardData?.setData('text/plain',root.value.slice(range.start,range.end));});
    root.addEventListener('cut',event=>{const range=selection(root);event.preventDefault();event.clipboardData?.setData('text/plain',root.value.slice(range.start,range.end));replace('');});
    root.addEventListener('compositionstart',()=>{root._composing=true;});
    root.addEventListener('compositionend',()=>{root._composing=false;});
    textarea.replaceWith(root);refreshFlowRichInput(root,block,language);return root;
}
