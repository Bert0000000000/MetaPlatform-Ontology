// MP-V6 顶栏 plugin — client half
//
// 在 dsh-web 页面顶部 prepend 一个 44px 高的顶栏, 含 2 个菜单:
//   - 市场        → http://localhost:8080/marketplace
//   - 后台管理    → http://localhost:8080/admin
//
// 用 vanilla DOM (不引入 React): dsh 用 zustand/cordis 但顶栏只是固定位 div + 2 个 <a>,
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

  var ITEMS = [
    {
      id: 'mp-marketplace',
      label: '市场',
      href: 'http://localhost:8080/marketplace',
    },
    {
      id: 'mp-platform-admin',
      label: '后台管理',
      href: 'http://localhost:8080/admin',
    },
  ]

  function buildTopbar() {
    var topbar = document.createElement('nav')
    topbar.id = TOPBAR_ID
    topbar.setAttribute('aria-label', 'MP-V6 应用导航')
    topbar.setAttribute('data-mp-v6-plugin', 'topbar')

    var brand = document.createElement('span')
    brand.textContent = 'MP-V6'
    brand.style.cssText =
      'color: rgba(255,255,255,0.55);font-size:11px;font-weight:600;' +
      'letter-spacing:0.08em;margin-right:12px;text-transform:uppercase;'
    topbar.appendChild(brand)

    for (var i = 0; i < ITEMS.length; i++) {
      var item = ITEMS[i]
      var a = document.createElement('a')
      a.href = item.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.setAttribute('data-menu-id', item.id)
      a.setAttribute('data-mp-v6-menu', item.id)
      a.textContent = item.label
      topbar.appendChild(a)
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