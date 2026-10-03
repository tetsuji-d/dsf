// Reuse the code-native file icon lettering. No font or image service dependency.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '../..');
const out = path.join(repo, 'outputs/windows-preview');
const sizes = [16,24,32,48,64,128,256];
function dib(rgba, size) {
  const stride = Math.ceil(size / 32) * 4;
  const bytes = Buffer.alloc(40 + size * size * 4 + stride * size);
  bytes.writeUInt32LE(40, 0); bytes.writeInt32LE(size, 4); bytes.writeInt32LE(size * 2, 8);
  bytes.writeUInt16LE(1, 12); bytes.writeUInt16LE(32, 14); bytes.writeUInt32LE(size * size * 4, 20);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const src=(y*size+x)*4, dst=40+((size-1-y)*size+x)*4;
    bytes[dst]=rgba[src+2]; bytes[dst+1]=rgba[src+1]; bytes[dst+2]=rgba[src]; bytes[dst+3]=rgba[src+3];
    if(!rgba[src+3]) bytes[40+size*size*4+(size-1-y)*stride+(x>>3)] |= 0x80>>(x&7);
  }
  return bytes;
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    for(const type of ['dsf','dsp']) {
      const source=fs.readFileSync(path.join(repo,'public/file-icons',type+'.svg'),'utf8');
      const lettering=source.match(/<g fill="white"[^>]*>([\s\S]*)<\/g>/)?.[1];
      if(!lettering) throw new Error('File icon lettering is missing');
      const color=type==='dsf'?'#2457C5':'#087D72';
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="2" y="148" width="252" height="106" rx="14" fill="${color}" stroke="white" stroke-width="4"/><g fill="white" fill-rule="evenodd" transform="translate(18 168) scale(2.5)">${lettering}</g></svg>`;
      fs.writeFileSync(path.join(out,type+'-overlay.svg'),svg);
      const images=[];
      for(const size of sizes) {
        const data=await page.evaluate(async({svg,size})=>{
          const image=new Image(); image.src='data:image/svg+xml;base64,'+btoa(svg); await image.decode();
          const canvas=document.createElement('canvas'); canvas.width=canvas.height=size;
          const context=canvas.getContext('2d'); context.drawImage(image,0,0,size,size);
          return {rgba:Array.from(context.getImageData(0,0,size,size).data),png:canvas.toDataURL('image/png').split(',')[1]};
        },{svg,size});
        images.push(dib(data.rgba,size));
        if(size===256) fs.writeFileSync(path.join(out,type+'-overlay.png'),Buffer.from(data.png,'base64'));
      }
      const header=Buffer.alloc(6+16*sizes.length); header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
      let offset=header.length;
      images.forEach((bytes,i)=>{ const at=6+i*16; header[at]=header[at+1]=sizes[i]===256?0:sizes[i]; header.writeUInt16LE(1,at+4); header.writeUInt16LE(32,at+6); header.writeUInt32LE(bytes.length,at+8); header.writeUInt32LE(offset,at+12); offset+=bytes.length; });
      fs.writeFileSync(path.join(out,type+'-overlay.ico'),Buffer.concat([header,...images]));
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
