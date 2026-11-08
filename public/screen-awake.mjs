// Hold the display for the visible page, independently of microphone/chat state.
export function createScreenAwake({doc=globalThis.document,win=globalThis.window,wakeLock=globalThis.navigator?.wakeLock,onState=()=>{}}={}){
 let lock=null,pending=null,generation=0,pageActive=true,disposed=false,state='idle';
 const visible=()=>!disposed&&pageActive&&doc.visibilityState==='visible';
 const report=next=>{if(state!==next){state=next;onState(next);}};
 const release=sentinel=>{try{return Promise.resolve(sentinel?.release()).catch(()=>{});}catch{return Promise.resolve();}};
 function suspend(){generation++;const old=lock;lock=null;report('hidden');void release(old);}
 function request(){
  if(!visible()){suspend();return Promise.resolve();}
  if(typeof wakeLock?.request!=='function'){report('unsupported');return Promise.resolve();}
  if(lock&&!lock.released){report('active');return Promise.resolve();}
  if(pending)return pending;
  const version=generation;report('requesting');
  const operation=Promise.resolve().then(()=>wakeLock.request('screen')).then(async sentinel=>{
   if(version!==generation||!visible()){await release(sentinel);return;}
   if(sentinel.released){report('released');return;}
   lock=sentinel;
   sentinel.addEventListener('release',()=>{if(lock===sentinel){lock=null;report(visible()?'released':'hidden');}});
   report('active');
  }).catch(()=>{if(version===generation&&visible())report('unavailable');}).finally(()=>{
   if(pending===operation)pending=null;
   // A hide/show cycle may complete while request() is still pending.
   if(version!==generation&&visible()&&!lock)void request();
  });
  pending=operation;return operation;
 }
 const visibility=()=>{if(visible())void request();else suspend();};
 const pagehide=()=>{pageActive=false;suspend();};
 const pageshow=()=>{pageActive=true;void request();};
 const interaction=()=>{if(visible()&&(state==='released'||state==='unavailable'))void request();};
 doc.addEventListener('visibilitychange',visibility);doc.addEventListener('pointerdown',interaction);doc.addEventListener('keydown',interaction);
 win.addEventListener('pagehide',pagehide);win.addEventListener('pageshow',pageshow);
 void request();
 return {refresh:request,get state(){return state;},dispose(){if(disposed)return;disposed=true;suspend();doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('pointerdown',interaction);doc.removeEventListener('keydown',interaction);win.removeEventListener('pagehide',pagehide);win.removeEventListener('pageshow',pageshow);}};
}
export function screenAwakeLabel(state){return {
 active:'Obrazovka zůstává rozsvícená, dokud je Verity vidět.',
 requesting:'Zapínám nezhasínání obrazovky…',
 hidden:'Nezhasínání se obnoví po návratu na Verity.',
 unsupported:'Tento prohlížeč neumí zabránit zhasnutí obrazovky.',
 released:'Systém uvolnil nezhasínání obrazovky. Dalším klepnutím ho zkusím obnovit.',
 unavailable:'Prohlížeč nezhasínání nepovolil. Může ho omezovat úsporný režim.',
 }[state]||'';}
