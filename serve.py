#!/usr/bin/env python3
"""健身器械助手本地开发服务：静态文件 + 百度 API 代理
   用法：python3 serve.py  （默认 127.0.0.1:8787，根目录=本文件所在目录）
   - 静态：/            → gym-app 目录
   - 代理：/proxy/*     → https://aip.baidubce.com/*
     百度接口不返回 CORS 头，浏览器无法直连；由本地代理转发，
     同时避免把含 Key 的请求 URL 打进访问日志。"""
import http.server
import os
import sys
import urllib.error
import urllib.request

PORT = 8787
ROOT = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = 'https://aip.baidubce.com'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith('/proxy/'):
            self.proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/proxy/'):
            self.proxy('POST')
        else:
            self.send_error(404)

    def proxy(self, method):
        target = UPSTREAM + self.path[len('/proxy'):]
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(length) if length else None
        except (ValueError, OSError):
            body = None
        req = urllib.request.Request(target, data=body, method=method)
        ct = self.headers.get('Content-Type')
        if ct:
            req.add_header('Content-Type', ct)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self.reply(r.status, r.read(), r.headers.get('Content-Type'))
        except urllib.error.HTTPError as e:
            self.reply(e.code, e.read(), e.headers.get('Content-Type'))
        except Exception as e:
            self.reply(502, str(e).encode(), 'text/plain')

    def reply(self, status, data, ctype):
        self.send_response(status)
        self.send_header('Content-Type', ctype or 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # 开发服务：禁用缓存，改完样式/脚本刷新即生效，避免浏览器用旧 CSS
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 不打印请求行（token 请求的 query 里含 Key），只记动作
        sys.stdout.write('[%s] %s\n' % (self.command, self.path.split('?')[0]))
        sys.stdout.flush()


if __name__ == '__main__':
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('serving http://127.0.0.1:%d  (static: %s)' % (PORT, ROOT))
    httpd.serve_forever()
