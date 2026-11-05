#!/usr/bin/env node
'use strict';
/* 冒烟测试用的上游桩：验证 /proxy/* 透传与 /api/llm/summary 转发行为（无需真实百度/智谱账号）
   /echo          → 200 回显 method / body / headers（验证原样透传）
   /boom*         → 直接断开连接（验证后端网络异常 → 502）
   body 含 FORCE_502 → 断开连接（用于触发 LLM 路由的 502 分支） */

const http = require('http');

const port = Number(process.argv[2] || 0);
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url.startsWith('/boom') || body.includes('FORCE_502')) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        method: req.method,
        url: req.url,
        body,
        contentType: req.headers['content-type'] || '',
        authorization: req.headers['authorization'] || '',
      })
    );
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`STUB_PORT=${server.address().port}\n`);
});
