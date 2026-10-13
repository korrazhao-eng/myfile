/* 百度识图 AI 模型对接
   Key 统一放在本地私有文件 js/config.local.js（window.BAIDU_AI_KEYS，已 gitignore）；
   留空自动走 Mock 模式（返回模拟候选，不发起真实请求）。
   请求经本地 serve.py 的 /proxy/* 转发：百度接口无 CORS 头，浏览器无法直连；
   生产环境应改由后端代理（Key 不下发到前端）。 */
const BAIDU_AI = {
  API_KEY: (window.BAIDU_AI_KEYS && window.BAIDU_AI_KEYS.API_KEY) || '',
  SECRET_KEY: (window.BAIDU_AI_KEYS && window.BAIDU_AI_KEYS.SECRET_KEY) || '',
  TOKEN_URL: '/proxy/oauth/2.0/token',
  CLASSIFY_URL: '/proxy/rest/2.0/image-classify/v2/advanced_general'
};

/* 获取 access_token */
async function baiduGetToken() {
  const url = `${BAIDU_AI.TOKEN_URL}?grant_type=client_credentials`
    + `&client_id=${encodeURIComponent(BAIDU_AI.API_KEY)}`
    + `&client_secret=${encodeURIComponent(BAIDU_AI.SECRET_KEY)}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('token http ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || '获取 access_token 失败');
  return data.access_token;
}

/* 调用百度通用物体识别：入参 dataURL，返回 [{keyword, score(0-100)}] */
async function baiduRecognize(imageDataUrl) {
  const base64 = String(imageDataUrl).split(',')[1];
  if (!base64) throw new Error('图片数据无效');
  const token = await baiduGetToken();
  const res = await fetch(`${BAIDU_AI.CLASSIFY_URL}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // top_num=3：只让接口返回相似度靠前的前 3 个候选（配合下方 slice(0,3) 双保险）
    body: 'image=' + encodeURIComponent(base64) + '&top_num=3'
  });
  if (!res.ok) throw new Error('classify http ' + res.status);
  const data = await res.json();
  if (data.error_code) throw new Error(data.error_msg || ('识别失败 code ' + data.error_code));
  return (data.result || []).map(r => ({
    keyword: r.keyword || '',
    score: Math.round((r.score || 0) * 100)
  }));
}

/* 将百度返回的关键词映射到器械库：
   - 关键词与器械名做字符重叠匹配（≥2 个命中字才算映射成功，避免「健身器材」这类泛词误挂）；
   - 映射不上的关键词丢弃，视为「识别未命中」，由兜底列表承接 */
function mapBaiduResults(list) {
  const mapped = [];
  for (const r of list) {
    const kw = String(r.keyword || '').trim();
    if (!kw) continue;
    let best = null, bestHits = 0;
    for (const eq of ALL_EQUIP) {
      let hits = 0;
      for (const ch of new Set(kw)) if (eq.name.includes(ch)) hits++;
      if (bestHits < hits) { bestHits = hits; best = eq; }
    }
    if (best && bestHits >= 2 && !mapped.some(m => m.id === best.id)) {
      mapped.push({ ...best, sim: Math.min(99, r.score) });
    }
  }
  return mapped.sort((a, b) => b.sim - a.sim).slice(0, 3);
}
