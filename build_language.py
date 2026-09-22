#!/usr/bin/env python3
"""Build a picture-flashcard language-learning MyLLMos app from a langpack.

Reuses the Hanyu content-pack flashcard illustrations (language-agnostic photos)
from github.com/TeamDzX/hanyu-packs, relabelled in the target language.

  python3 build_language.py langpacks/es.json
    -> apps-src/learn-spanish.html
    -> apps-src/learn-spanish.myllmapp
    -> prints the apps.json manifest entry to paste/merge

Data sources (already in repo):
  langpacks/catalog_en.json        deck meta (imgBase, English words)
  langpacks/<code>.json            target-language words aligned to each deck
"""
import sys, os, json, base64

HERE = os.path.dirname(os.path.abspath(__file__))
_CAT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "langpacks", "catalog_en.json")
CATALOG = json.load(open(_CAT))
CAT_BY_ID = {d["id"]: d for d in CATALOG}

TEMPLATE = r"""<!doctype html><html lang="__CODE__"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>__TITLE__</title>
<style>:root{color-scheme:light dark;--ac:__ACCENT__;--ac2:__ACCENT2__;
  --bg:var(--myllm-bg,#f2f2f7);--surface:var(--myllm-surface,#fff);--ink:var(--myllm-text,#111);
  --muted:var(--myllm-muted,#8a8a8e);--line:var(--myllm-border,#e3e3e8);--fill:rgba(120,120,128,.12);--bar:rgba(248,248,250,.86)}
@media(prefers-color-scheme:dark){:root{--bg:var(--myllm-bg,#000);--surface:var(--myllm-surface,#1c1c1e);--ink:var(--myllm-text,#f2f2f7);
  --muted:var(--myllm-muted,#8e8e93);--line:var(--myllm-border,#2c2c2e);--fill:rgba(120,120,128,.24);--bar:rgba(22,22,24,.86)}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:var(--myllm-font,-apple-system,system-ui,sans-serif);margin:0;background:var(--bg);color:var(--ink);
  padding:env(safe-area-inset-top) env(safe-area-inset-right) calc(96px + env(safe-area-inset-bottom)) env(safe-area-inset-left)}
button{font:inherit;color:inherit;cursor:pointer}
svg.i{width:1.2em;height:1.2em;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
.head{display:flex;align-items:center;gap:12px;padding:16px 18px 8px;max-width:820px;margin:0 auto}
.head .tile{width:44px;height:44px;border-radius:13px;object-fit:cover;flex:0 0 auto;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.head .ht{flex:1;min-width:0}
.head h1{font-size:22px;font-weight:800;letter-spacing:-.01em;margin:0}
.head p{font-size:13px;color:var(--muted);margin:1px 0 0}
.wrap{padding:0 16px;max-width:820px;margin:0 auto}
h2{font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:20px 2px 10px}
.chips{display:flex;gap:7px;overflow-x:auto;padding:4px 2px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;min-height:36px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:99px;padding:0 14px;font-size:13.5px;font-weight:650;white-space:nowrap}
.chip.on{background:var(--ac);color:#fff;border-color:transparent}
/* flashcard */
.card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden;margin:4px 0;cursor:pointer}
.card .img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block;background:var(--fill)}
.ph{width:100%;aspect-ratio:3/2;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--ac),var(--ac2))}
.ph svg{width:56px;height:56px;opacity:.9}
.body{padding:16px 18px;text-align:center;min-height:104px;display:flex;flex-direction:column;justify-content:center}
.body .w{font-size:30px;font-weight:800;line-height:1.2;letter-spacing:-.01em}
.body .en{font-size:16px;font-weight:600;color:var(--muted);margin-top:5px}
.body .tap{font-size:13px;color:var(--muted)}
.spkbtn{position:absolute;right:12px;bottom:12px;width:44px;height:44px;border:none;border-radius:12px;background:var(--fill);color:var(--ac);display:flex;align-items:center;justify-content:center;font-size:18px}
.spkbtn.on{background:var(--ac);color:#fff}
.hidden{display:none!important}
.nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px}
.nav button{min-height:44px;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:0 16px;font-size:15px;font-weight:650;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.nav button:active,.act:active,.chip:active{transform:scale(.97)}
.nav .ct{font-size:13px;color:var(--muted);text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row{display:flex;gap:8px}
.act{min-height:46px;border:0;background:var(--ac);color:#fff;border-radius:12px;padding:0 16px;font-size:15px;font-weight:700}
.act:disabled{opacity:.5}
input{flex:1;min-width:0;padding:12px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:16px;background:var(--surface);color:var(--ink);outline:none}
input:focus{border-color:var(--ac)}
#status{font-size:13px;color:var(--muted);min-height:18px;margin:8px 2px}
/* vocab */
.vrow{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:8px 12px;margin-bottom:8px;cursor:pointer}
.vrow>div{flex:1;min-width:0}
.thumb{width:52px;height:52px;border-radius:10px;object-fit:cover;flex:0 0 auto;background:var(--fill)}
.vrow .vw{font-size:16px;font-weight:650}
.vrow .ve{font-size:13px;color:var(--muted)}
.spk{flex:0 0 auto;color:var(--ac);opacity:.75;display:flex}
/* AI panels */
.panel{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 44px 14px 16px;margin-bottom:9px;cursor:pointer}
.panel.explain,.panel.basic{padding-right:16px;cursor:auto}
.panel>.spk{position:absolute;right:14px;top:15px}
.panel .pt{font-size:17px;font-weight:650}
.panel .pp{color:var(--muted);font-style:italic;font-size:14px;margin-top:2px}
.panel .pe{font-size:14px;margin-top:4px}
.panel.explain{white-space:pre-wrap;line-height:1.6;font-size:15px}
.section{display:none}.section.on{display:block}
.tabbar{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--bar);backdrop-filter:saturate(180%) blur(18px);-webkit-backdrop-filter:saturate(180%) blur(18px);border-top:1px solid var(--line);padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.tabbar button{flex:1;border:0;background:none;color:var(--muted);padding:9px 0 8px;font-size:11px;font-weight:650;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:52px}
.tabbar button .ti{height:22px;display:flex;align-items:center}
.tabbar button .ti svg{width:22px;height:22px}
.gr-ex{margin-top:8px;font-size:14px;cursor:pointer;display:flex;gap:6px;align-items:baseline}
.gr-ex b{font-weight:650}
.gr-ex span{color:var(--muted)}
.gr-ex .spk{align-self:center;font-size:12px}
.tabbar button.on{color:var(--ac)}
.snote{position:fixed;left:50%;bottom:calc(66px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(92%,480px);z-index:50;
  display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.45;border-radius:14px;padding:11px 12px;background:var(--surface);border:1px solid rgba(255,159,10,.5);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.snote svg{color:#ff9f0a;fill:currentColor;stroke:none;margin-top:1px}
.snote[hidden]{display:none}
/* phone on its side: keep the photo, the word and the controls on one screen */
@media(max-height:520px){.head{padding-top:10px;padding-bottom:4px}.head .tile{width:36px;height:36px;border-radius:11px}.head h1{font-size:19px}.head p{display:none}
  #s-cards{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);grid-template-areas:'chips chips' 'card nav1' 'card nav2';column-gap:14px;align-items:start}
  #deckChips{grid-area:chips}#fc{grid-area:card;display:flex}#fcImgWrap{flex:0 0 56%}#fc .img,#fc .ph{height:100%;aspect-ratio:auto;min-height:150px}
  #fc .body{flex:1;min-height:0;padding:10px 12px}.body .w{font-size:24px}
  #s-cards>.nav:nth-of-type(1){grid-area:nav1;margin-top:4px}#s-cards>.nav:nth-of-type(2){grid-area:nav2}}
@media(prefers-reduced-motion:reduce){.nav button:active,.act:active,.chip:active{transform:none}}
</style></head><body>
<style>
@keyframes myllmAiSpin{to{transform:rotate(360deg)}}
.myllm-ai-busy{position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(18px);z-index:99999;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;display:flex;align-items:center;gap:10px;background:rgba(28,28,30,.96);color:#fff;border-radius:999px;padding:10px 16px 10px 14px;box-shadow:0 6px 22px rgba(0,0,0,.4);font-family:-apple-system,system-ui,sans-serif;font-size:14px;font-weight:600;max-width:92%}
.myllm-ai-busy.on{opacity:1;transform:translateX(-50%) translateY(0)}
.myllm-ai-cog{width:16px;height:16px;border-radius:50%;border:2.4px solid #a78bfa;border-right-color:transparent;animation:myllmAiSpin .9s linear infinite;flex-shrink:0}
.myllm-ai-busy small{font-weight:400;opacity:.6}
</style>
<script>
(function(){if(window.__myllmAiWrap||typeof window.myllmAsk!=='function')return;window.__myllmAiWrap=true;
var orig=window.myllmAsk,depth=0,node=null;
function ensure(){if(node)return;node=document.createElement('div');node.className='myllm-ai-busy';
node.innerHTML='<span class="myllm-ai-cog"></span><span>AI is thinking… <small>privately, on your device</small></span>';
(document.body||document.documentElement).appendChild(node);}
function show(){ensure();depth++;node.classList.add('on');}
function hide(){depth=Math.max(0,depth-1);if(depth===0&&node)node.classList.remove('on');}
window.myllmAsk=function(){show();var p;try{p=orig.apply(this,arguments);}catch(e){hide();throw e;}
return Promise.resolve(p).then(function(r){hide();return r;},function(e){hide();throw e;});};})();
</script>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-spk" viewBox="0 0 24 24"><path d="M11 5.2 6.6 8.8H4v6.4h2.6L11 18.8z" fill="currentColor" stroke="none"/><path d="M15.4 9a4.3 4.3 0 0 1 0 6M18.2 6.3a8.2 8.2 0 0 1 0 11.4"/></symbol>
  <symbol id="i-prev" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></symbol>
  <symbol id="i-next" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M10.3 3.9a2 2 0 0 1 3.4 0l8 13.6a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3zM12 9a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1zm0 7.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/></symbol>
</defs></svg>

<div class="head"><img class="tile" src="__EMBLEM__" alt=""><div class="ht"><h1>__TITLE__</h1><p>__SUBTITLE__</p></div></div>

<div class="wrap">
  <!-- FLASHCARDS -->
  <div class="section on" id="s-cards">
    <div class="chips" id="deckChips"></div>
    <div class="card" id="fc" onclick="flip()">
      <div id="fcImgWrap"></div>
      <div class="body"><div class="w hidden" id="fcW"></div><div class="en hidden" id="fcE"></div><div class="tap" id="fcTap">tap to reveal</div></div>
      <button class="spkbtn hidden" id="fcSpk" type="button" aria-label="Hear it" onclick="event.stopPropagation();sayCard()"><svg class="i"><use href="#i-spk"/></svg></button>
    </div>
    <div class="nav"><button onclick="fcNav(-1)"><svg class="i"><use href="#i-prev"/></svg>Prev</button><span class="ct" id="fcCt"></span><button onclick="fcNav(1)">Next<svg class="i"><use href="#i-next"/></svg></button></div>
    <div class="nav" style="margin-top:8px"><button onclick="fcShuffle()" style="flex:1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M3 7h3c5.5 0 6.5 10 12 10h3"/><path d="M3 17h3c2.2 0 3.6-1.6 4.8-3.5M21 7h-3c-2.2 0-3.6 1.6-4.8 3.5"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5"/></svg>Shuffle deck</button></div>
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
    <div id="starterPhrases"></div>
  </div>

  <!-- GRAMMAR -->
  <div class="section" id="s-grammar">
    <h2>Grammar explainer</h2>
    <div class="chips" id="grChips"></div>
    <div class="row"><input id="gtopic" placeholder="Any grammar point…"><button class="act" id="ggen" onclick="genGrammar()">Explain</button></div>
    <div id="gstatus" style="font-size:13px;opacity:.65;min-height:18px;margin:8px 2px"></div>
    <div id="grammarOut"></div>
    <div id="grammarBasics"></div>
  </div>
</div>

<div class="snote" id="speakNote" hidden><svg class="i"><use href="#i-warn"/></svg><span id="speakNoteText"></span></div>

<div class="tabbar" id="tabbar">
  <button class="on" data-s="cards" onclick="tab('cards')"><span class="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="13.5" height="17.5" rx="2.5"/><path d="M3.5 6.5V19a2.5 2.5 0 0 0 2.5 2.5h9.5"/></svg></span>Flashcards</button>
  <button data-s="vocab" onclick="tab('vocab')"><span class="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 21a2.5 2.5 0 0 1 2.5-2.5H20"/></svg></span>Vocabulary</button>
  <button data-s="phrases" onclick="tab('phrases')"><span class="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12 7.8L4 21l1.7-5A8.5 8.5 0 1 1 21 11.5z"/></svg></span>Phrases</button>
  <button data-s="grammar" onclick="tab('grammar')"><span class="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l.9-3.6L16.3 5a2.1 2.1 0 0 1 3 3L7.9 19.4 4 20z"/><path d="M14.6 6.7l2.9 2.9"/></svg></span>Grammar</button>
</div>

<script>
var LANG="__NAME__", NATIVE="__NATIVE__";
var DECKS=__DECKS_JSON__;
var GRAMMAR_PRESETS=__GRAMMAR_JSON__;
var STARTER_PHRASES=__STARTERP_JSON__;
var GRAMMAR_BASICS=__STARTERG_JSON__;
var PH_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3 3 3.5-3.5 4 4"/></svg>';
function phFallback(img){var d=document.createElement('div');d.className='ph';d.innerHTML=PH_ICON;img.parentNode.replaceChild(d,img);}
function imgFallback(img){var j=img.getAttribute('data-jpg');if(j){img.removeAttribute('data-jpg');img.src=j;}else phFallback(img);}
/* Bridges are looked up when used, never kept: MyLLM can add them after this
   script has run. */
var store={getItem:function(k){var s=window.myllmStorage;return s?s.getItem(k):Promise.resolve(null)},
           setItem:function(k,v){var s=window.myllmStorage;return s?s.setItem(k,v):Promise.resolve()}};
function el(i){return document.getElementById(i)}
function haptic(k){if(window.myllmHaptic)try{myllmHaptic(k||'light')}catch(e){}}
function spkIcon(){return '<span class="spk"><svg class="i"><use href="#i-spk"/></svg></span>'}

/* ---------- speech ----------
   Android's MyLLM has a myllmSpeak bridge; iOS does not, so on iPhone the web
   view's own speechSynthesis speaks. What makes it dependable there (learned on
   device with Talk Tutor and Language Lab): pick a voice for the language
   explicitly, only cancel when something is actually speaking, and say plainly
   when no voice played instead of staying silent. */
var TTS_LANG='__TTS__';
function canSpeak(){return !!(window.speechSynthesis&&window.SpeechSynthesisUtterance)}
var voiceCache={},speakToken=0,speakBtn=null,noteT=0;
if(canSpeak())try{speechSynthesis.onvoiceschanged=function(){voiceCache={}}}catch(e){}
function pickVoice(code){
  if(voiceCache[code]!==undefined)return voiceCache[code];
  var all=[];try{all=speechSynthesis.getVoices()||[]}catch(e){}
  function norm(v){return String(v.lang||'').replace('_','-').toLowerCase()}
  var want=code.toLowerCase(),base=want.slice(0,2);
  var inLang=all.filter(function(v){return norm(v).slice(0,2)===base});
  var better=function(list){return list.filter(function(v){return /enhanced|premium/i.test(v.name)})[0]||list[0]};
  var exact=inLang.filter(function(v){return norm(v)===want});
  voiceCache[code]=better(exact)||better(inLang)||null;
  return voiceCache[code];
}
function markSpeaking(btn,on){
  if(speakBtn&&speakBtn!==btn)speakBtn.classList.remove('on');
  if(btn)btn.classList.toggle('on',on);
  speakBtn=on?btn:null;
}
function noVoice(){
  el('speakNoteText').textContent='Couldn’t play '+LANG+' out loud. Check the volume, or add a '+LANG+' voice in iPhone Settings → Accessibility → Spoken Content → Voices.';
  el('speakNote').hidden=false;clearTimeout(noteT);noteT=setTimeout(function(){el('speakNote').hidden=true},8000);
}
function say(text,btn){
  if(!text)return;
  if(window.myllmSpeak){try{myllmSpeak(text,{lang:'__CODE__'});return}catch(e){}}
  if(!canSpeak()){noVoice();return}
  var ss=window.speechSynthesis,token=++speakToken,started=false;
  var u=new SpeechSynthesisUtterance(text);u.lang=TTS_LANG;var v=pickVoice(TTS_LANG);if(v)u.voice=v;
  u.rate=.9;u.volume=1;
  u.onstart=function(){started=true;if(token===speakToken){markSpeaking(btn,true);el('speakNote').hidden=true}};
  u.onend=function(){if(token===speakToken)markSpeaking(btn,false)};
  u.onerror=function(e){if(token!==speakToken)return;markSpeaking(btn,false);var why=e&&e.error;if(!started&&why!=='interrupted'&&why!=='canceled')noVoice()};
  function go(){try{if(ss.paused)ss.resume();ss.speak(u)}catch(e){noVoice()}}
  try{if(ss.speaking||ss.pending){ss.cancel();setTimeout(go,80)}else go()}catch(e){noVoice();return}   /* first line stays inside the tap, which iOS requires */
  setTimeout(function(){if(token===speakToken&&!started&&!ss.speaking){markSpeaking(btn,false);noVoice()}},2500);
}
function stopSpeaking(){speakToken++;markSpeaking(null,false);if(canSpeak())try{speechSynthesis.cancel()}catch(e){}}
document.addEventListener('visibilitychange',function(){if(document.hidden)stopSpeaking()});

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
  /* animated WebP loop when one exists (autoplays in <img>, no player chrome), else the JPG, else placeholder */
  var base=d.imgBase+order[cardIdx];
  iw.innerHTML='<img class="img" src="'+base+'.webp" alt="" data-jpg="'+base+'.jpg" onerror="imgFallback(this)">';
  el('fcW').textContent=c.w;el('fcE').textContent=c.en;
  el('fcW').classList.toggle('hidden',!showBack);el('fcE').classList.toggle('hidden',!showBack);
  el('fcTap').classList.toggle('hidden',showBack);el('fcSpk').classList.toggle('hidden',!showBack);
  el('fcCt').textContent=(cardIdx+1)+' / '+d.cards.length+'  ·  '+d.title;
}
function sayCard(){say(DECKS[deckIdx].cards[order[cardIdx]].w,el('fcSpk'))}
function flip(){showBack=!showBack;renderCard();haptic('light');if(showBack)sayCard();else stopSpeaking()}
function fcNav(n){var len=DECKS[deckIdx].cards.length;cardIdx=(cardIdx+n+len)%len;showBack=false;stopSpeaking();renderCard();haptic('selection');}

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
        '<div><div class="vw">'+o.c.w+'</div><div class="ve">'+o.c.en+'</div></div>'+spkIcon();
      r.onclick=function(){haptic('light');say(o.c.w)};
      L.appendChild(r);
    });
  });
  if(!L.children.length)L.innerHTML='<p style="opacity:.5;text-align:center;margin-top:30px">No matches.</p>';
}

/* ---------- phrases (AI) ---------- */
var phrases=[];
function needAI(setter){if(window.myllmAsk)return false;setter('This needs the latest MyLLM with “Allow apps to use the AI” enabled in Settings.');return true;}
__PHRASES_JS__function renderPhrases(){
  var L=el('phraseList');L.innerHTML='';
  phrases.forEach(function(ph){
    var d=document.createElement('div');d.className='panel';
    d.innerHTML='<div class="pt"></div><div class="pp"></div><div class="pe"></div>'+spkIcon();
    d.querySelector('.pt').textContent=ph.t;
    d.querySelector('.pp').textContent=ph.p?'['+ph.p+']':'';
    d.querySelector('.pe').textContent=ph.n;
    d.onclick=function(){haptic('light');say(ph.t)};
    L.appendChild(d);
  });
}

function renderStarterPhrases(){
  var L=el('starterPhrases');L.innerHTML='';
  STARTER_PHRASES.forEach(function(sec){
    var h=document.createElement('h2');h.textContent=sec.topic;L.appendChild(h);
    sec.items.forEach(function(ph){
      var d=document.createElement('div');d.className='panel';
      d.innerHTML='<div class="pt"></div><div class="pp"></div><div class="pe"></div>'+spkIcon();
      d.querySelector('.pt').textContent=ph.t;
      d.querySelector('.pp').textContent=ph.p?'['+ph.p+']':'';
      d.querySelector('.pe').textContent=ph.n;
      d.onclick=function(){haptic('light');say(ph.t)};
      L.appendChild(d);
    });
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

function renderGrammarBasics(){
  var L=el('grammarBasics');L.innerHTML='';
  var h=document.createElement('h2');h.textContent='The basics';L.appendChild(h);
  GRAMMAR_BASICS.forEach(function(g){
    var d=document.createElement('div');d.className='panel basic';
    var t=document.createElement('div');t.className='pt';t.textContent=g.title;d.appendChild(t);
    var r=document.createElement('div');r.className='pe';r.textContent=g.rule;d.appendChild(r);
    g.ex.forEach(function(pair){
      var x=document.createElement('div');x.className='gr-ex';
      var b=document.createElement('b');b.textContent=pair[0];
      var s=document.createElement('span');s.textContent='  —  '+pair[1];
      x.appendChild(b);x.appendChild(s);x.insertAdjacentHTML('beforeend',spkIcon());
      x.onclick=function(ev){ev.stopPropagation();haptic('light');say(pair[0])};
      d.appendChild(x);
    });
    L.appendChild(d);
  });
}

/* ---------- init ---------- */
buildDeckChips();resetDeck();buildGrammarChips();renderVocab();renderStarterPhrases();renderGrammarBasics();
el('ptopic').addEventListener('keydown',function(e){if(e.key==='Enter')genPhrases()});
el('gtopic').addEventListener('keydown',function(e){if(e.key==='Enter')genGrammar()});
store.getItem('phrases').then(function(v){if(v){try{phrases=JSON.parse(v)}catch(e){}renderPhrases();}});
</script></body></html>
"""

# Phrase generation. French, German and Spanish were each echo-proofed by hand
# (2026-07-29 Apple Intelligence sweep: labelled lines, not JSON) with slightly
# different wording, and those prompts are live — so each is kept verbatim here.
# Any other language pack gets the original JSON-array version.
DEFAULT_PHRASES_JS = r'''function genPhrases(){
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
'''
PHRASES_JS = {
    'fr': r'''/* Labelled lines, not JSON — small models (Apple Intelligence) echo JSON
   templates back verbatim. Echoed instructions are rejected and retried. */
var ECHO=new RegExp('the phrase in '+LANG+'|simple English pronunciation|the English meaning|repeat this line|labelled line','i');
function parsePhrases(reply){
  reply=String(reply||'');
  var items=[],got=false;
  reply.split(/\r?\n/).forEach(function(raw){
    var ln=raw.replace(/\*\*/g,'').trim();
    var m=ln.match(/^[-*#>\s]*(PHRASES?)\s*\d*\s*[::]\s*(.*)$/i);
    if(!m)return;
    got=true;
    var parts=m[2].split('|').map(function(x){return x.trim()});
    if(parts[0])items.push({t:parts[0],p:parts[1]||'',n:parts[2]||''});
  });
  if(!got){ // model answered in the old JSON-array shape — accept it
    var s=reply.indexOf('['),e=reply.lastIndexOf(']');
    if(s>=0&&e>s)try{
      var j=JSON.parse(reply.slice(s,e+1));
      if(Array.isArray(j))j.forEach(function(x){
        if(x&&x.t)items.push({t:String(x.t),p:x.p?String(x.p):'',n:x.n?String(x.n):''});
      });
    }catch(e2){}
  }
  items=items.filter(function(x){return x.t&&x.n&&!ECHO.test(x.t)&&!ECHO.test(x.p)&&!ECHO.test(x.n)});
  if(!items.length)throw new Error('no lesson came back');
  return items;
}
function genPhrases(){
  var topic=el('ptopic').value.trim();if(!topic){el('pstatus').textContent='Enter a topic.';return}
  if(needAI(function(t){el('pstatus').textContent=t})) return;
  el('pgen').disabled=true;el('pstatus').textContent='Writing '+LANG+' phrases about “'+topic+'”…';
  var p='Create 8 useful '+LANG+' phrases about: '+topic+', for an English-speaking beginner. Reply with EXACTLY these labelled lines and nothing else:\n'+
    'PHRASE: the phrase in '+LANG+' | simple English pronunciation | the English meaning — repeat this line for each of the 8 phrases';
  myllmAsk(p).then(function(r){return parsePhrases(r||'')})
  .catch(function(){return myllmAsk(p+'\nIMPORTANT: fill each labelled line with real content — never repeat the instruction text.')
    .then(function(r){return parsePhrases(r||'')})})
  .then(function(got){
    phrases=got.concat(phrases);store.setItem('phrases',JSON.stringify(phrases.slice(0,80)));
    el('ptopic').value='';el('pstatus').textContent='';renderPhrases();
  }).catch(function(err){el('pstatus').textContent='Could not generate: '+err.message})
  .then(function(){el('pgen').disabled=false});
}
''',
    'de': r'''/* Labelled lines, not JSON — small models (Apple Intelligence) echo JSON
   templates back verbatim. Echoed instructions are rejected and retried. */
var PH_ECHO=new RegExp('the phrase in '+LANG+'|simple English pronunciation|the English meaning|repeat this line|labelled line','i');
function parsePhrases(reply){
  var out=[],got=false;
  String(reply||'').split(/\r?\n/).forEach(function(raw){
    var ln=raw.replace(/\*\*/g,'').trim();
    var m=ln.match(/^[-*#>\s]*(PHRASES?)\s*\d*\s*[::]\s*(.*)$/i);
    if(!m)return;
    got=true;var v=m[2].trim();if(!v)return;
    var parts=v.split('|').map(function(x){return x.trim()});
    if(!parts[0])return;
    out.push({t:parts[0],p:parts[1]||'',n:parts[2]||''});
  });
  if(!got){ // model answered in the old JSON shape — accept it
    var s=String(reply||'').indexOf('['),e=String(reply||'').lastIndexOf(']');
    if(s>=0&&e>s)try{
      var j=JSON.parse(String(reply).slice(s,e+1));
      if(Array.isArray(j))j.forEach(function(x){
        if(x&&x.t)out.push({t:String(x.t),p:x.p?String(x.p):'',n:x.n?String(x.n):''});
      });
    }catch(e2){}
  }
  out=out.filter(function(x){return x.t&&x.n&&!PH_ECHO.test(x.t)&&!PH_ECHO.test(x.p)&&!PH_ECHO.test(x.n)});
  if(!out.length)throw new Error('no lesson came back');
  return out;
}
function genPhrases(){
  var topic=el('ptopic').value.trim();if(!topic){el('pstatus').textContent='Enter a topic.';return}
  if(needAI(function(t){el('pstatus').textContent=t})) return;
  el('pgen').disabled=true;el('pstatus').textContent='Writing '+LANG+' phrases about “'+topic+'”…';
  var p='Create 8 useful '+LANG+' phrases about: '+topic+', for an English-speaking beginner. Reply with EXACTLY these labelled lines and nothing else:\n'+
    'PHRASE: the phrase in '+LANG+' | simple English pronunciation | the English meaning — repeat this line for each phrase';
  myllmAsk(p).then(function(r){return parsePhrases(r||'')})
  .catch(function(){return myllmAsk(p+'\nIMPORTANT: fill each labelled line with real content — never repeat the instruction text.')
    .then(function(r){return parsePhrases(r||'')})})
  .then(function(got){
    phrases=got.concat(phrases);store.setItem('phrases',JSON.stringify(phrases.slice(0,80)));
    el('ptopic').value='';el('pstatus').textContent='';renderPhrases();
  }).catch(function(err){el('pstatus').textContent='Could not generate: '+err.message})
  .then(function(){el('pgen').disabled=false});
}
''',
    'es': r'''/* Labelled lines, not JSON — small models (Apple Intelligence) echo JSON
   templates back verbatim. Echoed instructions are rejected and retried. */
var ECHO=/the phrase in|simple English pronunciation|its English meaning|repeat this line|labelled line/i;
function parsePhrases(reply){
  var items=[],got=false;
  String(reply||'').split(/\r?\n/).forEach(function(raw){
    var ln=raw.replace(/\*\*/g,'').trim();
    var m=ln.match(/^[-*#>\s]*(PHRASES?)\s*\d*\s*[::]\s*(.*)$/i);
    if(!m)return;
    got=true;
    var parts=m[2].split('|').map(function(s){return s.trim()});
    var it={t:parts[0]||'',p:parts[1]||'',n:parts[2]||''};
    if(it.t&&it.n&&!ECHO.test(parts.join(' ')))items.push(it);
  });
  if(!got){ // model answered in the old JSON shape — accept it
    var s=String(reply||'').indexOf('['),e=String(reply||'').lastIndexOf(']');
    if(s>=0&&e>s)try{
      items=JSON.parse(String(reply).slice(s,e+1)).filter(function(x){
        return x&&x.t&&x.n&&!ECHO.test(String(x.t)+' '+String(x.p||'')+' '+String(x.n))});
    }catch(e2){}
  }
  if(!items.length)throw new Error('the lesson was empty');
  return items;
}
function genPhrases(){
  var topic=el('ptopic').value.trim();if(!topic){el('pstatus').textContent='Enter a topic.';return}
  if(needAI(function(t){el('pstatus').textContent=t})) return;
  el('pgen').disabled=true;el('pstatus').textContent='Writing '+LANG+' phrases about “'+topic+'”…';
  var p='Create 8 useful '+LANG+' phrases about: '+topic+', for an English-speaking beginner. Reply with EXACTLY these labelled lines and nothing else:\n'+
    'PHRASE: the phrase in '+LANG+' | its simple English pronunciation | its English meaning — repeat this line for each of the 8 phrases';
  myllmAsk(p).then(function(r){return parsePhrases(r||'')})
  .catch(function(){return myllmAsk(p+'\nIMPORTANT: fill each labelled line with real content — never repeat the instruction text.')
    .then(function(r){return parsePhrases(r||'')})})
  .then(function(got){
    phrases=got.concat(phrases);store.setItem('phrases',JSON.stringify(phrases.slice(0,80)));
    el('ptopic').value='';el('pstatus').textContent='';renderPhrases();
  }).catch(function(err){el('pstatus').textContent='Could not generate: '+err.message})
  .then(function(){el('pgen').disabled=false});
}
''',
}

# BCP-47 voice per pack (the page's lang attribute stays the short code)
TTS = {"fr": "fr-FR", "de": "de-DE", "es": "es-ES", "sk": "sk-SK"}

# nice, common grammar points (kept language-neutral in wording so the AI adapts)
GRAMMAR_PRESETS = ["Articles & gender","Present tense","Plurals","Adjective agreement",
                   "Asking questions","Numbers 1–20","Ser vs estar / to be","Negation"]


def build(langfile):
    lp = json.load(open(langfile))
    code = lp["code"]
    # Optional branding overrides (default to the plain "Learn <Name>" app).
    title = lp.get("appName", "Learn " + lp["name"])
    subtitle = lp.get("subtitle", lp["native"] + " · picture flashcards")
    slug = lp.get("slug", "learn-" + lp["name"].lower())
    decks = []
    for deck_id, words in lp["decks"].items():
        meta = CAT_BY_ID[deck_id]
        en = [c["en"] for c in meta["cards"]]
        assert len(words) == len(en), f"{deck_id}: {len(words)} words vs {len(en)} images"
        decks.append({
            "id": deck_id,
            "title": meta["title"],
            "imgBase": meta["imgBase"],
            "cards": [{"w": w, "en": e} for w, e in zip(words, en)],
        })
    grammar = [g.replace("Ser vs estar / to be", "Ser vs estar" if code == "es" else "The verb 'to be'")
               for g in GRAMMAR_PRESETS]

    # ComfyUI-generated landmark badge replaces the old flag emoji in the header
    with open(os.path.join(HERE, "langpacks", "emblem-" + code + ".jpg"), "rb") as f:
        emblem = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()

    html = (TEMPLATE
            .replace("__CODE__", code)
            .replace("__TITLE__", title)
            .replace("__SUBTITLE__", subtitle)
            .replace("__NAME__", lp["name"])
            .replace("__NATIVE__", lp["native"])
            .replace("__EMBLEM__", emblem)
            .replace("__TTS__", TTS.get(code, code))
            .replace("__ACCENT2__", lp.get("accent2", lp["accent"]))
            .replace("__ACCENT__", lp["accent"])
            .replace("__DECKS_JSON__", json.dumps(decks, ensure_ascii=False))
            .replace("__GRAMMAR_JSON__", json.dumps(grammar, ensure_ascii=False))
            .replace("__STARTERP_JSON__", json.dumps(lp["starterPhrases"], ensure_ascii=False))
            .replace("__STARTERG_JSON__", json.dumps(lp["starterGrammar"], ensure_ascii=False))
            .replace("__PHRASES_JS__", PHRASES_JS.get(code, DEFAULT_PHRASES_JS)))

    open(os.path.join(HERE, "apps-src", slug + ".html"), "w").write(html)
    icon_symbol = lp.get("iconSymbol", "character.bubble.fill")
    # Full .myllmapp bundle schema so a standalone import (no manifest) still gets its icon.
    json.dump({"name": title, "kind": "html",
               "iconSymbol": icon_symbol, "iconColor": lp["iconColor"], "html": html},
              open(os.path.join(HERE, "apps-src", slug + ".myllmapp"), "w"), ensure_ascii=False)

    ncards = sum(len(d["cards"]) for d in decks)
    default_desc = ("Learn " + lp["name"] + " with illustrated picture flashcards across "
                    + str(len(decks)) + " everyday topics (" + str(ncards) + " words, each with a photo) — "
                    "browse and search the vocabulary, learn from built-in starter phrase packs "
                    "(greetings, eating out, getting around) and grammar basics, then use your own "
                    "on-device AI to generate phrase lessons on any topic and explain any grammar point. "
                    "Everything except the AI tutor works offline; AI generation needs the latest MyLLM "
                    "with “Allow apps to use the AI” enabled in Settings.")
    entry = {
        "id": slug, "name": title, "emoji": lp["flag"],
        "tagline": lp.get("tagline", "Picture flashcards + AI tutor"),
        "description": lp.get("description", default_desc),
        "tags": lp.get("tags", ["learning", "AI-powered", "offline"]),
        "iconSymbol": icon_symbol, "iconColor": lp["iconColor"],
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
