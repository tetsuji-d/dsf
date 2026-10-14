let dependencies;
const ready=new Promise(resolve=>{self.Module={onRuntimeInitialized:resolve};});
importScripts('/assets/vendor/wawoff2/decompress_binding.js');
async function setup() {
    if(!dependencies)dependencies=(async()=>{
        await ready;
        const hb=await import('/assets/vendor/harfbuzzjs/index.mjs'),sub=await import('/w0/subsetter.mjs'),enc=await import('/assets/vendor/woff2-encode-wasm/index.js');
        await sub.init(await (await fetch('/assets/vendor/harfbuzzjs/harfbuzz-subset.wasm')).arrayBuffer());
        await enc.init(await (await fetch('/assets/vendor/woff2-encode-wasm/encoder.wasm')).arrayBuffer());
        const {createWritingFontEngine}=await import('/js/dsf-writing-font-engine.js');
        return createWritingFontEngine({hb,subset:sub.subset,encode:enc.encode,decode:async b=>{const output=self.Module.decompress(b);if(!output)throw new Error('FONT_DECODE');return new Uint8Array(output);}});
    })();return dependencies;
}
onmessage=async({data})=>{try{const engine=await setup();const result=await engine[data.method](...data.args);postMessage({id:data.id,result});}catch(e){postMessage({id:data.id,error:e.message});}};
