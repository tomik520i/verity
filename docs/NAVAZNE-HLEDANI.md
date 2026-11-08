# Návazné hledání a potvrzení v hovoru

Oprava z 8. listopadu 2026.

## Proč Verity slibovala hledání, které neběželo

Diagnostika ukázala nový požadavek na zopakování zpráv, upřesňující otázku asistentky a následný lidský souhlas. Server ale kontroloval pouze slovesa typu „najdi“ v poslední zprávě. Krátké potvrzení zůstalo se searchAllowed=false. Druhá pojistka zachytila značku hledat, ale ne obyčejné věty „už to dělám“ a „dej mi chvíli, abych to našla“. Ty se proto dostaly do přehrávání bez spuštění nástroje.

## Nové rozhodování

- Nový výslovný pokyn dál platí jen pro právě zpracovávaný tah.
- Žádost o aktuální zprávy a „znovu ty zprávy“ spustí sestavení samostatného dotazu z dostupného kontextu. Chybějící téma vede k upřesnění, ne k odhadu.
- „Jo, chci“ může potvrdit konkrétní otázku o hledání z bezprostředně předcházející odpovědi. Potvrzení vtipu nebo běžné „jo“ nemá stejné oprávnění.
- Výslovné „znovu“ může zopakovat bezprostředně předchozí lidský úkol. Samotná historie ani téma rozhovoru hledání neobnoví. Zákaz hledání, změna tématu a událost návratu tento postup nepovolují.
- Hlasová věta „musíš nejít na tom internetu“ má úzkou kontextovou opravu: pouze v hlasovém režimu a pouze po nedávno potvrzeném požadavku. Nejde o obecné nahrazování záporů v přepisu.
- Běžná odpověď se před přehráním kontroluje také na rozpoznané sliby neprovedeného hledání. Neshodný návrh se zahodí a nejvýše jednou vygeneruje znovu. Pojistka je pravidlová, ne univerzální porozumění libovolné české větě.

Kód: [search-routing.js](../search-routing.js), [server.js](../server.js), [research.js](../research.js). Každý chat_start v soukromém logu uvádí searchReason; blokovaný slib má důvod unperformed_search_claim. Běžný model nemůže nástroji sám udělit oprávnění.

## Ověření

Regresní testy pokrývají potvrzení, opakování, zamítnutí, citace, místní hledání v kódu, nesouvisející souhlas, starý úkol a opakovanou planou předehru. Integrační test ověřuje právě jedno skutečné volání testovacího vyhledávače a finální odpověď pro návazné scénáře; bez svolení je počet volání nula.

Dvanáct generací na běžící Gemmě (šest scénářů, seeds 421/777) splnilo kontrolovaná kritéria směrování: šest návazných požadavků dalo zpravodajský dotaz, šest běžných odpovědí nezahájilo ani neslibovalo hledání. Nehodnotí to dokonalost roleplay nebo faktickou správnost novinek. Jedna plánovací odpověď obsahovala zároveň použitelný dotaz a nadbytečnou otázku; server použil dotaz. [Výstupy všech simulací](../bench/results/search-followup-20261108.json).

Po nasazení prošel také produkční test přes opicebot.cz: krátké potvrzení → confirmed_offer → query_resolution → search_start → šest zdrojů → research_answer complete → chat_done. Celý tah trval přibližně 8,7 sekundy. Test ověřil funkční průchod a dodání odpovědi, nikoli důvěryhodnost a čerstvost všech vrácených zdrojů; běžný webový vyhledávač nadále může vracet úvodní stránky a různě kvalitní články. Soukromý rozhovor ani produkční log se do repozitáře nekopírují.

~~~sh
node tests/search-routing-test.mjs
node tests/pipeline-test.mjs /cesta/k/pythonu
node bench/search-followup-eval.mjs http://localhost:8080 vysledky.json
~~~
