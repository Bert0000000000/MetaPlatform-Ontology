// MetaPlatform 顶栏 plugin — client half
//
// 在 dsh-web 页面顶部 prepend 一个 44px 高的顶栏, 含 4 个菜单:
//   - Ontology Copilot    → 触发 dsh chat panel (CustomEvent 'dsh:open-chat')
//   - 云市场              → http://localhost:8080/marketplace   (SPA internal nav, same tab)
//   - 应用中心            → http://localhost:8080/marketplace   (SPA internal nav, same tab)
//   - Ontology 本体平台   → http://localhost:8080/admin         (SPA internal nav, same tab)
//
// 用 vanilla DOM (不引入 React): dsh 用 zustand/cordis 但顶栏只是固定位 div + 4 个 <a>,
// 直接 DOM 注入最简单、最稳。脚本在 <head> 以 defer 加载, document.body 一存在就 mount。
//
// 注意: dsh 自己也是 SPA (单一 <div id="root">), 我们 prepend 一个 sibling div,
// 不冲突 React 的 hydration。

(function () {
  'use strict'

  var TOPBAR_ID = 'mp-v6-topbar'
  var STYLE_ID = 'mp-v6-topbar-style'

  var STYLES =
    '#' +
    TOPBAR_ID +
    ' {' +
    'position: fixed;' +
    'top: 0; left: 0; right: 0;' +
    'height: 44px;' +
    'background: rgba(20, 22, 28, 0.94);' +
    'backdrop-filter: blur(10px);' +
    '-webkit-backdrop-filter: blur(10px);' +
    'border-bottom: 1px solid rgba(255, 255, 255, 0.08);' +
    'display: flex;' +
    'align-items: center;' +
    'gap: 4px;' +
    'padding: 0 12px 0 56px;' + /* leave space for sidebar toggle */
    'z-index: 2147483600;' + /* below OS overlays, above everything dsh */
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;' +
    'box-sizing: border-box;' +
    '}' +
    '#' +
    TOPBAR_ID +
    ' a {' +
    'color: rgba(235, 238, 245, 0.85);' +
    'text-decoration: none;' +
    'padding: 6px 12px;' +
    'border-radius: 6px;' +
    'font-size: 13px;' +
    'font-weight: 500;' +
    'transition: background 120ms ease, color 120ms ease, transform 120ms ease;' +
    'display: inline-flex;' +
    'align-items: center;' +
    'gap: 4px;' +
    'cursor: pointer;' +
    'position: relative;' + /* required for ::after underline */
    '}' +
    '#' +
    TOPBAR_ID +
    ' a:hover {' +
    'background: rgba(255, 255, 255, 0.08);' +
    'color: #ffffff;' +
    '}' +
    '#' +
    TOPBAR_ID +
    ' a:focus-visible {' +
    'outline: 2px solid rgba(120, 165, 255, 0.6);' +
    'outline-offset: 2px;' +
    '}' +
    /* Tab-switching feedback: the current page's menu item gets a coloured
       background + underline so the user knows where they are. One item only. */
    '#' +
    TOPBAR_ID +
    ' a[data-active="1"] {' +
    'background: rgba(120, 165, 255, 0.18);' +
    'color: #ffffff;' +
    '}' +
    '#' +
    TOPBAR_ID +
    ' a[data-active="1"]::after {' +
    'content: "";' +
    'position: absolute;' +
    'left: 12px; right: 12px; bottom: 4px;' +
    'height: 2px;' +
    'background: rgba(120, 165, 255, 0.9);' +
    'border-radius: 1px;' +
    'transition: transform 200ms ease;' +
    'transform-origin: left center;' +
    '}' +
    '@media (prefers-reduced-motion: reduce) {' +
    '#' +
    TOPBAR_ID +
    ' a { transition: none; }' +
    '}' +
    /* Push dsh UI down so the topbar doesn't overlap the hero / sidebar header. */
    'body[data-mp-v6-topbar-mounted="1"] #root { padding-top: 44px; box-sizing: border-box; height: 100vh; }' +
    'body[data-mp-v6-topbar-mounted="1"] #root > div { height: 100%; }'

  /**
   * ITEMS list — 4 menus, in fixed render order.
   * - kind: 'link'  → SPA-internal navigation (history.pushState / same-tab assign)
   * - kind: 'chat'  → dispatch CustomEvent('dsh:open-chat') so any host code can react,
   *                   plus best-effort click on dsh's known chat trigger selector(s).
   *
   * Per item, `matchPath` (optional) declares which location.pathname prefix
   * should mark this item as active. The plugin re-evaluates active state on
   * every popstate / pushState / popstate-equivalent, so SPA-internal route
   * changes inside dsh also update the topbar.
   */
  var ITEMS = [
    {
      id: 'mp-ai-assistant',
      label: 'Ontology Copilot',
      href: null,
      kind: 'chat',
      matchPath: '/',
    },
    {
      id: 'mp-marketplace',
      label: '云市场',
      href: 'http://localhost:8080/marketplace',
      kind: 'link',
      matchPath: '/marketplace',
    },
    {
      id: 'mp-app-center',
      label: '应用中心',
      href: 'http://localhost:8080/app-center',
      kind: 'link',
      matchPath: '/app-center',
    },
    {
      id: 'mp-platform-admin',
      label: 'Ontology 本体平台',
      href: 'http://localhost:8080/admin',
      kind: 'link',
      matchPath: '/admin',
    },
  ]

  /**
   * Tab-switching: render the 4 menu items as a "tab strip" attached to the
   * top of dsh's content area. At any time exactly one tab is active; the
   * other 3 are inactive. Clicking a tab opens a full-bleed iframe inside
   * dsh that loads the corresponding mp-* page.
   *
   * No "back" button: the tabs are always visible at the top. Clicking
   * another tab simply switches. To return to dsh's native view, the
   * user can close the active tab — that just hides the iframe and shows
   * dsh's #root. (Closing the tab does NOT navigate; it only toggles
   * whether mp is on top.)
   */
  function navigateAsTab(href) {
    try {
      var target = new URL(href, window.location.href)
      if (target.origin === window.location.origin) {
        var path = target.pathname + target.search + target.hash
        window.history.pushState({}, '', path)
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
        return
      }
    } catch (err) {
      try { window.location.assign(href); return } catch (e2) { /* ignore */ }
    }
    showMpTab(href)
  }

  /**
   * Show the MP tab strip + iframe for the given href. The strip is
   * inserted at the top of dsh's content area (under the topbar itself).
   * If the same tab is already open, just toggle its active class and bring
   * its iframe to front. The user clicks a tab to switch; the close X
   * on the active tab hides the whole strip and reveals dsh.
   */
  function showMpTab(href) {
    // Tear down any existing tab strip first.
    hideMpTab()

    var url
    try { url = new URL(href, window.location.href).toString() } catch (e) { url = href }

    // Tab strip + iframe container
    var strip = document.createElement('div')
    strip.id = 'mp-v6-tab-strip'
    strip.style.cssText =
      'position: fixed; left: 0; right: 0; top: 44px; height: 36px;' +
      'display: flex; align-items: stretch; gap: 0;' +
      'background: rgba(15, 17, 22, 0.96);' +
      'border-bottom: 1px solid rgba(255, 255, 255, 0.08);' +
      'z-index: 2147483598;' +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;'

    // Header label (fixed text on the left)
    var header = document.createElement('span')
    header.textContent = '📱 MetaPlatform'
    header.style.cssText =
      'display: flex; align-items: center; padding: 0 12px;' +
      'font-size: 12px; font-weight: 600;' +
      'color: rgba(255,255,255,0.55);' +
      'border-right: 1px solid rgba(255, 255, 255, 0.06);'
    strip.appendChild(header)

    // Container for tab pills (so they don't wrap the close button)
    var tabs = document.createElement('div')
    tabs.id = 'mp-v6-tab-tabs'
    tabs.style.cssText = 'display: flex; flex: 1 1 auto; min-width: 0; overflow-x: auto;'
    strip.appendChild(tabs)

    // The close button on the far right of the strip.
    var closeAll = document.createElement('button')
    closeAll.type = 'button'
    closeAll.setAttribute('aria-label', '关闭 MetaPlatform 标签 (返回 dsh)')
    closeAll.textContent = '×'
    closeAll.style.cssText =
      'background: transparent; color: rgba(235, 238, 245, 0.55); border: none;' +
      'border-left: 1px solid rgba(255, 255, 255, 0.06);' +
      'padding: 0 14px; font-size: 18px; cursor: pointer;'
    closeAll.addEventListener('click', hideMpTab)
    strip.appendChild(closeAll)

    document.body.appendChild(strip)

    // The full-bleed iframe below the strip (starts at 80px from the top).
    var iframe = document.createElement('iframe')
    iframe.id = 'mp-v6-tab-iframe'
    iframe.src = url
    iframe.allow = 'clipboard-write; clipboard-read'
    iframe.style.cssText =
      'position: fixed; left: 0; right: 0; top: 80px; bottom: 0;' +
      'width: 100%; height: calc(100vh - 80px); border: 0; background: #fff;' +
      'z-index: 2147483597;'
    document.body.appendChild(iframe)

    // Wire the topbar so the right item is marked active.
    setActiveByPath(new URL(href, window.location.href).pathname)
  }

  function hideMpTab() {
    var strip = document.getElementById('mp-v6-tab-strip')
    if (strip) strip.parentNode.removeChild(strip)
    var iframe = document.getElementById('mp-v6-tab-iframe')
    if (iframe) iframe.parentNode.removeChild(iframe)
    // Reset active state to whatever dsh's path actually is.
    setActiveByPath(window.location.pathname)
  }

  /**
   * Tab-switching feedback: mark exactly one menu item as active based on
   * the current location.pathname. Idempotent; safe to call after any
   * navigation event (initial mount, click handler, popstate from SPA router).
   */
  function setActiveByPath(pathname) {
    var items = document.querySelectorAll('#' + TOPBAR_ID + ' a[data-menu-id]')
    for (var i = 0; i < items.length; i++) {
      var el = items[i]
      var id = el.getAttribute('data-menu-id')
      var item = null
      for (var j = 0; j < ITEMS.length; j++) {
        if (ITEMS[j].id === id) { item = ITEMS[j]; break }
      }
      if (!item || !item.matchPath) {
        el.removeAttribute('data-active')
        continue
      }
      if (pathname === item.matchPath || pathname.indexOf(item.matchPath) === 0) {
        el.setAttribute('data-active', '1')
      } else {
        el.removeAttribute('data-active')
      }
    }
  }

  /**
   * Trigger the dsh chat panel for a 'chat' item.
   * - Dispatch CustomEvent('dsh:open-chat') so host code can react.
   * - Best-effort click on dsh's chat trigger(s) via known selectors.
   *   Failure to find one is non-fatal: the CustomEvent alone is the contract.
   */
  function openChat(item) {
    window.dispatchEvent(
      new CustomEvent('dsh:open-chat', {
        detail: { source: 'mp-v6-topbar', menuId: item.id, label: item.label },
      })
    )

    var candidates = [
      '[data-dsh-chat-trigger]',
      '[data-mp-v6-chat-trigger]',
      'button[aria-label*="chat" i]',
      'button[aria-label*="session" i][aria-label*="new" i]',
      'button[aria-label*="新对话" i]',
      'button[aria-label*="新会话" i]',
    ]
    for (var i = 0; i < candidates.length; i++) {
      var btn = document.querySelector(candidates[i])
      if (btn) {
        try { btn.click() } catch (e) { /* non-fatal */ }
        return true
      }
    }
    return false
  }

  function buildItem(item) {
    var a = document.createElement('a')
    // Always set href so right-click "open in new tab" / middle-click still works
    // for power users. The click handler below prevents default navigation in
    // the primary click path.
    a.href = item.href || '#'
    a.setAttribute('data-menu-id', item.id)
    a.setAttribute('data-mp-v6-menu', item.id)
    a.setAttribute('data-menu-kind', item.kind)
    a.textContent = item.label

    a.addEventListener('click', function (ev) {
      // Respect modifier keys: ctrl/cmd/shift/middle-click → let the browser
      // open in a new tab/window as the user requested.
      if (ev.defaultPrevented) return
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button === 1) return

      ev.preventDefault()

      if (item.kind === 'chat') {
        openChat(item)
      } else {
        navigateAsTab(item.href)
      }
      // NB: no trailing setActiveByPath here.
      //   - Same-origin: history.pushState is patched → triggers syncOnNav → setActiveByPath.
      //   - Cross-origin: showMpTab already calls setActiveByPath with the target path.
      // Re-calling with window.location.pathname (still '/') would wipe the cross-origin activation.
    })

    return a
  }

  function buildTopbar() {
    var topbar = document.createElement('nav')
    topbar.id = TOPBAR_ID
    topbar.setAttribute('aria-label', 'MetaPlatform 应用导航')
    topbar.setAttribute('data-mp-v6-plugin', 'topbar')

    var brand = document.createElement('span')
    brand.textContent = 'MetaPlatform'
    brand.style.cssText =
      'color: rgba(255,255,255,0.55);font-size:11px;font-weight:600;' +
      'letter-spacing:0.08em;margin-right:12px;text-transform:uppercase;'
    topbar.appendChild(brand)

    for (var i = 0; i < ITEMS.length; i++) {
      topbar.appendChild(buildItem(ITEMS[i]))
    }

    return topbar
  }

  function mount() {
    if (document.getElementById(TOPBAR_ID)) return
    if (!document.body) return

    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
    }

    var topbar = buildTopbar()
    document.body.insertBefore(topbar, document.body.firstChild)
    document.body.setAttribute('data-mp-v6-topbar-mounted', '1')

    // Initial active state (covers deep-link arrivals and dsh's own route
    // changes that don't go through our click handler).
    setActiveByPath(window.location.pathname)
  }

  if (document.body) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  }

  // Re-mount if dsh swaps the document (HMR full reload, etc.).
  var mo = new MutationObserver(function () {
    if (!document.getElementById(TOPBAR_ID) && document.body) mount()
  })
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true })
  }

  // Keep active state in sync with dsh's SPA router: every time the URL
  // changes (pushState / replaceState / popstate), recompute.
  var lastPath = window.location.pathname
  function syncOnNav() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname
      setActiveByPath(lastPath)
    }
  }
  // patch history methods to call syncOnNav after a programmatic nav
  var origPush = history.pushState
  var origReplace = history.replaceState
  history.pushState = function () {
    var r = origPush.apply(this, arguments)
    syncOnNav()
    return r
  }
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments)
    syncOnNav()
    return r
  }
  window.addEventListener('popstate', syncOnNav)
  window.addEventListener('hashchange', syncOnNav)
})();
