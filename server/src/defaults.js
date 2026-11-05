'use strict';
/* 内置默认数据 —— 与旧模拟后端 serve.py 的 DEFAULTS 完全一致（由 serve.py 导出生成，勿手工改）
   用途：
   ① 首次启动（数据库为空且无存量 data/*.json）时播种各集合；
   ② equipments 读取时缺 muscles/subMuscles 字段 → 按内置默认表补全（幂等写回）。
   数据来源：gym-app/serve.py DEFAULTS / EQUIP_MUSCLES / EQUIP_SUB */

const EQUIP_MUSCLES = {
  "chest_press": [
    "胸大肌",
    "三角肌前束",
    "肱三头肌"
  ],
  "pec_fly": [
    "胸大肌",
    "三角肌前束"
  ],
  "incline_press": [
    "胸大肌",
    "三角肌前束",
    "肱三头肌"
  ],
  "cable_crossover": [
    "胸大肌",
    "三角肌前束",
    "腹肌"
  ],
  "leg_press": [
    "股四头肌",
    "臀大肌",
    "腘绳肌"
  ],
  "leg_ext": [
    "股四头肌"
  ],
  "leg_curl": [
    "腘绳肌"
  ],
  "lat_pull": [
    "背阔肌",
    "菱形肌",
    "斜方肌中下束"
  ],
  "straight_arm": [
    "背阔肌",
    "腹肌"
  ],
  "cable_row": [
    "背阔肌",
    "菱形肌",
    "斜方肌中下束"
  ],
  "cable_pushdown": [
    "肱三头肌"
  ],
  "smith_machine": [
    "股四头肌",
    "臀大肌",
    "三角肌前束"
  ]
};

const EQUIP_SUB = {
  "chest_press": [
    "肱三头肌"
  ],
  "pec_fly": [
    "三角肌前束"
  ],
  "incline_press": [
    "肱三头肌"
  ],
  "cable_crossover": [
    "三角肌前束"
  ],
  "leg_press": [
    "腘绳肌",
    "小腿"
  ],
  "leg_ext": [],
  "leg_curl": [
    "臀大肌"
  ],
  "lat_pull": [
    "肱二头肌",
    "前臂"
  ],
  "straight_arm": [],
  "cable_row": [
    "肱二头肌",
    "前臂"
  ],
  "cable_pushdown": [
    "前臂"
  ],
  "smith_machine": [
    "肱三头肌",
    "腘绳肌"
  ]
};

const DEFAULTS = {
  "coaches": [
    {
      "id": "c1",
      "name": "田文镜",
      "course": "力量训练课",
      "tags": [
        "ACSM",
        "力量训练",
        "营养师资格证"
      ]
    },
    {
      "id": "c2",
      "name": "曹操",
      "course": "体能提升课",
      "tags": [
        "ACSM",
        "体能提升",
        "动作指导"
      ]
    }
  ],
  "equipments": [
    {
      "id": "chest_press",
      "type": "胸部",
      "name": "坐姿推胸器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "胸大肌",
        "三角肌前束",
        "肱三头肌"
      ],
      "subMuscles": [
        "肱三头肌"
      ]
    },
    {
      "id": "pec_fly",
      "type": "胸部",
      "name": "蝴蝶机夹胸器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "胸大肌",
        "三角肌前束"
      ],
      "subMuscles": [
        "三角肌前束"
      ]
    },
    {
      "id": "incline_press",
      "type": "胸部",
      "name": "上斜卧推架",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "胸大肌",
        "三角肌前束",
        "肱三头肌"
      ],
      "subMuscles": [
        "肱三头肌"
      ]
    },
    {
      "id": "cable_crossover",
      "type": "胸部",
      "name": "龙门架夹胸器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "胸大肌",
        "三角肌前束",
        "腹肌"
      ],
      "subMuscles": [
        "三角肌前束"
      ]
    },
    {
      "id": "leg_press",
      "type": "腿部",
      "name": "坐姿腿举机",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "股四头肌",
        "臀大肌",
        "腘绳肌"
      ],
      "subMuscles": [
        "腘绳肌",
        "小腿"
      ]
    },
    {
      "id": "leg_ext",
      "type": "腿部",
      "name": "腿屈伸训练器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "股四头肌"
      ],
      "subMuscles": []
    },
    {
      "id": "leg_curl",
      "type": "腿部",
      "name": "俯卧腿弯举机",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "腘绳肌"
      ],
      "subMuscles": [
        "臀大肌"
      ]
    },
    {
      "id": "lat_pull",
      "type": "背部",
      "name": "坐姿高位下拉器械",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "背阔肌",
        "菱形肌",
        "斜方肌中下束"
      ],
      "subMuscles": [
        "肱二头肌",
        "前臂"
      ]
    },
    {
      "id": "straight_arm",
      "type": "背部",
      "name": "直臂下压训练器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "背阔肌",
        "腹肌"
      ],
      "subMuscles": []
    },
    {
      "id": "cable_row",
      "type": "背部",
      "name": "坐姿绳索划船器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "背阔肌",
        "菱形肌",
        "斜方肌中下束"
      ],
      "subMuscles": [
        "肱二头肌",
        "前臂"
      ]
    },
    {
      "id": "cable_pushdown",
      "type": "手臂",
      "name": "绳索下压训练器",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "肱三头肌"
      ],
      "subMuscles": [
        "前臂"
      ]
    },
    {
      "id": "smith_machine",
      "type": "多功能",
      "name": "史密斯机",
      "videoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      "videoJump": "https://xhslink.cn/o/1z39WqbiAAP",
      "safety": "加片之前先加控制，冲重量之前先问教练",
      "muscles": [
        "股四头肌",
        "臀大肌",
        "三角肌前束"
      ],
      "subMuscles": [
        "肱三头肌",
        "腘绳肌"
      ]
    }
  ],
  "users": [
    {
      "id": "u1",
      "nickname": "曹操",
      "phone": "13812345678",
      "memberNo": "U0946",
      "memberLevel": "年度会员",
      "visitAt": "2026-10-25 09:30",
      "coach": "田文镜",
      "heart": "最近一次 72 次/分（2026-10-11）",
      "body": "体重 68.5 kg ／ 体脂 18.2%（2026-10-08）",
      "contract": "有效期至 2027-10-11",
      "leave": "剩余 12 天"
    },
    {
      "id": "u2",
      "nickname": "田文镜",
      "phone": "15900112233",
      "visitAt": "2026-10-24 20:15",
      "coach": "",
      "heart": "最近一次 68 次/分（2026-10-24）",
      "body": "体重 75.0 kg ／ 体脂 20.1%（2026-10-20）",
      "contract": "有效期至 2026-12-01",
      "leave": ""
    }
  ],
  "profile": [
    {
      "title": "心率记录",
      "main": "最近一次 72 次/分",
      "sub": "记录日期 2026-10-11"
    },
    {
      "title": "体测记录",
      "main": "体重 68.5 kg ／ 体脂 18.2%",
      "sub": "体测日期 2026-10-08"
    },
    {
      "title": "合同记录",
      "main": "有效期至 2027 年 10 月 11 日",
      "sub": ""
    },
    {
      "title": "请假记录",
      "main": "剩余 12 天",
      "sub": ""
    }
  ],
  "logs": [],
  "lessons": [],
  "plans": [
    {
      "id": "back",
      "part": "背",
      "warmup": {
        "targets": "背阔肌、菱形肌、斜方肌中下束、三角肌后束、肩袖肌群",
        "method": "动态拉伸 + 轻重量器械试做",
        "standard": "背部微微发热、心率略升，手臂不发酸。"
      },
      "steps": [
        {
          "stage": "宽度构建",
          "action": "高位下拉（宽握）",
          "equipId": "lat_pull",
          "equipText": "高位下拉机",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 40,
          "focus": "背阔肌外侧",
          "detail": "身体微后仰15度，挺胸，手肘往腰间带；还原慢放3秒。",
          "rest": "90秒"
        },
        {
          "stage": "厚度雕刻",
          "action": "坐姿划船（窄握V把）",
          "equipId": "cable_row",
          "equipText": "坐姿划船机 + V把",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 35,
          "focus": "背阔肌、菱形肌、中斜方",
          "detail": "肩膀先下沉，手肘贴身体向后拉，顶峰肩胛骨夹紧1秒；不要用腰后甩。",
          "rest": "90秒"
        },
        {
          "stage": "单侧纠偏",
          "action": "单臂哑铃划船",
          "equipId": "cable_row",
          "equipText": "哑铃 + 平凳",
          "sets": 3,
          "reps": 12,
          "repsTxt": "3组 × 12次/侧",
          "w": 12,
          "focus": "背阔肌、菱形肌",
          "detail": "同侧手扶凳，背部平直；想象肘部去够后裤兜，弧线拉起，不耸肩。",
          "rest": "60秒"
        },
        {
          "stage": "下沿细节",
          "action": "直臂下压",
          "equipId": "straight_arm",
          "equipText": "龙门架绳索",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 20,
          "focus": "背阔肌下沿",
          "detail": "手臂微屈固定，朝大腿方向下压，顶峰停1秒；不要变成三头下压。",
          "rest": "60秒"
        },
        {
          "stage": "体态复位",
          "action": "龙门架面拉",
          "equipId": "cable_crossover",
          "equipText": "龙门架绳索（滑轮略高于眉头）",
          "sets": 3,
          "reps": 20,
          "repsTxt": "3组 × 20次",
          "w": 5,
          "focus": "三角肌后束、菱形肌、中下斜方、肩袖",
          "detail": "双手向后拉的同时向耳朵两侧分开，手肘不低于肩膀，肩胛骨夹紧；不要身体后仰借力。",
          "rest": "60秒"
        }
      ],
      "stretch": [
        {
          "action": "双手抓龙门架柱，身体下压",
          "target": "拉伸背阔肌",
          "time": "每侧30秒"
        },
        {
          "action": "坐姿弓背抱膝",
          "target": "拉伸中下斜方、下背",
          "time": "30秒"
        },
        {
          "action": "手臂横过胸前",
          "target": "拉伸三角肌后束",
          "time": "每侧30秒"
        }
      ]
    },
    {
      "id": "chest",
      "part": "胸",
      "warmup": {
        "targets": "胸大肌、三角肌前束、肩袖肌群",
        "method": "动态拉伸 + 轻重量器械试做",
        "standard": "胸部微微发热、心率略升，但不要做到手臂发酸。"
      },
      "steps": [
        {
          "stage": "宽度构建（大重量复合）",
          "action": "上斜卧推（杠铃）",
          "equipId": "incline_press",
          "equipText": "上斜卧推架 + 杠铃",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 30,
          "focus": "胸大肌上部、三角肌前束（决定上胸厚度，改善胸型轮廓）",
          "detail": "肩胛骨后收下沉，杠铃下放到锁骨一线，手肘约45度；推起不耸肩，腰部不过度反弓。",
          "rest": "90秒"
        },
        {
          "stage": "厚度雕刻（大重量复合）",
          "action": "坐姿推胸（水平）",
          "equipId": "chest_press",
          "equipText": "坐姿推胸器",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 40,
          "focus": "胸大肌中束、三角肌前束、肱三头（决定胸部整体厚度）",
          "detail": "背部贴紧靠垫，双手略宽于肩，推至手肘微屈不完全锁死；还原慢放3秒，感受胸肌离心发力。",
          "rest": "90秒"
        },
        {
          "stage": "单侧纠偏（左右平衡）",
          "action": "蝴蝶机夹胸（单臂依次）",
          "equipId": "pec_fly",
          "equipText": "蝴蝶机夹胸器",
          "sets": 3,
          "reps": 12,
          "repsTxt": "3组 × 12次/侧",
          "w": 25,
          "focus": "胸大肌中缝与外侧（纠正左右力量不平衡）",
          "detail": "把手调至与肩同高，单臂依次完成；手肘微屈固定，想象用肘部去抱合，顶峰停1秒，不要耸肩借力。",
          "rest": "60秒"
        },
        {
          "stage": "中缝细节（单关节雕刻）",
          "action": "龙门架绳索夹胸",
          "equipId": "cable_crossover",
          "equipText": "龙门架绳索（滑轮略高于肩）",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 15,
          "focus": "胸大肌中缝、下沿（让中缝更深、下胸轮廓更清晰）",
          "detail": "身体微前倾固定，手臂微屈呈弧线向内向下合拢于腹前，顶峰停1秒；不要做成推的动作。",
          "rest": "60秒"
        },
        {
          "stage": "体态复位（平衡推类负荷）",
          "action": "龙门架面拉",
          "equipId": "cable_crossover",
          "equipText": "龙门架绳索（滑轮略高于眉头）",
          "sets": 3,
          "reps": 20,
          "repsTxt": "3组 × 20次（轻重量）",
          "w": 5,
          "focus": "三角肌后束、菱形肌、中下斜方、肩袖（平衡练胸推量，防止圆肩驼背）",
          "detail": "双手向额头两侧拉开，手肘不低于肩膀，肩胛骨夹紧；不要用身体后仰借力。",
          "rest": "60秒"
        }
      ],
      "stretch": [
        {
          "action": "门框胸部拉伸",
          "target": "拉伸胸大肌、三角肌前束",
          "time": "每侧30秒"
        },
        {
          "action": "猫式展背",
          "target": "拉伸胸椎、放松胸小肌",
          "time": "30秒"
        },
        {
          "action": "手臂横过胸前",
          "target": "拉伸三角肌后束、肩部外侧",
          "time": "每侧30秒"
        }
      ]
    },
    {
      "id": "leg",
      "part": "腿",
      "warmup": {
        "targets": "臀大肌、臀中肌、股四头肌、腘绳肌、小腿稳定肌群",
        "method": "动态拉伸 + 轻重量器械试做",
        "standard": "臀部和大腿微微发热，膝盖无压力感。"
      },
      "steps": [
        {
          "stage": "臀主导（对膝盖最友好，优先练）",
          "action": "杠铃/哑铃臀推",
          "equipId": "smith_machine",
          "equipText": "臀推机 或 杠铃+平凳",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 30,
          "focus": "臀大肌（翘臀核心）",
          "knee": "膝盖角度固定，剪切力小；膝盖始终对准脚尖，不内扣",
          "detail": "下巴微收，用臀部顶起，顶峰夹紧2秒；不要用腰过度反弓。",
          "rest": "90秒"
        },
        {
          "stage": "臀主导（对膝盖最友好，优先练）",
          "action": "罗马尼亚硬拉（RDL）",
          "equipId": "smith_machine",
          "equipText": "哑铃或杠铃",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 12次",
          "w": 25,
          "focus": "腘绳肌+臀大肌",
          "knee": "膝盖几乎不屈曲，靠髋关节铰链",
          "detail": "屁股向后推，背部挺直，感受大腿后侧拉伸；膝盖微屈固定，不来回晃。",
          "rest": "90秒"
        },
        {
          "stage": "股四头肌（小角度、器械辅助）",
          "action": "坐姿腿屈伸（下半程）",
          "equipId": "leg_ext",
          "equipText": "坐姿腿屈伸机",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 20,
          "focus": "股四头肌",
          "knee": "只做下半程——从伸直位下放到约45度就停，不做到最大屈膝",
          "detail": "轻重量，顶峰收缩1秒，慢放3秒；膝盖不锁死。",
          "rest": "60秒"
        },
        {
          "stage": "股四头肌（小角度、器械辅助）",
          "action": "靠墙静蹲（浅角度）",
          "equipId": "",
          "equipText": "墙面",
          "sets": 3,
          "reps": 30,
          "repsTxt": "3组 × 30秒",
          "w": 0,
          "focus": "股四头肌+臀",
          "knee": "角度不超过60度，膝盖不超过脚尖",
          "detail": "背部贴墙，膝盖对准脚尖方向，不内扣；有不适立刻起身。",
          "rest": "60秒"
        },
        {
          "stage": "臀中肌+腘绳肌（稳定膝盖的关键）",
          "action": "弹力带蚌式开合",
          "equipId": "",
          "equipText": "弹力带+瑜伽垫",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次/侧",
          "w": 0,
          "focus": "臀中肌（稳定膝盖轨迹）",
          "knee": "无膝盖压力",
          "detail": "侧躺，膝盖弯曲，脚跟并拢，用臀中肌打开膝盖；骨盆不后翻。",
          "rest": "45秒"
        },
        {
          "stage": "臀中肌+腘绳肌（稳定膝盖的关键）",
          "action": "俯卧腿弯举（器械）",
          "equipId": "leg_curl",
          "equipText": "俯卧腿弯举机",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 25,
          "focus": "腘绳肌",
          "knee": "膝盖屈曲但无负重压迫；若不适可换弹力带俯卧腿弯举",
          "detail": "慢放3秒，不靠惯性甩；重量宁轻勿重。",
          "rest": "60秒"
        }
      ],
      "stretch": [
        {
          "action": "站姿抓脚踝拉股四头肌",
          "target": "拉伸大腿前侧",
          "time": "每侧30秒"
        },
        {
          "action": "坐姿体前屈",
          "target": "拉伸腘绳肌",
          "time": "30秒"
        },
        {
          "action": "仰卧4字拉伸",
          "target": "拉伸臀部",
          "time": "每侧30秒"
        },
        {
          "action": "小腿靠墙拉伸",
          "target": "放松小腿",
          "time": "每侧30秒"
        }
      ]
    },
    {
      "id": "shoulder",
      "part": "肩",
      "warmup": {
        "targets": "三角肌前中后束、肩袖肌群",
        "method": "动态拉伸 + 轻重量器械试做",
        "standard": "肩关节活动开，三角肌微微发热，无耸肩代偿。"
      },
      "steps": [
        {
          "stage": "复合推举",
          "action": "坐姿哑铃推举",
          "equipId": "",
          "equipText": "可调凳 + 哑铃",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 10-12次",
          "w": 15,
          "focus": "三角肌前束、中束",
          "detail": "坐直靠背，手肘始终朝前，推到顶手臂微屈不锁死；全程沉肩。",
          "rest": "90秒"
        },
        {
          "stage": "中束塑形",
          "action": "哑铃侧平举",
          "equipId": "",
          "equipText": "哑铃",
          "sets": 4,
          "reps": 15,
          "repsTxt": "4组 × 15次",
          "w": 5,
          "focus": "三角肌中束",
          "detail": "手肘先启动，想象往两侧倒水，抬至与肩同高即停；全程沉肩，不耸肩。",
          "rest": "60秒"
        },
        {
          "stage": "后束强化",
          "action": "俯身哑铃飞鸟",
          "equipId": "",
          "equipText": "哑铃",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 5,
          "focus": "三角肌后束",
          "detail": "俯身至躯干接近平行地面，手肘微屈，向两侧打开至与背部平行；不甩重量。",
          "rest": "60秒"
        },
        {
          "stage": "体态复位",
          "action": "龙门架面拉",
          "equipId": "cable_crossover",
          "equipText": "龙门架绳索（滑轮略高于眉头）",
          "sets": 3,
          "reps": 20,
          "repsTxt": "3组 × 20次",
          "w": 5,
          "focus": "三角肌后束、菱形肌、中下斜方、肩袖",
          "detail": "向后拉的同时向耳朵两侧分开，手肘不低于肩膀，肩胛骨夹紧；不后仰借力。",
          "rest": "60秒"
        }
      ],
      "stretch": [
        {
          "action": "手臂横过胸前",
          "target": "拉伸三角肌后束",
          "time": "每侧30秒"
        },
        {
          "action": "手臂下垂外旋拉伸",
          "target": "拉伸三角肌前束",
          "time": "每侧30秒"
        },
        {
          "action": "颈后轻拉肘",
          "target": "拉伸三角肌中束",
          "time": "每侧30秒"
        }
      ]
    },
    {
      "id": "arm",
      "part": "手臂",
      "warmup": {
        "targets": "肱三头肌、肱二头肌、前臂肌群、肘腕关节",
        "method": "动态拉伸 + 轻重量器械试做",
        "standard": "手臂微微发热，肘腕无压力感。"
      },
      "steps": [
        {
          "stage": "三头肌复合",
          "action": "哑铃颈后臂屈伸",
          "equipId": "",
          "equipText": "哑铃 + 坐姿凳",
          "sets": 4,
          "reps": 12,
          "repsTxt": "4组 × 10-12次",
          "w": 15,
          "focus": "肱三头肌长头",
          "detail": "大臂全程贴紧耳朵固定，只弯伸肘关节；下放感受三头拉伸，推起不锁死。",
          "rest": "90秒"
        },
        {
          "stage": "三头肌孤立",
          "action": "龙门架绳索下压",
          "equipId": "cable_pushdown",
          "equipText": "龙门架绳索",
          "sets": 4,
          "reps": 15,
          "repsTxt": "4组 × 15次",
          "w": 15,
          "focus": "肱三头肌外侧头",
          "detail": "大臂夹紧肋骨固定，下压到底时双手向外旋转；不耸肩、不甩肩。",
          "rest": "60秒"
        },
        {
          "stage": "二头肌长头",
          "action": "坐姿哑铃交替弯举",
          "equipId": "",
          "equipText": "哑铃 + 坐姿凳",
          "sets": 3,
          "reps": 12,
          "repsTxt": "3组 × 12次/侧",
          "w": 12,
          "focus": "肱二头肌长头",
          "detail": "坐姿防借力，手腕保持中立，顶峰收缩1秒；下放保持微屈不锁死。",
          "rest": "60秒"
        },
        {
          "stage": "肱肌与侧面线条",
          "action": "哑铃锤式弯举",
          "equipId": "",
          "equipText": "哑铃",
          "sets": 3,
          "reps": 15,
          "repsTxt": "3组 × 15次",
          "w": 10,
          "focus": "肱肌",
          "detail": "掌心相对，大臂贴紧身体，弯举至胸前；慢放3秒，不靠惯性。",
          "rest": "60秒"
        },
        {
          "stage": "前臂收尾",
          "action": "哑铃正握腕弯举",
          "equipId": "",
          "equipText": "哑铃 + 平凳",
          "sets": 2,
          "reps": 20,
          "repsTxt": "2组 × 20次",
          "w": 5,
          "focus": "前臂屈肌群",
          "detail": "前臂放腿上，手腕悬空，正手握哑铃做腕屈伸；动作慢，不甩。",
          "rest": "45秒"
        }
      ],
      "stretch": [
        {
          "action": "举臂摸对侧后背",
          "target": "拉伸肱三头肌",
          "time": "每侧30秒"
        },
        {
          "action": "手臂后伸外旋、手掌贴墙",
          "target": "拉伸肱二头肌",
          "time": "每侧30秒"
        },
        {
          "action": "前臂伸直、掌心向上轻拉手指",
          "target": "拉伸前臂屈肌",
          "time": "每侧30秒"
        }
      ]
    }
  ]
};

module.exports = { EQUIP_MUSCLES, EQUIP_SUB, DEFAULTS };
