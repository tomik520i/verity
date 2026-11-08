import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {seriousContent,deliveryPerformance} from '../public/delivery-policy.mjs';
import {createPerformanceParser} from '../public/performance-parser.mjs';
const require=createRequire(import.meta.url),{cleanResearch,researchProblem}=require('../research.js');
const catalog=JSON.parse(await fs.readFile(new URL('../public/emotions.json',import.meta.url)));
for(const text of ['Při střelbě zemřelo šest lidí.','Na místě jsou tři mrtví.','Je to pietní místo.','Při požáru byli zraněni čtyři lidé.'])assert.equal(seriousContent(text),true,text);
for(const text of ['Ve hře zemřelo šest herních postav.','Death Stranding má pokračování.','Nikdo nebyl zraněn.','Nehoda se obešla bez obětí.','Dítě našli živé a zdravé.'])assert.equal(seriousContent(text),false,text);
const raw='[neutral:40][mood:focused] Mám přehled.\n[sad:45][mood:gloomy] 1. Při střelbě zemřelo šest lidí.\n[relieved:50][mood:warm] 2. Turistu našli živého. [hledat: nesmí projít] [pamatuj: tajné] [posun:14]';
const cleaned=cleanResearch(raw);assert.ok(cleaned.includes('[sad:45][mood:gloomy]'));assert.ok(cleaned.includes('[relieved:50][mood:warm]'));assert.ok(!cleaned.includes('hledat')&&!cleaned.includes('pamatuj'));assert.ok(cleaned.endsWith('[posun:0]'));assert.equal(researchProblem(cleaned,'stop',2),null);
const parse=chunks=>{const rows=[];const p=createPerformanceParser({catalog,onSegment:s=>rows.push(s)});chunks.forEach(c=>p.feed(c));p.end();return rows;};
const rows=parse([cleaned]);assert.equal(rows.find(r=>r.text.includes('zemřelo')).serious,true);assert.equal(rows.find(r=>r.text.includes('živého')).serious,false);
const wrong='[happy:95][mood:playful] Při střelbě zemřelo šest lidí. [happy:60][mood:warm] Místní tým vyhrál turnaj.';
for(let i=0;i<wrong.length;i++){const r=parse([wrong.slice(0,i),wrong.slice(i)]);assert.equal(r[0].emotion,'empathetic');assert.equal(r[0].mood,'gloomy');assert.equal(r[0].serious,true);assert.equal(r[1].emotion,'happy');assert.equal(r[1].serious,false);}
assert.ok(deliveryPerformance({text:'Je to vzpomínkové místo.',emotion:'sad',mood:'gloomy',intensity:.4}).serious);
console.log('PASS per-item research emotions, list counting, untrusted tag stripping, split-stream delivery, tragedy restraint and positive/fiction recovery.');
