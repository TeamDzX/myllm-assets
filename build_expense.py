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
/* MyLLMos design refresh: the gallery's shared header, theme tokens with dark
   fallbacks, safe areas on the sides, and 40px header buttons. */
:root{ --primary:var(--myllm-accent,#007AFF); color-scheme:light dark; --h:152; }
@media (prefers-color-scheme:dark){ :root{
  --white:#1c1c1e; --card-bg:#1c1c1e; --body-bg:#000; --border:#2c2c2e;
  --gray-50:#1f1f22; --gray-100:#2c2c2e; --gray-200:#3a3a3c; --gray-300:#48484a;
  --gray-400:#8e8e93; --gray-500:#98989f; --gray-600:#aeaeb2; --gray-700:#c7c7cc; --gray-800:#e5e5ea; --gray-900:#f2f2f7; } }
body{ font-family:var(--myllm-font,-apple-system,BlinkMacSystemFont,sans-serif) !important; }
.app{ padding-left:env(safe-area-inset-left); padding-right:env(safe-area-inset-right); }
.header{ background:var(--body-bg) !important; border-bottom:0 !important; padding:calc(14px + var(--safe-area-top)) 16px 6px !important; }
.header-title{ gap:12px !important; min-width:0; }
.header-icon{ width:44px !important; height:44px !important; border-radius:13px !important; font-size:19px; flex-shrink:0;
  background:linear-gradient(145deg,hsl(var(--h) 62% 44%),hsl(calc(var(--h) + 40) 58% 26%)) !important; }
.header h1{ font-size:22px !important; font-weight:800 !important; letter-spacing:-.01em; line-height:1.15; }
.header .sub{ font-size:13px; color:var(--gray-500); margin-top:1px; }
.header-btn{ width:40px !important; height:40px !important; border-radius:12px !important; border:1px solid var(--border) !important;
  background:var(--card-bg) !important; color:var(--gray-700) !important; }
/* Icons: the source used Font Awesome from a CDN, which the self-contained
   build had to drop — so every icon rendered blank. Each fa-* class the app
   uses is drawn here as an inline SVG mask, coloured by currentColor. */
[class^="fa-"],[class*=" fa-"]{display:inline-block;width:1em;height:1em;vertical-align:-.125em;flex:0 0 auto;
  background:currentColor;-webkit-mask:var(--fa) center/contain no-repeat;mask:var(--fa) center/contain no-repeat}
.fa-credit-card{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Crect%20x=%222.5%22%20y=%225%22%20width=%2219%22%20height=%2214%22%20rx=%222.5%22/%3E%3Cpath%20d=%22M2.5%2010h19M6.5%2015h4%22/%3E%3C/svg%3E")}
.fa-arrows-rotate{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M20%2011a8%208%200%200%200-14.3-4.9L4%208M4%204v4h4M4%2013a8%208%200%200%200%2014.3%204.9L20%2016M20%2020v-4h-4%22/%3E%3C/svg%3E")}
.fa-gear{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Ccircle%20cx=%2212%22%20cy=%2212%22%20r=%223.2%22/%3E%3Cpath%20d=%22M12%202.8v2.4M12%2018.8v2.4M4.2%207.5l2.1%201.2M17.7%2015.3l2.1%201.2M4.2%2016.5l2.1-1.2M17.7%208.7l2.1-1.2%22/%3E%3Ccircle%20cx=%2212%22%20cy=%2212%22%20r=%226.6%22/%3E%3C/svg%3E")}
.fa-plus{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M12%205v14M5%2012h14%22/%3E%3C/svg%3E")}
.fa-sterling-sign{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M16.5%206.5A4%204%200%200%200%209%208.2V18M6%2013h7M6%2018h11%22/%3E%3C/svg%3E")}
.fa-pencil{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M4%2020l1-4.5L15.8%204.7a2%202%200%200%201%202.8%200l.7.7a2%202%200%200%201%200%202.8L8.5%2019z%22/%3E%3C/svg%3E")}
.fa-clock-rotate-left{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M3.5%2012a8.5%208.5%200%201%200%202.5-6L3.5%208.5M3.5%204v4.5H8M12%207.5V12l3%202%22/%3E%3C/svg%3E")}
.fa-folder{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M3%207.5A2.5%202.5%200%200%201%205.5%205h4l2%202.5h7A2.5%202.5%200%200%201%2021%2010v7.5a2.5%202.5%200%200%201-2.5%202.5h-13A2.5%202.5%200%200%201%203%2017.5z%22/%3E%3C/svg%3E")}
.fa-user{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Ccircle%20cx=%2212%22%20cy=%228%22%20r=%224%22/%3E%3Cpath%20d=%22M4.5%2020.5c.8-3.8%203.9-5.8%207.5-5.8s6.7%202%207.5%205.8%22/%3E%3C/svg%3E")}
.fa-chart-column{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M4%2020h16M7%2016.5v-5M12%2016.5V7M17%2016.5v-8%22/%3E%3C/svg%3E")}
.fa-google{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22%23000%22%3E%3Cpath%20d=%22M20.5%2012.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1%204.1%200%200%201-1.8%202.7v2.2h2.9c1.7-1.6%202.6-3.9%202.6-6.5z%22/%3E%3Cpath%20d=%22M12%2021c2.4%200%204.5-.8%205.9-2.2L15%2016.5a5.4%205.4%200%200%201-8.1-2.8H4v2.3A9%209%200%200%200%2012%2021zM6.9%2013.7a5.4%205.4%200%200%201%200-3.4V8H4a9%209%200%200%200%200%208.1zM12%206.6c1.3%200%202.5.5%203.4%201.3l2.6-2.6A9%209%200%200%200%204%208l2.9%202.3A5.4%205.4%200%200%201%2012%206.6z%22/%3E%3C/svg%3E")}
.fa-trash{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M4.5%207h15M9.5%207V4.5h5V7M6.5%207l1%2013h9l1-13%22/%3E%3C/svg%3E")}
.fa-trash-can{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M4.5%207h15M9.5%207V4.5h5V7M6.5%207l1%2013h9l1-13M10%2011v5M14%2011v5%22/%3E%3C/svg%3E")}
.fa-repeat{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M17%203.5L20.5%207%2017%2010.5M3.5%2011V9.5A2.5%202.5%200%200%201%206%207h14.5M7%2020.5L3.5%2017%207%2013.5M20.5%2013v1.5A2.5%202.5%200%200%201%2018%2017H3.5%22/%3E%3C/svg%3E")}
.fa-check{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M5%2012.6l4.6%204.6L19.2%207.4%22/%3E%3C/svg%3E")}
.fa-xmark{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M6%206l12%2012M18%206L6%2018%22/%3E%3C/svg%3E")}
.fa-circle-info{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Ccircle%20cx=%2212%22%20cy=%2212%22%20r=%229%22/%3E%3Cpath%20d=%22M12%2011v5.5M12%207.6v.2%22/%3E%3C/svg%3E")}
.fa-arrow-up-right-from-square{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M13.5%204.5h6v6M19.5%204.5L11%2013M17%2014v4.5a1.5%201.5%200%200%201-1.5%201.5h-10A1.5%201.5%200%200%201%204%2018.5v-10A1.5%201.5%200%200%201%205.5%207H10%22/%3E%3C/svg%3E")}
.fa-rotate-left{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22M4%2012a8%208%200%201%200%202.4-5.7L4%208.5M4%204v4.5h4.5%22/%3E%3C/svg%3E")}
.fa-ban{--fa:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23000%22%20stroke-width=%222.1%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Ccircle%20cx=%2212%22%20cy=%2212%22%20r=%228.5%22/%3E%3Cpath%20d=%22M6%206l12%2012%22/%3E%3C/svg%3E")}
@media (max-width:360px){ .header h1{ font-size:18px !important; white-space:nowrap; } .header .sub{ display:none; } .header-actions{ gap:6px !important; } }
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
    # 1b. Self-contained (2026-07-24): no Google Fonts (Inter falls back to the
    #     system stack) and no Font Awesome (no icons were ever used).
    html = sub1(r'    <link rel="preconnect" href="https://fonts\.googleapis\.com">\n'
                r'    <link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n'
                r'    <link href="https://fonts\.googleapis\.com/css2\?family=Inter[^"]*" rel="stylesheet">\n'
                r'    <link rel="stylesheet" href="https://cdnjs\.cloudflare\.com/ajax/libs/font-awesome/[^"]*">\n',
                '    <!-- Self-contained: dropped Google Fonts (Inter) — falls back to the system\n         font below — and Font Awesome (no icons were used). No remote code. -->\n', html)
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
    # 4b. Header: the gallery name and a subtitle (design refresh, 2026-09-22).
    html = sub1(r'<h1>Credit Card Tracker</h1>',
                '<div><h1>Expense Tracker</h1><div class="sub">Shared household spending, synced</div></div>', html)
    html = sub1(r'<title>Credit Card Tracker</title>', '<title>Expense Tracker</title>', html)
    html = sub1(r'<meta name="viewport" content="width=device-width, initial-scale=1\.0, maximum-scale=1\.0, user-scalable=no">',
                '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">', html)
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
