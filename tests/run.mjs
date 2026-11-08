import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const file of ['audio-test.mjs','dialogue-test.mjs','echo-test.mjs','worker-test.mjs','voice-defaults-test.mjs','memory-test.mjs','captions-test.mjs','microphone-test.mjs','mic-settings-test.mjs','images-test.mjs','expressions-test.mjs','face-test.mjs','idle-test.mjs','horror-test.mjs','search-routing-test.mjs','content-tone-test.mjs','diagnostics-test.mjs','emotion-tts-test.mjs']){
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)process.exit(result.status||1);
}
