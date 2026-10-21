let dependencies;
const ready=new Promise(resolve=>{self.Module={onRuntimeInitialized:resolve};});
importScripts('/assets/vendor/wawoff2/decompress_binding.js');
async function setup() {
    if(!dependencies)dependencies=(async()=>{
        await ready;
        const [hb,sub]=await Promise.all([import('/assets/vendor/harfbuzzjs/index.mjs'),import('/w0/subsetter.mjs')]);
        await sub.init(await (await fetch('/assets/vendor/harfbuzzjs/harfbuzz-subset.wasm')).arrayBuffer());
        let encoder;
        const encode=async bytes=>{if(!encoder)encoder=(async()=>{const enc=await import('/assets/vendor/woff2-encode-wasm/index.js');await enc.init(await (await fetch('/assets/vendor/woff2-encode-wasm/encoder.wasm')).arrayBuffer());return enc;})().catch(error=>{encoder=undefined;throw error;});return (await encoder).encode(bytes);};
        const {createWritingFontEngine}=await import('/js/dsf-writing-font-engine.js');
        return createWritingFontEngine({hb,subset:sub.subset,encode,decode:async b=>{const output=self.Module.decompress(b);if(!output)throw new Error('FONT_DECODE');return new Uint8Array(output);}});
    })().catch(error=>{dependencies=undefined;throw error;});return dependencies;
}
let queue=Promise.resolve();
onmessage=({data})=>{queue=queue.then(async()=>{try{const engine=await setup();const result=data.method==='warm'?{ready:true}:await engine[data.method](...data.args);postMessage({id:data.id,result});}catch(e){postMessage({id:data.id,error:e.message});}});};
