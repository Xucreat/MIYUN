/* ============================================================
   Router · SPA 化内容区切换（原型演示版）
   侧栏 / 顶栏只渲染一次；点击导航或页内链接时 fetch 目标页 HTML，
   仅替换 .content（含页面私有 <style>、body 元数据、页面脚本），
   侧栏原地更新高亮，URL 用 pushState 同步，前进 / 后退可用。
   - 共享脚本（data/store/ui/shell/geo/router）只加载一次不重复执行
   - 页面脚本按原顺序串行重建执行，onload 链保证先后依赖
   - 任何一步失败自动回退整页跳转，永不白屏
   - window.onPageTeardown(fn) 供页面登记 document/window 级监听清理
   ============================================================ */
window.ROUTER = (function () {
  /* 只加载一次的共享脚本（按页面引用路径原样记录） */
  const SHARED = new Set([
    'assets/miyun-geo.js', 'assets/data.js', 'assets/store.js',
    'assets/fileparse.js', 'assets/ui.js', 'assets/shell.js', 'assets/router.js'
  ]);
  /* 不接管的外开 / 无壳页面：保持原生行为 */
  const SKIP_FILE = new Set(['bigscreen.html', 'login.html', 'index.html']);

  const teardowns = [];
  window.onPageTeardown = function (fn) { teardowns.push(fn); };
  let navigating = false;

  /* 判断一个 <a> 是否应被路由接管；接管则返回目标 URL 对象 */
  function routable(el) {
    if (!el || el.tagName !== 'A') return null;
    if (location.protocol === 'file:') return null;   /* 离线包双击直开：fetch 被浏览器禁止，保持原生整页跳转 */
    const href = el.getAttribute('href') || '';
    if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) return null;
    if (el.dataset.ext) return null;                    /* 大屏等外开入口保持新窗口 */
    let u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    if (u.origin !== location.origin) return null;
    if (!/\.html$/.test(u.pathname)) return null;
    if (SKIP_FILE.has(u.pathname.split('/').pop())) return null;
    return u;
  }

  /* 页面脚本按原始顺序串行重建：src 等 onload、内联同步执行。
     内联脚本统一包一层 IIFE：防止二次进入同一页时顶层 const/let/function
     在全局词法环境重复声明抛 SyntaxError（全站已验证无跨脚本全局符号
     依赖、无 HTML 属性内联事件，包裹无副作用）。 */
  function loadScripts(list) {
    return list.reduce((p, item) => p.then(() => new Promise(res => {
      const el = document.createElement('script');
      if (item.src) {
        el.src = item.src;
        el.onload = () => res();
        el.onerror = () => res();
      } else {
        el.textContent = '(function(){\n' + item.code + '\n})();';
      }
      document.body.appendChild(el);
      if (!item.src) res();
    })), Promise.resolve());
  }

  async function go(url, push) {
    if (navigating) return;
    navigating = true;
    const target = url.pathname + url.search + url.hash;
    try {
      const res = await fetch(url.pathname + url.search);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const newContent = doc.querySelector('.content');
      const cur = document.querySelector('.content');
      if (!newContent || !cur) throw new Error('no .content');

      /* 1) 页面级清理：登记的定时器 / document 级监听 + 搜索弹层 + store 订阅 */
      while (teardowns.length) { try { teardowns.pop()(); } catch (e) { /* 忽略单个清理失败 */ } }
      if (window.__searchClose) { try { window.__searchClose(); } catch (e) {} }
      if (window.STORE && STORE.clearSubs) { try { STORE.clearSubs(); } catch (e) {} }

      /* 2) 页面私有 <style> 整体替换 */
      document.querySelectorAll('style[data-router]').forEach(n => n.remove());
      doc.querySelectorAll('head style').forEach(s => {
        const el = document.createElement('style');
        el.setAttribute('data-router', '');
        el.textContent = s.textContent;
        document.head.appendChild(el);
      });

      /* 3) body 元数据 / 类名 / 内容区 / 标题 */
      Array.from(document.body.attributes)
        .filter(a => /^data-/.test(a.name))
        .forEach(a => document.body.removeAttribute(a.name));
      Array.from(doc.body.attributes)
        .filter(a => /^data-/.test(a.name))
        .forEach(a => document.body.setAttribute(a.name, a.value));
      document.body.className = doc.body.className;
      cur.innerHTML = newContent.innerHTML;
      document.title = doc.title;

      /* 4) 地址栏先行：页面脚本会读 location.search（如 persons?tab=query） */
      if (push) history.pushState({ r: 1 }, '', target);
      else history.replaceState({ r: 1 }, '', target);

      /* 5) 权限门 + 外壳刷新（先于页面脚本，与整页加载时序一致） */
      if (window.PAGE_GATE) window.PAGE_GATE();
      if (window.SHELL_REFRESH) window.SHELL_REFRESH();
      if (window.SYNC_METRICS) window.SYNC_METRICS();
      if (window.applyPermGates) window.applyPermGates();

      /* 6) 目标页脚本按原顺序重建执行（共享脚本跳过） */
      const list = [];
      doc.querySelectorAll('script').forEach(old => {
        const src = old.getAttribute('src');
        if (src) {
          if (SHARED.has(src.replace(/^\.\//, ''))) return;
          list.push({ src: src });
        } else if (old.textContent.trim()) {
          list.push({ code: old.textContent });
        }
      });
      await loadScripts(list);

      window.scrollTo(0, 0);
    } catch (e) {
      /* 任何异常兜底回退整页加载 */
      location.href = target;
      return;
    } finally {
      navigating = false;
    }
  }

  /* 全局委托拦截（capture，覆盖动态渲染与 target="_blank" 的内链） */
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    if (!document.body.dataset.page) return;            /* 总览 / 登录页不接管 */
    const u = routable(a);
    if (!u) return;
    e.preventDefault();
    go(u, true);
  }, true);

  /* 浏览器前进 / 后退 */
  window.addEventListener('popstate', () => {
    if (document.body.dataset.page) go(new URL(location.href), false);
  });

  /* 供 shell / 页面脚本程序化跳转 */
  return { go: function (u) { go(new URL(u, location.href), true); } };
})();
