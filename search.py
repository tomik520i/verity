"""Vyhledávání pro Verity → JSON {query, answers, results: [{title, url, snippet, date, text}]}.

Zdroje (sloučí se, bez duplicit):
  1. DDGS (knihovna `ddgs`, DuckDuckGo/Bing/… bez API klíče) – úryvky, u zpráv i datum
  2. SearXNG JSON API, pokud je nastavená proměnná SEARXNG_URL
  3. volitelný záložní modul web_search.py ve složce SEARCH_FALLBACK_PATH
Pak se paralelně stáhnou 3 nejlepší stránky a vytáhne se z nich čitelný text.

Použití:  python search.py "dotaz"
Závislosti: ddgs, requests, beautifulsoup4, readability-lxml (volitelně).
"""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

try:
    from readability import Document
except ImportError:
    Document = None
try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        DDGS = None

SEARXNG = os.environ.get('SEARXNG_URL', '').rstrip('/')
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
           'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.6'}
NEWS = re.compile(r'zpráv|nejnověj|novinky|co se děje|co je nového|news|aktuálně', re.I)
FRESH = re.compile(r'počas|dnes|zítra|včera|teď|aktuál|nejnověj|zpráv|cena|kurz|výsled|zápas|news|weather|today|price', re.I)
ADULT = re.compile(r'porn|xxx|xhamster|xvideos|redtube|youporn|onlyfans|\bsex|hentai|erotik|nude|nsfw|escort', re.I)
STOP = {'jaký', 'jaká', 'jaké', 'kolik', 'najdi', 'vyhledej', 'internet', 'internetu', 'prosím', 'dnes', 'zítra',
        'včera', 'mrkni', 'podívej', 'zjisti', 'něco', 'nového', 'nejnovější', 'aktuální', 'what', 'the'}


def _fold(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')


def relevant(item, query):
    """Bezpečný a k věci: žádný dospělý obsah a aspoň jedno společné slovo (kmen 5 znaků) s dotazem."""
    blob = ' '.join([item.get('title', ''), item.get('snippet', ''), item.get('url', '')])
    if ADULT.search(blob):
        return False
    stems = {_fold(w)[:5] for w in re.findall(r'\w{4,}', query) if w.lower() not in STOP}
    return not stems or any(st in _fold(blob) for st in stems)


def ddgs_search(query, max_results=6):
    if DDGS is None:
        return []
    # backend="duckduckgo" bez regionu dává nejrelevantnější výsledky; region / „auto“ backend
    # u některých dotazů vrací nesouvisející (i nevhodné) stránky – proto safesearch a filtr relevance.
    out = []
    d = DDGS()
    if NEWS.search(query):
        try:
            for h in d.news(query, max_results=4, safesearch='on') or []:
                out.append({'title': h.get('title', ''), 'url': h.get('url') or h.get('href', ''),
                            'snippet': (h.get('body') or '')[:400], 'date': (h.get('date') or '')[:10]})
        except Exception:
            pass
    for kw in ({'backend': 'duckduckgo'}, {'backend': 'auto'}):
        try:
            hits = d.text(query, max_results=max_results, safesearch='on', **kw) or []
        except Exception:
            hits = []
        hits = [{'title': h.get('title', ''), 'url': h.get('href', ''), 'snippet': (h.get('body') or '')[:400], 'date': ''} for h in hits]
        hits = [h for h in hits if relevant(h, query)]
        if hits:
            out += hits
            break
    return [h for h in out if relevant(h, query)]


def searxng_search(query, max_results=6):
    if not SEARXNG:
        return [], []
    r = requests.get(SEARXNG + '/search', params={'q': query, 'format': 'json', 'language': 'cs-CZ', 'safesearch': 1},
                     headers=HEADERS, timeout=12)
    r.raise_for_status()
    data = r.json()
    answers = [a if isinstance(a, str) else a.get('answer', '') for a in data.get('answers', [])]
    answers += [(ib.get('infobox', '') + ': ' + ib.get('content', '')).strip(': ') for ib in data.get('infoboxes', [])]
    out = [{'title': i.get('title', ''), 'url': i.get('url', ''), 'snippet': (i.get('content') or '')[:400],
            'date': (i.get('publishedDate') or '')[:10]} for i in data.get('results', [])[:max_results]]
    return [a for a in answers if a][:3], [h for h in out if relevant(h, query)]


def fallback_search(query):
    path = os.environ.get('SEARCH_FALLBACK_PATH')
    if not path:
        return []
    sys.path.insert(0, path)
    from web_search import web_search
    out = []
    for line in (web_search(query, 5, 2, 'cs-CZ', 'week' if FRESH.search(query) else None) or '').splitlines():
        if '—' in line:
            title, url = line.rsplit('—', 1)
            out.append({'title': title.strip(), 'url': url.strip(), 'snippet': '', 'date': ''})
    return [h for h in out if relevant(h, query)]


def fetch_text(url, max_chars=1800):
    r = requests.get(url, headers=HEADERS, timeout=8)
    r.raise_for_status()
    ctype = r.headers.get('Content-Type', '').lower()
    if 'html' not in ctype:
        return ''
    if 'charset' not in ctype:
        r.encoding = r.apparent_encoding
    html = Document(r.text).summary() if Document else r.text
    text = BeautifulSoup(html, 'html.parser').get_text(' ', strip=True)
    return re.sub(r'\s+', ' ', text)[:max_chars]


def main():
    query = ' '.join(sys.argv[1:]).strip()[:200]
    answers, errors, merged, seen = [], [], [], set()

    def add(items):
        for it in items:
            url = it.get('url', '')
            key = re.sub(r'^https?://(www\.)?', '', url).rstrip('/')
            if url.startswith(('http://', 'https://')) and it.get('title') and key not in seen:
                seen.add(key)
                merged.append({**it, 'text': ''})

    # DDGS a SearXNG paralelně
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_ddgs = pool.submit(ddgs_search, query)
        f_sx = pool.submit(searxng_search, query)
        try:
            add(f_ddgs.result())
        except Exception as e:
            errors.append('ddgs: ' + str(e)[:120])
        try:
            a, items = f_sx.result()
            answers += a
            add(items)
        except Exception as e:
            errors.append('searxng: ' + str(e)[:120])
    if not merged:
        try:
            add(fallback_search(query))
        except Exception as e:
            errors.append('fallback: ' + str(e)[:120])
    merged = merged[:6]

    def enrich(r):
        try:
            t = fetch_text(r['url'])
            if len(t) > 60:
                r['text'] = t
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(enrich, merged[:3]))
    out = {'query': query, 'answers': answers, 'results': merged}
    if errors and not merged:
        out['error'] = '; '.join(errors)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
