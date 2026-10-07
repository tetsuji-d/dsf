import {selectProjectAuthoringCoverThumbnail} from './project-listing-thumbnail.js';
// Recover display-only thumbnail URLs; never rewrite the manuscript or its index.
export async function restoreRecentThumbnail(item, record, readAsset, encode) {
    const ref=item.listThumbnail || item.thumbnail || '';
    if(!ref.startsWith('blob:'))return ref;
    const cover=selectProjectAuthoringCoverThumbnail(record?.state,{allowLocal:true});
    const id=record?.imageMap?.[ref] || record?.imageMap?.[cover];
    if(!id)return '';
    const blob=await readAsset(id);
    return blob instanceof Blob && blob.size ? encode(blob) : '';
}
