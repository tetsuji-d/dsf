// Thin adapter around the official harfbuzzjs 1.6.3 subset WASM C ABI.
// No original font mutation, variation pinning, or manual glyph-table rewriting.
let wasm;
export async function init(bytes) { const {instance}=await WebAssembly.instantiate(bytes,{});wasm=instance.exports;wasm._initialize(); }
export async function subset(bytes,{text}) {
    if(!wasm)throw new Error('SUBSET_NOT_READY');
    const w=wasm;let inputPtr=0,blob=0,face=0,config=0,target=0,resultBlob=0;
    try {
        inputPtr=w.malloc(bytes.length);if(!inputPtr)throw new Error('SUBSET_MEMORY');
        new Uint8Array(w.memory.buffer,inputPtr,bytes.length).set(bytes);
        blob=w.hb_blob_create(inputPtr,bytes.length,0,0,0); // HB_MEMORY_MODE_DUPLICATE
        face=w.hb_face_create(blob,0);config=w.hb_subset_input_create_or_fail();
        if(!blob||!face||!config)throw new Error('SUBSET_INPUT');
        w.hb_subset_input_keep_everything(config);
        const unicode=w.hb_subset_input_unicode_set(config),glyphs=w.hb_subset_input_glyph_set(config);
        w.hb_set_clear(unicode);w.hb_set_clear(glyphs);
        for(const c of text+text.normalize('NFC')+text.normalize('NFD'))w.hb_set_add(unicode,c.codePointAt(0));
        target=w.hb_subset_or_fail(face,config);if(!target)throw new Error('SUBSET_FAILED');
        resultBlob=w.hb_face_reference_blob(target);const length=w.hb_blob_get_length(resultBlob),ptr=w.hb_blob_get_data(resultBlob,0);
        if(!ptr||!length||length>32*1024*1024)throw new Error('SUBSET_OUTPUT');
        return new Uint8Array(w.memory.buffer,ptr,length).slice();
    } finally {
        if(resultBlob)w.hb_blob_destroy(resultBlob);if(target)w.hb_face_destroy(target);
        if(config)w.hb_subset_input_destroy(config);if(face)w.hb_face_destroy(face);if(blob)w.hb_blob_destroy(blob);if(inputPtr)w.free(inputPtr);
    }
}
