/**
// *   MP-V6 顶栏 plugin — host half
// *
// *   把 2 个菜单注入到 dsh-web 顶栏:
// *     - 市场   (mp-marketplace)
// *     - 后台管理 (mp-platform admin)
// *
// *   集成方式:
// *     1. 注册静态路由 /__mp_v6_topbar__/topbar.js, 服务 client.js
// *     2. tapIndex(): 把 <script src=...> 注入到 <head>, 客户端跑就 prepend 顶栏
// *
// *   加载: vendor/.../profiles/web/cordis.patch.yml 的 `insert` 行指向本文件
// *   (相对路径从 cordis.yml 解析; 不修改 vendor 源码, 不修改 dsh 主代码)
// */
// Host plugin — no client half, server-side only.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Inject list — required services the Cordis loader must wait for. */
export const inject = ['webServer']

/** Apply the host plugin: register the client bundle route + tap index.html. */
export function apply(ctx) {
  // 1. Serve the client JS bundle as a static file at a stable path.
  const clientJsPath = join(HERE, 'topbar.js')

  const serveClientJs = async (req, res) => {
    try {
      const body = await readFile(clientJsPath)
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`mp-v6-topbar: failed to read ${clientJsPath}: ${err && err.message}`)
    }
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/__mp_v6_topbar__/topbar.js',
      handler: serveClientJs,
    })
    return dispose
  }, 'mp-v6-topbar: serve client.js route')

  // 2. Tap index.html so every served page includes our <script>.
  const tag = '<script src="/__mp_v6_topbar__/topbar.js" defer></script>'
  ctx.effect(() => {
    const dispose = ctx.webServer.tapIndex((html) => {
      // Avoid double-injection if HMR re-taps the index.
      if (html.includes('/__mp_v6_topbar__/topbar.js')) return html
      return html.replace('<head>', `<head>${tag}`)
    })
    return dispose
  }, 'mp-v6-topbar: inject topbar script tag')
}