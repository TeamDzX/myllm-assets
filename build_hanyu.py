#!/usr/bin/env python3
"""Adapt the Wix-built Hanyu (Learn Chinese) app to run inside the MyLLMos sandbox.

Reads apps-src/hanyu-raw.html (your untouched source), injects a compatibility
layer (no edits to your 10k lines), and writes:
  - apps-src/hanyu.html          (sandbox-ready)
  - apps-src/hanyu.myllmapp      (install wrapper)
  - adds/updates the apps.json entry (Students)
Run:  python3 build_hanyu.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW  = os.path.join(HERE, 'apps-src', 'hanyu-raw.html')
OUT  = os.path.join(HERE, 'apps-src', 'hanyu.html')
WRAP = os.path.join(HERE, 'apps-src', 'hanyu.myllmapp')
MANIFEST = os.path.join(HERE, 'apps.json')
APPSTORE = 'https://apps.apple.com/us/app/hanyu-learn-chinese/id6760541929'
VERSION  = 6  # bump on every adapted change; also cache-busts the html URL

# --- HEAD shim: injected right after <body>, before any app script runs ---
HEAD = r'''
<style>
/* MyLLMos: take over the chat's keyboard behaviour. The app's own handler
   fixes the input bar to bottom:0 (behind the keyboard); we instead resize the
   chat window to fit above the keyboard, keeping the input bar in normal flow
   and the messages list scrollable. Neutralise the app's conflicting rules. */
body.keyboard-open .chat-input-area{position:static !important;bottom:auto !important;}
body.keyboard-open .chat-messages{padding-bottom:12px !important;}
</style>
<script>
/* === MyLLMos compatibility layer (auto-injected; do not edit the app above) === */
(function(){
  // Synchronous storage shim. On the null origin used by MyLLMos, the real
  // localStorage/sessionStorage throw — which would crash this app at startup.
  function memStore(){
    var M = {};
    var api = {
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(M,k)?M[k]:null;},
      setItem:function(k,v){M[String(k)]=String(v); if(api.__persist) api.__persist();},
      removeItem:function(k){delete M[String(k)]; if(api.__persist) api.__persist();},
      clear:function(){for(var k in M){ if(Object.prototype.hasOwnProperty.call(M,k)) delete M[k]; } if(api.__persist) api.__persist();},
      key:function(i){return Object.keys(M)[i]||null;},
      __dump:function(){return M;},
      __load:function(o){if(o){for(var k in o){ if(Object.prototype.hasOwnProperty.call(o,k)) M[k]=String(o[k]); }}}
    };
    Object.defineProperty(api,'length',{get:function(){return Object.keys(M).length;}});
    return api;
  }
  var LS = memStore(), SS = memStore();
  try{ Object.defineProperty(window,'localStorage',{value:LS,configurable:true}); }catch(e){ try{window.localStorage = LS;}catch(e2){} }
  try{ Object.defineProperty(window,'sessionStorage',{value:SS,configurable:true}); }catch(e){ try{window.sessionStorage = SS;}catch(e2){} }

  // Persist the localStorage blob through myllmStorage (debounced).
  var KEY='__hanyu_ls', hydrated=false, flushT=null;
  function flush(){ if(!hydrated||!window.myllmStorage) return; try{ window.myllmStorage.setItem(KEY, JSON.stringify(LS.__dump())); }catch(e){} }
  LS.__persist=function(){ if(!hydrated) return; if(flushT) clearTimeout(flushT); flushT=setTimeout(flush,400); };
  window.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden') flush(); });
  window.addEventListener('pagehide',flush);

  // Hydrate from native storage, then let the resync (tail script) refresh the UI.
  window.__hanyuHydrate = new Promise(function(resolve){
    if(!window.myllmStorage){ hydrated=true; return resolve(); }
    window.myllmStorage.getItem(KEY).then(function(v){
      if(v){ try{ LS.__load(JSON.parse(v)); }catch(e){} }
      hydrated=true; resolve();
    }, function(){ hydrated=true; resolve(); });
  });

  // Route fetch() through the native bridge (the null origin makes external fetch CORS-dead).
  if(window.myllmFetch){
    var realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function(url, opts){
      url = String(url);
      if(!/^https?:/i.test(url)){ return realFetch ? realFetch(url, opts) : Promise.reject(new Error('offline')); }
      opts = opts||{};
      return window.myllmFetch(url, {method:opts.method||'GET', headers:opts.headers||{}, body:(opts.body==null?null:String(opts.body))})
        .then(function(r){
          if(r && r.error) throw new Error(r.error);
          var body = (r && r.body!=null) ? r.body : ((r && r.bodyBase64) ? (window.atob?atob(r.bodyBase64):'') : '');
          return {
            ok: !!(r&&r.ok), status: (r&&r.status)||0,
            headers:{get:function(h){return (r&&r.headers&&r.headers[String(h).toLowerCase()])||null;}},
            text:function(){return Promise.resolve(body);},
            json:function(){return Promise.resolve(JSON.parse(body));}
          };
        });
    };
  }

  // AI tutor: the chat posts CHATBOT_REQUEST to window.parent (old Wix page).
  // parent === self in MyLLMos, so answer it on-device with myllmAsk.
  var SYS = "You are a friendly, encouraging Mandarin Chinese tutor inside a learning app. Help with translations, grammar, pinyin, tones, example sentences, and short conversation practice. Keep answers concise and beginner-friendly. Whenever you give Chinese, include pinyin and a short English meaning.";
  window.addEventListener('message', function(ev){
    var d = ev.data; if(!d || d.type!=='CHATBOT_REQUEST') return;
    function reply(ok,msg,err){ window.postMessage({type:'CHATBOT_RESPONSE', requestId:d.requestId, response: ok?{success:true,message:msg}:{success:false,error:err}}, '*'); }
    if(!window.myllmAsk){ reply(false,null,"The tutor needs the MyLLM app's on-device AI. Turn on 'Allow apps to use the AI' in the MyLLMos settings menu."); return; }
    var prompt = d.message;
    if(d.conversationHistory && d.conversationHistory.length){
      var hist = d.conversationHistory.slice(-8).map(function(m){return (m.role==='user'?'Student: ':'Tutor: ')+m.content;}).join('\n');
      prompt = hist + '\nStudent: ' + d.message;
    }
    window.myllmAsk(prompt, {system:SYS}).then(function(t){ reply(true,t); }, function(e){ reply(false,null,(e&&e.message)||'The AI is unavailable right now.'); });
  });

  // AI tutor keyboard fix: shrink the chat window to fit above the keyboard so
  // the input bar stays in normal flow at the bottom and the messages list
  // scrolls normally (WKWebView shrinks visualViewport, not window.innerHeight).
  (function(){
    var vv = window.visualViewport; if(!vv) return;
    var active=false;
    function sizeWin(){
      var win=document.querySelector('.chat-window-tab'); if(!win) return;
      var top=win.getBoundingClientRect().top; if(!(top>0 && top<320)) top=90;
      var h=Math.round(vv.height - top - 8); if(h<200) h=200;
      win.style.height=h+'px'; win.style.maxHeight=h+'px';
      var msgs=document.querySelector('.chat-messages'); if(msgs) msgs.scrollTop=msgs.scrollHeight;
    }
    function reset(){ var win=document.querySelector('.chat-window-tab'); if(win){ win.style.height=''; win.style.maxHeight=''; } }
    function onVV(){ if(active) sizeWin(); }
    document.addEventListener('focusin', function(e){
      if(e.target && e.target.id==='chatInput'){ active=true; sizeWin(); vv.addEventListener('resize',onVV); vv.addEventListener('scroll',onVV); setTimeout(sizeWin,250); setTimeout(sizeWin,550); }
    });
    document.addEventListener('focusout', function(e){
      if(e.target && e.target.id==='chatInput'){ active=false; vv.removeEventListener('resize',onVV); vv.removeEventListener('scroll',onVV); setTimeout(reset,150); }
    });
  })();

  // Tutor empty-state hint about model speed / backends.
  window.addEventListener('DOMContentLoaded', function(){
    try{
      var w=document.querySelector('#chatTab .welcome-message'); if(!w) return;
      var p=document.createElement('p');
      p.style.cssText='margin-top:12px;font-size:12px;opacity:.7';
      p.textContent='Answers come from your selected AI model (MyLLM Settings → needs “Allow apps to use the AI”). The on-device model takes a few seconds; pairing a backend or adding a cloud key makes it near-instant.';
      w.appendChild(p);
    }catch(e){}
  });

  // "Get the full app" App Store banner (opens in Safari).
  window.addEventListener('DOMContentLoaded', function(){
    try{
      var a = document.createElement('a');
      a.href='APPSTORE_URL'; a.target='_blank'; a.rel='noopener';
      a.style.cssText='display:block;padding:9px 16px;background:linear-gradient(135deg,#4a6bdf,#8b5cf6);color:#fff;text-align:center;font-weight:600;font-size:13px;text-decoration:none;';
      a.innerHTML='⭐ Love this? Get the full <b>Hanyu – Learn Chinese</b> app on the App Store →';
      var hdr = document.querySelector('.top-header');
      if(hdr && hdr.parentNode) hdr.parentNode.insertBefore(a, hdr.nextSibling); else document.body.insertBefore(a, document.body.firstChild);
    }catch(e){}
  });
})();
</script>
'''.replace('APPSTORE_URL', APPSTORE)

# --- TAIL resync: injected before the final </body>, after the app's scripts ---
TAIL = r'''
<script>
/* === MyLLMos: re-sync app state after async storage hydration === */
window.__hanyuHydrate && window.__hanyuHydrate.then(function(){
  try{
    if(typeof xp!=='undefined') xp=parseInt(localStorage.getItem('xp')||'0');
    if(typeof streak!=='undefined') streak=parseInt(localStorage.getItem('streak')||'0');
    if(typeof hearts!=='undefined') hearts=parseInt(localStorage.getItem('hearts')||'5');
    if(typeof gems!=='undefined') gems=parseInt(localStorage.getItem('gems')||'0');
    if(typeof studyTime!=='undefined') studyTime=parseInt(localStorage.getItem('studyTime')||'0');
    if(typeof gamesPlayed!=='undefined') gamesPlayed=parseInt(localStorage.getItem('gamesPlayed')||'0');
    if(typeof favorites!=='undefined') favorites=JSON.parse(localStorage.getItem('favorites')||'[]');
    if(typeof learned!=='undefined') learned=JSON.parse(localStorage.getItem('learned')||'[]');
    if(typeof practiceDifficulty!=='undefined') practiceDifficulty=localStorage.getItem('practiceDifficulty')||'normal';
    if(typeof audioSpeed!=='undefined') audioSpeed=parseFloat(localStorage.getItem('audioSpeed')||'0.8');
    if(typeof selectedVoiceName!=='undefined') selectedVoiceName=localStorage.getItem('selectedVoice')||'';
    if(typeof spacedRepData!=='undefined') spacedRepData=JSON.parse(localStorage.getItem('spacedRepData')||'{}');
    if(typeof listeningCorrectAnswers!=='undefined') listeningCorrectAnswers=parseInt(localStorage.getItem('listeningCorrectAnswers')||'0');
    if(typeof loadLastPosition==='function') loadLastPosition();
    if(typeof restoreDifficultyUI==='function') restoreDifficultyUI();
    if(typeof updateStats==='function') updateStats();
    if(typeof loadUserProfile==='function') loadUserProfile();
    if(typeof renderSessionStats==='function') renderSessionStats();
    if(typeof updateDisplay==='function') updateDisplay();
  }catch(e){ if(window.console) console.warn('hanyu resync', e); }
});
</script>
'''

# --- Illustrated Stories: replaces the YouTube/Movies section with real
#     hanyu-packs stories (data embedded as window.__hanyuStories). ---
STORIES_FEATURE = r'''
<style>
.hy-stories-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-top:8px}
.hy-story-card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:var(--shadow-md);cursor:pointer;transition:transform .2s,box-shadow .2s;border:1px solid var(--gray-200)}
.hy-story-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
.hy-story-card:active{transform:scale(.98)}
.hy-story-card .thumb{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:var(--gray-100)}
.hy-story-card .meta{padding:10px 12px}
.hy-story-card .zh{font-size:18px;font-weight:700;color:var(--gray-800)}
.hy-story-card .py{font-size:12px;color:var(--primary-color);font-weight:600}
.hy-story-card .en{font-size:12px;color:var(--gray-500);margin-top:2px}
.hy-story-card .lvl{display:inline-block;margin-top:6px;font-size:10px;font-weight:700;color:#fff;background:var(--primary-color);border-radius:10px;padding:2px 8px}
.hy-reader{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:11000;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch}
.hy-reader.open{display:flex}
.hy-reader-card{background:var(--gray-50);width:100%;max-width:640px;min-height:100%}
.hy-reader-hero{position:relative}
.hy-reader-hero img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--gray-200)}
.hy-reader-hero .titles{position:absolute;left:0;right:0;bottom:0;padding:16px;background:linear-gradient(transparent,rgba(0,0,0,.78));color:#fff}
.hy-reader-hero .titles .zh{font-size:26px;font-weight:800}
.hy-reader-hero .titles .py{font-size:14px;opacity:.92}
.hy-reader-hero .titles .en{font-size:14px;opacity:.85}
.hy-reader-close{position:absolute;top:12px;right:12px;width:38px;height:38px;border:0;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:22px;line-height:1;cursor:pointer;z-index:2}
.hy-sent{background:#fff;border-radius:12px;padding:14px;margin:12px;box-shadow:var(--shadow-sm);border-left:4px solid var(--primary-color)}
.hy-sent .zh{font-size:22px;font-weight:600;color:var(--gray-800);line-height:1.5}
.hy-sent .zh .w{cursor:pointer;border-radius:4px;padding:0 1px}
.hy-sent .zh .w:active{background:var(--primary-light)}
.hy-sent .py{font-size:14px;color:var(--primary-color);margin-top:4px}
.hy-sent .en{font-size:14px;color:var(--gray-600);margin-top:2px}
.hy-sent .play{margin-top:8px;border:0;background:var(--primary-color);color:#fff;border-radius:18px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer}
.hy-q{background:#fff;border-radius:12px;padding:14px;margin:12px;box-shadow:var(--shadow-sm)}
.hy-q-t{font-weight:600;color:var(--gray-800);margin-bottom:8px}
.hy-opts{display:grid;gap:8px}
.hy-opt{text-align:left;border:2px solid var(--gray-200);background:#fff;border-radius:10px;padding:10px 12px;font-size:15px;color:var(--gray-700);cursor:pointer}
.hy-opt.ok{background:#d1fae5;border-color:#10b981;color:#065f46}
.hy-opt.no{background:#fee2e2;border-color:#ef4444;color:#991b1b}
@media (prefers-color-scheme: dark){
  .hy-story-card{background:#1c1c1e;border-color:#2c2c2e}.hy-story-card .zh{color:#eee}
  .hy-reader-card{background:#000}.hy-sent,.hy-q{background:#1c1c1e}.hy-sent .zh,.hy-q-t{color:#eee}
  .hy-opt{background:#1c1c1e;color:#ccc;border-color:#2c2c2e}
}
</style>
<script>
(function(){
  var STORIES = window.__hanyuStories || [];
  if(!STORIES.length) return;
  function speak(zh,py){ try{ if(typeof speakVocab==='function'){ speakVocab(zh,py||''); return; } if('speechSynthesis' in window){ speechSynthesis.cancel(); var u=new SpeechSynthesisUtterance(zh); u.lang='zh-CN'; u.rate=0.85; speechSynthesis.speak(u); } }catch(e){} }
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  var reader=document.createElement('div'); reader.className='hy-reader';
  reader.addEventListener('click',function(e){ if(e.target===reader) close(); });
  document.body.appendChild(reader);
  function close(){ reader.className='hy-reader'; reader.innerHTML=''; try{speechSynthesis.cancel();}catch(e){} }
  function open(s){
    var sents=(s.sentences||[]).map(function(se){
      var zh=(se.words&&se.words.length)? se.words.map(function(w){return '<span class="w" data-zh="'+esc(w.hanzi)+'" data-py="'+esc(w.pinyin)+'">'+esc(w.hanzi)+'</span>';}).join('') : esc(se.chinese);
      return '<div class="hy-sent"><div class="zh">'+zh+'</div><div class="py">'+esc(se.pinyin)+'</div><div class="en">'+esc(se.english)+'</div><button class="play" data-zh="'+esc(se.chinese)+'" data-py="'+esc(se.pinyin)+'">🔊 Listen</button></div>';
    }).join('');
    var qs=(s.questions||[]).map(function(q,qi){
      var opts=(q.options||[]).map(function(o,oi){return '<button class="hy-opt" data-o="'+oi+'">'+esc(o)+'</button>';}).join('');
      return '<div class="hy-q" data-correct="'+(q.correct)+'"><div class="hy-q-t">'+esc(q.question)+'</div><div class="hy-opts">'+opts+'</div></div>';
    }).join('');
    var qhead = qs ? '<div style="margin:18px 12px 2px;font-weight:700;color:var(--gray-600)">Quick check</div>' : '';
    reader.innerHTML='<div class="hy-reader-card"><div class="hy-reader-hero"><button class="hy-reader-close" aria-label="Close">&times;</button>'+
      (s.image?'<img src="'+esc(s.image)+'" alt="">':'')+
      '<div class="titles"><div class="zh">'+esc(s.title)+'</div><div class="py">'+esc(s.titlePinyin)+'</div><div class="en">'+esc(s.titleEnglish)+'</div></div></div>'+
      sents+qhead+qs+'<div style="height:28px"></div></div>';
    reader.className='hy-reader open'; reader.scrollTop=0;
    reader.querySelector('.hy-reader-close').onclick=close;
    reader.querySelectorAll('.hy-sent .play').forEach(function(b){ b.onclick=function(){ speak(b.getAttribute('data-zh'), b.getAttribute('data-py')); }; });
    reader.querySelectorAll('.hy-sent .w').forEach(function(w){ w.onclick=function(){ speak(w.getAttribute('data-zh'), w.getAttribute('data-py')); }; });
    reader.querySelectorAll('.hy-q').forEach(function(qd){
      var correct=parseInt(qd.getAttribute('data-correct'),10);
      var btns=qd.querySelectorAll('.hy-opt');
      btns.forEach(function(b,oi){ b.onclick=function(){
        btns.forEach(function(x){ x.style.pointerEvents='none'; });
        if(oi===correct){ b.className='hy-opt ok'; } else { b.className='hy-opt no'; if(btns[correct]) btns[correct].className='hy-opt ok'; }
      }; });
    });
  }
  function buildGrid(){
    var grid=document.createElement('div'); grid.className='hy-stories-grid';
    STORIES.forEach(function(s){
      var c=document.createElement('div'); c.className='hy-story-card';
      c.innerHTML=(s.image?'<img class="thumb" loading="lazy" src="'+esc(s.image)+'" alt="">':'<div class="thumb"></div>')+
        '<div class="meta"><div class="zh">'+esc(s.title)+'</div><div class="py">'+esc(s.titlePinyin)+'</div><div class="en">'+esc(s.titleEnglish)+'</div><span class="lvl">HSK '+esc(s.level)+'</span></div>';
      c.onclick=function(){ open(s); };
      grid.appendChild(c);
    });
    return grid;
  }
  function install(){
    var mc=document.getElementById('moviesContent'); if(!mc) return false;   // repurpose the old Movies pane
    mc.innerHTML='<div class="section-intro" style="background:linear-gradient(135deg,#ef4444,#f59e0b)"><h2><i class="fas fa-book-open"></i> Chinese Stories</h2><p>Illustrated short stories — tap any word or sentence to hear it.</p></div>';
    mc.appendChild(buildGrid());
    var btns=document.querySelectorAll('#storiesTab .sub-tab-btn');
    if(btns[0]) btns[0].innerHTML='<i class="fas fa-book-open"></i> Stories';
    return true;
  }
  function tryInstall(n){ if(install()||n<=0) return; setTimeout(function(){ tryInstall(n-1); },300); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ tryInstall(6); });
  else tryInstall(6);
})();
</script>
'''

def main():
    if not os.path.exists(RAW):
        sys.exit('Missing %s — save your Hanyu source there first.' % RAW)
    raw = open(RAW, encoding='utf-8').read()
    # Defensive: drop anything after the real document close (stray paste text).
    i = raw.rfind('</html>')
    if i != -1:
        raw = raw[:i+len('</html>')]
    # Inject HEAD after the first <body...>
    new, n = re.subn(r'<body[^>]*>', lambda m: m.group(0) + HEAD, raw, count=1)
    if n != 1:
        sys.exit('Could not find <body> to inject into.')
    # Inject TAIL before the LAST </body> (the app builds other </body> in strings).
    head, _, tailpart = new.rpartition('</body>')
    if not head:
        sys.exit('Could not find closing </body>.')
    # Embed the real hanyu-packs stories + the illustrated-stories reader.
    stories_path = os.path.join(HERE, 'apps-src', 'hanyu-stories.json')
    stories_block = ''
    if os.path.exists(stories_path):
        sj = json.dumps(json.load(open(stories_path, encoding='utf-8')), ensure_ascii=True, separators=(',', ':'))
        sj = sj.replace('</', '<\\/')
        stories_block = '<script>window.__hanyuStories=' + sj + ';</script>\n' + STORIES_FEATURE
    else:
        print('WARN: %s missing — Stories feature not embedded' % stories_path)

    new = head + TAIL + stories_block + '</body>' + tailpart
    # Give the AI tutor more breathing room than its 30s default (offline model).
    new, tcount = re.subn(r"(reject\(new Error\('Request timeout'\)\);[\s\S]{0,80}?\}, )30000(\);)",
                          r"\g<1>120000\g<2>", new, count=1)
    if tcount != 1:
        print('WARN: chat timeout not bumped (pattern not found)')
    open(OUT, 'w', encoding='utf-8').write(new)

    icon, color = 'character.book.closed.fill', 'orange'
    open(WRAP, 'w', encoding='utf-8').write(json.dumps(
        {"name":"Hanyu – Learn Chinese","html":new,"kind":"html","iconSymbol":icon,"iconColor":color}, ensure_ascii=False))

    RAWBASE = 'https://raw.githubusercontent.com/TeamDzX/myllm-assets/main'
    d = json.load(open(MANIFEST, encoding='utf-8'))
    d['apps'] = [a for a in d['apps'] if a.get('id') != 'hanyu']
    d['apps'].append({
        "id":"hanyu","name":"Hanyu – Learn Chinese","emoji":"学",
        "tagline":"Learn Mandarin Chinese",
        "description":"A full Mandarin course in one app: character flashcards with stroke order, 20+ games, grammar, radicals, vocabulary, geography and history, printable worksheets, and a private AI tutor powered by MyLLM's on-device AI (turn on 'Allow apps to use the AI'). Saves your progress on-device and works offline. The full native app is also on the App Store: "+APPSTORE,
        "tags":["AI-powered","learning","offline"],
        "category":"Students","iconSymbol":icon,"iconColor":color,
        "version":VERSION,"featured":True,"requiresAI":False,
        "banner":RAWBASE+"/apps/hanyu.jpg","icon":RAWBASE+"/apps/hanyu-icon.png",
        "html":RAWBASE+"/apps-src/hanyu.html?v=%d"%VERSION,"json":RAWBASE+"/apps-src/hanyu.myllmapp",
        "sizeKB":max(1,round(os.path.getsize(OUT)/1024))
    })
    d['updated']="2026-06-14"
    open(MANIFEST,'w',encoding='utf-8').write(json.dumps(d,indent=2,ensure_ascii=False))
    json.load(open(MANIFEST, encoding='utf-8'))            # validate
    json.load(open(WRAP, encoding='utf-8'))

    print('OK  hanyu.html %d KB | wrapper %d KB | manifest entry added (Students)' % (
        round(os.path.getsize(OUT)/1024), round(os.path.getsize(WRAP)/1024)))

if __name__ == '__main__':
    main()
