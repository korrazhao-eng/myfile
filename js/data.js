/* 器械库 Mock 数据（测试期约定）
   - 单店写死，无后台
   - 目标肌群测试期统一 = 背部
   - 视频区测试态：详情页内嵌 <video> 播放器（VIDEO_TEST_URL=公开示例视频，可内嵌播放）
     + 「视频教程（跳转小红书）」外链模块（VIDEO_JUMP_URL 测试链接）；
     正式版替换为真实器械教学视频源与真实外链
   - 识别接口为 Mock：不接真实 API，Key 不入仓库 */
const VIDEO_TEST_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const VIDEO_JUMP_URL = 'https://xhslink.cn/o/1z39WqbiAAP'; // 「视频教程（跳转小红书）」外链模块，测试链接保留
const SAFETY_WARNING = '加片之前先加控制，冲重量之前先问教练';

/* M4：以下 4 个集合改为 var（挂 window）——store.js 启动时从后端拉配置原位替换内容，
   引用不变、下游零改动；无后端环境（GitHub Pages）保留此处内置默认值 */
var EQUIP_GROUPS = [
  { type: '胸部', items: [
    { id: 'chest_press',   name: '坐姿推胸器' },
    { id: 'pec_fly',       name: '蝴蝶机夹胸器' },
    { id: 'incline_press', name: '上斜卧推架' },
    { id: 'cable_crossover', name: '龙门架夹胸器' }
  ]},
  { type: '腿部', items: [
    { id: 'leg_press', name: '坐姿腿举机' },
    { id: 'leg_ext',   name: '腿屈伸训练器' },
    { id: 'leg_curl',  name: '俯卧腿弯举机' }
  ]},
  { type: '背部', items: [
    { id: 'lat_pull',     name: '坐姿高位下拉器械' },
    { id: 'straight_arm', name: '直臂下压训练器' },
    { id: 'cable_row',    name: '坐姿绳索划船器' }
  ]},
  { type: '手臂', items: [
    { id: 'cable_pushdown', name: '绳索下压训练器' }
  ]},
  { type: '多功能', items: [
    { id: 'smith_machine', name: '史密斯机' }
  ]}
];

/* 固定训练模板（单店写死，一期固定 5 部位 × 4 动作）
   equipId 必须存在于器械库，教学入口据此跳转器械详情页
   w = 每组默认重量 kg（V1.1 组次重量录入弹层预填值，前端按动作写死的演示配置） */
const PLAN_TEMPLATES = {
  '胸': [
    { action: '坐姿推胸', equipId: 'chest_press',    sets: 4, reps: 12, w: 40 },
    { action: '上斜推胸', equipId: 'smith_machine',  sets: 4, reps: 10, w: 30 },
    { action: '坐姿夹胸', equipId: 'pec_fly',         sets: 3, reps: 12, w: 25 },
    { action: '绳索夹胸', equipId: 'cable_crossover', sets: 3, reps: 15, w: 15 }
  ],
  '背': [
    { action: '高位下拉', equipId: 'lat_pull',   sets: 4, reps: 12, w: 40 },
    { action: '坐姿划船', equipId: 'cable_row',  sets: 4, reps: 12, w: 35 },
    { action: '直臂下压', equipId: 'straight_arm', sets: 3, reps: 15, w: 20 },
    { action: '反式飞鸟', equipId: 'pec_fly',     sets: 3, reps: 15, w: 15 }
  ],
  '腿': [
    { action: '腿举',     equipId: 'leg_press',     sets: 4, reps: 12, w: 80 },
    { action: '腿屈伸',   equipId: 'leg_ext',       sets: 3, reps: 15, w: 35 },
    { action: '腿弯举',   equipId: 'leg_curl',      sets: 3, reps: 15, w: 30 },
    { action: '史密斯深蹲', equipId: 'smith_machine', sets: 4, reps: 10, w: 40 }
  ],
  '肩': [
    { action: '坐姿推肩',   equipId: 'smith_machine',    sets: 4, reps: 12, w: 25 },
    { action: '绳索侧平举', equipId: 'cable_crossover',  sets: 3, reps: 15, w: 10 },
    { action: '反式飞鸟（后束）', equipId: 'pec_fly',    sets: 3, reps: 15, w: 10 },
    { action: '绳索前平举', equipId: 'cable_pushdown',   sets: 3, reps: 12, w: 10 }
  ],
  '手臂': [
    { action: '绳索下压（三头）', equipId: 'cable_pushdown',   sets: 3, reps: 15, w: 20 },
    { action: '反握下压',         equipId: 'cable_pushdown',   sets: 3, reps: 12, w: 15 },
    { action: '绳索弯举（二头）', equipId: 'cable_crossover',  sets: 3, reps: 15, w: 20 },
    { action: '锤式弯举',         equipId: 'cable_crossover',  sets: 3, reps: 12, w: 15 }
  ]
};

// 摊平器械库：统一补默认字段；guide 等可选字段测试期为空 → 详情页整块隐藏
var ALL_EQUIP = EQUIP_GROUPS.flatMap(g => g.items.map(it => ({
  type: g.type,
  muscle: '背部',
  videoUrl: VIDEO_TEST_URL,
  videoJump: VIDEO_JUMP_URL,
  safety: SAFETY_WARNING,
  guide: '', // 可选字段示例：为空则详情页不渲染该块
  ...it
})));

/* ===== M3 · 预约 / 我的（测试期写死数据） =====
   教练人名用项目固定虚拟人名（原型上的姓名仅为线框示例，不固化） */
var RESERVE_COACHES = [
  { id: 'c1', name: '田文镜', course: '力量训练课', tags: ['ACSM', '力量训练', '营养师资格证'] },
  { id: 'c2', name: '曹操',   course: '体能提升课', tags: ['ACSM', '体能提升', '动作指导'] }
];

var MINE_DATA = [ // 我的页面四宫格入口（M4：main/sub 可由后端 profile 覆盖，icon 前端注入）
  { title: '心率记录', main: '最近一次 72 次/分', sub: '记录日期 2026-10-11',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20v-7M11 20V5M17 20v-10M3 20h18"/></svg>' },
  { title: '体测记录', main: '体重 68.5 kg ／ 体脂 18.2%', sub: '体测日期 2026-10-08',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9.5a4.2 4.2 0 0 1 8 0"/><path d="M12 9.5l-1.6 2.4"/></svg>' },
  { title: '合同记录', main: '有效期至 2027 年 10 月 11 日', sub: '',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/></svg>' },
  { title: '请假记录', main: '剩余 12 天', sub: '',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M10 13l4 4M14 13l-4 4"/></svg>' }
];

/* 训练日志 / 最近运动摘要卡 演示数据（测试期写死）：以「今天-N 天」动态锚定生成，
   跨月/跨年滑动窗口自动正确。内容保留原三处记录并支撑状态四态演示：
   - rel(6) 教练课 田文镜·力量训练课（原 10/1）
   - rel(3) 教练课 曹操·体能提升课（原 10/10）
   - rel(2)/rel(1) 自由训练明细两天（背部连练两天 → 触发恢复建议）：
       高位下拉 4×40 → 5×40 = 进步；坐姿划船 4×35 → 3×35 = 退步；坐姿推胸 = 首次记录
   - rel(9) 窗口外历史一天：直臂下压 3×20 与 rel(2)/rel(1) 同重量同组数，凑足「停滞」三连判定 */
const DEMO_LOG_DAYS = (() => {
  const p = n => String(n).padStart(2, '0');
  const rel = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  return {
    [rel(9)]: {
      solo: [{ action: '直臂下压', sets: 3, weight: 20 }]
    },
    [rel(6)]: {
      coach: { name: '田文镜', course: '力量训练课' }
    },
    [rel(3)]: {
      coach: { name: '曹操', course: '体能提升课' }
    },
    [rel(2)]: {
      solo: [
        { action: '高位下拉', sets: 4, weight: 40 },
        { action: '坐姿划船', sets: 4, weight: 35 },
        { action: '直臂下压', sets: 3, weight: 20 }
      ]
    },
    [rel(1)]: {
      solo: [
        { action: '高位下拉', sets: 5, weight: 40 },
        { action: '坐姿划船', sets: 3, weight: 35 },
        { action: '直臂下压', sets: 3, weight: 20 },
        { action: '坐姿推胸', sets: 4, weight: 40 }
      ]
    }
  };
})();
