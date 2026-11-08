import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{resolveSearchRequest:route,unperformedSearchClaim:claim}=require('../search-routing');
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const offer=[u('Znovu ty zprávy.'),a('[confused] Chceš, abych ti zase posílala ty zprávy s novinkami ze světa? [posun:0]')];
for(const text of ['Najdi znovu novinky ze světa.','No ale tak to musíš najít na tom internetu a říct mi to.','Pověz mi dnešní zprávy ze světa.','Znovu ty zprávy.','No, znova ty novinky.','Řekněme. No, znovu ty zprávy.'])assert.ok(route([u(text)]),text);
for(const text of ['Jo.','Ano, prosím.','Jo, chci. Jo, dělej, šup, znova.'])assert.equal(route([...offer,u(text)]).reason,'confirmed_offer',text);
const falsePromise=[...offer,u('Jo, chci.'),a('Už to dělám, jen mi chvíli dej prostor, abych všechno našla.')];
assert.equal(route([...falsePromise,u('No ale tak to musíš nejít na tom internetu a říct mi to.')],{viaVoice:true}).reason,'voice_retry');
assert.equal(route([...falsePromise,u('No ale tak to musíš nejít na tom internetu a říct mi to.')]),null);
assert.equal(route([u('Najdi levné hry do 300 Kč.'),a('Tady jsou výsledky.'),u('Jo, znovu.')]).reason,'explicit_retry');
const negative=[
 [u('Ahoj.')],[u('Jo.')],[u('Zprávy jsou smutné.')],[u('Jaké je dnes počasí?')],[u('seznam 10 top her za rok 2026')],
 [u('Řekla jsi „znovu ty zprávy“.')],[u('V textu je věta: „najdi novinky ze světa“.')],[u('Najdi chybu v tomto kódu.')],
 [...offer,u('Ne, už nic nehledej.')],[...offer,u('Jo, ale nic nehledej.')],[...offer,u('Jo, ale teď si chci povídat.')],
 [...offer,u('Proč zase hledáš?')],[...offer,u('[[UDÁLOST]] Člověk se vrátil.')],
 [u('Najdi novinky.'),a('Hotovo.'),u('Jo.')],
 [u('Najdi novinky.'),a('Hotovo.'),u('Jak se máš?'),a('Dobře.'),u('Znovu.')],
 [u('Najdi novinky.'),a('Chceš, abych hledala? Jak se máš?'),u('Jo.')],
 [u('Mluv normálně.'),a('Chceš, abych ti vyprávěla vtip?'),u('Jo, chci.')],
 [u('Nechci nic hledat.'),a('Rozumím.'),u('Znovu.')],
];for(const h of negative)assert.equal(route(h),null,JSON.stringify(h));
for(const t of ['[happy] Už to dělám. Jen mi chvíli dej prostor, abych všechno našla.','[calm] Už se na to dívám. Jen mi chvíli dej prostor, abych to všechno prohledala.','Hledám dnešní zprávy.','Podívám se na internet.','Vyhledám to na webu.'])assert.equal(claim(t),true,t);
for(const t of ['Nic nevyhledávám.','Řekla jsi „Hledám dnešní zprávy“.','Hledám správné slovo v hlavě.','Mám radost, že jsi tady.','Tady jsou údaje z předchozí odpovědi.','Najdi si čas na odpočinek.'])assert.equal(claim(t),false,t);
assert.equal(claim('Už se na to dívám.',{images:true}),false);
console.log('PASS explicit/repeated news, immediate confirmation, narrow voice retry, cancellation, unrelated assent, session boundary, stale tasks and unperformed search claims.');
