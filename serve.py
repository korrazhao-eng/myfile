#!/usr/bin/env python3
"""健身器械助手本地开发服务：静态文件 + 百度/LLM 代理 + 轻量配置 API（M4）
   用法：python3 serve.py [端口]  （默认 127.0.0.1:8787，根目录=本文件所在目录）
   - 静态：/            → gym-app 目录（含 admin.html 管理页）
   - 代理：/proxy/*     → https://aip.baidubce.com/*（百度识图，Key 不进日志）
   - 代理：/proxy/llm   → https://open.bigmodel.cn/...（智谱 LLM，Key 前端注入）
   - API：  /api/*      → 轻量模拟后端：data/*.json 文件存储（线程锁保护）
     coaches    教练管理（CRUD）
     equipments 器械库+教程配置（CRUD）
     profile    用户档案（心率/体测/合同/请假，GET/PUT 全量）
     logs       训练日志上报与查询（POST/GET）
     lessons    教练课预约上报与查询（POST/GET）
     bootstrap  一次拉全 coaches+equipments+profile（用户端启动用）
   data/ 目录不存在时用内置默认值初始化（与前端 data.js 回退值一致）；
   部署到 GitHub Pages（无后端）时前端 fetch 失败自动回退内置默认值。"""
import http.server
import json
import os
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

PORT = 8787
ROOT = os.path.dirname(os.path.abspath(__file__))
UPSTREAM = 'https://aip.baidubce.com'
LLM_UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
DATA_DIR = os.path.join(ROOT, 'data')
DATA_LOCK = threading.Lock()  # ThreadingHTTPServer 并发保护 JSON 读写

VIDEO_TEST_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
VIDEO_JUMP_URL = 'https://xhslink.cn/o/1z39WqbiAAP'
SAFETY_WARNING = '加片之前先加控制，冲重量之前先问教练'

def _eq(id_, type_, name):
    return {'id': id_, 'type': type_, 'name': name,
            'videoUrl': VIDEO_TEST_URL, 'videoJump': VIDEO_JUMP_URL, 'safety': SAFETY_WARNING}

DEFAULTS = {
    'coaches': [
        {'id': 'c1', 'name': '田文镜', 'course': '力量训练课', 'tags': ['ACSM', '力量训练', '营养师资格证']},
        {'id': 'c2', 'name': '曹操',   'course': '体能提升课', 'tags': ['ACSM', '体能提升', '动作指导']}
    ],
    'equipments': [
        _eq('chest_press',      '胸部', '坐姿推胸器'),
        _eq('pec_fly',          '胸部', '蝴蝶机夹胸器'),
        _eq('incline_press',    '胸部', '上斜卧推架'),
        _eq('cable_crossover',  '胸部', '龙门架夹胸器'),
        _eq('leg_press',        '腿部', '坐姿腿举机'),
        _eq('leg_ext',          '腿部', '腿屈伸训练器'),
        _eq('leg_curl',         '腿部', '俯卧腿弯举机'),
        _eq('lat_pull',         '背部', '坐姿高位下拉器械'),
        _eq('straight_arm',     '背部', '直臂下压训练器'),
        _eq('cable_row',        '背部', '坐姿绳索划船器'),
        _eq('cable_pushdown',   '手臂', '绳索下压训练器'),
        _eq('smith_machine',    '多功能', '史密斯机')
    ],
    'users': [
        {'id': 'u1', 'nickname': '曹操', 'phone': '13812345678', 'visitAt': '2026-10-25 09:30', 'coach': '田文镜',
         'heart': '最近一次 72 次/分（2026-10-11）', 'body': '体重 68.5 kg ／ 体脂 18.2%（2026-10-08）',
         'contract': '有效期至 2027-10-11', 'leave': '剩余 12 天'},
        {'id': 'u2', 'nickname': '田文镜', 'phone': '15900112233', 'visitAt': '2026-10-24 20:15', 'coach': '',
         'heart': '最近一次 68 次/分（2026-10-24）', 'body': '体重 75.0 kg ／ 体脂 20.1%（2026-10-20）',
         'contract': '有效期至 2026-12-01', 'leave': ''}
    ],
    'profile': [
        {'title': '心率记录', 'main': '最近一次 72 次/分', 'sub': '记录日期 2026-10-11'},
        {'title': '体测记录', 'main': '体重 68.5 kg ／ 体脂 18.2%', 'sub': '体测日期 2026-10-08'},
        {'title': '合同记录', 'main': '有效期至 2027 年 10 月 11 日', 'sub': ''},
        {'title': '请假记录', 'main': '剩余 12 天', 'sub': ''}
    ],
    'logs': [],     # 训练日志（用户端按天 upsert 上报）
    'lessons': []   # 教练课预约（用户端按天 upsert 上报）
}


def data_path(name):
    return os.path.join(DATA_DIR, name + '.json')


def load_collection(name):
    """读取集合；文件不存在时用默认值初始化（首次启动生成 data/）"""
    path = data_path(name)
    if not os.path.exists(path):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(DEFAULTS[name], f, ensure_ascii=False, indent=2)
        return json.loads(json.dumps(DEFAULTS[name]))  # 深拷贝
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_collection(name, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = data_path(name)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:  # 先写临时文件再替换，避免写一半被读
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- 路由 ----------
    def do_GET(self):
        if self.path.startswith('/api/'):
            self.api_get()
        elif self.path.startswith('/proxy/'):
            self.proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.api_write('POST')
        elif self.path.startswith('/proxy/'):
            self.proxy('POST')
        else:
            self.send_error(404)

    def do_PUT(self):
        if self.path.startswith('/api/'):
            self.api_write('PUT')
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self.api_write('DELETE')
        else:
            self.send_error(404)

    # ---------- API ----------
    def api_get(self):
        route, query = self.split_route()
        if route == 'bootstrap':
            with DATA_LOCK:
                data = {n: load_collection(n) for n in ('coaches', 'equipments', 'profile')}
            return self.reply(200, data)
        parts = route.split('/')
        coll = parts[0] if parts[0] in ('coaches', 'equipments', 'profile', 'users', 'logs', 'lessons') else None
        if not coll:
            return self.reply(404, {'error': 'unknown collection'})
        with DATA_LOCK:
            items = load_collection(coll)
        if coll in ('logs', 'lessons'):  # 查询过滤：?date= &coach=
            out = [it for it in items
                   if ('date' not in query or it.get('date') == query['date'])
                   and ('coach' not in query or it.get('coachName') == query['coach'])]
            return self.reply(200, out)
        if len(parts) > 1:  # 单条：/api/coaches/c1
            item = next((it for it in items if it.get('id') == parts[1]), None)
            return self.reply(200, item) if item else self.reply(404, {'error': 'not found'})
        self.reply(200, items)

    def api_write(self, method):
        route, _ = self.split_route()
        body = self.read_json()
        if body is None and method in ('POST', 'PUT'):
            return self.reply(400, {'error': 'invalid json body'})
        parts = route.split('/')
        coll = parts[0] if parts[0] in ('coaches', 'equipments', 'profile', 'users', 'logs', 'lessons') else None
        if not coll:
            return self.reply(404, {'error': 'unknown collection'})
        item_id = parts[1] if len(parts) > 1 else None
        with DATA_LOCK:
            items = load_collection(coll)
            if coll == 'profile':  # 档案：PUT 全量替换
                if method != 'PUT' or not isinstance(body, list):
                    return self.reply(405, {'error': 'profile supports PUT list only'})
                save_collection(coll, body)
                return self.reply(200, {'ok': True, 'count': len(body)})
            if method == 'POST':  # 新增 / 上报（logs/lessons 按天 upsert：同 date 覆盖，防重复追加）
                if coll in ('coaches', 'equipments') and not body.get('name'):
                    return self.reply(400, {'error': 'name required'})
                item = dict(body)
                if coll in ('logs', 'lessons') and item.get('date'):
                    idx = next((i for i, it in enumerate(items) if it.get('date') == item['date']), -1)
                    if idx >= 0:
                        items[idx] = item
                    else:
                        items.append(item)
                else:
                    item['id'] = item.get('id') or uuid.uuid4().hex[:8]
                    items.append(item)
                save_collection(coll, items)
                return self.reply(200, {'ok': True, 'id': item.get('id')})
            if method == 'PUT':
                if not item_id:
                    return self.reply(405, {'error': 'item id required'})
                idx = next((i for i, it in enumerate(items) if it.get('id') == item_id), -1)
                if idx < 0:
                    return self.reply(404, {'error': 'not found'})
                body.pop('id', None)
                items[idx].update(body)
                save_collection(coll, items)
                return self.reply(200, {'ok': True})
            if method == 'DELETE':
                if not item_id:
                    return self.reply(405, {'error': 'item id required'})
                rest = [it for it in items if it.get('id') != item_id]
                if len(rest) == len(items):
                    return self.reply(404, {'error': 'not found'})
                save_collection(coll, rest)
                return self.reply(200, {'ok': True})

    def split_route(self):
        path = self.path[len('/api/'):].split('?')
        route = path[0].strip('/')
        query = {}
        if len(path) > 1:
            for kv in path[1].split('&'):
                if '=' in kv:
                    k, v = kv.split('=', 1)
                    query[urllib.parse.unquote(k)] = urllib.parse.unquote(v)
        return route, query

    def read_json(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) if length else b''
            return json.loads(raw) if raw else None
        except (ValueError, json.JSONDecodeError):
            return None

    # ---------- 代理（百度 / 智谱 LLM） ----------
    def proxy(self, method):
        if self.path.startswith('/proxy/llm'):
            target = LLM_UPSTREAM
        else:
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
        auth = self.headers.get('Authorization')
        if auth:
            req.add_header('Authorization', auth)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self.reply(r.status, r.read(), r.headers.get('Content-Type'))
        except urllib.error.HTTPError as e:
            self.reply(e.code, e.read(), e.headers.get('Content-Type'))
        except Exception as e:
            self.reply(502, str(e).encode(), 'text/plain')

    def reply(self, status, data, ctype=None):
        if not isinstance(data, (bytes, bytearray)):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
            ctype = ctype or 'application/json; charset=utf-8'
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
    if len(sys.argv) > 1:  # 可选端口参数：python3 serve.py 8788
        PORT = int(sys.argv[1])
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('serving http://127.0.0.1:%d  (static: %s)' % (PORT, ROOT))
    httpd.serve_forever()
