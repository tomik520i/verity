import assert from 'node:assert/strict';
import {requestImages,MAX_IMAGES,MAX_IMAGE_CHARS,MAX_IMAGES_CHARS} from '../public/image-limits.mjs';
const image='data:image/png;base64,AA==';
assert.deepEqual(requestImages({}),[]);
assert.deepEqual(requestImages({image}),[image]);
assert.equal(requestImages({images:Array(10).fill(image)}).length,10);
assert.throws(()=>requestImages({images:Array(11).fill(image)}),/10/);
assert.throws(()=>requestImages({images:image}),/seznam/);
for(const bad of ['https://example.com/a.png','data:image/svg+xml;base64,AA==','data:image/png;base64,@@@',null])
 assert.throws(()=>requestImages({images:[bad]}));
assert.throws(()=>requestImages({images:['data:image/png;base64,'+'A'.repeat(MAX_IMAGE_CHARS)]}),/velký/);
assert.throws(()=>requestImages({images:Array(3).fill('data:image/png;base64,'+'A'.repeat(Math.ceil(MAX_IMAGES_CHARS/3)))}),/dohromady/);
const handlers={},els=new Map(),$=id=>{if(!els.has(id))els.set(id,{});return els.get(id);};
globalThis.document={getElementById:$,addEventListener:(t,fn)=>handlers[t]=fn};
globalThis.matchMedia=()=>({matches:false});
const {setupPhoto}=await import('../public/photo.js');
let photos=[],errors=[],busy=[],wait;
const picker=setupPhoto({
 getCount:()=>photos.length,onPhoto:p=>photos.push(p),onError:e=>errors.push(e),onBusy:v=>busy.push(v),
 prepare:async f=>{if(f.name==='slow')await new Promise(r=>wait=r);if(f.name==='bad')throw Error('Nečitelný obrázek');return f.name;}
});
const file=name=>({name,type:'image/png'});
const first=picker.handleFiles([file('slow'),file('2')]);await Promise.resolve();
const second=picker.handleFiles([file('3')]);wait();await Promise.all([first,second]);
assert.deepEqual(photos,['slow','2','3']);assert.equal(busy.at(-1),false);
await picker.handleFiles(Array.from({length:12},(_,i)=>file(String(i+4))));
assert.equal(photos.length,MAX_IMAGES);assert.match(errors.at(-1),/10/);
photos.splice(2,1);await picker.handleFiles([file('new')]);assert.equal(photos.at(-1),'new');
photos=[];await picker.handleFiles([file('bad'),file('good')]);assert.deepEqual(photos,['good']);
let prevented=0;handlers.paste({preventDefault:()=>prevented++,clipboardData:{items:['a','b'].map(name=>({type:'image/png',getAsFile:()=>file(name)}))}});
await picker.handleFiles([]);for(let i=0;i<12;i++)await Promise.resolve();
assert.equal(prevented,1);assert.deepEqual(photos,['good','a','b']);
console.log('PASS images: 10/count/size/type validation, legacy API, selection queue/order, add after removal, failed decode, multiple pasted images.');
