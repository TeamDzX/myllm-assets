#!/usr/bin/env python3
"""Build a picture-flashcard language-learning MyLLMos app from a langpack.

Reuses the Hanyu content-pack flashcard illustrations (language-agnostic photos)
from github.com/TeamDzX/hanyu-packs, relabelled in the target language.

  python3 build_language.py langpacks/es.json
    -> apps-src/learn-spanish.html
    -> apps-src/learn-spanish.myllmapp
    -> prints the apps.json manifest entry to paste/merge

Data sources (already in repo):
  /tmp/langbuild/catalog_en.json   deck meta (icon, grad, imgBase, English words)
  langpacks/<code>.json            target-language words aligned to each deck
"""
import sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = json.load(open("/tmp/langbuild/catalog_en.json"))
CAT_BY_ID = {d["id"]: d for d in CATALOG}

TEMPLATE = r"""<!doctype html><html lang="__CODE__"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Learn __NAME__</title>
<style>:root{color-scheme:light dark;--ac:__ACCENT__;--ac2:__ACCENT2__}
*{box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:0 0 96px;background:#f2f2f7;color:#111;-webkit-tap-highlight-color:transparent}
@media(prefers-color-scheme:dark){body{background:#000;color:#eee}.card,.deck,.chip,.panel,input,.vrow{background:#1c1c1e}.chip{border-color:#3a3a3c}input{color:#eee;border-color:#3a3a3c}.tabbar{background:rgba(20,20,22,.86)}.thumb{background:#2c2c2e}.body .w{color:#fff}.body .en{color:#c7c7cc}.body .tap{color:#8a8a8e}}
header{padding:18px 18px 8px;display:flex;align-items:center;gap:12px}
header .fl{font-size:34px}
header h1{font-size:22px;margin:0}
header .nv{font-size:13px;opacity:.6;margin:1px 0 0}
.wrap{padding:0 16px;max-width:820px;margin:0 auto}
h2{font-size:14px;letter-spacing:.02em;text-transform:uppercase;opacity:.5;margin:20px 2px 8px}
.chips{display:flex;gap:8px;overflow-x:auto;padding:4px 2px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;border:1px solid #e3e3e8;background:#fff;border-radius:999px;padding:9px 15px;font-size:14px;font-weight:600;white-space:nowrap;color:inherit}
.chip.on{background:var(--ac);color:#fff;border-color:transparent}
/* flashcard */
.card{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.09);margin:4px 0}
.card .img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block;background:#e5e5ea}
.ph{width:100%;aspect-ratio:3/2;display:flex;align-items:center;justify-content:center;font-size:60px;background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff}
.body{padding:16px 18px;text-align:center;min-height:104px;display:flex;flex-direction:column;justify-content:center}
.body .w{font-size:30px;font-weight:800;line-height:1.2;color:#000;letter-spacing:-.01em}
.body .en{font-size:16px;font-weight:600;color:#3a3a3c;margin-top:5px}
.body .tap{font-size:13px;color:#8a8a8e}
.hidden{display:none}
.nav{display:flex;align-items:center;justify-content:space-between;margin-top:12px}
.nav button{border:0;background:#e5e5ea;color:inherit;border-radius:12px;padding:11px 20px;font-size:15px;font-weight:600}
@media(prefers-color-scheme:dark){.nav button{background:#2c2c2e}}
.nav .ct{font-size:14px;opacity:.6}
.row{display:flex;gap:8px}
.act{border:0;background:var(--ac);color:#fff;border-radius:12px;padding:0 16px;font-size:15px;font-weight:600}
.act:disabled{opacity:.45}
input{flex:1;min-width:0;padding:12px;border:1px solid #d1d1d6;border-radius:12px;font-size:16px;background:#fff}
#status{font-size:13px;opacity:.65;min-height:18px;margin:8px 2px}
/* vocab */
.vrow{display:flex;align-items:center;gap:12px;background:#fff;border-radius:14px;padding:8px 12px;margin-bottom:8px}
.thumb{width:52px;height:52px;border-radius:10px;object-fit:cover;flex:0 0 auto;background:#e5e5ea}
.vrow .vw{font-size:16px;font-weight:600}
.vrow .ve{font-size:13px;opacity:.6}
/* AI panels */
.panel{background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:9px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.panel .pt{font-size:17px;font-weight:600}
.panel .pp{opacity:.6;font-style:italic;font-size:14px;margin-top:2px}
.panel .pe{font-size:14px;margin-top:4px}
.panel.explain{white-space:pre-wrap;line-height:1.6;font-size:15px}
.section{display:none}.section.on{display:block}
.tabbar{position:fixed;left:0;right:0;bottom:0;display:flex;background:rgba(248,248,250,.86);backdrop-filter:saturate(180%) blur(18px);-webkit-backdrop-filter:saturate(180%) blur(18px);border-top:1px solid rgba(0,0,0,.08);padding-bottom:env(safe-area-inset-bottom)}
.tabbar button{flex:1;border:0;background:none;color:inherit;padding:9px 0 8px;font-size:11px;font-weight:600;opacity:.5;display:flex;flex-direction:column;align-items:center;gap:3px}
.tabbar button .ti{font-size:20px}
.tabbar button.on{opacity:1;color:var(--ac)}
</style></head><body>
<style>
@keyframes myllmAiSpin{to{transform:rotate(360deg)}}
.myllm-ai-busy{position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(18px);z-index:99999;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;display:flex;align-items:center;gap:10px;background:rgba(28,28,30,.96);color:#fff;border-radius:999px;padding:10px 16px 10px 14px;box-shadow:0 6px 22px rgba(0,0,0,.4);font-family:-apple-system,system-ui,sans-serif;font-size:14px;font-weight:600;max-width:92%}
.myllm-ai-busy.on{opacity:1;transform:translateX(-50%) translateY(0)}
.myllm-ai-cog{font-size:18px;line-height:1;animation:myllmAiSpin 2.4s linear infinite;filter:drop-shadow(0 0 5px rgba(124,92,255,.85))}
.myllm-ai-busy small{font-weight:400;opacity:.6}
</style>
<script>
(function(){if(window.__myllmAiWrap||typeof window.myllmAsk!=='function')return;window.__myllmAiWrap=true;
var orig=window.myllmAsk,depth=0,node=null;
function ensure(){if(node)return;node=document.createElement('div');node.className='myllm-ai-busy';
node.innerHTML='<span class="myllm-ai-cog">⚙️</span><span>AI is thinking… <small>privately, on your device</small></span>';
(document.body||document.documentElement).appendChild(node);}
function show(){ensure();depth++;node.classList.add('on');}
function hide(){depth=Math.max(0,depth-1);if(depth===0&&node)node.classList.remove('on');}
window.myllmAsk=function(){show();var p;try{p=orig.apply(this,arguments);}catch(e){hide();throw e;}
return Promise.resolve(p).then(function(r){hide();return r;},function(e){hide();throw e;});};})();
</script>

<header><span class="fl">__FLAG__</span><div><h1>Learn __NAME__</h1><div class="nv">__NATIVE__ · picture flashcards</div></div></header>

<div class="wrap">
  <!-- FLASHCARDS -->
  <div class="section on" id="s-cards">
    <div class="chips" id="deckChips"></div>
    <div class="card" id="fc" onclick="flip()">
      <div id="fcImgWrap"></div>
      <div class="body"><div class="w hidden" id="fcW"></div><div class="en hidden" id="fcE"></div><div class="tap" id="fcTap">tap to reveal</div></div>
    </div>
    <div class="nav"><button onclick="fcNav(-1)">‹ Prev</button><span class="ct" id="fcCt"></span><button onclick="fcNav(1)">Next ›</button></div>
    <div class="nav" style="margin-top:8px"><button onclick="fcShuffle()" style="flex:1">🔀 Shuffle deck</button></div>
  </div>

  <!-- VOCABULARY -->
  <div class="section" id="s-vocab">
    <div class="row" style="margin-top:12px"><input id="vsearch" placeholder="Search words…" oninput="renderVocab()"></div>
    <div id="vocabList"></div>
  </div>

  <!-- PHRASES -->
  <div class="section" id="s-phrases">
    <h2>AI phrase lessons</h2>
    <div class="row"><input id="ptopic" placeholder="Topic — e.g. ordering food, at the airport…"><button class="act" id="pgen" onclick="genPhrases()">Teach me</button></div>
    <div id="pstatus" style="font-size:13px;opacity:.65;min-height:18px;margin:8px 2px"></div>
    <div id="phraseList"></div>
  </div>

  <!-- GRAMMAR -->
  <div class="section" id="s-grammar">
    <h2>Grammar explainer</h2>
    <div class="chips" id="grChips"></div>
    <div class="row"><input id="gtopic" placeholder="Any grammar point…"><button class="act" id="ggen" onclick="genGrammar()">Explain</button></div>
    <div id="gstatus" style="font-size:13px;opacity:.65;min-height:18px;margin:8px 2px"></div>
    <div id="grammarOut"></div>
  </div>
</div>

<div class="tabbar" id="tabbar">
  <button class="on" data-s="cards" onclick="tab('cards')"><span class="ti">🃏</span>Flashcards</button>
  <button data-s="vocab" onclick="tab('vocab')"><span class="ti">📖</span>Vocabulary</button>
  <button data-s="phrases" onclick="tab('phrases')"><span class="ti">💬</span>Phrases</button>
  <button data-s="grammar" onclick="tab('grammar')"><span class="ti">✍️</span>Grammar</button>
</div>

<script>
var LANG="__NAME__", NATIVE="__NATIVE__";
var DECKS=__DECKS_JSON__;
var GRAMMAR_PRESETS=__GRAMMAR_JSON__;
var store=window.myllmStorage||{getItem:function(){return Promise.resolve(null)},setItem:function(){return Promise.resolve()}};
function el(i){return document.getElementById(i)}
function haptic(k){if(window.myllmHaptic)myllmHaptic(k||'light')}

/* ---------- tabs ---------- */
function tab(s){
  [].forEach.call(document.querySelectorAll('.section'),function(x){x.classList.remove('on')});
  el('s-'+s).classList.add('on');
  [].forEach.call(document.querySelectorAll('.tabbar button'),function(b){b.classList.toggle('on',b.dataset.s===s)});
  haptic('selection');window.scrollTo(0,0);
}

/* ---------- flashcards ---------- */
var deckIdx=0, cardIdx=0, showBack=false, order=[];
function buildDeckChips(){
  var c=el('deckChips');c.innerHTML='';
  DECKS.forEach(function(d,i){
    var b=document.createElement('button');b.className='chip'+(i===deckIdx?' on':'');b.textContent=d.title;
    b.onclick=function(){deckIdx=i;resetDeck();buildDeckChips();};c.appendChild(b);
  });
}
function resetDeck(){order=DECKS[deckIdx].cards.map(function(_,i){return i});cardIdx=0;showBack=false;renderCard();}
function fcShuffle(){for(var i=order.length-1;i>0;i--){var j=Math.floor((i+1)*fract());var t=order[i];order[i]=order[j];order[j]=t;}cardIdx=0;showBack=false;renderCard();haptic('success');}
var _s=0.4142;function fract(){_s=(_s*9301+49297)%233280/233280;return _s;} /* stable pseudo-shuffle, no Math.random needed */
function renderCard(){
  var d=DECKS[deckIdx],c=d.cards[order[cardIdx]],iw=el('fcImgWrap');
  var url=d.imgBase+order[cardIdx]+'.jpg';
  iw.innerHTML='<img class="img" src="'+url+'" alt="" onerror="this.outerHTML=\'<div class=ph>'+d.emoji+'</div>\'">';
  el('fcW').textContent=c.w;el('fcE').textContent=c.en;
  el('fcW').classList.toggle('hidden',!showBack);el('fcE').classList.toggle('hidden',!showBack);
  el('fcTap').classList.toggle('hidden',showBack);
  el('fcCt').textContent=(cardIdx+1)+' / '+d.cards.length+'  ·  '+d.title;
}
function flip(){showBack=!showBack;renderCard();haptic('light');if(showBack&&window.myllmSpeak)try{myllmSpeak(DECKS[deckIdx].cards[order[cardIdx]].w,{lang:'__CODE__'})}catch(e){}}
function fcNav(n){var len=DECKS[deckIdx].cards.length;cardIdx=(cardIdx+n+len)%len;showBack=false;renderCard();haptic('selection');}

/* ---------- vocabulary ---------- */
function renderVocab(){
  var q=(el('vsearch').value||'').toLowerCase().trim(),L=el('vocabList');L.innerHTML='';
  DECKS.forEach(function(d){
    var matches=d.cards.map(function(c,i){return {c:c,i:i}}).filter(function(o){
      return !q||o.c.w.toLowerCase().indexOf(q)>=0||o.c.en.toLowerCase().indexOf(q)>=0;});
    if(!matches.length)return;
    var h=document.createElement('h2');h.textContent=d.title;L.appendChild(h);
    matches.forEach(function(o){
      var r=document.createElement('div');r.className='vrow';
      r.innerHTML='<img class="thumb" loading="lazy" src="'+d.imgBase+o.i+'.jpg" alt="" onerror="this.style.visibility=\'hidden\'">'+
        '<div><div class="vw">'+o.c.w+'</div><div class="ve">'+o.c.en+'</div></div>';
      r.onclick=function(){haptic('light');if(window.myllmSpeak)try{myllmSpeak(o.c.w,{lang:'__CODE__'})}catch(e){}};
      L.appendChild(r);
    });
  });
  if(!L.children.length)L.innerHTML='<p style="opacity:.5;text-align:center;margin-top:30px">No matches.</p>';
}

/* ---------- phrases (AI) ---------- */
var phrases=[];
function needAI(setter){if(window.myllmAsk)return false;setter('This needs the latest MyLLM with “Allow apps to use the AI” enabled in Settings.');return true;}
function genPhrases(){
  var topic=el('ptopic').value.trim();if(!topic){el('pstatus').textContent='Enter a topic.';return}
  if(needAI(function(t){el('pstatus').textContent=t})) return;
  el('pgen').disabled=true;el('pstatus').textContent='Writing '+LANG+' phrases about “'+topic+'”…';
  myllmAsk('Create 8 useful '+LANG+' phrases about: '+topic+', for an English-speaking beginner. Reply with ONLY a JSON array like [{"t":"phrase in '+LANG+'","p":"simple English pronunciation","n":"English meaning"}] and nothing else.')
  .then(function(reply){
    var s=reply.indexOf('['),e=reply.lastIndexOf(']');if(s<0||e<=s)throw new Error('no lesson came back');
    var got=JSON.parse(reply.slice(s,e+1)).filter(function(x){return x&&x.t&&x.n});
    if(!got.length)throw new Error('the lesson was empty');
    phrases=got.concat(phrases);store.setItem('phrases',JSON.stringify(phrases.slice(0,80)));
    el('ptopic').value='';el('pstatus').textContent='';renderPhrases();
  }).catch(function(err){el('pstatus').textContent='Could not generate: '+err.message})
  .then(function(){el('pgen').disabled=false});
}
function renderPhrases(){
  var L=el('phraseList');L.innerHTML='';
  phrases.forEach(function(ph){
    var d=document.createElement('div');d.className='panel';
    d.innerHTML='<div class="pt"></div><div class="pp"></div><div class="pe"></div>';
    d.querySelector('.pt').textContent=ph.t;
    d.querySelector('.pp').textContent=ph.p?'['+ph.p+']':'';
    d.querySelector('.pe').textContent=ph.n;
    d.onclick=function(){haptic('light');if(window.myllmSpeak)try{myllmSpeak(ph.t,{lang:'__CODE__'})}catch(e){}};
    L.appendChild(d);
  });
}

/* ---------- grammar (AI) ---------- */
function buildGrammarChips(){
  var c=el('grChips');c.innerHTML='';
  GRAMMAR_PRESETS.forEach(function(g){
    var b=document.createElement('button');b.className='chip';b.textContent=g;
    b.onclick=function(){el('gtopic').value=g;genGrammar();};c.appendChild(b);
  });
}
function genGrammar(){
  var topic=el('gtopic').value.trim();if(!topic){el('gstatus').textContent='Pick or type a grammar point.';return}
  if(needAI(function(t){el('gstatus').textContent=t})) return;
  el('ggen').disabled=true;el('gstatus').textContent='Explaining “'+topic+'”…';el('grammarOut').innerHTML='';
  myllmAsk('Explain this '+LANG+' grammar point for an English-speaking beginner: "'+topic+'". Keep it under 160 words. Give a one-line rule, then 3 short example sentences (each with its English meaning). Plain text, no markdown headers.')
  .then(function(reply){
    var d=document.createElement('div');d.className='panel explain';d.textContent=reply.trim();
    el('grammarOut').appendChild(d);el('gstatus').textContent='';haptic('success');
  }).catch(function(err){el('gstatus').textContent='Could not explain: '+err.message})
  .then(function(){el('ggen').disabled=false});
}

/* ---------- init ---------- */
buildDeckChips();resetDeck();buildGrammarChips();renderVocab();
el('ptopic').addEventListener('keydown',function(e){if(e.key==='Enter')genPhrases()});
el('gtopic').addEventListener('keydown',function(e){if(e.key==='Enter')genGrammar()});
store.getItem('phrases').then(function(v){if(v){try{phrases=JSON.parse(v)}catch(e){}renderPhrases();}});
</script></body></html>
"""

# emoji fallbacks per deck (shown if a remote image fails to load / offline)
DECK_EMOJI = {
    "fruits":"🍎","vegetables":"🥕","food":"🍜","drinks":"🥤","family":"👪","body":"🧑",
    "clothing":"👕","transport":"🚗","home":"🛋️","town":"🏙️","seasons":"🍂","sports":"⚽",
    "jobs":"👩‍⚕️","nature":"🏞️","kitchen":"🍳","music":"🎸","stationery":"✏️","tools":"🔨",
}
# nice, common grammar points (kept language-neutral in wording so the AI adapts)
GRAMMAR_PRESETS = ["Articles & gender","Present tense","Plurals","Adjective agreement",
                   "Asking questions","Numbers 1–20","Ser vs estar / to be","Negation"]


def build(langfile):
    lp = json.load(open(langfile))
    code = lp["code"]
    decks = []
    for deck_id, words in lp["decks"].items():
        meta = CAT_BY_ID[deck_id]
        en = [c["en"] for c in meta["cards"]]
        assert len(words) == len(en), f"{deck_id}: {len(words)} words vs {len(en)} images"
        decks.append({
            "id": deck_id,
            "title": meta["title"],
            "emoji": DECK_EMOJI.get(deck_id, lp["flag"]),
            "imgBase": meta["imgBase"],
            "cards": [{"w": w, "en": e} for w, e in zip(words, en)],
        })
    grammar = [g.replace("Ser vs estar / to be", "Ser vs estar" if code == "es" else "The verb 'to be'")
               for g in GRAMMAR_PRESETS]

    html = (TEMPLATE
            .replace("__CODE__", code)
            .replace("__NAME__", lp["name"])
            .replace("__NATIVE__", lp["native"])
            .replace("__FLAG__", lp["flag"])
            .replace("__ACCENT2__", lp.get("accent2", lp["accent"]))
            .replace("__ACCENT__", lp["accent"])
            .replace("__DECKS_JSON__", json.dumps(decks, ensure_ascii=False))
            .replace("__GRAMMAR_JSON__", json.dumps(grammar, ensure_ascii=False)))

    slug = "learn-" + lp["name"].lower()
    open(os.path.join(HERE, "apps-src", slug + ".html"), "w").write(html)
    json.dump({"name": "Learn " + lp["name"], "html": html},
              open(os.path.join(HERE, "apps-src", slug + ".myllmapp"), "w"), ensure_ascii=False)

    ncards = sum(len(d["cards"]) for d in decks)
    entry = {
        "id": slug, "name": "Learn " + lp["name"], "emoji": lp["flag"],
        "tagline": "Picture flashcards + AI tutor",
        "description": ("Learn " + lp["name"] + " with illustrated picture flashcards across "
                        + str(len(decks)) + " everyday topics (" + str(ncards) + " words, each with a photo) — "
                        "browse and search the vocabulary, then use your own on-device AI to generate phrase "
                        "lessons on any topic and explain any grammar point. Flashcards and vocabulary work "
                        "offline; the AI phrase and grammar tabs need the latest MyLLM with "
                        "“Allow apps to use the AI” enabled in Settings."),
        "tags": ["learning", "AI-powered", "offline"],
        "iconSymbol": "character.bubble.fill", "iconColor": lp["iconColor"],
        "version": 1, "featured": False, "requiresAI": False,
        "banner": "https://raw.githubusercontent.com/TeamDzX/myllm-assets/main/apps/" + slug + ".jpg",
        "html": "https://raw.githubusercontent.com/TeamDzX/myllm-assets/main/apps-src/" + slug + ".html",
        "json": "https://raw.githubusercontent.com/TeamDzX/myllm-assets/main/apps-src/" + slug + ".myllmapp",
        "sizeKB": round(len(html) / 1024), "category": "Students",
    }
    print("Built", slug, "-", len(decks), "decks,", ncards, "cards,", round(len(html)/1024), "KB")
    print("\n--- manifest entry ---")
    print(json.dumps(entry, ensure_ascii=False, indent=6))
    return entry


if __name__ == "__main__":
    for f in sys.argv[1:]:
        build(f)
