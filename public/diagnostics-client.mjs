// No audio/image upload here; only acknowledgements for a server-issued request receipt.
export function conversationId(storage){
 try{storage??=globalThis.sessionStorage;const old=storage.getItem('verity.diagnosticConversation');if(/^[a-f0-9-]{36}$/i.test(old||''))return old;const id=crypto.randomUUID();storage.setItem('verity.diagnosticConversation',id);return id;}catch{return crypto.randomUUID();}
}
export class DiagnosticTrace{
 constructor(send=(...args)=>globalThis.fetch(...args)){this.send=send;this.receipt=null;this.segment=0;}
 accept(value){if(value?.requestId&&value?.token)this.receipt=value;}
 report(event,details={}){
  if(!this.receipt)return;
  try{Promise.resolve(this.send('api/diagnostics/events',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({receipt:this.receipt,event,...details})})).catch(()=>{});}catch{}
 }
}
