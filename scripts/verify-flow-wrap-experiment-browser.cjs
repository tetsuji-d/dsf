/* Run with DSF_PLAYWRIGHT_MODULE set to the installed Playwright module path. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const browser = await chromium.launch({channel:'chrome',headless:true});
    try {
        const page = await browser.newPage({viewport:{width:1500,height:980}});
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        await page.goto((process.env.DSF_BASE_URL || 'http://127.0.0.1:5178')+'/scripts/fixtures/flow-image-wrap-lab.html');
        await page.waitForFunction(()=>window.wrapLab?.result);
        const first = await page.evaluate(()=>({index:wrapLab.result.pages.find(p=>p.object).index,object:wrapLab.result.pages.find(p=>p.object).object}));
        await page.click('#more');
        const increased = await page.evaluate(()=>({index:wrapLab.result.pages.find(p=>p.object).index,object:wrapLab.result.pages.find(p=>p.object).object}));
        assert.ok(increased.index>first.index,'anchor follows additional source text');
        assert.deepEqual(increased.object,first.object,'page-local geometry stays fixed');
        await page.click('#less');
        assert.equal(await page.evaluate(()=>wrapLab.result.pages.find(p=>p.object).index),first.index,'removing prefix brings the pair back');
        await page.locator('#anchor').fill('灯台を見上げた。\n\n手紙には「また会おう」と書かれていた。👩‍👩‍👧‍👦 e\u0301');
        await page.waitForFunction(()=>wrapLab.source.sections[0].blocks[1].texts.ja.startsWith('灯台を見上げた。'));
        const report = await page.evaluate(async () => {
            const lab=window.wrapLab;
            const {paginateFlowDocument}=await import('/js/flow-pagination.js');
            const {createFlowDomPageMeasurer}=await import('/js/flow-dom-measurer.js');
            const {segmentGraphemes}=await import('/js/grapheme.js');
            const {getFlowPublicationAnnotationGlyphs}=await import('/js/flow-publication-annotations.js');
            let cases=0, checkedGlyphs=0, annotationGlyphs=0, forwardMoves=0;
            function check(condition,message){if(!condition)throw new Error(message);}
            const fixture=document.createElement('div');fixture.style.cssText='position:fixed;left:0;top:0;z-index:-1';document.body.append(fixture);
            function verifyRendered(source,result){
                const joined=new Map();
                for(const page of result.pages){
                    lab.render(fixture,result,page,lab.imageUrl);
                    const expected=page.fragments.flatMap(getFlowPublicationAnnotationGlyphs).map(g=>g.text).sort();
                    const actual=[...fixture.querySelectorAll('[data-annotation-text]')].map(e=>e.textContent).sort();
                    check(JSON.stringify(expected)===JSON.stringify(actual),'annotation glyph missing/duplicated');
                    annotationGlyphs+=actual.length;
                    for(const el of fixture.querySelectorAll('.flow-dom-block')) {
                        const clone=el.cloneNode(true);clone.querySelectorAll('[data-annotation-text]').forEach(e=>e.remove());
                        const text=el.dataset.emptyFragment==='true'?'':clone.textContent;
                        joined.set(el.dataset.flowBlockId,(joined.get(el.dataset.flowBlockId)||'')+text);
                        const nodes=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
                        for(let node=nodes.nextNode();node;node=nodes.nextNode())for(const g of segmentGraphemes(node.textContent,result.languageKey)){
                            if(!g.segment?.trim() && !g.text?.trim() && !node.textContent.slice(g.index,g.end).trim())continue;
                            if(el.dataset.emptyFragment==='true')continue;
                            const range=document.createRange();range.setStart(node,g.index);range.setEnd(node,g.end);
                            const parent=fixture.getBoundingClientRect();
                            for(const rect of range.getClientRects()){
                                if(!rect.width||!rect.height)continue;
                                const r={left:rect.left-parent.left,right:rect.right-parent.left,top:rect.top-parent.top,bottom:rect.bottom-parent.top};
                                const box=result.pageBox.contentBox;
                                check(r.left>=box.x-1 && r.right<=box.x+box.width+1 && r.top>=box.y-1 && r.bottom<=box.y+box.height+1,'glyph outside page: '+JSON.stringify(r));
                                if(page.object){const o=page.object;check(!(r.left<o.x+o.width && r.right>o.x && r.top<o.y+o.height && r.bottom>o.y),'glyph overlaps image');}
                                checkedGlyphs++;
                            }
                        }
                    }
                }
                for(const b of source.sections.flatMap(s=>s.blocks).filter(b=>b.texts))check(joined.get(b.id)===b.texts[result.languageKey],'rendered text lost/duplicated: '+b.id);
            }
            function verify(source,options,visual=true){
                const before=JSON.stringify(source);const a=lab.compose(source,options),b=lab.compose(source,options);
                check(JSON.stringify(a.pages)===JSON.stringify(b.pages),'cold pagination is nondeterministic');
                check(JSON.stringify(source)===before,'source mutated');
                const objects=a.pages.filter(p=>p.object);check(objects.length===1,'object missing or duplicated');
                check(objects[0].fragments.some(f=>f.blockId===options.object.anchorBlockId&&f.isBlockStart),'anchor not on object page');
                check(a.attempts<=a.pages.length*9,'unbounded composition work');
                lab.verifyWrapSourceCoverage(source,options.languageKey,a.pages);
                if(visual)verifyRendered(source,a);cases++;return a;
            }
            for(const writingMode of ['vertical-rl','horizontal-tb'])for(const wrap of ['square','band'])for(const position of ['left','right','center']){
                const base=lab.options({writingMode});
                const object={...base.object,wrap,x:position==='left'?24:position==='right'?204:114,y:position==='center'?230:56};
                verify(lab.makeDocument(),{...base,object});
            }
            for(const writingMode of ['vertical-rl','horizontal-tb']){
                const base=lab.options({writingMode});
                for(const text of ['', '\n\n', '日本語👩‍👩‍👧‍👦e\u0301\n\n次の行。'.repeat(80)])verify(lab.makeDocument('前文。'.repeat(100),text),base);
                const withBreak=lab.makeDocument();withBreak.sections[0].blocks.splice(1,0,{id:'break',type:'pageBreak'});
                const r=verify(withBreak,base);check(r.pages.filter(p=>p.manualBreakBefore?.blockId==='break').length===1,'manual break was lost or repeated');
                for(const count of [0,100,200,300,400,500,650,800]){
                    const source=lab.makeDocument('前文。'.repeat(count));const r=verify(source,base,false);
                    const m=createFlowDomPageMeasurer({languageKey:'ja',writingMode,typography:base.typography,hyphenation:'none'});
                    try {const baseline=paginateFlowDocument(source,{...base,measurePage:m.measurePage});
                        const p=baseline.pages.find(p=>p.fragments.some(f=>f.blockId==='anchor'&&f.isBlockStart)).index;
                        if(r.pages.find(p=>p.object).index>p)forwardMoves++;
                    }finally{m.dispose();}
                }
            }
            for(const writingMode of ['vertical-rl','horizontal-tb'])for(const wrap of ['square','band']) {
                const source=lab.makeDocument('前文。'.repeat(100),'灯台と約束。'.repeat(180));source.schemaVersion=2;
                const block=source.sections[0].blocks[1];block.annotations={ja:[]};
                for(let start=0;start<block.texts.ja.length;start+=6){
                    block.annotations.ja.push({id:'ruby-'+start,type:'ruby',start,end:start+2,reading:'とうだい'});
                    block.annotations.ja.push({id:'mark-'+start,type:'emphasis',start:start+3,end:start+5,mark:wrap==='band'?'dot':'sesame'});
                }
                const base=lab.options({writingMode});verify(source,{...base,object:{...base.object,wrap}});
            }
            const english=lab.makeDocument();english.sourceLanguage='en';for(const b of english.sections[0].blocks)b.texts.en='The lighthouse stood above the quiet harbor. A letter waited on the desk.\n'.repeat(18);
            verify(english,lab.options({languageKey:'en',writingMode:'horizontal-tb'}));
            for(const [code,change] of [
                ['ANCHOR_MISSING',o=>{o.object.anchorBlockId='missing'}],
                ['INVALID_OBJECT_GEOMETRY',o=>{o.object.width=999}],
                ['INVALID_OBJECT_GEOMETRY',o=>{o.object.gap=-1}],
                ['OBJECT_LEAVES_NO_TEXT_ROOM',o=>{o.object={...o.object,x:24,y:24,width:312,height:592}}],
                ['PAGE_LIMIT_EXCEEDED',o=>{o.maxPages=1}],
            ]){const o=lab.options();change(o);let caught;try{lab.compose(lab.makeDocument(),o)}catch(e){caught=e.code}check(caught===code,'expected '+code+' got '+caught);cases++;}
            const unsupported=lab.makeDocument();unsupported.schemaVersion=3;unsupported.sections[0].blocks[0].titleRegion={id:'title',languageKey:'ja',textAlign:'center',blockAlign:'center'};
            let caught;try{lab.compose(unsupported,lab.options())}catch(e){caught=e.code}check(caught==='UNSUPPORTED_COMPOSITION_FEATURE','title silently accepted');cases++;
            fixture.remove();check(forwardMoves>0,'anchor displacement case was not exercised');
            check(!document.querySelector('.flow-dom-measure-host, .flow-wrap-annotation-measure-host'),'measurement hosts leaked');
            return {cases,checkedGlyphs,annotationGlyphs,forwardMoves};
        });
        assert.equal(errors.length,0,errors.join('\n'));
        await page.click('#reset');
        await page.selectOption('#writing','horizontal-tb');
        assert.equal(await page.locator('#status').getAttribute('data-error'),'false');
        await page.click('#annotations');
        assert.equal(await page.locator('#status').getAttribute('data-error'),'false');
        assert.ok(await page.locator('[data-annotation-text]').count()>0);
        await page.selectOption('#position','center');
        await page.selectOption('#gap','24');
        assert.equal(await page.locator('#status').getAttribute('data-error'),'false');
        console.log('PASS Flow wrap experiment:',JSON.stringify(report));
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
