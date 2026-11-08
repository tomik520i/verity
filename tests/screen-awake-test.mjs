import assert from 'node:assert/strict';import {createScreenAwake,screenAwakeLabel} from '../public/screen-awake.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
class Page extends EventTarget{visibilityState='visible';setVisibility(value){this.visibilityState=value;this.dispatchEvent(new Event('visibilitychange'));}}
class Sentinel extends EventTarget{released=false;calls=0;async release(){this.calls++;this.released=true;this.dispatchEvent(new Event('release'));}}
function fixture(request){const doc=new Page(),win=new EventTarget(),states=[],sentinels=[];let calls=0;const api={request(type){assert.equal(type,'screen');calls++;if(request)return request();const lock=new Sentinel();sentinels.push(lock);return Promise.resolve(lock);}};const control=createScreenAwake({doc,win,wakeLock:api,onState:s=>states.push(s)});return {doc,win,states,control,sentinels,get calls(){return calls;}};}
// The page requests immediately without a call, microphone, or initial wake gesture.
const f=fixture();await tick();assert.equal(f.calls,1);assert.equal(f.control.state,'active');
await Promise.all([f.control.refresh(),f.control.refresh()]);assert.equal(f.calls,1);
f.doc.setVisibility('hidden');await tick();assert.equal(f.sentinels[0].calls,1);assert.equal(f.control.state,'hidden');
f.doc.setVisibility('visible');await tick();assert.equal(f.calls,2);assert.equal(f.control.state,'active');
f.sentinels[0].dispatchEvent(new Event('release'));assert.equal(f.control.state,'active');
f.win.dispatchEvent(new Event('pagehide'));await tick();assert.equal(f.control.state,'hidden');await f.control.refresh();assert.equal(f.calls,2);
f.win.dispatchEvent(new Event('pageshow'));await tick();assert.equal(f.calls,3);assert.equal(f.control.state,'active');
// Do not spin after a system release; retry at an actual interaction.
await f.sentinels.at(-1).release();await tick();assert.equal(f.control.state,'released');assert.equal(f.calls,3);
f.doc.dispatchEvent(new Event('pointerdown'));await tick();assert.equal(f.calls,4);assert.equal(f.control.state,'active');
f.control.dispose();await tick();assert.equal(f.sentinels.at(-1).calls,1);f.doc.setVisibility('visible');await tick();assert.equal(f.calls,4);
// Late acquisition must release its lock after the page becomes hidden.
let resolve;const delayed=fixture(()=>new Promise(r=>{resolve=r;}));await tick();delayed.doc.setVisibility('hidden');const stale=new Sentinel();resolve(stale);await tick();assert.equal(stale.calls,1);assert.equal(delayed.control.state,'hidden');delayed.control.dispose();
// Hide/show during an in-flight request must reacquire only once after the stale lock.
const resolvers=[];const racing=fixture(()=>new Promise(r=>resolvers.push(r)));await tick();racing.doc.setVisibility('hidden');racing.doc.setVisibility('visible');assert.equal(racing.calls,1);const obsolete=new Sentinel();resolvers[0](obsolete);await tick();assert.equal(obsolete.calls,1);assert.equal(racing.calls,2);resolvers[1](new Sentinel());await tick();assert.equal(racing.control.state,'active');racing.control.dispose();
// Permission/battery failure is visible and retried only after a new interaction.
let reject=true;const failed=fixture(()=>reject?Promise.reject(Error('NotAllowedError')):Promise.resolve(new Sentinel()));await tick();assert.equal(failed.control.state,'unavailable');assert.equal(failed.calls,1);reject=false;failed.doc.dispatchEvent(new Event('keydown'));await tick();assert.equal(failed.control.state,'active');failed.control.dispose();
const doc=new Page();doc.visibilityState='hidden';let called=0;const hidden=createScreenAwake({doc,win:new EventTarget(),wakeLock:{request(){called++;return Promise.resolve(new Sentinel());}}});await tick();assert.equal(called,0);doc.setVisibility('visible');await tick();assert.equal(called,1);hidden.dispose();
const unsupported=createScreenAwake({doc:new Page(),win:new EventTarget(),wakeLock:{}});await tick();assert.equal(unsupported.state,'unsupported');assert.match(screenAwakeLabel('unsupported'),/neumí/);unsupported.dispose();
console.log('PASS visible-page wake lock before interaction, single acquisition, hide/release, late callbacks, hide/show race, BFCache return, system release, denied retry, unsupported browser and disposal.');
