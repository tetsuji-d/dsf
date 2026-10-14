import JSZip from 'jszip';
import {loadDsfLocalViewerPackage} from '../../js/dsf-local-viewer-package.js';
import {createDsfV3Original} from '../../js/dsf-writing-package.js';
import {sha256,ensure,WRITING_LIMITS} from '../../js/dsf-writing-contract.js';

/** One-way import of current Press portable v2. Source is never modified.
 * Validate with the product Reader, then preserve page layout and WebP bytes.
 * A new format-3 base is generated with source-matched font subsets.
 */
export async function importWritingV2(bytes,options,viewerOptions={}) {
    ensure(bytes.length<=WRITING_LIMITS.expandedBytes,'ZIP_LIMIT');
    // Inspect sizes before the product Reader's CRC/decompression pass.
    const zip=await JSZip.loadAsync(bytes,{checkCRC32:false,createFolders:false});
    let total=0;const entries=Object.values(zip.files);
    ensure(entries.length<=WRITING_LIMITS.entries,'ZIP_COUNT');
    for(const entry of entries){const n=entry._data?.uncompressedSize;ensure(Number.isSafeInteger(n)&&n>=0,'ZIP_UNSUPPORTED');total+=n;ensure(total<=WRITING_LIMITS.expandedBytes,'ZIP_LIMIT');}
    const verified=await loadDsfLocalViewerPackage({...viewerOptions,file:new Blob([bytes])});
    ensure(verified,'DSF3_REQUIRED');
    try {
        const bundle=structuredClone({index:verified.index,manifests:verified.manifests}),images=new Map();
        const read=async path=>{const entry=zip.file(path);ensure(entry,'DSF3_MISSING_ENTRY');return entry.async('uint8array');};
        for(const [id,font] of Object.entries(bundle.index.fonts)){
            const source=options.catalog.find(c=>c.id===id);
            ensure(source&&source.asset.sha256===font.sha256&&source.version===font.version,'WRITING_IMPORT_FONT');
        }
        for(const manifest of Object.values(bundle.manifests))for(const page of manifest.pages){
            for(const [object,key] of [[page.image,'href'],[page.background,'imageHref']])if(object?.[key]){
                ensure(/^\.\.\/assets\/images\//.test(object[key]),'DSF3_IMAGE_PATH');
                const image=await read(object[key].slice(3)),path=`assets/images/${await sha256(image)}.webp`;
                images.set(path,{path,bytes:image});object[key]='../'+path;
            }
        }
        const converted=await createDsfV3Original({bundle,meta:verified.meta,images:[...images.values()]},{...options,
            getFont:id=>read(verified.index.fonts[id].href)});
        return {bytes:converted.bytes,sourceSha256:verified.archive.sha256,sourceByteLength:bytes.length,pageCount:Object.values(bundle.manifests).reduce((n,m)=>n+m.pages.length,0)};
    }finally{verified.dispose();}
}
