// MetaPlatform 顶栏 plugin — client half
//
// 在 dsh-web 页面顶部 prepend 一个 44px 高的顶栏, 含 4 个菜单:
//   - 云市场              → http://localhost:8080/marketplace   (SPA internal nav, same tab)
//   - 应用中心            → http://localhost:8080/marketplace   (SPA internal nav, same tab)
//   - Ontology 本体平台   → http://localhost:8080/admin         (SPA internal nav, same tab)
//   - AI 助手             → 触发 dsh chat panel (CustomEvent 'dsh:open-chat')
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
    'transition: background 120ms ease, color 120ms ease;' +
    'display: inline-flex;' +
    'align-items: center;' +
    'gap: 4px;' +
    'cursor: pointer;' +
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
   */
  var ITEMS = [
    {
      id: 'mp-marketplace',
      label: '云市场',
      href: 'http://localhost:8080/marketplace',
      kind: 'link',
    },
    {
      id: 'mp-app-center',
      label: '应用中心',
      href: 'http://localhost:8080/marketplace',
      kind: 'link',
    },
    {
      id: 'mp-platform-admin',
      label: 'Ontology 本体平台',
      href: 'http://localhost:8080/admin',
      kind: 'link',
    },
    {
      id: 'mp-ai-assistant',
      label: 'AI 助手',
      href: null,
      kind: 'chat',
    },
  ]

  /**
   * SPA internal navigation for a 'link' item.
   * - Same-origin href  → history.pushState + dispatch popstate (no page reload,
   *                        dsh's React Router / window.location listener can pick it up).
   * - Cross-origin href → window.location.assign(href), which navigates the
   *                        CURRENT tab (no new tab, no popup). This replaces
   *                        target="_blank" which opened a new tab.
   * - Any parse failure → same fallback (navigate current tab).
   */
  function navigateAsInternal(href) {
    try {
      var target = new URL(href, window.location.href)
      if (target.origin === window.location.origin) {
        var path = target.pathname + target.search + target.hash
        window.history.pushState({}, '', path)
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
      } else {
        window.location.assign(href)
      }
    } catch (err) {
      window.location.assign(href)
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
        navigateAsInternal(item.href)
      }
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
    mo.observe(document.documentElement, { childList: true, subtree: false })
  }
})()