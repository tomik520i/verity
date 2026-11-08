// Permission comes from the current user turn, including a direct confirmation.
const {searchRequest,detectSearch,needsConversation}=require('./research');
const fold=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
function plain(text){return String(text||'').replace(/\[[^\]]*\]/g,'').replace(/\x60{3}[\s\S]*?\x60{3}|\x60[^\x60]*\x60|"[^"]*"|„[^“”]*[“”]|“[^”]*”|«[^»]*»/g,' ').trim();}
function blocked(text){const t=fold(plain(text));return String(text||'').trim().startsWith('[[')||/^\s*>/m.test(text)||/\b(nechci|nechceme|nemusis|nesmis|prestan|stop|nehled\w*|nevyhled\w*|bez internetu|bez webu|nechtel\w*|nezadal\w*|nepozadal\w*)\b/.test(t)||/^\s*(?:(?:a|hele|no|tak)\s+)*(proc|kdy|umis|dokazes|jak casto)\b/.test(t)||/\b(rekl|rekla|rikas|napsal|napsala|tvoje odpoved|tvuj vystup)\b[^.!?\n]{0,100}:/.test(t);}
const newsTopic=t=>/\b(?:novink\w* ze sveta|zprav\w* ze sveta|(?:aktualni|dnesni|nejnovejsi|cerstve) (?:zprav\w*|novink\w*))\b/.test(t);
function newsRequest(text){
 if(blocked(text))return false;const t=fold(plain(text));
 if(/\b(?:v|ve|z|ze) (?:tom|te|nasem|predchozim|tomto|tomhle|tech)?\s*(?:rozhovor\w*|chat\w*|historii|text\w*|prilo\w*)\b/.test(t))return false;
 return (newsTopic(t)&&/\b(rekni|povez|precti|ukaz|dej|chci|chtel bych|prosim|najdi|vyhledej)\b/.test(t))||/^(?:(?:no|tak|jo|prosim|rekni|mi|nam|to|ted)\W+)*(?:znovu|znova)\W+(?:(?:mi|nam|prosim|ty|tyhle|tyto|te|dnesni)\W+)*(?:zpravy|novinky)[.!?\s]*$/.test(t.split(/[.!?]+/).map(x=>x.trim()).filter(Boolean).at(-1)||'');
}
function affirmation(text){const words=fold(plain(text)).match(/[a-z0-9]+/g)||[];return words.length>0&&words.length<=18&&words.every(w=>/^(ano|jo|jj|jasne|chci|prosim|klidne|dobre|tak|to|udelej|delej|delaj|sup|znovu|znova|jeste|ted|hned|do|toho|pust|se|muzes)$/.test(w));}
function searchOffer(text){
 if(blocked(text))return false;
 const questions=fold(plain(text)).match(/[^.!?]*\?/g)||[];const q=questions.at(-1)||'';
 return /\b(chces|mam|muzu|mohu|mohla bych|prejes si)\b/.test(q)&&(/\b(vyhledat|vyhledala|hledat|hledala|dohledat|dohledala|najit|nasla|vygooglit|vygooglila)\b/.test(q)||/\b(internet\w*|webu|online)\b/.test(q)||newsTopic(q));
}
function resolveSearchRequest(history,{viaVoice=false}={},depth=0){
 const last=history.at(-1);if(!last||last.role!=='user')return null;
 const text=last.content;if(blocked(text))return null;
 const direct=searchRequest(text);
 if(direct)return {...direct,query:detectSearch(text),contextual:needsConversation(text)};
 if(newsRequest(text))return {allowed:true,reason:'requested_news',query:plain(text).slice(0,200),contextual:true};
 const previous=history.at(-2);
 if(affirmation(text)&&previous?.role==='assistant'&&searchOffer(previous.content))return {allowed:true,reason:'confirmed_offer',query:plain(previous.content).slice(0,200),contextual:true};
 // Only a fresh repeat command may reuse the immediately preceding human task.
 const repeat=affirmation(text)&&/\b(znovu|znova)\b/.test(fold(plain(text)));
 // Narrow STT repair: "musíš nejít na tom internetu" after a confirmed task.
 const voiceRepair=viaVoice&&/\bmusis nejit na (?:tom )?(?:internetu|webu|netu)\b/.test(fold(plain(text)));
 if((repeat||voiceRepair)&&depth<2){
  let i=history.length-2;while(i>=0&&history[i].role!=='user')i--;
  if(i>=0&&history.length-i<=4){const prior=resolveSearchRequest(history.slice(0,i+1),{viaVoice},depth+1);
   if(prior)return {allowed:true,reason:voiceRepair?'voice_retry':'explicit_retry',query:prior.query,contextual:true};}
 }
 return null;
}
function unperformedSearchClaim(text,{images=false}={}){
 const t=fold(plain(text));
 // Claims of ongoing/future tool work, not negatives, quotations or local reasoning.
 if(/\b(?:hledam|vyhledavam|dohledavam|googlim|prohledavam)\b/.test(t)&&!/\b(?:nehledam|nevyhledavam|v hlave|v pameti|v tomhle textu|na obrazku|na fotce)\b/.test(t))return true;
 if(/\b(?:podivam|mrknu|kouknu|najdu|vyhledam|dohledam|overim)\b[^.!?]{0,100}\b(?:internet\w*|webu|online|netu)\b/.test(t))return true;
 if(/\b(?:chvili|pockej|prostor)\b[^.!?]{0,120}\b(?:abych[^.!?]{0,50}(?:nasla|prohledala|vyhledala|overila)|nez[^.!?]{0,30}(?:najdu|vyhledam))\b/.test(t))return true;
 if(!images&&t.length<220&&/\b(?:uz|prave|ted) (?:to delam|se na to divam|na tom pracuju|na tom pracuji)\b/.test(t))return true;
 return false;
}
module.exports={resolveSearchRequest,unperformedSearchClaim};
