/**
 * ============================================================================
 * dsh-glass-ranswork 宿主半侧（host half）—— 「自定义主题」的持久化后端
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件运行在 DSH 的 Node 服务端（不是浏览器）。它只做一件事：把自定义主题
 *   的设置（不透明度 / 模糊 / 饱和度 / 氛围光 / 配色）持久化到磁盘，并通过
 *   HTTP 路由给浏览器半侧读写。
 *
 * 【为什么需要它】
 *   DSH 的 `ctx.theme.setTheme()` 只持久化内置偏好（light / dark / system），
 *   第三方主题 id 是「进程内扩展」，刷新页面就丢。所以本插件自己存一份设置：
 *     - 浏览器半侧启动时 GET 一次，恢复上次的外观；
 *     - 用户在设置页改动时 POST 回来。
 *   存储位置：`$DSH_HOME/glass-theme.json`（一个纯 JSON 文件，坏了大不了删掉）。
 *
 * 【路由表】
 *   GET    /glass-theme/settings    读取当前设置（缺失字段用默认值补齐）
 *   POST   /glass-theme/settings    合并写入（body 是 { ...要改的字段 }）
 *   GET    /glass-theme/background/<token>  读取用户自定义的背景图片（原样回传二进制）
 *   POST   /glass-theme/background          上传背景图片（body 是原始图片字节）
 *   DELETE /glass-theme/background          删除背景图片并把 bgImage 清空
 *
 *   三条共用**同一个 prefix 路由**：GET 的路径段里带换图 token（缓存策略），
 *   POST / DELETE 用不带 token 的路径。
 *
 * 【背景图为什么单独走一条路由，而不是塞进设置 JSON】
 *   设置文件会被整体读写（每次改动都重写一遍），把几 MB 的 data URL 放进去
 *   会让每次拖滑块都写一遍大文件，localStorage 镜像也会跟着爆掉。
 *   所以图片单独落盘成 `$DSH_HOME/glass-theme-bg.<ext>`，设置里只存一个
 *   **短 token**（bgImage），浏览器用 `/glass-theme/background?v=<token>`
 *   取图：token 一变 URL 就变，天然绕开缓存，旧图也就不用留着。
 *
 * 【设计取舍】
 *   写入走「临时文件 + rename」的原子替换，避免写一半断电留下半个 JSON。
 *   所有数值在**服务端**再夹一次范围——浏览器半侧的滑块只是 UI，边界值由这里
 *   说了算（和 DSH 官方「model-authored callers 要在边界校验」的口径一致）。
 *
 * ============================================================================
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 插件行 id（与 cordis.patch.yml 一致），也是 loader 诊断里的名字。 */
export const name = 'glass-theme';

/**
 * 需要注入的宿主服务（硬依赖）：webServer —— 注册 /glass-theme/settings 路由。
 * 设置存储由本插件自己落盘，不依赖 settings 服务，所以只注入这一个。
 */
export const inject = ['webServer'];

/** 路由路径（exact：GET 与 POST 共用同一个 handler）。 */
const ROUTE_PATH = '/glass-theme/settings';

/** 背景图路由：GET 取图 / POST 上传 / DELETE 删除。 */
const BACKGROUND_PATH = '/glass-theme/background';

/** 版本 / 更新检查路由（设置页顶部显示当前版本，并静默比对一次最新版）。 */
const VERSION_PATH = '/glass-theme/version';

/** npm 包名（`package.json` 与市场身份用；更新检查已不再问 registry，见下）。 */
const PACKAGE_NAME = 'dsh-glass-ranswork';

/** GitHub 仓库（`owner/name`）—— 更新检查的唯一来源。 */
const UPDATE_REPO = 'rans725/dsh-glass-ranswork';

/** 更新检查结果的缓存时长：6 小时。设置页不是仪表盘，不必每次打开都问。 */
const UPDATE_TTL = 6 * 60 * 60 * 1000;

/** 检查失败后的重试间隔：10 分钟。避免离线时每个请求都白等一个超时。 */
const UPDATE_RETRY = 10 * 60 * 1000;

/** 单次远端检查的超时（毫秒）。超时就静默放弃，不能拖慢设置页。 */
const UPDATE_TIMEOUT = 2500;

/**
 * 依次尝试的更新检查地址。
 *
 * 为什么问 GitHub Releases 而不是 npm：本包**没有发布到 npm**（作者不走 npm 账号），
 * registry 上永远是 404；GitHub 的 tag / Release 才是真正发布的那个地方。
 * 注意 api.github.com 的匿名限速是 60 次/小时/IP，所以缓存必须留着（UPDATE_TTL）。
 *
 * 官方优先；国内网络下 `latest-1` 这个数字镜像通常更快。两个都失败就当作
 * 「不知道」，绝不把网络错误弹给用户。
 */
const UPDATE_SOURCES = [
  { label: 'github', url: `https://api.github.com/repos/${UPDATE_REPO}/releases/latest` },
  { label: 'mirror', url: `https://github.com/${UPDATE_REPO}/releases/latest/download/version.json` },
];

/**
 * 在响应里找出「最新版本号」。
 *
 * - GitHub Release 的 JSON：`tag_name`
 * - 镜像上的 `version.json`：`version`
 *
 * 两边都按「先认 tag_name，再认 version」的顺序取，不依赖 label ——
 * 静态文件万一被换成一个 GitHub Release 的 JSON，也照样能读。
 *
 * @returns 版本号字符串（去掉前缀 v），认不出来就是 ''。
 */
function pickVersion(data) {
  if (data === null || typeof data !== 'object') return '';
  for (const raw of [data.tag_name, data.version]) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim().replace(/^v/i, '');
    if (/^\d+\.\d+\.\d+/.test(value)) return value;
  }
  return '';
}

/**
 * 比较两个 `x.y.z` 版本号（只比数字段，够用）。
 *
 * @returns 负数表示 a 更旧，0 表示相等，正数表示 a 更新。
 */
function compareVersions(a, b) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 设置请求体上限（64 KiB）。这里只有几个数字和布尔，正常不到 1 KiB。 */
const BODY_LIMIT = 64 << 10;

/**
 * 背景图请求体上限（24 MiB）。
 *
 * 浏览器半侧上传前会先按长边 3840 压缩成 WebP，正常在 1–4 MiB；
 * 这里的上限只是防呆（防止有人直接 POST 一个巨型文件把内存打满），
 * 不是正常的尺寸预算。
 */
const BACKGROUND_LIMIT = 24 << 20;

/**
 * 允许的背景图类型 → 落盘扩展名。
 *
 * 只认图片：这个路径写的是 `$DSH_HOME` 下的固定文件名，不能让它变成
 * 「往主目录写任意文件」的通道。content-type 由浏览器按 Blob.type 给出，
 * 不可伪造到别的用途上也只会写成一个图片后缀的文件。
 */
const IMAGE_EXT_BY_TYPE = Object.freeze({
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
});

/** 扩展名 → 响应 content-type（读图时用）。 */
const MIME_BY_EXT = Object.freeze({
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
});

/** 背景图在磁盘上的固定文件名（前缀），同一时间只保留一张。 */
const BACKGROUND_STEM = 'glass-theme-bg';

/** 允许的显示方式 —— 与浏览器半侧的 FIT_MODES 必须一致。 */
const FIT_MODES = Object.freeze(['cover', 'contain', 'stretch', 'tile', 'center']);

/** 内置的明暗偏好（自动明暗只会在这三个之间切）。 */
const THEME_PREFERENCES = Object.freeze(['light', 'dark', 'system']);

/** 裁剪区域的最小边长（占原图比例）。比 5% 更小的框在 UI 上无法再拖大。 */
const CROP_MIN = 0.05;

/**
 * 设置默认值 —— 也是「80% 半透明」这个主题的出厂状态。
 *
 * 【口径说明：opacity 是「不透明度」，不是「透明度」】
 *   opacity = 20  →  表面 20% 不透明 = 80% 半透明  ← 本主题的默认值
 *   opacity = 100 →  表面完全不透明（等于关掉玻璃）
 *   用户说的「80% 半透明」= 透明度 80% = 不透明度 20%，所以默认是 20。
 *
 * 【为什么下限是 0 而不是 40】
 *   初版把下限设在 40（最多只能 60% 半透明），等于替用户决定了「再透就没法看」。
 *   但那是个越权的护栏：透明度上限该由用户自己顶到 0，可读性由「氛围光 + 模糊」
 *   兜底，而不是靠不许调。所以这里放开到 0。
 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  opacity: 20,
  // 「信息面板」的不透明度：与表面分开调。
  // 为什么必须分开：面板（文件预览、费用/会话统计弹层、浮层菜单）是**要读字**的
  // 地方，和背景装饰不是一个可读性预算。默认 85% 不透明 = 只透一点点氛围光，
  // 保证正文与表格不发灰；用户仍可一路拉到 0 让面板彻底玻璃化。
  panelOpacity: 85,
  blur: 32,
  // 浮层（弹层 / 已归档面板 / 费用面板 / Modal）的模糊半径。
  // 与 blur 分开：blur 管三列骨架，浮层要单独调 —— 浮层面积小、离正文近，
  // 半径过大会让边缘发虚，用户需要独立一档来兼顾"糊得掉背景"与"看得清字"。
  overlayBlur: 32,
  // 发送框（composer）与任务卡片（任务看板内部卡片）的模糊半径。
  // 默认比浮层低（24）：输入框就在正文旁边、字是正在打的，
  // 半径过大反而让输入的字看着发飘。
  composerBlur: 24,
  // 文件预览 / 改动卡片（文件 diff、已编辑文件卡、文档预览）的底色不透明度。
  // 为什么要独立一档：这几处要读代码，用户把「表面 / 面板」调低之后它们会
  // 跟着糊掉；为了看清 diff 去拉高面板，又会把整个界面一起变实。所以给它们
  // 自己的百分比，拉高只影响这几处。
  previewOpacity: 85,
  saturate: 180,
  ambient: true,
  accent: 'aurora',

  // ---- 自定义背景图片（2026-10 新增）----
  /**
   * 背景图 token：空串 = 没有背景图。
   *
   * 它是 `/glass-theme/background?v=<token>` 的缓存键，**不是**文件名。
   * 每次上传换一个新值 → URL 变 → 浏览器不会拿旧图；图片本体固定落在
   * `$DSH_HOME/glass-theme-bg.<ext>`（同一时间只留一张）。
   */
  bgImage: '',
  /** 显示方式：cover 填充 / contain 适应 / stretch 拉伸 / tile 平铺 / center 居中。 */
  bgFit: 'cover',
  /** 自定义裁剪区域，单位是「占原图的比例」，全图 = { x:0, y:0, w:1, h:1 }。 */
  bgCrop: Object.freeze({ x: 0, y: 0, w: 1, h: 1 }),
  /**
   * 背景蒙层不透明度 %。
   *
   * 和桌面壁纸不同，这里盖的是「与明暗同向的雾」：浅色主题盖白、深色盖黑。
   * 玻璃表面只有 20% 不透明时，一张照片会让文字彻底读不了，所以默认 30。
   */
  bgDim: 30,
  /**
   * 文字保护：设了背景图后，给文字加一圈「与明暗同向」的光晕。
   *
   * 为什么不是「把表面调实」：用户可能把表面不透明度压到个位数、把模糊调到 0
   * （就是为了看清壁纸），自动加白底会直接违背他的设置。光晕只作用在**字**
   * 周围，不占任何底色，所以在完全不透明的照片上也能把字「抬」出来。
   * 默认开；不喜欢光晕的用户可以关掉。
   */
  bgGuard: true,
  /**
   * 自动明暗：按背景图（裁剪后）的平均亮度自动切换 light / dark 主题。
   *
   * 为什么需要：文字颜色是跟随主题模式的（浅色主题=深字、深色主题=浅字），
   * 而**壁纸的明暗和主题模式无关**。用户换成一张暗色壁纸后，深色字压在
   * 暗图上就完全看不清 —— 光晕和加深 token 都救不了「方向错了」。
   * 所以这里测出图片亮度：偏暗 → 切深色主题（字变浅、面板变暗），
   * 偏亮 → 切回浅色。用户原来的明暗偏好会被记住，关掉/换图时还原。
   */
  bgAutoTone: true,
  /**
   * 自动切换前的用户明暗偏好（''=没有切过）。
   *
   * 为什么要落盘：setTheme 会写用户设置；只在内存里记「原来的模式」的话，
   * 重启后用户删掉壁纸，主题会永远停在我们切的深色。所以把原偏好存进设置，
   * 删图/关开关时再还原。只接受 light / dark / system。
   */
  bgBaseTheme: '',
  /**
   * 上传时算好的 32×32 亮度图（base64，1024 字节）。
   *
   * 浏览器端在「选择图片」时就把亮度图算好存进来；自动明暗只需要按裁剪
   * 区域查表求平均，不必在页面里重新解码图片、也不会受 canvas 跨源限制影响。
   * 空串 = 旧图（还没算过），浏览器端会退回「现量」。
   */
  bgLumaGrid: '',
});

/** 允许的氛围光配色 id（浏览器半侧的调色板必须落在这个集合里）。 */
const ACCENTS = Object.freeze(['aurora', 'ocean', 'sunset', 'mono']);

/** 数值字段的合法区间；越界一律夹回边界，而不是报错（滑块抖动不该 400）。 */
const RANGES = Object.freeze({
  opacity: [0, 100],
  panelOpacity: [0, 100],
  blur: [0, 80],
  overlayBlur: [0, 80],
  composerBlur: [0, 80],
  previewOpacity: [0, 100],
  saturate: [100, 200],
  bgDim: [0, 100],
});

/** bgImage token 的形状：只允许 URL 安全字符，防止被拼进路径或响应头。 */
const BG_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 把任意输入规范成一个合法的裁剪区域。
 *
 * 规则：x/y/w/h 都夹到 [0,1]；w/h 不小于 `CROP_MIN`；框不能越出图片右/下边界
 * （越界时保持宽高、把左上角往回推，而不是把框压扁 —— 用户看到的是
 * 「框被挡在边上停住」，和桌面裁剪工具的手感一致）。
 *
 * @param input - 任意输入（可能是 undefined / 字符串 / 半个对象）。
 * @param fallback - 完全无法解析时使用的基础值。
 * @returns 新的 { x, y, w, h }（永远是新对象，避免和 DEFAULTS 共享引用）。
 */
export function normalizeCrop(input, fallback = { x: 0, y: 0, w: 1, h: 1 }) {
  const source = input !== null && typeof input === 'object' ? input : {};
  const base = fallback !== null && typeof fallback === 'object' ? fallback : {};
  const number = (value, alternate) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : alternate;
  };
  const unit = (value) => Math.min(1, Math.max(0, value));
  const round = (value) => Math.round(value * 10000) / 10000;
  const w = Math.min(1, Math.max(CROP_MIN, unit(number(source.w, number(base.w, 1)))));
  const h = Math.min(1, Math.max(CROP_MIN, unit(number(source.h, number(base.h, 1)))));
  const x = Math.min(round(1 - w), Math.max(0, unit(number(source.x, number(base.x, 0)))));
  const y = Math.min(round(1 - h), Math.max(0, unit(number(source.y, number(base.y, 0)))));
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** 把任意输入压成一句人话。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 解析 DSH 主目录（$DSH_HOME，默认 ~/.dsh）。
 *
 * 优先用官方 `@deepseek-ai/dsh-home-paths`；万一解析不到（老版本/裁剪发行），
 * 退回环境变量与 `~/.dsh`，保证插件在任何组合里都能落盘。
 *
 * @returns DSH 主目录的绝对路径。
 */
async function resolveHome() {
  try {
    const mod = await import('@deepseek-ai/dsh-home-paths');
    if (mod !== null && typeof mod.resolveDshHome === 'function') {
      const home = mod.resolveDshHome();
      if (typeof home === 'string' && home.length > 0) return home;
    }
  } catch {
    // 官方包不在解析路径里：走下面的兜底
  }
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return join(homedir(), '.dsh');
}

/** 把任意字段夹成合法整数；非有限数一律退回 fallback。 */
function clampInt(value, [min, max], fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/**
 * 把任意外部输入规范成一份完整、合法的设置。
 *
 * 缺失字段保留 `base` 里的值（而不是硬退回默认值），这样 POST 可以只发一个字段。
 *
 * @param input - 来自磁盘或 HTTP 的未知数据。
 * @param base - 缺字段时的取值来源。
 * @returns 完整的设置对象。
 */
export function normalize(input, base = DEFAULTS) {
  const source = input !== null && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const fallback = base[key] !== undefined ? base[key] : DEFAULTS[key];
    const raw = source[key];
    if (key === 'enabled' || key === 'ambient' || key === 'bgGuard' || key === 'bgAutoTone') {
      out[key] = typeof raw === 'boolean' ? raw : fallback;
      continue;
    }
    if (key === 'accent') {
      out[key] = typeof raw === 'string' && ACCENTS.includes(raw) ? raw : fallback;
      continue;
    }
    if (key === 'bgImage') {
      // 空串是合法值（= 没有背景图）；其余只接受 URL 安全的短 token。
      out[key] = typeof raw === 'string' && (raw.length === 0 || BG_TOKEN.test(raw)) ? raw : fallback;
      continue;
    }
    if (key === 'bgFit') {
      out[key] = typeof raw === 'string' && FIT_MODES.includes(raw) ? raw : fallback;
      continue;
    }
    if (key === 'bgBaseTheme') {
      // 空串 = 没有切过。partial POST 不带这个键时必须保住 base 里的值，
      // 否则一次只改 opacity 的写入就会把「切换前模式」抹掉。
      out[key] = typeof raw === 'string' && THEME_PREFERENCES.includes(raw)
        ? raw
        : (typeof fallback === 'string' && THEME_PREFERENCES.includes(fallback) ? fallback : '');
      continue;
    }
    if (key === 'bgLumaGrid') {
      // 32×32 亮度图的 base64：只认合法字符与长度，空串表示「没有」。
      const keep = typeof fallback === 'string' && /^[A-Za-z0-9+/=]{0,4096}$/.test(fallback) ? fallback : '';
      out[key] = raw === '' ? '' : (typeof raw === 'string' && /^[A-Za-z0-9+/=]{64,4096}$/.test(raw) ? raw : keep);
      continue;
    }
    if (key === 'bgCrop') {
      out[key] = normalizeCrop(raw, normalizeCrop(fallback));
      continue;
    }
    out[key] = clampInt(raw, RANGES[key], fallback);
  }
  return out;
}

/**
 * 统一的 JSON 响应（no-store：设置必须每次都是实时的）。
 *
 * @param res - HTTP 响应对象。
 * @param status - HTTP 状态码。
 * @param payload - 将被序列化的 JSON 负载。
 */
function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/**
 * 读完整请求体（二进制），超过上限直接抛错。
 *
 * @param req - HTTP 请求对象。
 * @param limit - 字节上限。
 * @returns 请求体 Buffer。
 */
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * 读完整请求体并解析成 JSON。空体按空对象处理。
 *
 * @param req - HTTP 请求对象。
 * @returns 解析后的 JSON 值。
 */
async function readJsonBody(req) {
  const text = (await readBody(req, BODY_LIMIT)).toString('utf8').trim();
  if (text.length === 0) return {};
  return JSON.parse(text);
}

/**
 * 写入前的来源信任检查（挡 CSRF）。
 *
 * 复用 DSH 官方的 Connection 检查；拿不到 connection 服务或检查本身出错时一律
 * 放行——本插件写的是一个偏好文件，不值得为了一个校验失败把功能变成不可用。
 *
 * @param ctx - 宿主插件上下文。
 * @param req - HTTP 请求对象。
 * @returns 拒绝时的状态码；放行时返回 undefined。
 */
function rejectionOf(ctx, req) {
  const connection = ctx.get('connection');
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined;
  try {
    return connection.requestRejection({ headers: req.headers });
  } catch {
    return undefined;
  }
}

/**
 * 插件主体：注册 `/glass-theme/settings` 路由，读写 `$DSH_HOME/glass-theme.json`。
 *
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  /** 设置文件路径；首次访问时懒解析，避免 apply() 里做异步 IO。 */
  let filePath;
  /** 内存中的当前设置：磁盘读取后作为缓存，避免每次 GET 都读盘。 */
  let cache = null;
  /** 写入串行化：一次只跑一个，避免两次快速改动交错覆盖。 */
  let tail = Promise.resolve();

  /** 本包版本（从同目录的 package.json 读；读不到就空串，设置页不显示）。 */
  let ownVersion;

  /** 读本包版本（只读一次，失败也缓存，避免每次请求都碰磁盘）。 */
  const versionOf = async () => {
    if (ownVersion !== undefined) return ownVersion;
    try {
      const text = await readFile(new URL('./package.json', import.meta.url), 'utf8');
      const parsed = JSON.parse(text);
      ownVersion = typeof parsed.version === 'string' ? parsed.version : '';
    } catch {
      ownVersion = '';
    }
    return ownVersion;
  };

  /** 远端最新版缓存：at = 上次成功检查的时间戳，value = 版本号（'' = 还不知道）。 */
  let latest = { at: 0, value: '' };

  /** 上一次检查失败的时间：失败也退避，否则每次打开设置页都要等满一个超时。 */
  let failedAt = 0;

  /** 正在进行的检查：并发的设置页请求共用同一次网络往返。 */
  let checking = null;

  /** 是否该重新检查：成功按 6 小时，失败按 10 分钟退避。 */
  const shouldCheck = () => {
    const last = Math.max(latest.at, failedAt);
    if (last === 0) return true;
    return Date.now() - last > (latest.value === '' ? UPDATE_RETRY : UPDATE_TTL);
  };

  /**
   * 问一次远端；全部失败返回 ''（网络受限是常态，不当作错误上报）。
   *
   * 按 `UPDATE_SOURCES` 顺序回退：GitHub API 优先，不通时用 GitHub 自己的
   * `releases/latest/download/...` 静态文件兜底（不占 API 限速）。
   */
  const fetchLatest = async () => {
    if (typeof fetch !== 'function') return '';
    for (const source of UPDATE_SOURCES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT);
      try {
        const response = await fetch(source.url, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            // GitHub API 要求带 UA，否则 403。
            'user-agent': `${PACKAGE_NAME}/${await versionOf()}`,
          },
        });
        if (!response.ok) continue;
        const value = pickVersion(await response.json());
        if (value !== '') return value;
      } catch {
        // 超时 / DNS / TLS：换下一个来源
      } finally {
        clearTimeout(timer);
      }
    }
    return '';
  };

  /** 刷新远端版本缓存；同一时间只跑一次，失败保留旧值并记下退避时间。 */
  const refreshLatest = () => {
    if (checking !== null) return checking;
    checking = fetchLatest()
      .then((value) => {
        if (value !== '') latest = { at: Date.now(), value };
        else failedAt = Date.now();
        return latest.value;
      })
      .catch(() => {
        failedAt = Date.now();
        return latest.value;
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  };

  /** 解析设置文件路径（只算一次）。 */
  const pathOf = async () => {
    if (filePath === undefined) filePath = join(await resolveHome(), 'glass-theme.json');
    return filePath;
  };

  /** 读设置：优先内存缓存，其次磁盘，最后默认值。坏文件按默认值处理。 */
  const load = async () => {
    if (cache !== null) return cache;
    try {
      const text = await readFile(await pathOf(), 'utf8');
      cache = normalize(JSON.parse(text));
    } catch {
      // 文件不存在 / 不是 JSON：都退回默认值（用户删掉文件即可复位）
      cache = { ...DEFAULTS };
    }
    return cache;
  };

  /** 把 patch 合并进当前设置并原子落盘；返回落盘后的完整设置。 */
  const save = async (patch) => {
    const current = await load();
    const next = normalize(patch, current);
    cache = next;
    const target = await pathOf();
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(tmp, target);
    return next;
  };

  /** DSH 主目录（背景图与设置文件同住这里）；只解析一次。 */
  let homeDir;
  const homeOf = async () => {
    if (homeDir === undefined) homeDir = await resolveHome();
    return homeDir;
  };

  /**
   * 找到当前的背景图文件。
   *
   * 同一时间只保留一张图，但扩展名随上传内容变，所以按白名单逐个 stat。
   * 找不到返回 null（= 用户没设过图 / 图被删了），调用方据此回 404。
   *
   * @returns { path, ext, size } 或 null。
   */
  const findBackground = async () => {
    const home = await homeOf();
    for (const ext of Object.keys(MIME_BY_EXT)) {
      const path = join(home, `${BACKGROUND_STEM}.${ext}`);
      try {
        const info = await stat(path);
        if (info.isFile()) return { path, ext, size: info.size };
      } catch {
        // 这个扩展名不存在：继续找下一个
      }
    }
    return null;
  };

  /** 删掉背景图（所有扩展名）。文件本来就不存在时静默通过。 */
  const removeBackground = async () => {
    const home = await homeOf();
    for (const ext of Object.keys(MIME_BY_EXT)) {
      await unlink(join(home, `${BACKGROUND_STEM}.${ext}`)).catch(() => {});
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendJson(res, 200, { value: await load(), writable: true, defaults: DEFAULTS });
          return;
        }

        if (req.method === 'POST') {
          const rejection = rejectionOf(ctx, req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { ok: false, error: '请求来源不被信任' });
            return;
          }
          const body = await readJsonBody(req);
          // 写入串行化：后一次写一定看得到前一次的结果
          const result = tail.then(() => save(body), () => save(body));
          tail = result.then(() => {}, () => {});
          sendJson(res, 200, { ok: true, value: await result });
          return;
        }

        sendJson(res, 405, { ok: false, error: 'method not allowed' });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: messageOf(error) });
      }
    },
  }), 'dsh-glass-ranswork: settings route');

  /**
   * 背景图路由：GET 取图 / POST 上传 / DELETE 删除。
   *
   * 上传走原始二进制（不是 multipart）：浏览器半侧已经把图片压成 WebP，
   * 直接用 Blob 作为 body，这里按 content-type 决定落盘扩展名。
   * 这样没有 multipart 解析依赖，也不给这个路由任何「写任意文件」的能力 ——
   * 文件名是固定的，扩展名来自白名单。
   */
  ctx.effect(() => ctx.webServer.register({
    // prefix 而不是 exact：图片 URL 把换图 token 放在路径段里
    // （`/glass-theme/background/<token>`），token 一变就能绕开长缓存；
    // 用前缀路由可以同时接住「带 token 的 GET」和「不带 token 的 POST/DELETE」，
    // 也不依赖 exact 路由是否会忽略 query。
    kind: 'prefix',
    path: BACKGROUND_PATH,
    handler: async (req, res) => {
      try {
        const method = req.method ?? 'GET';

        if (method === 'GET' || method === 'HEAD') {
          const found = await findBackground();
          if (found === null) {
            sendJson(res, 404, { ok: false, error: '还没有设置背景图' });
            return;
          }
          res.writeHead(200, {
            'content-type': MIME_BY_EXT[found.ext],
            'content-length': found.size,
            // token 在 URL 的 query 里，换图必然换 URL，所以可以放心长缓存。
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          });
          if (method === 'HEAD') {
            res.end();
            return;
          }
          const stream = createReadStream(found.path);
          stream.on('error', () => {
            try {
              res.destroy();
            } catch {
              res.end();
            }
          });
          stream.pipe(res);
          return;
        }

        // 写操作（POST / DELETE）需要过来源信任检查，和设置路由一致。
        const rejection = rejectionOf(ctx, req);
        if (rejection !== undefined) {
          sendJson(res, rejection, { ok: false, error: '请求来源不被信任' });
          return;
        }

        if (method === 'POST') {
          const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
          const ext = IMAGE_EXT_BY_TYPE[type];
          if (ext === undefined) {
            sendJson(res, 415, { ok: false, error: '只接受图片（png / webp / jpeg / gif / avif / bmp / svg）' });
            return;
          }
          const body = await readBody(req, BACKGROUND_LIMIT);
          if (body.length === 0) throw new Error('空文件');
          const home = await homeOf();
          await mkdir(home, { recursive: true });
          const target = join(home, `${BACKGROUND_STEM}.${ext}`);
          const tmp = `${target}.tmp`;
          await writeFile(tmp, body);
          // 先写新图再清旧图：写失败时旧图还在，不会变成"什么都没有"。
          await removeBackground();
          await rename(tmp, target);
          const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const result = tail.then(() => save({ bgImage: token }), () => save({ bgImage: token }));
          tail = result.then(() => {}, () => {});
          sendJson(res, 200, { ok: true, token, bytes: body.length, ext, value: await result });
          return;
        }

        if (method === 'DELETE') {
          await removeBackground();
          const result = tail.then(() => save({ bgImage: '' }), () => save({ bgImage: '' }));
          tail = result.then(() => {}, () => {});
          sendJson(res, 200, { ok: true, value: await result });
          return;
        }

        sendJson(res, 405, { ok: false, error: 'method not allowed' });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: messageOf(error) });
      }
    },
  }), 'dsh-glass-ranswork: background route');

  /**
   * 版本 / 更新检查路由。
   *
   * 为什么由宿主半侧来做：浏览器半侧拿不到 package.json 的版本，而且受限网络
   * 下由 Node 访问 api.github.com 比页面直连更稳（还能回退到静态 version.json）。
   *
   * 语义：**永远先返回当前版本**，更新信息只是附带的；检查失败就当作不知道，
   * 不显示任何错误。设置页不是更新器，这里不做自动升级。
   */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VERSION_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }

        const version = await versionOf();

        if (shouldCheck()) {
          const pending = refreshLatest();
          // 第一次没有缓存时最多等一个超时窗口；之后有旧值就立刻返回、后台刷新。
          if (latest.at === 0 && failedAt === 0) {
            await Promise.race([pending, new Promise((done) => setTimeout(done, UPDATE_TIMEOUT))]);
          }
        }

        const fresh = latest.value;
        sendJson(res, 200, {
          version,
          latest: fresh,
          updateAvailable: fresh !== '' && version !== '' && compareVersions(fresh, version) > 0,
          url: fresh === '' ? '' : `https://github.com/${UPDATE_REPO}/releases/tag/v${fresh}`,
          checkedAt: latest.at,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: messageOf(error) });
      }
    },
  }), 'dsh-glass-ranswork: version route');
}
