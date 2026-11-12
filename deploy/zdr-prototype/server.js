/**
 * 密云区重点风险人员台账管理与风险预警系统 — 原型静态服务
 * 零依赖，Node.js 原生 http/fs。绑定 0.0.0.0 供内网访问。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 80);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'site');
const LOG_DIR = path.join(__dirname, 'logs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localStamp() {
  // 北京时间 +08:00（等保审计需本地时间可比对）
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().replace('Z', '+08:00');
}

function logAccess(ip, method, url, status) {
  const line = `${localStamp()}\t${ip}\t${method}\t${url}\t${status}\n`;
  try {
    fs.appendFileSync(path.join(LOG_DIR, `access-${today()}.log`), line, 'utf8');
  } catch (e) {
    /* 日志失败不影响服务 */
  }
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  }, headers || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const clientIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    logAccess(clientIp, req.method, req.url, 400);
    return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    logAccess(clientIp, req.method, urlPath, 405);
    return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  // 防路径穿越
  const target = path.resolve(ROOT, '.' + urlPath);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    logAccess(clientIp, req.method, urlPath, 403);
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  fs.stat(target, (err, stat) => {
    if (err) {
      logAccess(clientIp, req.method, urlPath, 404);
      return send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    let filePath = target;
    if (stat.isDirectory()) {
      // 目录只接受 index.html，不提供目录浏览
      filePath = path.join(target, 'index.html');
      if (!fs.existsSync(filePath)) {
        logAccess(clientIp, req.method, urlPath, 404);
        return send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    logAccess(clientIp, req.method, urlPath, 200);
    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      // 原型迭代期统一禁用缓存，避免改了 css/js 但浏览器仍用旧版（重部署后必须立即可见）
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (err) => {
  console.error(`[FATAL] ${err.code}: ${err.message}`);
  process.exit(1);
});

/* ============================================================
   源码自动同步：改 docs/prototype-v2 即自动落 site/，无需手动部署
   - 只同步白名单文件（顶层 *.html/*.ico + assets/ 下静态资源）
   - shots/、tools/、*.md 永久排除，不外发
   - 正式服务器部署时设环境变量 WATCH=0 关闭
   ============================================================ */
const SOURCE = path.resolve(__dirname, '..', '..', 'docs', 'prototype-v2');
const WATCH_ENABLED = process.env.WATCH !== '0';

function isSyncable(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (p === 'assets') return false;
  if (p.startsWith('assets/')) {
    return /\.(js|css|png|jpe?g|svg|ico|woff2?|ttf|json)$/i.test(p);
  }
  if (p.includes('/')) return false; // 顶层以外的目录（shots/tools）一律不同步
  return /\.(html|ico)$/i.test(p);
}

function syncFile(rel, retry) {
  const src = path.join(SOURCE, rel);
  const dst = path.join(ROOT, rel);
  try {
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`[SYNC] ${rel}`);
    } else if (fs.existsSync(dst)) {
      fs.unlinkSync(dst);
      console.log(`[DEL ] ${rel}`);
    }
  } catch (e) {
    // 编辑器保存瞬间的占用/原子替换，短暂重试
    if (retry > 0) return setTimeout(() => syncFile(rel, retry - 1), 150);
    console.error(`[SYNC-FAIL] ${rel}: ${e.message}`);
  }
}

function syncAll() {
  let count = 0;
  for (const name of fs.readdirSync(SOURCE)) {
    const abs = path.join(SOURCE, name);
    if (fs.statSync(abs).isDirectory()) {
      if (name !== 'assets') continue;
      for (const f of fs.readdirSync(abs)) {
        const rel = `assets/${f}`;
        if (isSyncable(rel)) { syncFile(rel, 1); count++; }
      }
    } else if (isSyncable(name)) {
      syncFile(name, 1);
      count++;
    }
  }
  return count;
}

function startWatch() {
  let timer = null;
  const pending = new Set();
  fs.watch(SOURCE, { recursive: true }, (ev, filename) => {
    if (!filename) return;
    const rel = String(filename).replace(/\\/g, '/');
    if (!isSyncable(rel)) return;
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const r of pending) syncFile(r, 2);
      pending.clear();
    }, 120);
  });
  console.log(`[WATCH] 已监听源码目录，改动自动同步：${SOURCE}`);
}

server.listen(PORT, HOST, () => {
  console.log(`[OK] 原型服务已启动 http://${HOST}:${PORT}  root=${ROOT}`);
  if (WATCH_ENABLED && fs.existsSync(SOURCE)) {
    console.log(`[SYNC] 启动全量同步 ${syncAll()} 个文件`);
    startWatch();
  } else {
    console.log('[WATCH] 未启用（WATCH=0 或源码目录不存在），仅服务 site/');
  }
});
