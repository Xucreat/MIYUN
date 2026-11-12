const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=process.cwd();
const CHROME='C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
let h=fs.readFileSync('system.html','utf8');
h=h.replace('</body>',`<script>
setTimeout(function(){
  var log=[];
  var tabs=[].slice.call(document.querySelectorAll('[data-tab]'));
  log.push('tabs='+tabs.length);
  var t=document.querySelector('[data-tab=audit]');
  log.push('tabFound='+!!t);
  if(t){ t.click(); }
  setTimeout(function(){
    var tb=document.getElementById('auditBody');
    log.push('tbFound='+!!tb);
    if(tb) log.push('rows='+tb.children.length+'|len='+tb.innerHTML.length);
    var pane=document.querySelector('[data-panel=audit]');
    log.push('pane='+(pane?pane.style.display:'NF'));
    log.push('ops='+document.querySelectorAll('.op').length);
    document.body.setAttribute('data-dbg',log.join(' ; '));
  },900);
},1500);
</script></body>`);
fs.writeFileSync('.probe/dbg.html',h);
const dom=execFileSync(CHROME,['--headless','--disable-gpu','--allow-file-access-from-files','--window-size=1680,950','--virtual-time-budget=7000','--dump-dom','file:///'+path.join(root,'.probe/dbg.html').replace(/\\/g,'/')],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']});
const m=dom.match(/data-dbg="([^"]*)"/);
console.log(m?m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').split(' ; ').join('\n'):'NO DBG');
