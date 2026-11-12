const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=process.cwd();
const CHROME='C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
let h=fs.readFileSync('system.html','utf8');
h=h.replace('</body>',`<script>
setTimeout(function(){
  var log=[];
  log.push('sysNavBtn='+document.querySelectorAll('#sysNav button[data-tab]').length);
  log.push('has__sysGo='+typeof window.__sysGo);
  log.push('panels='+[].slice.call(document.querySelectorAll('[data-panel]')).map(function(p){return p.dataset.panel+':'+(p.style.display||'auto');}).join(','));
  if(window.__sysGo) window.__sysGo('audit');
  setTimeout(function(){
    log.push('afterGo='+[].slice.call(document.querySelectorAll('[data-panel]')).map(function(p){return p.dataset.panel+':'+(p.style.display||'auto');}).join(','));
    var tb=document.getElementById('auditBody');
    log.push('rows='+(tb?tb.children.length:'noTB'));
    log.push('ops='+document.querySelectorAll('.op').length);
    var op=document.querySelector('.log-tb .op');
    if(op) log.push('opH='+op.offsetHeight+'/sh'+op.scrollHeight+'|cw='+Math.round(op.parentNode.getBoundingClientRect().width)+'|txt='+op.textContent.trim());
    document.body.setAttribute('data-dbg',log.join(' ; '));
  },900);
},1500);
</script></body>`);
fs.writeFileSync('.probe/dbg2.html',h);
const dom=execFileSync(CHROME,['--headless','--disable-gpu','--allow-file-access-from-files','--window-size=1680,950','--virtual-time-budget=7000','--dump-dom','file:///'+path.join(root,'.probe/dbg2.html').replace(/\\/g,'/')],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']});
const m=dom.match(/data-dbg="([^"]*)"/);
console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').split(' ; ').join('\n'):'NO DBG');
