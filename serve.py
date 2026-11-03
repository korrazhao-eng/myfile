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

# 器械默认发力肌群（详情页人体模型标红；后台「器械与教程」表单可改，muscles 为主发力=红，subMuscles 为辅助发力=橙）
EQUIP_MUSCLES = {
    'chest_press':     ['胸大肌', '三角肌前束', '肱三头肌'],
    'pec_fly':         ['胸大肌', '三角肌前束'],
    'incline_press':   ['胸大肌', '三角肌前束', '肱三头肌'],
    'cable_crossover': ['胸大肌', '三角肌前束', '腹肌'],
    'leg_press':       ['股四头肌', '臀大肌', '腘绳肌'],
    'leg_ext':         ['股四头肌'],
    'leg_curl':        ['腘绳肌'],
    'lat_pull':        ['背阔肌', '菱形肌', '斜方肌中下束'],
    'straight_arm':    ['背阔肌', '腹肌'],
    'cable_row':       ['背阔肌', '菱形肌', '斜方肌中下束'],
    'cable_pushdown':  ['肱三头肌'],
    'smith_machine':   ['股四头肌', '臀大肌', '三角肌前束']
}
EQUIP_SUB = {
    'chest_press':     ['肱三头肌'],
    'pec_fly':         ['三角肌前束'],
    'incline_press':   ['肱三头肌'],
    'cable_crossover': ['三角肌前束'],
    'leg_press':       ['腘绳肌', '小腿'],
    'leg_ext':         [],
    'leg_curl':        ['臀大肌'],
    'lat_pull':        ['肱二头肌', '前臂'],
    'straight_arm':    [],
    'cable_row':       ['肱二头肌', '前臂'],
    'cable_pushdown':  ['前臂'],
    'smith_machine':   ['肱三头肌', '腘绳肌']
}

def _eq(id_, type_, name):
    return {'id': id_, 'type': type_, 'name': name,
            'videoUrl': VIDEO_TEST_URL, 'videoJump': VIDEO_JUMP_URL, 'safety': SAFETY_WARNING,
            'muscles': EQUIP_MUSCLES.get(id_, []), 'subMuscles': EQUIP_SUB.get(id_, [])}

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
    'lessons': [],  # 教练课预约（用户端按天 upsert 上报）
    # 方案配置（后台「方案配置」页编辑，用户端「生成今日方案」优先使用；未配置的部位回退前端内置模板）
    # steps 字段：stage 阶段名 / action 动作名 / equipId 教学跳转器械 / equipText 展示器械 /
    #             sets 组数 / repsTxt 组次展示文本 / w 默认重量（录入弹层预填） /
    #             focus 目标肌群 / detail 关键细节 / rest 组间休息
    'plans': [
        {
            'id': 'back', 'part': '背',
            'warmup': {'targets': '背阔肌、菱形肌、斜方肌中下束、三角肌后束、肩袖肌群',
                       'method': '动态拉伸 + 轻重量器械试做',
                       'standard': '背部微微发热、心率略升，手臂不发酸。'},
            'steps': [
                {'stage': '宽度构建', 'action': '高位下拉（宽握）', 'equipId': 'lat_pull', 'equipText': '高位下拉机',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 40,
                 'focus': '背阔肌外侧',
                 'detail': '身体微后仰15度，挺胸，手肘往腰间带；还原慢放3秒。', 'rest': '90秒'},
                {'stage': '厚度雕刻', 'action': '坐姿划船（窄握V把）', 'equipId': 'cable_row', 'equipText': '坐姿划船机 + V把',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 35,
                 'focus': '背阔肌、菱形肌、中斜方',
                 'detail': '肩膀先下沉，手肘贴身体向后拉，顶峰肩胛骨夹紧1秒；不要用腰后甩。', 'rest': '90秒'},
                {'stage': '单侧纠偏', 'action': '单臂哑铃划船', 'equipId': 'cable_row', 'equipText': '哑铃 + 平凳',
                 'sets': 3, 'reps': 12, 'repsTxt': '3组 × 12次/侧', 'w': 12,
                 'focus': '背阔肌、菱形肌',
                 'detail': '同侧手扶凳，背部平直；想象肘部去够后裤兜，弧线拉起，不耸肩。', 'rest': '60秒'},
                {'stage': '下沿细节', 'action': '直臂下压', 'equipId': 'straight_arm', 'equipText': '龙门架绳索',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 20,
                 'focus': '背阔肌下沿',
                 'detail': '手臂微屈固定，朝大腿方向下压，顶峰停1秒；不要变成三头下压。', 'rest': '60秒'},
                {'stage': '体态复位', 'action': '龙门架面拉', 'equipId': 'cable_crossover', 'equipText': '龙门架绳索（滑轮略高于眉头）',
                 'sets': 3, 'reps': 20, 'repsTxt': '3组 × 20次', 'w': 5,
                 'focus': '三角肌后束、菱形肌、中下斜方、肩袖',
                 'detail': '双手向后拉的同时向耳朵两侧分开，手肘不低于肩膀，肩胛骨夹紧；不要身体后仰借力。', 'rest': '60秒'}
            ],
            'stretch': [
                {'action': '双手抓龙门架柱，身体下压', 'target': '拉伸背阔肌', 'time': '每侧30秒'},
                {'action': '坐姿弓背抱膝', 'target': '拉伸中下斜方、下背', 'time': '30秒'},
                {'action': '手臂横过胸前', 'target': '拉伸三角肌后束', 'time': '每侧30秒'}
            ]
        },
        {
            'id': 'chest', 'part': '胸',
            'warmup': {'targets': '胸大肌、三角肌前束、肩袖肌群',
                       'method': '动态拉伸 + 轻重量器械试做',
                       'standard': '胸部微微发热、心率略升，但不要做到手臂发酸。'},
            'steps': [
                {'stage': '宽度构建（大重量复合）', 'action': '上斜卧推（杠铃）', 'equipId': 'incline_press', 'equipText': '上斜卧推架 + 杠铃',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 30,
                 'focus': '胸大肌上部、三角肌前束（决定上胸厚度，改善胸型轮廓）',
                 'detail': '肩胛骨后收下沉，杠铃下放到锁骨一线，手肘约45度；推起不耸肩，腰部不过度反弓。', 'rest': '90秒'},
                {'stage': '厚度雕刻（大重量复合）', 'action': '坐姿推胸（水平）', 'equipId': 'chest_press', 'equipText': '坐姿推胸器',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 40,
                 'focus': '胸大肌中束、三角肌前束、肱三头（决定胸部整体厚度）',
                 'detail': '背部贴紧靠垫，双手略宽于肩，推至手肘微屈不完全锁死；还原慢放3秒，感受胸肌离心发力。', 'rest': '90秒'},
                {'stage': '单侧纠偏（左右平衡）', 'action': '蝴蝶机夹胸（单臂依次）', 'equipId': 'pec_fly', 'equipText': '蝴蝶机夹胸器',
                 'sets': 3, 'reps': 12, 'repsTxt': '3组 × 12次/侧', 'w': 25,
                 'focus': '胸大肌中缝与外侧（纠正左右力量不平衡）',
                 'detail': '把手调至与肩同高，单臂依次完成；手肘微屈固定，想象用肘部去抱合，顶峰停1秒，不要耸肩借力。', 'rest': '60秒'},
                {'stage': '中缝细节（单关节雕刻）', 'action': '龙门架绳索夹胸', 'equipId': 'cable_crossover', 'equipText': '龙门架绳索（滑轮略高于肩）',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 15,
                 'focus': '胸大肌中缝、下沿（让中缝更深、下胸轮廓更清晰）',
                 'detail': '身体微前倾固定，手臂微屈呈弧线向内向下合拢于腹前，顶峰停1秒；不要做成推的动作。', 'rest': '60秒'},
                {'stage': '体态复位（平衡推类负荷）', 'action': '龙门架面拉', 'equipId': 'cable_crossover', 'equipText': '龙门架绳索（滑轮略高于眉头）',
                 'sets': 3, 'reps': 20, 'repsTxt': '3组 × 20次（轻重量）', 'w': 5,
                 'focus': '三角肌后束、菱形肌、中下斜方、肩袖（平衡练胸推量，防止圆肩驼背）',
                 'detail': '双手向额头两侧拉开，手肘不低于肩膀，肩胛骨夹紧；不要用身体后仰借力。', 'rest': '60秒'}
            ],
            'stretch': [
                {'action': '门框胸部拉伸', 'target': '拉伸胸大肌、三角肌前束', 'time': '每侧30秒'},
                {'action': '猫式展背', 'target': '拉伸胸椎、放松胸小肌', 'time': '30秒'},
                {'action': '手臂横过胸前', 'target': '拉伸三角肌后束、肩部外侧', 'time': '每侧30秒'}
            ]
        },
        {
            'id': 'leg', 'part': '腿',
            'warmup': {'targets': '臀大肌、臀中肌、股四头肌、腘绳肌、小腿稳定肌群',
                       'method': '动态拉伸 + 轻重量器械试做',
                       'standard': '臀部和大腿微微发热，膝盖无压力感。'},
            'steps': [
                {'stage': '臀主导（对膝盖最友好，优先练）', 'action': '杠铃/哑铃臀推', 'equipId': 'smith_machine', 'equipText': '臀推机 或 杠铃+平凳',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 30,
                 'focus': '臀大肌（翘臀核心）',
                 'knee': '膝盖角度固定，剪切力小；膝盖始终对准脚尖，不内扣',
                 'detail': '下巴微收，用臀部顶起，顶峰夹紧2秒；不要用腰过度反弓。', 'rest': '90秒'},
                {'stage': '臀主导（对膝盖最友好，优先练）', 'action': '罗马尼亚硬拉（RDL）', 'equipId': 'smith_machine', 'equipText': '哑铃或杠铃',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 12次', 'w': 25,
                 'focus': '腘绳肌+臀大肌',
                 'knee': '膝盖几乎不屈曲，靠髋关节铰链',
                 'detail': '屁股向后推，背部挺直，感受大腿后侧拉伸；膝盖微屈固定，不来回晃。', 'rest': '90秒'},
                {'stage': '股四头肌（小角度、器械辅助）', 'action': '坐姿腿屈伸（下半程）', 'equipId': 'leg_ext', 'equipText': '坐姿腿屈伸机',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 20,
                 'focus': '股四头肌',
                 'knee': '只做下半程——从伸直位下放到约45度就停，不做到最大屈膝',
                 'detail': '轻重量，顶峰收缩1秒，慢放3秒；膝盖不锁死。', 'rest': '60秒'},
                {'stage': '股四头肌（小角度、器械辅助）', 'action': '靠墙静蹲（浅角度）', 'equipId': '', 'equipText': '墙面',
                 'sets': 3, 'reps': 30, 'repsTxt': '3组 × 30秒', 'w': 0,
                 'focus': '股四头肌+臀',
                 'knee': '角度不超过60度，膝盖不超过脚尖',
                 'detail': '背部贴墙，膝盖对准脚尖方向，不内扣；有不适立刻起身。', 'rest': '60秒'},
                {'stage': '臀中肌+腘绳肌（稳定膝盖的关键）', 'action': '弹力带蚌式开合', 'equipId': '', 'equipText': '弹力带+瑜伽垫',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次/侧', 'w': 0,
                 'focus': '臀中肌（稳定膝盖轨迹）',
                 'knee': '无膝盖压力',
                 'detail': '侧躺，膝盖弯曲，脚跟并拢，用臀中肌打开膝盖；骨盆不后翻。', 'rest': '45秒'},
                {'stage': '臀中肌+腘绳肌（稳定膝盖的关键）', 'action': '俯卧腿弯举（器械）', 'equipId': 'leg_curl', 'equipText': '俯卧腿弯举机',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 25,
                 'focus': '腘绳肌',
                 'knee': '膝盖屈曲但无负重压迫；若不适可换弹力带俯卧腿弯举',
                 'detail': '慢放3秒，不靠惯性甩；重量宁轻勿重。', 'rest': '60秒'}
            ],
            'stretch': [
                {'action': '站姿抓脚踝拉股四头肌', 'target': '拉伸大腿前侧', 'time': '每侧30秒'},
                {'action': '坐姿体前屈', 'target': '拉伸腘绳肌', 'time': '30秒'},
                {'action': '仰卧4字拉伸', 'target': '拉伸臀部', 'time': '每侧30秒'},
                {'action': '小腿靠墙拉伸', 'target': '放松小腿', 'time': '每侧30秒'}
            ]
        },
        {
            'id': 'shoulder', 'part': '肩',
            'warmup': {'targets': '三角肌前中后束、肩袖肌群',
                       'method': '动态拉伸 + 轻重量器械试做',
                       'standard': '肩关节活动开，三角肌微微发热，无耸肩代偿。'},
            'steps': [
                {'stage': '复合推举', 'action': '坐姿哑铃推举', 'equipId': '', 'equipText': '可调凳 + 哑铃',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 10-12次', 'w': 15,
                 'focus': '三角肌前束、中束',
                 'detail': '坐直靠背，手肘始终朝前，推到顶手臂微屈不锁死；全程沉肩。', 'rest': '90秒'},
                {'stage': '中束塑形', 'action': '哑铃侧平举', 'equipId': '', 'equipText': '哑铃',
                 'sets': 4, 'reps': 15, 'repsTxt': '4组 × 15次', 'w': 5,
                 'focus': '三角肌中束',
                 'detail': '手肘先启动，想象往两侧倒水，抬至与肩同高即停；全程沉肩，不耸肩。', 'rest': '60秒'},
                {'stage': '后束强化', 'action': '俯身哑铃飞鸟', 'equipId': '', 'equipText': '哑铃',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 5,
                 'focus': '三角肌后束',
                 'detail': '俯身至躯干接近平行地面，手肘微屈，向两侧打开至与背部平行；不甩重量。', 'rest': '60秒'},
                {'stage': '体态复位', 'action': '龙门架面拉', 'equipId': 'cable_crossover', 'equipText': '龙门架绳索（滑轮略高于眉头）',
                 'sets': 3, 'reps': 20, 'repsTxt': '3组 × 20次', 'w': 5,
                 'focus': '三角肌后束、菱形肌、中下斜方、肩袖',
                 'detail': '向后拉的同时向耳朵两侧分开，手肘不低于肩膀，肩胛骨夹紧；不后仰借力。', 'rest': '60秒'}
            ],
            'stretch': [
                {'action': '手臂横过胸前', 'target': '拉伸三角肌后束', 'time': '每侧30秒'},
                {'action': '手臂下垂外旋拉伸', 'target': '拉伸三角肌前束', 'time': '每侧30秒'},
                {'action': '颈后轻拉肘', 'target': '拉伸三角肌中束', 'time': '每侧30秒'}
            ]
        },
        {
            'id': 'arm', 'part': '手臂',
            'warmup': {'targets': '肱三头肌、肱二头肌、前臂肌群、肘腕关节',
                       'method': '动态拉伸 + 轻重量器械试做',
                       'standard': '手臂微微发热，肘腕无压力感。'},
            'steps': [
                {'stage': '三头肌复合', 'action': '哑铃颈后臂屈伸', 'equipId': '', 'equipText': '哑铃 + 坐姿凳',
                 'sets': 4, 'reps': 12, 'repsTxt': '4组 × 10-12次', 'w': 15,
                 'focus': '肱三头肌长头',
                 'detail': '大臂全程贴紧耳朵固定，只弯伸肘关节；下放感受三头拉伸，推起不锁死。', 'rest': '90秒'},
                {'stage': '三头肌孤立', 'action': '龙门架绳索下压', 'equipId': 'cable_pushdown', 'equipText': '龙门架绳索',
                 'sets': 4, 'reps': 15, 'repsTxt': '4组 × 15次', 'w': 15,
                 'focus': '肱三头肌外侧头',
                 'detail': '大臂夹紧肋骨固定，下压到底时双手向外旋转；不耸肩、不甩肩。', 'rest': '60秒'},
                {'stage': '二头肌长头', 'action': '坐姿哑铃交替弯举', 'equipId': '', 'equipText': '哑铃 + 坐姿凳',
                 'sets': 3, 'reps': 12, 'repsTxt': '3组 × 12次/侧', 'w': 12,
                 'focus': '肱二头肌长头',
                 'detail': '坐姿防借力，手腕保持中立，顶峰收缩1秒；下放保持微屈不锁死。', 'rest': '60秒'},
                {'stage': '肱肌与侧面线条', 'action': '哑铃锤式弯举', 'equipId': '', 'equipText': '哑铃',
                 'sets': 3, 'reps': 15, 'repsTxt': '3组 × 15次', 'w': 10,
                 'focus': '肱肌',
                 'detail': '掌心相对，大臂贴紧身体，弯举至胸前；慢放3秒，不靠惯性。', 'rest': '60秒'},
                {'stage': '前臂收尾', 'action': '哑铃正握腕弯举', 'equipId': '', 'equipText': '哑铃 + 平凳',
                 'sets': 2, 'reps': 20, 'repsTxt': '2组 × 20次', 'w': 5,
                 'focus': '前臂屈肌群',
                 'detail': '前臂放腿上，手腕悬空，正手握哑铃做腕屈伸；动作慢，不甩。', 'rest': '45秒'}
            ],
            'stretch': [
                {'action': '举臂摸对侧后背', 'target': '拉伸肱三头肌', 'time': '每侧30秒'},
                {'action': '手臂后伸外旋、手掌贴墙', 'target': '拉伸肱二头肌', 'time': '每侧30秒'},
                {'action': '前臂伸直、掌心向上轻拉手指', 'target': '拉伸前臂屈肌', 'time': '每侧30秒'}
            ]
        }
    ]
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
        data = json.load(f)
    if name == 'equipments':  # 发力肌群字段升级：存量器械缺 muscles/subMuscles 时按默认表补全并写回（幂等）
        changed = False
        for it in data:
            if 'muscles' not in it:
                it['muscles'] = EQUIP_MUSCLES.get(it.get('id'), [])
                changed = True
            if 'subMuscles' not in it:
                it['subMuscles'] = EQUIP_SUB.get(it.get('id'), [])
                changed = True
        if changed:
            save_collection(name, data)
    return data


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
        coll = parts[0] if parts[0] in ('coaches', 'equipments', 'profile', 'users', 'logs', 'lessons', 'plans') else None
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
        coll = parts[0] if parts[0] in ('coaches', 'equipments', 'profile', 'users', 'logs', 'lessons', 'plans') else None
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
            if coll == 'plans':  # 方案配置：PUT 全量替换（后台「保存方案配置」一次提交全部部位）
                if method != 'PUT' or not isinstance(body, list):
                    return self.reply(405, {'error': 'plans supports PUT list only'})
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
