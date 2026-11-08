// Run on the Verity server; the credential is never printed or put into a URL.
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url),config=JSON.parse(await fs.readFile(new URL('config.json',root),'utf8'));
const key=(await fs.readFile(new URL('diagnostics.key',root),'utf8')).trim();
const query=new URLSearchParams();
for(const arg of process.argv.slice(2)){const m=arg.match(/^--(limit|since|before|conversationId|requestId)=(.*)$/);if(!m)throw Error('Unknown argument');query.set(m[1],m[2]);}
if(!query.has('limit'))query.set('limit','100');
const response=await fetch('http://127.0.0.1:'+config.port+'/api/diagnostics/logs?'+query,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Diagnostics HTTP '+response.status);
console.log(JSON.stringify(await response.json(),null,2));
