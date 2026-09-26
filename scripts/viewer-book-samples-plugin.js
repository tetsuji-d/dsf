import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Explicitly opt in when publishing this synthetic review fixture to staging.
// Never copy the outputs directory or package these samples into production.
export function viewerBookSamplesPlugin(mode) {
    if(mode!=='staging'||process.env.DSF_VIEWER_SAMPLES!=='1')return null;
    return {name:'viewer-book-samples',apply:'build',generateBundle(){
        for(const total of [24,120,480]){
            const fileName=`book-edges-${total}.json`;
            const sample=JSON.parse(readFileSync(resolve('outputs',fileName),'utf8'));
            if(sample.title!=='海辺の採集帖'||sample.pages?.length!==total)throw new Error(`Unexpected synthetic sample: ${fileName}`);
            const pages=sample.pages.map((p,i)=>{
                const image=p.content?.backgrounds?.__all;
                if(p.id!==`edge-page-${i}`||typeof image!=='string'||!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw new Error(`Invalid synthetic page: ${fileName}:${i}`);
                return {id:p.id,content:{backgrounds:{__all:image},bubbles:{}}};
            });
            const clean={title:'海辺の採集帖',languages:['ja','en'],defaultLang:'ja',languageConfigs:{ja:{pageDirection:'rtl'},en:{pageDirection:'ltr'}},pages,
                book:{mode:'full',covers:{c1:{pageIndex:0},c2:{pageIndex:1},c3:{pageIndex:total-2},c4:{pageIndex:total-1}},spineDesign:{title:'海辺の採集帖',author:'読書体験の試作',backgroundColor:'#173d42',textColor:'#f4eddb',fontSize:18}}};
            this.emitFile({type:'asset',fileName:`samples/viewer/${fileName}`,source:JSON.stringify(clean)});
        }
        this.emitFile({type:'asset',fileName:'viewer-book-preview/index.html',source:readFileSync(resolve('scripts/fixtures/viewer-book-preview.html'),'utf8')});
    }};
}
