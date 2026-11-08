# Automatická diagnostika rozhovoru

Od této verze není pro nové rozhovory potřeba ručně posílat export paměti. Nasazení na opicebot.cz má zapnutý chráněný serverový log. Staré rozhovory zpětně neobnovuje; pro připojení událostí přehrávače je po aktualizaci potřeba obnovit stránku.

## Co se zaznamenává

- Poslední odeslaná lidská zpráva, počet obrázků, režim hovoru, nestabilita a předchozí nálada.
- Text odpovědi skutečně odeslaný klientovi včetně značek emocí. Odmítnuté modelové návrhy se nepublikují do přehrávání; log zaznamená důvod opravného pokusu.
- Povolení hledání, vyhledávací dotaz, názvy a adresy výsledků, dokončení, chyba nebo přerušení.
- Klientská potvrzení začátku/konce přehrávání segmentu: text, skutečně použitá emoce, intenzita, nálada, střídmé podání a dostupnost audia. Je to hlášení přehrávače, nikoli důkaz, že člověk zvuk slyšel.

Zvukové soubory, fotografie, miniatury, plná paměť, přístupové hlavičky a vnitřní reasoning se do tohoto logu neukládají. Běžný PM2 log nadále neobsahuje celý rozhovor. Úložiště diagnostiky je samostatné, mimo public i Git. Text může obsahovat osobní informace; jednoduché maskování zjevných hesel/tokenů není úplná anonymizace.

## Čtení správcem nebo při další opravě

Nejdřív čti tento log, nevyžaduj od uživatele nový export, pokud problém vznikl po zapnutí diagnostiky. Na serveru ve složce Verity spusť:

~~~sh
node tools/read-diagnostics.mjs --limit=100
node tools/read-diagnostics.mjs --requestId=ID_POZADAVKU --limit=200
node tools/read-diagnostics.mjs --conversationId=ID_ROZHOVORU --limit=300
~~~

Skript sám přečte místní klíč a zavolá endpoint. **Klíč nevypisuj, neposílej v URL a nevkládej do veřejných issue, commitů ani dokumentace.** Stejně tak veřejně nepublikuj obsah soukromého logu; do regresních testů patří syntetické příklady.

GET /verity/api/diagnostics/logs vrací JSON s records. Vyžaduje hlavičku Authorization: Bearer a správcovský klíč. Podporuje limit (1–500), since/before (čas v milisekundách), requestId a conversationId. Záznamy jsou v časovém pořadí, bez filtru se vrací poslední. Stránkování používá before; při shodném čase může oříznout hraniční skupinu, proto pro celý tah používej requestId.

Bez klíče nebo s chybným klíčem odpoví 401. Klíč v query stringu se nepřijímá. Endpoint ani klíč nemají veřejný přepínač v prohlížeči. POST /verity/api/diagnostics/events přijímá pouze omezené typy událostí s podpisem konkrétního požadavku; tento krátkodobý podpis neopravňuje číst logy. Diagnostika nepovoluje webové hledání a nemění konverzaci ani paměť.

## Provoz a uchování

V config.json: diagnostics.enabled=true a diagnostics.retention_days=7. Příklad konfigurace v repozitáři má diagnostiku vypnutou; produkční zapnutí je místní konfigurace. První spuštění vytvoří diagnostics.key (náhodných 32 bajtů, oprávnění 600). Čtecí klíč se prohlížeči neposílá.

Záznamy jsou ve var/diagnostics/events-*.jsonl. Rotace po 4 MiB, rozpočet 32 MiB, uchování sedm dní. Úklid probíhá každou minutu a při čtení/zápisu; starší soubory mohou zaniknout dříve při zaplnění rozpočtu. Čtení samo filtruje podle retenčního času. Retence se týká tohoto aktivního logu, ne případných správcem vytvořených záloh celého serveru.

Prohlížeč používá náhodné ID relace v sessionStorage. Nejde o identifikaci člověka. Nová záložka či relace může mít nové ID. Na úvodní obrazovce a v nastavení je stručná informace o ukládání textu. Diagnostické nahrávání WAV zůstává vypnuté.

Kód: [server](../server.js), [úložiště a ověření](../diagnostics.js), [klient](../public/diagnostics-client.mjs). Testy ověřují neoprávněné čtení, podvržené a prošlé podpisy, filtrování, retenci, restart, vynechání médií i pokračování při nedostupném logování.

## Ověřené nasazení 8. listopadu 2026

Přes skutečný prohlížeč proběhl syntetický rozhovor s nasazenou Gemmou. Správcovský čtecí skript následně načetl vstup, výstup i dvojice playback_start/playback_end obou vět. U zprávy o obětech přehrávač hlásil serious=true a náladu gloomy. Test používal vypnutý hlas (audio=false), takže ověřuje text, animaci a přenos diagnostiky, ne poslech reproduktoru. Čtení bez klíče skončilo 401; přímá adresa souboru klíče 404.
