// scripts/dev/mp-sandbox-sidecar.mjs
// PoC: 模拟 mp-runtime K8s sidecar HTTP /execute
// 生产: mp-runtime Deployment sidecar container (Deno / Rust / Go)
//   用 bwrap / Landlock / Seatbelt 真执行 + 进程级隔离
//
// 本地 dev: 接收 POST /execute, 用 Node.js child_process 真跑 (Deno.Command 不允许 in EF runtime)

import http from 'node:http';
import { spawn } from 'node:child_process';

const port = parseInt(process.env.SIDECAR_PORT ?? '9999');

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/execute') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let params;
    try { params = JSON.parse(body); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
      return;
    }

    const { code, language, timeout_ms = 5000 } = params;
    if (!code || !language) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing_fields' }));
      return;
    }
    if (!['python', 'javascript', 'bash'].includes(language)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_language' }));
      return;
    }

    const t0 = Date.now();
    let cmd, args;
    if (language === 'python') { cmd = 'python3'; args = ['-c', code]; }
    else if (language === 'javascript') { cmd = 'node'; args = ['-e', code]; }
    else { cmd = 'bash'; args = ['-c', code]; }

    const child = spawn(cmd, args);
    let stdout = '', stderr = '', timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, timeout_ms);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - t0;
      const exit_code = typeof code === 'number' ? code : (signal ? 128 + 1 : 1);
      res.writeHead(timedOut ? 408 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: !timedOut && exit_code === 0,
        stdout: stdout.slice(0, 1_048_576),
        stderr: stderr.slice(0, 1_048_576),
        exit_code,
        timed_out: timedOut,
        duration_ms,
      }));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message, stdout: '', stderr: '', exit_code: 1, timed_out: false, duration_ms: Date.now() - t0 }));
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`mp-sandbox sidecar mock on http://0.0.0.0:${port}/execute`);
});