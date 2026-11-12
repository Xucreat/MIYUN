const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=process.cwd();
const CHROME='C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
let h=fs.readFileSync('system.html','utf8');
const hook=`<script>window.__err=[];window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+(e.filename||'').split('/').pop()+':'+e.lineno);},true);window.addEventListener('unhandledrejection',function(e){window.__err.push('REJ:'+e.reason);});</script>`;
h=h.replace(/<head[^>]*>/i,m=>m+hook);
h=h.replace('</body>',`<script>
setTimeout(function(){
  var log=[];
  log.push('errs='+(window.__err||[]).join(' || '));
  log.push('DATA='+typeof window.DATA+' STORE='+typeof window.STORE+' UI='+typeof window.UI);
  log.push('SYS='+(window.DATA?Object.keys(window.DATA).filter(function(k){return k.indexOf('SYS')===0;}).join(','):'n/a'));
  document.body.setAttribute('data-dbg',log.join(' ; '));
},2000);
</script></body>`);
fs.writeFileSync('.probe/dbg3.html',h);
const dom=execFileSync(CHROME,['--headless','--disable-gpu','--allow-file-access-from-files','--window-size=1680,950','--virtual-time-budget=7000','--dump-dom','file:///'+path.join(root,'.probe/dbg3.html').replace(/\\/g,'/')],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']});
const m=dom.match(/data-dbg="([^"]*)"/);
console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').split(' ; ').join('\n'):'NO DBG');
