#!/usr/bin/env python3
"""Adapt the household Expense Tracker (Google Sheets backend) for MyLLMos.

Reads apps-src/expense-raw.html (PRIVATE — contains the author's own Apps Script
URL; never committed), strips the hardcoded endpoint, injects a sandbox compat
layer (storage + fetch shims, a moment polyfill, sandbox-safe confirms), a
"connect your OWN sheet" setup with a paste-in Apps Script, an add-expense
assistant action, and writes:
  - apps-src/expense-tracker.html
  - apps-src/expense-tracker.myllmapp
  - apps.json entry (Productivity)
Run:  python3 build_expense.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW  = os.path.join(HERE, 'apps-src', 'expense-raw.html')
OUT  = os.path.join(HERE, 'apps-src', 'expense-tracker.html')
WRAP = os.path.join(HERE, 'apps-src', 'expense-tracker.myllmapp')
MANIFEST = os.path.join(HERE, 'apps.json')
RAWBASE = 'https://raw.githubusercontent.com/TeamDzX/myllm-assets/main'
VERSION = 2

# --- Apps Script the user deploys to their OWN sheet (implements the contract
#     the app already speaks: POST appends a row; ?action=getExpenses reads;
#     ?action=resetMonth clears). ---
APPS_SCRIPT = r'''function doGet(e){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheets()[0];
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'resetMonth'){
    var last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
    return ContentService.createTextOutput('Success');
  }
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++){
    var r = rows[i];
    if (!r[0]) continue;
    out.push({date:String(r[0]), person:String(r[1]), category:String(r[2]), amount:r[3], description:String(r[4])});
  }
  return ContentService.createTextOutput(JSON.stringify({expenses:out, sheetUrl:ss.getUrl()}))
    .setMimeType(ContentService.MimeType.JSON);
}
function doPost(e){
  var d = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]
    .appendRow([d.date, d.person, d.category, d.amount, d.description]);
  return ContentService.createTextOutput('Success');
}'''

# --- CSS injected into <head>: iPad-responsive centred column. ---
STYLE = r'''
<style>
/* MyLLMos: comfortable centred column on iPad/large screens. */
@media (min-width: 768px){
  body{ max-width: 640px !important; margin-left:auto !important; margin-right:auto !important; }
}
#webAppUrlInput{ width:100%; box-sizing:border-box; font:inherit; font-size:14px; padding:10px 12px;
  border:2px solid var(--border,#e5e7eb); border-radius:8px; }
#appsScript{ white-space:pre-wrap; font-family:ui-monospace,Menlo,monospace; font-size:11px;
  background:var(--gray-50,#f7f7f8); padding:10px; border-radius:8px; overflow:auto; max-height:220px; }
</style>
'''

# --- Compat layer injected right after <body>, before any app script runs. ---
HEAD = r'''
<script>
/* === MyLLMos compatibility layer (auto-injected) === */
(function(){
  // localStorage/sessionStorage throw on the null origin — synchronous in-memory
  // shim, persisted through myllmStorage (key __expense_ls).
  function memStore(){
    var M={}, api={
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(M,k)?M[k]:null;},
      setItem:function(k,v){M[String(k)]=String(v); if(api.__persist) api.__persist();},
      removeItem:function(k){delete M[String(k)]; if(api.__persist) api.__persist();},
      clear:function(){for(var k in M){if(Object.prototype.hasOwnProperty.call(M,k)) delete M[k];} if(api.__persist) api.__persist();},
      key:function(i){return Object.keys(M)[i]||null;}, __dump:function(){return M;},
      __load:function(o){if(o){for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k)) M[k]=String(o[k]);}}}
    };
    Object.defineProperty(api,'length',{get:function(){return Object.keys(M).length;}});
    return api;
  }
  var LS=memStore(), SS=memStore();
  try{Object.defineProperty(window,'localStorage',{value:LS,configurable:true});}catch(e){try{window.localStorage=LS;}catch(e2){}}
  try{Object.defineProperty(window,'sessionStorage',{value:SS,configurable:true});}catch(e){try{window.sessionStorage=SS;}catch(e2){}}
  var KEY='__expense_ls', hydrated=false, flushT=null;
  function flush(){ if(!hydrated||!window.myllmStorage) return; try{ window.myllmStorage.setItem(KEY, JSON.stringify(LS.__dump())); }catch(e){} }
  LS.__persist=function(){ if(!hydrated) return; if(flushT) clearTimeout(flushT); flushT=setTimeout(flush,400); };
  window.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden') flush(); });
  window.addEventListener('pagehide',flush);
  window.__expenseHydrate=new Promise(function(resolve){
    if(!window.myllmStorage){ hydrated=true; return resolve(); }
    window.myllmStorage.getItem(KEY).then(function(v){ if(v){try{LS.__load(JSON.parse(v));}catch(e){}} hydrated=true; resolve(); },
      function(){ hydrated=true; resolve(); });
  });

  // fetch() -> myllmFetch (the null origin makes external fetch CORS-dead).
  if(window.myllmFetch){
    var realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch=function(url,opts){
      url=String(url);
      if(!/^https?:/i.test(url)){ return realFetch?realFetch(url,opts):Promise.reject(new Error('offline')); }
      opts=opts||{};
      return window.myllmFetch(url,{method:opts.method||'GET',headers:opts.headers||{},body:(opts.body==null?null:String(opts.body))})
        .then(function(r){
          if(r&&r.error) throw new Error(r.error);
          var body=(r&&r.body!=null)?r.body:((r&&r.bodyBase64)?(window.atob?atob(r.bodyBase64):''):'');
          return { ok:!!(r&&r.ok), status:(r&&r.status)||0,
            headers:{get:function(h){return (r&&r.headers&&r.headers[String(h).toLowerCase()])||null;}},
            text:function(){return Promise.resolve(body);}, json:function(){return Promise.resolve(JSON.parse(body));} };
        });
    };
  }

  // moment polyfill — the app only uses .format('MMM D') and 'YYYY-MM-DD HH:mm:ss'.
  if(!window.moment){
    var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    window.moment=function(input){
      var d=(input instanceof Date)?input:new Date(input);
      if(isNaN(d.getTime())) d=new Date();
      function p2(n){return (n<10?'0':'')+n;}
      return { format:function(f){
        return String(f)
          .replace('YYYY', d.getFullYear())
          .replace('MMM', MON[d.getMonth()])
          .replace('MM', p2(d.getMonth()+1))
          .replace('DD', p2(d.getDate()))
          .replace('HH', p2(d.getHours()))
          .replace('mm', p2(d.getMinutes()))
          .replace('ss', p2(d.getSeconds()))
          .replace(/\bD\b/, d.getDate());
      }};
    };
  }

  // Sandbox-safe replacement for the blocked window.confirm — a promise the
  // refactored call sites await.
  window.uiConfirm=function(msg){
    return new Promise(function(resolve){
      var ov=document.createElement('div');
      ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;';
      var box=document.createElement('div');
      box.style.cssText='background:var(--card-bg,#fff);color:var(--text,#111);max-width:340px;width:100%;border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:-apple-system,system-ui,sans-serif;';
      box.innerHTML='<div style="font-size:15px;line-height:1.5;margin-bottom:18px;">'+String(msg).replace(/</g,'&lt;')+'</div>';
      var row=document.createElement('div'); row.style.cssText='display:flex;gap:10px;justify-content:flex-end;';
      function mk(t,p){var b=document.createElement('button');b.textContent=t;b.style.cssText='font:inherit;font-weight:700;font-size:15px;padding:9px 16px;border:0;border-radius:10px;cursor:pointer;'+(p?'background:var(--primary,#4f7cff);color:#fff;':'background:rgba(128,128,128,.18);color:inherit;');return b;}
      var c=mk('Cancel',false), k=mk('OK',true);
      function close(v){try{document.body.removeChild(ov);}catch(e){} resolve(v);}
      c.onclick=function(){close(false);}; k.onclick=function(){close(true);};
      row.appendChild(c); row.appendChild(k); box.appendChild(row); ov.appendChild(box);
      ov.addEventListener('click',function(e){ if(e.target===ov) close(false); });
      document.body.appendChild(ov);
    });
  };
})();
</script>
'''

# --- Settings panel: connect your OWN sheet + paste-in Apps Script. ---
def settings_block():
    script_html = (APPS_SCRIPT.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'))
    return ('''
                <div style="padding-top:16px;margin-top:16px;border-top:1px solid var(--border);">
                    <div class="form-label" style="margin-bottom:8px;">Shared Google Sheet</div>
                    <input type="text" id="webAppUrlInput" placeholder="Paste your Apps Script web-app URL (ends with /exec)">
                    <button class="btn btn-primary" id="saveWebAppBtn" style="margin-top:8px;">Connect sheet</button>
                    <details style="margin-top:12px;">
                        <summary style="cursor:pointer;font-size:.875rem;color:var(--primary);">How to set up your own shared sheet</summary>
                        <ol style="font-size:.8rem;color:var(--gray-600);line-height:1.6;padding-left:18px;margin-top:8px;">
                            <li>Create a new Google Sheet.</li>
                            <li>Extensions &rarr; Apps Script. Delete any code, paste the script below, Save.</li>
                            <li>Deploy &rarr; New deployment &rarr; Web app. Execute as: <b>Me</b>, Who has access: <b>Anyone</b>. Deploy &amp; authorise.</li>
                            <li>Copy the Web app URL (ends with <b>/exec</b>) and paste it above, then Connect.</li>
                            <li>Share that same URL with your household so every phone updates one sheet.</li>
                        </ol>
                        <button class="btn btn-secondary" id="copyScriptBtn" style="margin:6px 0;">Copy the Apps Script</button>
                        <pre id="appsScript">''' + script_html + '''</pre>
                    </details>
                </div>
''')

# --- Tail: hydrate -> set URL + fetch; URL save; copy script; add-expense action. ---
TAIL = r'''
<script>
/* === MyLLMos: wire the user-configured sheet URL + assistant action === */
(function(){
  function byId(id){ return document.getElementById(id); }
  (window.__expenseHydrate||Promise.resolve()).then(function(){
    try{ WEBAPP_URL = storage.get('webAppUrl','') || ''; }catch(e){}
    var i=byId('webAppUrlInput'); if(i) i.value=WEBAPP_URL;
    if(WEBAPP_URL && typeof fetchExpensesFromWebApp==='function') fetchExpensesFromWebApp().catch(function(){});
  });
  document.addEventListener('click', function(ev){
    var t=ev.target.closest ? ev.target.closest('#saveWebAppBtn,#copyScriptBtn') : null; if(!t) return;
    if(t.id==='saveWebAppBtn'){
      var v=((byId('webAppUrlInput')||{}).value||'').trim();
      try{ storage.set('webAppUrl', v); }catch(e){}
      WEBAPP_URL=v;
      if(typeof showToast==='function') showToast(v?'Sheet connected':'URL cleared', v?'success':'info');
      if(v && typeof fetchExpensesFromWebApp==='function') fetchExpensesFromWebApp().catch(function(){});
    } else if(t.id==='copyScriptBtn'){
      var s=(byId('appsScript')||{}).textContent||'';
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(s); }
      if(typeof showToast==='function') showToast('Apps Script copied', 'success');
    }
  });
  // Assistant action (#2): "add £12 lunch to expenses" -> fill the form + add.
  if(window.myllmIntent && myllmIntent.receive){
    myllmIntent.receive(function(intent){
      if(!intent || intent.action!=='add-expense' || !intent.data) return;
      var d=intent.data;
      try{
        var amt=byId('amount'); if(amt) amt.value=String(d.amount==null?'':d.amount).replace(/[^0-9.]/g,'');
        var desc=byId('description'); if(desc) desc.value=d.description||d.note||d.item||'';
        if(d.category){ var cat=byId('category'); if(cat){ for(var n=0;n<cat.options.length;n++){
          var o=cat.options[n]; if(o.value.toLowerCase()===String(d.category).toLowerCase()||o.text.toLowerCase()===String(d.category).toLowerCase()){ cat.selectedIndex=n; break; } } } }
        if(typeof addExpense==='function') addExpense();
      }catch(e){}
    });
  }
})();
</script>
'''

def main():
    if not os.path.exists(RAW):
        sys.exit('Missing %s — copy "Expense tracker.html" there first.' % RAW)
    html = open(RAW, encoding='utf-8').read()
    subs = 0
    def sub1(pat, repl, s, flags=0):
        nonlocal subs
        s2, n = re.subn(pat, repl, s, count=1, flags=flags)
        if n != 1: sys.exit('PATTERN NOT FOUND: %s' % pat[:70])
        subs += 1
        return s2

    # 1. Strip the hardcoded private endpoint -> user-configured (set in tail).
    html = sub1(r"const\s+WEBAPP_URL\s*=\s*'[^']*';",
                "let WEBAPP_URL = '';  /* MyLLMos: set from the user's own sheet (Settings) */", html)
    # 2. Drop the moment.js CDN (polyfilled in the compat layer).
    html = sub1(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/moment\.js[^"]*"></script>', '', html)
    # 3. Sandbox-safe confirms (refactor the 3 call sites + make 2 fns async).
    html = sub1(r'function confirmDeleteExpense\(index\) \{', 'async function confirmDeleteExpense(index) {', html)
    html = sub1(r'if \(confirm\(confirmMsg\)\) \{', 'if (await uiConfirm(confirmMsg)) {', html)
    html = sub1(r"if \(!confirm\('Reset all expenses for this month\? This clears the Google Sheet\.'\)\) return;",
                "if (!(await uiConfirm('Reset all expenses for this month? This clears the Google Sheet.'))) return;", html)
    html = sub1(r"\$\('clearDataBtn'\)\.addEventListener\('click', \(\) => \{",
                "$('clearDataBtn').addEventListener('click', async () => {", html)
    html = sub1(r"if \(confirm\('Clear all saved suggestions\?'\)\) \{", "if (await uiConfirm('Clear all saved suggestions?')) {", html)
    # 3b. Guard the sheet calls when no URL is configured yet — otherwise the
    #     load-time fetch hits an empty/relative URL, gets HTML back, and
    #     JSON.parse throws "unexpected token <" (fires in the gallery preview
    #     and on every launch before setup).
    html = sub1(r'async function fetchExpensesFromWebApp\(\) \{',
                "async function fetchExpensesFromWebApp() {\n            if (!WEBAPP_URL) { try { var _l = storage.get('expenses', []); if (Array.isArray(_l)) expenses = _l; } catch(e){} if (typeof updateSummary==='function') updateSummary(); if (typeof renderExpensesList==='function') renderExpensesList(); return; }", html)
    html = sub1(r'async function syncExpenseToWebApp\(expense\) \{',
                "async function syncExpenseToWebApp(expense) {\n            if (!WEBAPP_URL) { if (typeof showToast==='function') showToast('Add your Google Sheet in Settings first', 'error'); return false; }", html)
    # 4. Inject the connect-your-sheet panel before "Data Management".
    html = sub1(r'(<div style="padding-top: 16px; margin-top: 16px; border-top: 1px solid var\(--border\);">\s*<div class="form-label" style="margin-bottom: 8px;">Data Management</div>)',
                settings_block() + r'\1', html)
    # 5. Head: design/iPad CSS + intent meta + actions manifest.
    actions = ('<meta name="myllm:intents" content="add-expense">\n'
               '<script type="application/myllm-actions">'
               + json.dumps([{ "name":"add-expense",
                   "description":"Add an expense to the shared household expense tracker",
                   "parameters":{"amount":"the amount as a number, e.g. 12.50",
                                 "description":"what it was for, e.g. lunch",
                                 "category":"optional category name"}}], ensure_ascii=True).replace('</','<\\/')
               + '</script>\n')
    html = sub1(r'</head>', STYLE + actions + '</head>', html)
    # 6. Compat layer right after <body>; wiring tail before </body>.
    html = sub1(r'(<body[^>]*>)', r'\1' + HEAD, html)
    html = sub1(r'</body>', TAIL + '</body>', html)

    open(OUT, 'w', encoding='utf-8').write(html)
    wrapper = {"name":"Expense Tracker", "html":html, "kind":"html",
               "iconSymbol":"creditcard.fill", "iconColor":"green"}
    json.dump(wrapper, open(WRAP,'w',encoding='utf-8'), ensure_ascii=False)

    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    entry = {
        "id":"expense-tracker", "name":"Expense Tracker", "emoji":"\U0001F4B7",
        "tagline":"Shared household spending, synced",
        "description":"A shared expense tracker for a household sharing one card — everyone's phone updates the same Google Sheet, so the running total is always in sync. Categories, per-person summaries, recurring detection, and a private setup using your OWN free Google Sheet (paste-in Apps Script included). You can also just tell MyLLM “add £12 lunch to expenses”.",
        "tags":["productivity","expenses","household","shared","google sheets"],
        "iconSymbol":"creditcard.fill", "iconColor":"green",
        "version":VERSION, "featured":True, "requiresAI":False,
        "banner":RAWBASE+"/apps/expense-tracker.jpg",
        "html":RAWBASE+"/apps-src/expense-tracker.html?v=%d" % VERSION,
        "json":RAWBASE+"/apps-src/expense-tracker.myllmapp",
        "sizeKB":max(1, round(len(html.encode('utf-8'))/1024)), "category":"Productivity",
    }
    apps=manifest["apps"]; by={a["id"]:i for i,a in enumerate(apps)}
    if "expense-tracker" in by: apps[by["expense-tracker"]]=entry
    else: apps.append(entry)
    json.dump(manifest, open(MANIFEST,'w',encoding='utf-8'), ensure_ascii=False, indent=2)
    print('OK  %d substitutions | expense-tracker.html %d KB | manifest %d apps'
          % (subs, len(html.encode('utf-8'))//1024, len(apps)))

if __name__ == '__main__':
    main()
