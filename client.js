/**
 * ============================================================================
 * dsh-glass-ranswork 浏览器半侧（browser half）—— 「自定义主题」的引擎与设置页
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件运行在 DSH Web 页面里，做两件事：
 *     1. 把整个界面变成「半透明 + 背景模糊」的毛玻璃外观（引擎）；
 *     2. 在「设置」里注册一个自己的分区页，让用户实时调参数（设置页）。
 *
 * 【为什么必须长这样：客户端 bundle 的形态】
 *   DSH 的浏览器插件不是普通 ESM，而是一个固定形态的 bundle：
 *     window.__ModuleLoader__.load({ id, factory })
 *   factory 拿到一个同步的 require，用它取 React 与 DSH 提供的模块；
 *   **不能**自己打包 React（React 由宿主外壳的模块表提供）。
 *   CSS 以字符串形式自己塞进 <style> 标签。
 *   详见宿主安装目录里的 cordis-plugin-development 技能文档。
 *
 * 【玻璃效果是怎么做出来的（三层，缺一不可）】
 *
 *   第 1 层：氛围光背景（ambient）
 *     在 body::before 上画一层固定定位的渐变（极光/海洋/落日/单色）。
 *     它铺在 #root 下面，是所有半透明表面的「背后那层东西」。
 *
 *   第 2 层：半透明表面（token 覆盖）
 *     通过官方 `ctx.theme.overrideTokens(source, tokens)` 把表面色 token
 *     （--dsw-alias-bg-base / bg-layer-* / sidebar-fill ...）改成
 *     `color-mix(in srgb, <原色> N%, transparent)`。
 *     N 就是用户调的「不透明度」：N=20 即 80% 半透明。
 *     走官方 token 层是刻意的选择——它不碰注册表、可撤销、随主题切换
 *     自动重算明暗两套值，是升级最稳的做法。
 *
 *   第 3 层：背景模糊（backdrop-filter）
 *     给主要列/面板加 backdrop-filter: blur() saturate()，
 *     让第 1 层氛围光在表面后面被真实模糊——这才是「毛玻璃」而不是
 *     「半透明色块」。菜单与遮罩的模糊走官方 token
 *     --dsw-menu-backdrop-filter / --dsw-mask-blur，一并覆盖。
 *
 * 【必须知道的天花板（重要，别被"80% 半透明"误导）】
 *   Windows 上主窗口创建时**没有** transparent / backgroundMaterial
 *   （见 Electron 主进程 createWindow：只有欢迎页用 acrylic，
 *   只有 macOS 主窗口用 vibrancy:"sidebar" + backgroundColor:"#00000000"）。
 *   所以：
 *     - Windows：表面半透明后透出的是**本插件画的氛围光**，不是桌面；
 *     - macOS：窗口本身透明，能真正透出桌面壁纸。
 *   也就是说，在 Windows 上「80% 半透明」= 80% 透出氛围光。
 *   这是 Electron 窗口材质的边界，不是 CSS 能突破的；宿主半侧跑在
 *   ELECTRON_RUN_AS_NODE 子进程里，够不到 BrowserWindow API，
 *   所以也无法在运行时去改窗口材质。
 *
 * 【一个刻意的 !important】
 *   `.frame` 与 `.centerCol` 都用 var(--dsw-alias-bg-base) 铺底。
 *   如果两层都留着半透明底色，实际不透明度会变成 1-(1-a)² 而非 a
 *   （a=20% 时实测约 36%），用户拉的滑块就对不上了。
 *   所以把最外层的 frame 底色清成透明，只让叶子表面承担半透明。
 *
 * 【依赖的宿主 DOM 钩子（稳定性说明）】
 *   - body::before / #root：自有选择器，稳定。
 *   - [data-shortcut-modal] / [data-menu-material]：宿主在组件上写的
 *     data 属性，稳定。
 *   - [class*="_frame"] / [class*="_sidebarCol"] / [class*="_centerCol"]
 *     / [class*="_rightbarCol"]：DSH 用 CSS Modules，类名是
 *     `<哈希>_<局部名>`，哈希随构建变、局部名稳定，所以用「子串匹配」。
 *     这是全局主题唯一无法避免的耦合点；万一哪天局部名改了，
 *     退化结果是「那一块没有模糊」，token 带来的半透明仍然生效。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-glass-ranswork',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ==========================================================================
    // 常量
    // ==========================================================================

    /** 宿主半侧提供的设置读写路由（见 index.js）。 */
    const API = '/glass-theme/settings';

    /** 文案命名空间。 */
    const NS = 'settings.glass';

    /** token 覆盖层的身份（同一 source 重复调用会整层替换）。 */
    const TOKEN_SOURCE = 'dsh-glass-ranswork';

    /** 设置页在「设置」左栏里的位置：通用(0) / 模型(10) / 插件(15) / 预设(20) 之后。 */
    const SECTION_ORDER = 25;

    /** 出厂设置——必须与宿主半侧 DEFAULTS 保持一致。 */
    const DEFAULTS = Object.freeze({
      enabled: true,
      opacity: 20, // 不透明度 %；20 = 80% 半透明
      panelOpacity: 85, // 信息面板的不透明度 %（见 index.js DEFAULTS 注释）
      blur: 32, // 背景模糊 px
      overlayBlur: 32, // 浮层（弹层/已归档/费用面板/Modal）模糊 px —— 本轮新增
      composerBlur: 24, // 发送框 + 任务卡片模糊 px
      previewOpacity: 85, // 文件预览 / 改动卡片的不透明度 % —— 本轮新增
      saturate: 180, // 背景饱和度 %
      ambient: true, // 是否画氛围光背景
      accent: 'aurora', // 氛围光配色

      // ---- 自定义背景图片（2026-10 本轮新增）----
      bgImage: '', // 背景图 token（空串 = 没有背景图；只是缓存键，不是文件名）
      bgFit: 'cover', // 显示方式：cover / contain / stretch / tile / center
      bgCrop: { x: 0, y: 0, w: 1, h: 1 }, // 自定义裁剪区域（占原图比例；全图 = 0,0,1,1）
      bgDim: 30, // 背景蒙层不透明度 %
      bgGuard: true, // 文字保护：有壁纸时给文字加光晕（不加底色）
      bgAutoTone: true, // 自动明暗：按壁纸平均亮度切换 light / dark 模式
      bgBaseTheme: '', // 自动切换前的用户明暗偏好（light/dark/system，空=没有切过）
      /**
       * 上传时算好的 32×32 亮度图（base64，1024 字节）。
       *
       * 为什么存这个：自动明暗需要在「浏览器里」量图片亮度，而
       * `new Image()` + canvas `getImageData` 在自定义协议 / 跨源场景下可能
       * **静默失败**（canvas 被判污染 → 抛错 → 量不到 → 自动明暗永远不生效）。
       * 上传时图片是用户本地文件（`createImageBitmap` → canvas），同源、
       * 一定读得出来；把 32×32 的亮度存进设置，之后算任意裁剪区域的亮度
       * 都只是查表，不再依赖运行时解码。
       */
      bgLumaGrid: '',
    });

    /**
     * 需要改成半透明的**装饰性表面** token。
     *
     * 每个 token 给出它在浅色/深色下对应的**静态基色 token 名**。
     * 用静态 token 而不是写死十六进制，是为了跟宿主调色板保持同源；
     * 这里挑的都是「不随明暗翻转」的静态色（例如 bluish-00 恒为白、
     * bluish-950 恒为 #151517），所以按模式取用是安全的。
     *
     * 收录标准：**宿主 CSS 里真的有 var() 引用**的 token（否则覆盖了也看不见）。
     * 曾收录过 --dsw-specific-tip，但扫描 app.asar 后确认它只有定义、
     * 没有任何 var() 消费点，属于无效覆盖，已移除。
     * 这张表的值已与 design_platform 的 light/dark 两套定义逐项核对一致。
     */
    const SURFACES = Object.freeze({
      '--dsw-alias-bg-base': { light: '--dsw-static-neutral-bluish-00', dark: '--dsw-static-neutral-bluish-950' },
      '--dsw-alias-bg-layer-1': { light: '--dsw-static-neutral-bluish-00', dark: '--dsw-static-neutral-bluish-875' },
      '--dsw-alias-bg-overlay': { light: '--dsw-static-neutral-bluish-150', dark: '--dsw-static-neutral-bluish-700' },
      '--dsw-alias-bg-module-platform': { light: '--dsw-static-neutral-bluish-60', dark: '--dsw-static-neutral-bluish-800' },
      '--dsw-specific-sidebar-fill': { light: '--dsw-static-neutral-bluish-50', dark: '--dsw-static-neutral-bluish-900' },
      '--dsw-specific-input-major': { light: '--dsw-static-neutral-bluish-00', dark: '--dsw-static-neutral-bluish-850' },
      '--dsw-specific-selector': { light: '--dsw-static-neutral-bluish-60', dark: '--dsw-static-neutral-bluish-800' },
    });

    /**
     * **信息面板**表面 token —— 单独用 `panelOpacity` 覆盖，默认 85% 不透明。
     *
     * 【为什么必须单独一张表】
     *   这几处是「要读字」的地方，不是装饰：
     *     - `--dsw-specific-menu` → 会话统计 / 逐轮用量弹层（宿主 `Xt1eiG_panel`）
     *       与所有下拉浮层。宿主自己的定义已经是 `#f8f9fa94` / `#43454a73`
     *       （≈58% / 45% 半透明）+ 模糊，再被主题压到 20% 就直接糊成一片。
     *     - `--dsw-alias-bg-document-preview` → 文件预览里 PDF 的底色
     *       （`TdjKvG_body:has([data-pdf-preview])` 消费，全仓库唯一消费点）。
     *     - `--dsw-alias-bg-layer-2/3` → 抬升面：Modal 内容、Pill、轨迹列表、
     *       插件管理页、以及**桌宠的费用弹层 / 花费看板**
     *       （`dsh-cost-panel` / `dsh-pet-dash-panel` 的 background 就是 layer-2）。
     *   把它们单独拎出来，滑块拉到底也不会把正文拖没。
     *
     * 【基色为什么不用 `--dsw-menu-surface-fill`】
     *   那个值**自带 alpha**（`#f8f9fa94`）。再乘一次 panelOpacity 会变成
     *   0.58 × 0.85 ≈ 49% 透明，比不改还透。所以这里用同色的**不透明静态 token**：
     *   浅色 `#f8f9fa` = bluish-50、深色 `#43454a` = bluish-750。
     *
     * 【macOS 上会被行内覆盖压过】
     *   宿主对 darwin 有 `html[data-platform=darwin] body{--dsw-specific-menu:#f8f9faf0}`
     *   的 94% 覆盖；行内样式的优先级更高，所以 panelOpacity 在 macOS 上同样生效
     *   （跨平台一致，这是有意的）。
     */
    const PANELS = Object.freeze({
      '--dsw-specific-menu': { light: '--dsw-static-neutral-bluish-50', dark: '--dsw-static-neutral-bluish-750' },
      '--dsw-alias-bg-document-preview': {
        light: '--dsw-static-neutral-bluish-100',
        dark: '--dsw-static-neutral-bluish-950',
      },
      '--dsw-alias-bg-layer-2': { light: '--dsw-static-neutral-bluish-00', dark: '--dsw-static-neutral-bluish-850' },
      '--dsw-alias-bg-layer-3': { light: '--dsw-static-neutral-bluish-00', dark: '--dsw-static-neutral-bluish-800' },
    });

    /** 可选氛围光配色。 */
    const ACCENTS = Object.freeze(['aurora', 'ocean', 'sunset', 'mono']);

    /**
     * 背景图显示方式 —— 与桌面壁纸设置一致的 5 种。
     *
     *   cover   填充   ：等比放大到铺满窗口，超出部分裁掉（不保证看到全图）
     *   contain 适应   ：等比缩放到整张图都看得见，留白处透出氛围光
     *   stretch 拉伸   ：强行拉满整块，比例会变形
     *   tile    平铺   ：按原图像素重复铺满
     *   center  居中   ：按原图像素居中，四周不动
     *
     * 这五个值必须与宿主半侧 index.js 的 FIT_MODES 完全一致：
     * 宿主不认识的 id 会被 normalize() 退回默认值（cover）。
     */
    const FIT_MODES = Object.freeze(['cover', 'contain', 'stretch', 'tile', 'center']);

    /** 裁剪区域的最小边长（占原图比例）。 */
    const CROP_MIN = 0.05;

    /** 「整图」裁剪（没有裁剪）。 */
    const CROP_FULL = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

    /** 判断裁剪是否等于整图时的容差（canvas 上取整后会有 1px 级误差）。 */
    const CROP_EPSILON = 0.001;

    /** 背景图路由（宿主半侧 index.js）。 */
    const API_BG = '/glass-theme/background';

    /** 上传前把长边压到这个尺寸以内：窗口再大也用不到更多像素。 */
    const BG_MAX_SIDE = 3840;

    /**
     * 自动明暗的两个阈值（0..1 的相对亮度）。
     *
     * 中间这段**不切换**：一张明暗参半的图（比如一半夜空一半月亮）来回切
     * 会很晃眼，保持用户当前模式、靠文字保护兜住即可。
     */
    const BG_TONE_DARK = 0.42;
    const BG_TONE_LIGHT = 0.58;

    /**
     * 允许自动切换的主题偏好。
     *
     * 只动内置的 light / dark / system：如果用户在用一个**第三方主题 id**，
     * setTheme('dark') 会把他选的第三方主题顶掉 —— 那种情况一律不碰。
     */
    const MANAGED_PREFERENCES = Object.freeze(['light', 'dark', 'system']);

    /** 滑块/裁剪的合法区间——必须与宿主半侧 RANGES 一致（那边是最终裁决）。 */
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

    // ==========================================================================
    // 文案
    // ==========================================================================

    /** 简体中文（键集的事实来源）。 */
    const zh = {
      nav: '自定义主题',
      intro: '把整个界面变成半透明毛玻璃。改动即时生效，并自动保存。',
      'enable.title': '启用自定义主题',
      'enable.desc': '关闭后完全恢复原生外观',
      'opacity.title': '表面不透明度',
      'opacity.desc': '0 = 完全透明（最透），100 = 不透明（等于关闭玻璃）',
      'panelOpacity.title': '面板不透明度',
      'panelOpacity.desc': '弹层、文件预览、统计与费用面板单独一档。这些地方要读字，默认比表面更实；拉低到 0 会一起玻璃化',
      'blur.title': '背景模糊',
      'blur.desc': '表面背后那层的模糊半径',
      'overlayBlur.title': '浮层模糊',
      'overlayBlur.desc': '弹层、已归档面板、费用面板、Modal 背后那层的模糊半径。拉到 0 会让浮层只剩半透明色块，背后的字会透出来',
      'composerBlur.title': '发送框 / 任务模糊',
      'composerBlur.desc': '发送输入框与任务卡片背后那层的模糊半径，调到 0 关闭这两处的模糊。它们的底色跟「表面不透明度」走，没有额外的白色铺底',
      'previewOpacity.title': '文件预览 / 改动卡片',
      'previewOpacity.desc': '文件 diff、已编辑文件卡片、文档预览这几处的底色不透明度。它们要读代码，所以单独一档：拉高它不会把整个界面一起变实',
      'diag.title': '诊断',
      'diag.desc': '上一次绘制时浏览器实际算出的值。拖任意滑块会刷新它。targets 是命中的层数（0 表示没找到发送框区域），seat 表示是否找到 composerSeat',
      'saturate.title': '背景饱和度',
      'saturate.desc': '提高可让背后的颜色更鲜艳',
      'ambient.title': '氛围光背景',
      'ambient.desc': '关闭后表面透出的是窗口底色而非氛围光',
      'accent.title': '氛围光配色',
      'accent.desc': '氛围光的色系',
      'accent.aurora': '极光',
      'accent.ocean': '海洋',
      'accent.sunset': '落日',
      'accent.mono': '单色',

      // ---- 背景图片 ----
      'bg.title': '背景图片',
      'bg.desc': '选一张自己的图片当壁纸，铺在所有半透明表面后面。图片只存在本机，不会上传到任何服务器',
      'bg.choose': '选择图片',
      'bg.replace': '更换图片',
      'bg.remove': '移除',
      'bg.none': '未设置',
      'bg.busy': '处理中…',
      'bg.uploadError': '图片读取失败，换一张试试',
      'bg.needRestart': '背景图服务还没就绪：重启 DSH 后再试一次',
      'bg.meta': '显示方式与裁剪见下方',
      'bg.fit.title': '显示方式',
      'bg.fit.desc': '和桌面壁纸一样：填充会裁掉超出部分，适应保留整张图，拉伸会变形，平铺按原尺寸重复，居中按原尺寸居中',
      'bg.fit.cover': '填充',
      'bg.fit.contain': '适应',
      'bg.fit.stretch': '拉伸',
      'bg.fit.tile': '平铺',
      'bg.fit.center': '居中',
      'bg.dim.title': '背景蒙层',
      'bg.dim.desc': '在图片上盖一层与明暗同向的雾（浅色盖白、深色盖黑）。拉高后文字更清楚，拉低图片更鲜艳',
      'bgGuard.title': '文字保护',
      'bgGuard.desc': '给文字加一圈与明暗同向的光晕，并把次要说明文字加深一档，让字从图片里跳出来。不加任何底色，不会影响你调好的透明度和模糊',
      'bgAutoTone.title': '跟随图片明暗',
      'bgAutoTone.desc': '自动测量背景图（裁剪后）的平均明暗：偏暗就切到深色主题、偏亮就切回浅色，让文字颜色始终和图片对得上。关掉就固定用你当前选的明暗',
      'bgAutoTone.measured': '测得亮度',
      'bgAutoTone.dark': '已切深色主题',
      'bgAutoTone.light': '已切浅色主题',
      'bgAutoTone.keep': '明暗居中，保持当前主题',
      'bgAutoTone.measuring': '正在测量图片亮度…',
      'bgAutoTone.failed': '还没量到图片亮度，会自动重试',
      'bgAutoTone.off': '已关闭，固定用当前明暗',
      'bg.crop.title': '自定义裁剪',
      'bg.crop.desc': '在图片上拖出一个框，只显示框内的部分；拖动框内部可移动，拖四个角可缩放',
      'bg.crop.hint': '在图片上拖动可重新框选',
      'bg.crop.reset': '整图',
      'bg.crop.full': '整图',

      reset: '恢复默认',
      saveError: '保存失败，设置可能在刷新后丢失',
      unitPx: 'px',
      unitPercent: '%',
    };

    /** English，与中文键集一一对应。 */
    const en = {
      nav: 'Custom theme',
      intro: 'Turns the whole interface into translucent frosted glass. Changes apply live and save automatically.',
      'enable.title': 'Enable custom theme',
      'enable.desc': 'Turn off to restore the native appearance',
      'opacity.title': 'Surface opacity',
      'opacity.desc': '0 = fully transparent (clearest), 100 = opaque (same as off)',
      'panelOpacity.title': 'Panel opacity',
      'panelOpacity.desc': 'A separate level for popovers, file preview, and the statistics and cost panels. They are meant to be read, so they stay more solid than surfaces by default; pull it to 0 to glass them over too',
      'blur.title': 'Background blur',
      'blur.desc': 'Blur radius applied to what sits behind a surface',
      'overlayBlur.title': 'Overlay blur',
      'overlayBlur.desc': 'Blur radius behind popovers, the archive panel, cost panels, and modals. At 0 they become plain translucent blocks and the text behind shows through',
      'composerBlur.title': 'Composer / task blur',
      'composerBlur.desc': 'Blur radius behind the message composer and task cards. Set it to 0 to turn both off',
      'previewOpacity.title': 'File preview / changes',
      'previewOpacity.desc': 'Opacity of file diffs, the edited-files card, and the document preview. They are meant to be read, so they get their own level: raising it does not make the rest of the UI more solid',
      'diag.title': 'Diagnostics',
      'diag.desc': 'Values the browser actually computed during the last paint. Dragging any slider refreshes them. targets is how many layers were matched (0 means the composer area was not found); seat tells whether composerSeat was found',
      'saturate.title': 'Background saturation',
      'saturate.desc': 'Raise it to make the colors behind more vivid',
      'ambient.title': 'Ambient backdrop',
      'ambient.desc': 'When off, surfaces reveal the window fill instead of the ambient light',
      'accent.title': 'Ambient palette',
      'accent.desc': 'Color family of the ambient backdrop',
      'accent.aurora': 'Aurora',
      'accent.ocean': 'Ocean',
      'accent.sunset': 'Sunset',
      'accent.mono': 'Mono',

      // ---- Background image ----
      'bg.title': 'Background image',
      'bg.desc': 'Pick your own wallpaper and place it behind every translucent surface. The image stays on this machine and is never uploaded anywhere',
      'bg.choose': 'Choose image',
      'bg.replace': 'Replace',
      'bg.remove': 'Remove',
      'bg.none': 'Not set',
      'bg.busy': 'Working…',
      'bg.uploadError': 'Could not read that image, try another one',
      'bg.needRestart': 'The background service is not ready yet; restart DSH and try again',
      'bg.meta': 'Fit and crop are below',
      'bg.fit.title': 'Fit',
      'bg.fit.desc': 'Same as the desktop wallpaper setting: Fill crops the overflow, Fit keeps the whole image, Stretch distorts it, Tile repeats it at native size, Center keeps it centered at native size',
      'bg.fit.cover': 'Fill',
      'bg.fit.contain': 'Fit',
      'bg.fit.stretch': 'Stretch',
      'bg.fit.tile': 'Tile',
      'bg.fit.center': 'Center',
      'bg.dim.title': 'Background veil',
      'bg.dim.desc': 'Covers the image with a mist that follows the theme mode (white in light, black in dark). Higher keeps text readable, lower keeps the photo vivid',
      'bgGuard.title': 'Text protection',
      'bgGuard.desc': 'Adds a halo around text and strengthens secondary labels so they stand out from the photo. It adds no background fill, so your opacity and blur settings stay exactly as you set them',
      'bgAutoTone.title': 'Follow image tone',
      'bgAutoTone.desc': 'Measures the average brightness of the background image (after cropping): dark images switch the app to the dark theme, bright ones back to light, so text always matches the photo. Turn it off to keep the current light/dark mode',
      'bgAutoTone.measured': 'Brightness',
      'bgAutoTone.dark': 'switched to dark theme',
      'bgAutoTone.light': 'switched to light theme',
      'bgAutoTone.keep': 'mid-tone, keeping the current theme',
      'bgAutoTone.measuring': 'Measuring the image brightness…',
      'bgAutoTone.failed': 'Could not measure the image brightness yet; will retry',
      'bgAutoTone.off': 'Off — the current light/dark mode is kept',
      'bg.crop.title': 'Custom crop',
      'bg.crop.desc': 'Drag a box on the image to show only that part; drag inside the box to move it, drag a corner to resize',
      'bg.crop.hint': 'Drag on the image to pick a new area',
      'bg.crop.reset': 'Whole image',
      'bg.crop.full': 'Whole image',

      reset: 'Reset to defaults',
      saveError: 'Could not save; changes may be lost after a refresh',
      unitPx: 'px',
      unitPercent: '%',
    };

    // ==========================================================================
    // 设置状态（模块级单例：设置页与引擎共享同一份真相）
    // ==========================================================================

    let state = { ...DEFAULTS };
    const listeners = new Set();

    /**
     * 本地镜像键。
     *
     * 【为什么需要】
     *   宿主半侧（index.js）的 `DEFAULTS` / `RANGES` 是**模块加载时**读进内存的，
     *   改了它必须重启 DSH 才生效；而浏览器半侧走 HMR，改完刷新页面就生效。
     *   于是在"宿主还没重启"的窗口期里，宿主不认识 `panelOpacity`：
     *   POST 上去会被它按旧键集 `normalize()` 丢掉，GET 回来也没有这个字段。
     *   用户调完滑块、一刷新就回到 85 —— 体验上等于"设置没保存"。
     *
     *   所以把设置镜像一份到 localStorage，**只用来补齐宿主不认识的键**：
     *   宿主认识的键永远以宿主为准（它是唯一的权威存储，也是跨设备/跨窗口的
     *   真相来源）。宿主重启后自然会开始持久化 `panelOpacity`，镜像里那份
     *   随即被覆盖成同一个值，不会产生分叉。
     */
    const MIRROR_KEY = 'dsh-glass-theme:settings';

    /** 读本地镜像；隐私模式 / 禁用存储时静默返回空对象。 */
    function readMirror() {
      try {
        const raw = window.localStorage.getItem(MIRROR_KEY);
        if (typeof raw !== 'string') return {};
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    /** 写本地镜像；失败不影响主流程（宿主那份才是权威）。 */
    function writeMirror(value) {
      try {
        window.localStorage.setItem(MIRROR_KEY, JSON.stringify(value));
      } catch {
        // 存储不可用（隐私模式 / 配额满）：忽略，退回"每次刷新用默认值"
      }
    }

    /** 读取当前设置（引用稳定，便于比较）。 */
    function getState() {
      return state;
    }

    /** 合并写入并通知订阅者。 */
    function patchState(patch) {
      state = { ...state, ...patch };
      writeMirror(state);
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error('[glass-theme] listener failed', error);
        }
      }
    }

    /** 订阅变更；返回取消订阅函数。 */
    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    // ==========================================================================
    // 引擎：把设置投影到文档
    // ==========================================================================

    /**
     * 把设置编译成 theme 服务的 token 覆盖层。
     *
     * 两层不透明度：
     *   - `opacity`      → SURFACES（窗口骨架：frame / 侧栏 / 输入框 / 选区）
     *   - `panelOpacity` → PANELS  （信息面板：弹层、文件预览、Modal 内容）
     * 两套用同一个 `color-mix()` 表达式，只是百分比不同 —— 这样"面板永远比
     * 骨架更实"这件事由设置值本身表达，不需要额外规则去兜。
     *
     * @param settings - 当前设置。
     * @returns token 名 → { light, dark } 的覆盖表。
     */
    function buildTokens(settings) {
      const surfacePercent = clamp(settings.opacity, RANGES.opacity);
      const panelPercent = clamp(settings.panelOpacity, RANGES.panelOpacity);
      const filter = `blur(${clamp(settings.blur, RANGES.blur)}px) saturate(${clamp(settings.saturate, RANGES.saturate)}%)`;
      const tokens = {};
      const mix = (table, percent) => {
        for (const [name, modes] of Object.entries(table)) {
          tokens[name] = {
            light: `color-mix(in srgb, var(${modes.light}) ${percent}%, transparent)`,
            dark: `color-mix(in srgb, var(${modes.dark}) ${percent}%, transparent)`,
          };
        }
      };
      mix(SURFACES, surfacePercent);
      mix(PANELS, panelPercent);
      // 菜单与模态遮罩本来就带模糊，把它们的模糊值也统一到本主题的档位，
      // 这样"设置面板"和"下拉菜单"的玻璃质感是一致的。
      tokens['--dsw-menu-backdrop-filter'] = { light: filter, dark: filter };
      tokens['--dsw-mask-blur'] = { light: filter, dark: filter };
      return tokens;
    }

    /** 夹到区间内；非有限数退回区间下界。 */
    function clamp(value, [min, max]) {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) return min;
      return Math.min(max, Math.max(min, Math.round(parsed)));
    }

    /**
     * 把任意输入规范成合法的显示方式 id。
     *
     * @param value - 任意输入。
     * @returns FIT_MODES 里的一个值；非法时退回 DEFAULTS.bgFit。
     */
    function normalizeFit(value) {
      return typeof value === 'string' && FIT_MODES.includes(value) ? value : DEFAULTS.bgFit;
    }

    /**
     * 把任意输入规范成合法的裁剪区域 —— 规则与宿主半侧 normalizeCrop 完全一致。
     *
     * x/y/w/h 都是**占原图的比例**（不是像素）：换分辨率、换窗口大小都不用重算。
     * w/h 不小于 CROP_MIN；框越出右/下边界时把左上角往回推，而不是把框压扁。
     *
     * @param input - 任意输入（可能是 undefined / 字符串 / 半个对象）。
     * @returns 新的 { x, y, w, h }。
     */
    function normalizeCrop(input) {
      const source = input !== null && typeof input === 'object' ? input : {};
      const number = (value, alternate) => {
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : alternate;
      };
      const unit = (value) => Math.min(1, Math.max(0, value));
      const round = (value) => Math.round(value * 10000) / 10000;
      const w = Math.min(1, Math.max(CROP_MIN, unit(number(source.w, 1))));
      const h = Math.min(1, Math.max(CROP_MIN, unit(number(source.h, 1))));
      const x = Math.min(round(1 - w), Math.max(0, unit(number(source.x, 0))));
      const y = Math.min(round(1 - h), Math.max(0, unit(number(source.y, 0))));
      return { x: round(x), y: round(y), w: round(w), h: round(h) };
    }

    /** 判断裁剪区域是否等于「整图」。 */
    function isFullCrop(crop) {
      return (
        crop.x <= CROP_EPSILON &&
        crop.y <= CROP_EPSILON &&
        crop.w >= 1 - CROP_EPSILON &&
        crop.h >= 1 - CROP_EPSILON
      );
    }

    /**
     * 背景图平均亮度 → 期望的主题模式。
     *
     * 文字颜色是跟着主题模式走的（浅色主题深字、深色主题浅字），而壁纸的
     * 明暗和模式无关。这里把两者对上：暗图配深色主题、亮图配浅色主题；
     * 中间调返回 null（不动用户当前的模式）。
     *
     * @param luminance - 0..1 的相对亮度（0.2126R + 0.7152G + 0.0722B）。
     * @returns 'dark' | 'light' | null。
     */
    function toneForLuminance(luminance) {
      const numeric = typeof luminance === 'number' ? luminance : Number(luminance);
      if (!Number.isFinite(numeric)) return null;
      if (numeric < BG_TONE_DARK) return 'dark';
      if (numeric > BG_TONE_LIGHT) return 'light';
      return null;
    }

    /** 亮度图的边长（32×32 = 1024 个采样点）。 */
    const LUMA_GRID_SIDE = 32;
    const LUMA_GRID_CELLS = LUMA_GRID_SIDE * LUMA_GRID_SIDE;

    /**
     * 解码上传时算好的亮度图（base64 → 1024 个 0..255）。
     *
     * @param text - 设置里的 bgLumaGrid。
     * @returns Uint8Array | null。
     */
    function decodeLumaGrid(text) {
      if (typeof text !== 'string' || text.length < 64 || text.length > 4096) return null;
      if (typeof atob !== 'function') return null;
      try {
        const binary = atob(text);
        if (binary.length !== LUMA_GRID_CELLS) return null;
        const values = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          values[index] = binary.charCodeAt(index);
        }
        return values;
      } catch {
        return null;
      }
    }

    /**
     * 从亮度图里按裁剪区域求平均亮度（0..1）。
     *
     * 裁剪坐标是比例，网格是 32×32，所以取子矩形求平均即可 —— 纯查表，
     * 不碰图片解码，也就不存在 canvas 跨源/污染的问题。
     *
     * @param grid - decodeLumaGrid 的结果。
     * @param crop - 归一化裁剪区域。
     * @returns 0..1 | null。
     */
    function lumaFromGrid(grid, crop) {
      if (grid === null || grid === undefined || grid.length !== LUMA_GRID_CELLS) return null;
      const side = LUMA_GRID_SIDE;
      const x0 = Math.max(0, Math.min(side - 1, Math.floor(crop.x * side)));
      const y0 = Math.max(0, Math.min(side - 1, Math.floor(crop.y * side)));
      const x1 = Math.max(x0 + 1, Math.min(side, Math.ceil((crop.x + crop.w) * side)));
      const y1 = Math.max(y0 + 1, Math.min(side, Math.ceil((crop.y + crop.h) * side)));
      let total = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += grid[y * side + x];
          count += 1;
        }
      }
      return count === 0 ? null : total / count / 255;
    }

    /**
     * 把一张图（ImageBitmap / HTMLImageElement）缩成 32×32 亮度图并编码成 base64。
     *
     * 只在上传时调用：那时图片是用户本地文件（`createImageBitmap` 出来的），
     * 画进 canvas 一定读得出来，不受页面协议/跨源影响。
     *
     * @param source - 可被 drawImage 的图片源。
     * @returns base64 字符串；算不出来时返回空串。
     */
    function encodeLumaGrid(source) {
      try {
        if (typeof document === 'undefined' || typeof btoa !== 'function') return '';
        const canvas = document.createElement('canvas');
        canvas.width = LUMA_GRID_SIDE;
        canvas.height = LUMA_GRID_SIDE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) return '';
        context.drawImage(source, 0, 0, LUMA_GRID_SIDE, LUMA_GRID_SIDE);
        const data = context.getImageData(0, 0, LUMA_GRID_SIDE, LUMA_GRID_SIDE).data;
        let binary = '';
        for (let index = 0; index < data.length; index += 4) {
          const luma = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
          binary += String.fromCharCode(Math.max(0, Math.min(255, luma)));
        }
        return btoa(binary);
      } catch {
        return '';
      }
    }

    /**
     * 显示方式 → CSS `background-size / position / repeat` 三件套。
     *
     * 为什么用「一张位图 + background 三属性」而不是 <img> + object-fit：
     *   object-fit 只有 cover/contain/fill，没有平铺，也没有「原尺寸居中」。
     *   而这三个 background 属性的语义和 Windows 壁纸设置一一对应。
     *
     * @param fit - 显示方式 id。
     * @returns { size, position, repeat }。
     */
    function fitToCss(fit) {
      switch (normalizeFit(fit)) {
        case 'contain':
          return { size: 'contain', position: 'center', repeat: 'no-repeat' };
        case 'stretch':
          return { size: '100% 100%', position: 'center', repeat: 'no-repeat' };
        case 'tile':
          return { size: 'auto', position: 'left top', repeat: 'repeat' };
        case 'center':
          return { size: 'auto', position: 'center', repeat: 'no-repeat' };
        case 'cover':
        default:
          return { size: 'cover', position: 'center', repeat: 'no-repeat' };
      }
    }

    /**
     * 背景图 URL。
     *
     * token 放在**路径**里而不是 query 里，这是刻意选的：
     *   - 宿主对这张图回的是 `immutable` 长缓存，换图必然换 token → 换 URL
     *     → 浏览器不会拿旧图；
     *   - webServer 的路由有 `exact` / `prefix` 两种，token 放进路径段后
     *     这条兜底路由用 `prefix` 注册就能稳定命中，不依赖「exact 会不会
     *     忽略 query」这种实现细节。
     */
    function backgroundUrl(token) {
      return `${API_BG}/${encodeURIComponent(token)}`;
    }

    // ==========================================================================
    // 背景图：DOM 层 + 裁剪合成
    // ==========================================================================

    /**
     * 背景图的运行时状态（模块级单例，和设置状态分开）。
     *
     * 【为什么用独立 DOM 层，而不是 body::before】
     *   - body::before 已经被氛围光占了（CSS 第 1 段），不能抢；
     *   - 平铺 / 拉伸 / 居中需要 background-size·position·repeat，放在独立
     *     元素上可以随手改，不影响渐变；
     *   - 裁剪结果是 canvas 生成的 blob: URL，换图 / 改裁剪时必须能 revoke，
     *     独立元素让「谁在用这个 URL」一目了然。
     *
     * 【层级】
     *   固定定位 + z-index:-1，和氛围光的 body::before 同级；因为它**在 DOM
     *   后面**追加，所以画在氛围光之上、#root 内容之下。这样：
     *     - 填充（cover）时图片盖住氛围光；
     *     - 适应 / 平铺 / 居中留白处，氛围光从缝里透出来（配色仍然有意义）。
     */
    const bgState = {
      layer: null,
      imageEl: null,
      token: null,
      image: null,
      loading: null,
      cropKey: null,
      objectUrl: null,
      seq: 0,
    };

    /** 懒创建背景层；body 还没准备好时返回 null。 */
    function ensureBackgroundLayer() {
      if (bgState.layer !== null && bgState.layer.isConnected) return bgState.layer;
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return null;
      const layer = document.createElement('div');
      layer.className = 'dsh-glass-bg';
      layer.setAttribute('aria-hidden', 'true');
      const image = document.createElement('div');
      image.className = 'dsh-glass-bgImage';
      const veil = document.createElement('div');
      veil.className = 'dsh-glass-bgVeil';
      layer.appendChild(image);
      layer.appendChild(veil);
      document.body.appendChild(layer);
      bgState.layer = layer;
      bgState.imageEl = image;
      return layer;
    }

    /** 卸载时把层与 blob URL 一起回收。 */
    function disposeBackgroundLayer() {
      if (bgState.layer !== null) bgState.layer.remove();
      bgState.layer = null;
      bgState.imageEl = null;
      bgState.token = null;
      bgState.image = null;
      bgState.loading = null;
      bgState.cropKey = null;
      if (bgState.objectUrl !== null && typeof URL !== 'undefined') URL.revokeObjectURL(bgState.objectUrl);
      bgState.objectUrl = null;
    }

    /**
     * 加载原图（同一个 token 只加载一次）。
     *
     * 失败不抛错：返回 null，调用方保留「没有背景图」的状态即可 ——
     * 一张图读不出来不该把整个主题打崩。
     *
     * @param token - 背景图 token。
     * @returns Promise<HTMLImageElement | null>。
     */
    /**
     * 把一个图片 URL 解码成 HTMLImageElement。
     *
     * @param url - 图片地址（http(s) / blob: / 自定义协议）。
     * @returns Promise<HTMLImageElement | null>。
     */
    function decodeBackgroundImage(url) {
      return new Promise((resolve) => {
        if (typeof window === 'undefined' || typeof window.Image !== 'function') {
          resolve(null);
          return;
        }
        const img = new window.Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }

    /**
     * 加载原图（同一个 token 只加载一次）。
     *
     * 【为什么先 fetch 成 blob: URL，再交给 Image】
     *   桌面端页面跑在 `dsh-app://app/` 这个自定义协议下，图片路径能不能直接
     *   喂给 `new Image()`、画进 canvas 后会不会被判成「跨源」都是环境细节。
     *   一旦 canvas 被判定污染，`getImageData`/`toBlob` 会**静默抛错** ——
     *   表现就是「裁剪不生效、自动明暗永远量不到」，而且控制台以外看不出原因。
     *   `fetch()` 走的正是插件设置读写已经在用的那条通道，拿到的 Blob 再
     *   转成 `blob:` URL，就是**本页面同源**的，canvas 一定读得出来。
     *   fetch 不可用/失败时再退回直连 URL（也就是 background-image 的同一条路）。
     *
     * 失败不抛错：返回 null，调用方保留「没有背景图」的状态即可 ——
     * 一张图读不出来不该把整个主题打崩。
     *
     * @param token - 背景图 token。
     * @returns Promise<HTMLImageElement | null>。
     */
    function loadBackgroundImage(token) {
      if (bgState.token === token && bgState.image !== null) return Promise.resolve(bgState.image);
      if (bgState.token === token && bgState.loading !== null) return bgState.loading;
      bgState.token = token;
      bgState.image = null;
      bgState.cropKey = null;
      bgState.loading = (async () => {
        const direct = backgroundUrl(token);
        let image = null;
        // 1) 首选：fetch → blob: URL（同源，canvas 可读）
        try {
          if (typeof fetch === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const response = await fetch(direct);
            if (response !== null && response !== undefined && response.ok === true) {
              const blob = await response.blob();
              const objectUrl = URL.createObjectURL(blob);
              image = await decodeBackgroundImage(objectUrl);
              URL.revokeObjectURL(objectUrl);
            }
          }
        } catch {
          image = null;
        }
        // 2) 兜底：直接拿 URL 当图（和 background-image 完全同一条路径）
        if (image === null) image = await decodeBackgroundImage(direct);
        if (image !== null) {
          if (bgState.token === token) bgState.image = image;
          return image;
        }
        // 失败：清掉缓存，让下一次 paint 还能重试
        if (bgState.token === token) {
          bgState.token = null;
          bgState.loading = null;
        }
        return null;
      })();
      return bgState.loading;
    }

    /**
     * 把图片的 crop 区域裁成一张新位图，返回 blob: URL。
     *
     * 【为什么要真的重画，而不是用 background-position 缩放模拟】
     *   「裁剪 + 平铺 / 居中」需要的是**裁剪后的自然尺寸**。用百分比位移
     *   模拟只对「铺满」成立，平铺时会露出整张原图。canvas 裁一刀之后，
     *   五种显示方式都退化成普通图片，语义最干净。
     *
     * @param image - 已加载的原图。
     * @param crop - 归一化裁剪区域。
     * @returns Promise<string | null>。
     */
    function cropToObjectUrl(image, crop) {
      return new Promise((resolve) => {
        try {
          if (typeof document === 'undefined' || typeof URL === 'undefined') {
            resolve(null);
            return;
          }
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          if (!(width > 0 && height > 0)) {
            resolve(null);
            return;
          }
          const sx = Math.max(0, Math.round(crop.x * width));
          const sy = Math.max(0, Math.round(crop.y * height));
          const sw = Math.max(1, Math.min(width - sx, Math.round(crop.w * width)));
          const sh = Math.max(1, Math.min(height - sy, Math.round(crop.h * height)));
          const scale = Math.min(1, BG_MAX_SIDE / Math.max(sw, sh));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          const context = canvas.getContext('2d');
          if (context === null) {
            resolve(null);
            return;
          }
          context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              resolve(blob === null ? null : URL.createObjectURL(blob));
            },
            'image/webp',
            0.92,
          );
        } catch {
          resolve(null);
        }
      });
    }

    /**
     * 把背景图投影到 DOM 层（paint() 每帧调用）。
     *
     * 三条路径：
     *   1. 没有图 / 主题关闭 → 清空 background-image（CSS 同时把整层隐藏）；
     *   2. 整图 → 直接用宿主的 `/glass-theme/background?v=token`；
     *   3. 有裁剪 → 先显示原图，异步裁好后替换成 blob: URL（不闪空）。
     *
     * @param settings - 当前设置。
     */
    function applyBackground(settings) {
      const layer = ensureBackgroundLayer();
      if (layer === null) return;
      const token = typeof settings.bgImage === 'string' ? settings.bgImage : '';
      const active = settings.enabled === true && token.length > 0;
      const image = bgState.imageEl;
      if (image === null) return;

      // 每次投影都推进序号：任何在途的裁剪任务一旦过期就作废，
      // 否则「刚换了图 / 刚把裁剪恢复成整图」会被上一次的异步结果覆盖。
      const seq = (bgState.seq += 1);

      const fit = fitToCss(settings.bgFit);
      image.style.backgroundSize = fit.size;
      image.style.backgroundPosition = fit.position;
      image.style.backgroundRepeat = fit.repeat;

      /** 放掉上一张裁剪结果（blob URL 不 revoke 会一直占内存）。 */
      const dropCropped = () => {
        if (bgState.objectUrl !== null && typeof URL !== 'undefined') URL.revokeObjectURL(bgState.objectUrl);
        bgState.objectUrl = null;
        bgState.cropKey = null;
      };

      if (!active) {
        dropCropped();
        image.style.backgroundImage = 'none';
        return;
      }

      const crop = normalizeCrop(settings.bgCrop);
      if (isFullCrop(crop)) {
        dropCropped();
        image.style.backgroundImage = `url("${backgroundUrl(token)}")`;
        return;
      }

      const key = `${token}|${crop.x}|${crop.y}|${crop.w}|${crop.h}`;
      if (bgState.cropKey === key && bgState.objectUrl !== null) {
        image.style.backgroundImage = `url("${bgState.objectUrl}")`;
        return;
      }

      // 先挂原图（立即可见），裁剪结果算好后再替换。
      image.style.backgroundImage = `url("${backgroundUrl(token)}")`;
      loadBackgroundImage(token)
        .then((loaded) => {
          if (loaded === null || seq !== bgState.seq) return null;
          return cropToObjectUrl(loaded, crop);
        })
        .then((url) => {
          if (url === null || url === undefined || seq !== bgState.seq) {
            if (typeof url === 'string' && typeof URL !== 'undefined') URL.revokeObjectURL(url);
            return;
          }
          if (bgState.imageEl === null) {
            if (typeof URL !== 'undefined') URL.revokeObjectURL(url);
            return;
          }
          if (bgState.objectUrl !== null && typeof URL !== 'undefined') URL.revokeObjectURL(bgState.objectUrl);
          bgState.objectUrl = url;
          bgState.cropKey = key;
          bgState.imageEl.style.backgroundImage = `url("${url}")`;
        })
        .catch(() => {});
    }

    // ==========================================================================
    // 背景图：自动明暗（按图片平均亮度切换 light / dark）
    // ==========================================================================

    /**
     * 自动明暗的运行时状态。
     *
     * forcedTo / forcedFrom 是「我们替用户切过模式」的证据：
     *   forcedTo   = 我们切到的模式（'light' | 'dark'）
     *   forcedFrom = 切换前用户自己的偏好（'light' | 'dark' | 'system'）
     * 还原时只还原 forcedFrom，而且**只在偏好仍然是 forcedTo 时**还原 ——
     * 用户中途自己改过主题，就不能再拿旧偏好覆盖他。
     */
    const toneState = {
      key: null,
      luminance: null,
      tone: null,
      source: null, // 'grid'（上传时算好的亮度图）| 'canvas'（现场量）
      forcedTo: null,
      forcedFrom: null,
      seq: 0,
      // 诊断用：失败原因（'image' / 'measure'）、重试次数、重试定时器
      error: null,
      attempts: 0,
      retryTimer: null,
    };

    /**
     * 安排一次「量不到就重试」。
     *
     * 为什么需要：页面刚启动时图片可能还没就绪（宿主还在注册路由 /
     * 图片文件刚写完），一次失败就永久放弃会让自动明暗**静默失效**。
     * 这里退避重试最多 6 次（0.6s→4.2s），并把原因记进 toneState.error
     * 供设置页诊断行显示。
     *
     * @param repaint - 重新跑 paint 的函数。
     * @param reason - 失败原因（写进诊断）。
     */
    function scheduleToneRetry(repaint, reason) {
      toneState.error = reason;
      if (toneState.retryTimer !== null) return;
      toneState.attempts += 1;
      if (toneState.attempts > 6) {
        // 放弃重试：刷新一次状态行，让用户看到「量不到」
        patchState({});
        return;
      }
      const delay = Math.min(8000, 600 * toneState.attempts + 600);
      toneState.retryTimer = setTimeout(() => {
        toneState.retryTimer = null;
        // 放开 key 让下一次 paint 重新量；patchState 会触发 paint
        toneState.key = null;
        try {
          patchState({});
        } catch {
          try {
            repaint();
          } catch {
            // 忽略：下一轮还有机会
          }
        }
      }, delay);
      // 刷新设置页状态行；此时 key 还保留着，这次 paint 不会立刻重试
      patchState({});
    }

    /** 清掉重试定时器（换图 / 关开关 / 卸载时）。 */
    function clearToneRetry() {
      if (toneState.retryTimer !== null) {
        clearTimeout(toneState.retryTimer);
        toneState.retryTimer = null;
      }
      toneState.attempts = 0;
      toneState.error = null;
    }

    /**
     * 量背景图（裁剪区域）的平均相对亮度。
     *
     * 为什么不直接读整张图：用户裁过之后，屏幕上看得到的只有裁出来的那块，
     * 拿整图平均会把裁掉的黑色边框也算进去，判断就偏了。
     *
     * 32×32 足够：这里要的是「整体亮还是暗」，不是细节；而且 drawImage
     * 会把大图缩到画布上，成本可以忽略。
     *
     * @param image - 已加载的原图。
     * @param crop - 归一化裁剪区域。
     * @returns 0..1 的平均相对亮度；算不出来时返回 null。
     */
    function measureBackgroundLuminance(image, crop) {
      try {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) return null;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!(width > 0 && height > 0)) return null;
        const sx = Math.max(0, Math.round(crop.x * width));
        const sy = Math.max(0, Math.round(crop.y * height));
        const sw = Math.max(1, Math.min(width - sx, Math.round(crop.w * width)));
        const sh = Math.max(1, Math.min(height - sy, Math.round(crop.h * height)));
        context.drawImage(image, sx, sy, sw, sh, 0, 0, 32, 32);
        const data = context.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let index = 0; index < data.length; index += 4) {
          total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
        }
        return total / (data.length / 4) / 255;
      } catch {
        return null;
      }
    }

    /**
     * 把主题切到图片对应的明暗（只动内置偏好）。
     *
     * 【为什么要持久化「切换前的模式」】
     *   setTheme 会写进用户设置。如果只在内存里记 forcedFrom，下次启动就忘了：
     *   用户随后删掉壁纸，主题会永远停在深色。所以切换前把原偏好写进
     *   bgBaseTheme（跟着设置一起落盘 + 镜像），删图/关开关时再还原。
     *
     * @param theme - 客户端 theme 服务。
     * @param tone - 'dark' | 'light' | null（null = 不切换 / 还原）。
     * @param settings - 当前设置（读 bgBaseTheme）。
     */
    function applyBackgroundTone(theme, tone, settings) {
      if (theme === undefined || theme === null || typeof theme.getTheme !== 'function' || typeof theme.setTheme !== 'function') {
        return;
      }
      if (tone === null) {
        restoreBackgroundTone(theme, settings);
        return;
      }
      let snapshot;
      try {
        snapshot = theme.getTheme();
      } catch {
        return;
      }
      if (snapshot === null || typeof snapshot !== 'object') return;
      const preference = typeof snapshot.preference === 'string' ? snapshot.preference : '';
      // 用户用的是第三方主题 id：别把人家换掉
      if (!MANAGED_PREFERENCES.includes(preference)) return;
      const scheme = snapshot.active !== null && typeof snapshot.active === 'object' ? snapshot.active.colorScheme : null;
      const stored = typeof settings.bgBaseTheme === 'string' && MANAGED_PREFERENCES.includes(settings.bgBaseTheme) ? settings.bgBaseTheme : '';

      if (scheme === tone) {
        // 已经是目标模式。
        // 如果 bgBaseTheme 里有基准，说明这个模式就是我们上次切的（比如刷新后），
        // 继续持有它，等删图时还原；否则是用户自己的模式，不碰。
        if (stored !== '' && toneState.forcedTo === null) {
          toneState.forcedTo = preference;
          toneState.forcedFrom = stored;
        } else if (toneState.forcedTo !== null && preference !== toneState.forcedTo) {
          // 用户中途自己改过 → 放弃我们的记录（但保留 bgBaseTheme 不动？
          // 不，已经没用了一并清掉，免得以后拿它覆盖用户）
          toneState.forcedTo = null;
          toneState.forcedFrom = null;
          if (stored !== '') patchState({ bgBaseTheme: '' });
        }
        return;
      }

      // 需要切换：基准优先用已经存下来的（重启后），否则用当前偏好。
      const from = stored !== '' ? stored : preference;
      toneState.forcedTo = tone;
      toneState.forcedFrom = from;
      if (from !== tone && MANAGED_PREFERENCES.includes(from)) patchState({ bgBaseTheme: from });
      try {
        theme.setTheme(tone);
      } catch (error) {
        // 不致命（界面不会崩），但必须留证据：诊断行会显示 err=theme:...
        toneState.error = `theme:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    /**
     * 还原用户原来的明暗偏好。
     *
     * 规则：
     *   - 同一会话里用户自己改过模式（当前偏好 ≠ 我们切的那个）→ 只清基准，
     *     不还原，尊重用户；
     *   - 否则还原到 bgBaseTheme / forcedFrom（重启后也能还原）。
     *
     * @param theme - 客户端 theme 服务。
     * @param settings - 当前设置（读 bgBaseTheme）。
     * @param persist - 是否把「已还原」写回设置（卸载时不需要，避免在拆卸阶段
     *   触发保存副作用）。
     */
    function restoreBackgroundTone(theme, settings, persist = true) {
      const stored = settings !== undefined && typeof settings.bgBaseTheme === 'string' && MANAGED_PREFERENCES.includes(settings.bgBaseTheme)
        ? settings.bgBaseTheme
        : '';
      const forcedTo = toneState.forcedTo;
      const from = toneState.forcedFrom !== null ? toneState.forcedFrom : stored;
      toneState.forcedTo = null;
      toneState.forcedFrom = null;
      toneState.tone = null;
      if (persist && stored !== '') patchState({ bgBaseTheme: '' });
      if (from === '') return;
      if (theme === undefined || theme === null || typeof theme.setTheme !== 'function') return;
      try {
        const snapshot = theme.getTheme();
        if (snapshot !== null && typeof snapshot === 'object') {
          // 同一会话内用户自己换过主题 → 不覆盖
          if (forcedTo !== null && snapshot.preference !== forcedTo) return;
          if (snapshot.preference === from) return; // 已经是原样，不用切
        }
        theme.setTheme(from);
      } catch {
        // 忽略
      }
    }

    /**
     * 按当前设置同步自动明暗（paint() 每帧调用）。
     *
     * 只在「图片 token / 裁剪区域 / 开关」变化时重新量：量一次是异步的
     * （要等图片解码），而 paint 会被拖滑块触发几十次，不能每次都算。
     *
     * @param theme - 客户端 theme 服务。
     * @param settings - 当前设置。
     * @param repaint - 重新跑 paint 的函数（重试用）。
     */
    function syncBackgroundTone(theme, settings, repaint) {
      const auto =
        settings.enabled === true &&
        settings.bgAutoTone !== false &&
        typeof settings.bgImage === 'string' &&
        settings.bgImage.length > 0;
      if (!auto) {
        toneState.key = null;
        toneState.tone = null;
        toneState.luminance = null;
        clearToneRetry();
        restoreBackgroundTone(theme, settings);
        return;
      }
      const token = settings.bgImage;
      const crop = normalizeCrop(settings.bgCrop);
      const key = `${token}|${crop.x}|${crop.y}|${crop.w}|${crop.h}`;
      if (toneState.key === key) return;
      toneState.key = key;

      // 首选：上传时算好的 32×32 亮度图（纯查表，不依赖图片解码）
      const grid = decodeLumaGrid(settings.bgLumaGrid);
      if (grid !== null) {
        const fromGrid = lumaFromGrid(grid, crop);
        if (fromGrid !== null) {
          clearToneRetry();
          toneState.luminance = fromGrid;
          toneState.source = 'grid';
          const tone = toneForLuminance(fromGrid);
          toneState.tone = tone;
          applyBackgroundTone(theme, tone, settings);
          patchState({}); // 刷新设置页的「测得亮度 …」状态行
          return;
        }
      }

      // 兜底：现场解码图片量一次（旧图没有亮度图，或亮度图损坏）
      const seq = (toneState.seq += 1);
      loadBackgroundImage(token)
        .then((image) => {
          if (seq !== toneState.seq) return;
          if (image === null) {
            scheduleToneRetry(repaint, 'image');
            return;
          }
          const luminance = measureBackgroundLuminance(image, crop);
          if (luminance === null) {
            scheduleToneRetry(repaint, 'measure');
            return;
          }
          clearToneRetry();
          toneState.source = 'canvas';
          toneState.luminance = luminance;
          const tone = toneForLuminance(luminance);
          toneState.tone = tone;
          applyBackgroundTone(theme, tone, settings);
          patchState({}); // 刷新设置页的「测得亮度 …」状态行
        })
        .catch(() => {
          if (seq === toneState.seq) scheduleToneRetry(repaint, 'load');
        });
    }

    /**
     * 把用户选的图片压成 WebP Blob，同时算好 32×32 亮度图。
     *
     * 为什么要压：
     *   - 宿主侧请求体上限 24 MiB，但真正的问题是**内存与解码开销**：
     *     一张 6000×4000 的原图会占上百 MB 位图内存，而窗口最大也就 4K 宽；
     *   - WebP 会顺手剥掉 EXIF（含拍摄地点），只把像素发出去。
     *
     * 为什么在这里算亮度图：此时图片是用户本地文件（ImageBitmap），画进
     * canvas 必然同源、读得出来；存进设置后，自动明暗就不用再在页面里
     * 解码远程图片、也不会被 canvas 跨源限制卡住。
     *
     * @param file - 用户选的文件。
     * @returns Promise<{ blob: Blob, grid: string }>。
     */
    async function prepareImageUpload(file) {
      if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
        if (typeof file.type === 'string' && file.type.startsWith('image/')) return { blob: file, grid: '' };
        throw new Error('unsupported image');
      }
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        bitmap = await createImageBitmap(file);
      }
      const width = bitmap.width;
      const height = bitmap.height;
      if (!(width > 0 && height > 0)) throw new Error('empty image');
      const grid = encodeLumaGrid(bitmap);
      const scale = Math.min(1, BG_MAX_SIDE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (blob === null) throw new Error('encode failed');
      return { blob, grid };
    }

    /**
     * 上传背景图，返回新的 token 与亮度图。
     *
     * @param file - 用户选的文件。
     * @returns Promise<{ token: string, grid: string }>。
     */
    async function uploadBackground(file) {
      const { blob, grid } = await prepareImageUpload(file);
      const response = await fetch(API_BG, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'image/webp' },
        body: blob,
      });
      const payload = await response.json().catch(() => null);
      if (response.ok !== true || payload === null || payload.ok !== true) {
        // 404 / 405 = 宿主还是旧版本（路由没注册）。这需要重启 DSH，
        // 和「图片本身有问题」是两件事，设置页要给出不同的提示。
        const missing = response.status === 404 || response.status === 405;
        throw new Error(
          missing
            ? 'route-missing'
            : payload !== null && typeof payload.error === 'string'
              ? payload.error
              : 'upload failed',
        );
      }
      return { token: String(payload.token), grid };
    }

    // ==========================================================================
    // 样式表
    // ==========================================================================

    /**
     * 插件持有的全局样式。
     *
     * 分六段：氛围光背景 / 配色 / 清掉最外层双重底色 / 表面模糊 /
     * 信息面板底色 / 设置页控件。
     * 只引用 --dsw-* token 与本插件自己的 --dsh-glass-* 变量，不写死颜色
     * （氛围光的渐变是"美术"部分，按规范允许自带颜色）。
     */
    const CSS = `
/* ---------- 1. 氛围光背景：铺在 #root 底下，作为半透明表面的"背后那层" ---------- */
html[data-dsh-glass] body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: var(--dsh-glass-ambient, transparent);
}
html[data-dsh-glass][data-dsh-ambient="off"] body::before { display: none; }

/* ---------- 1b. 自定义背景图（2026-10 本轮新增）----------

   【它和氛围光的关系】
   背景图是**追加的一层**，固定在 z-index:-1，与 body::before（氛围光）同级，
   因为它在 DOM 里更靠后，所以画在氛围光之上、#root 内容之下：
     - 填充（cover）时图片是不透明的 → 氛围光被完全盖住；
     - 适应 / 平铺 / 居中时留白处会透出氛围光 → 配色选择仍然有意义。
   所以这里**不要**把 body::before 隐藏掉，那是留白的底色。

   【为什么用独立元素而不是 body::before】
   body::before 已经被氛围光占了；而且平铺 / 拉伸 / 居中需要每个元素自己的
   background-size·position·repeat，独立元素改起来最直接。

   【层级为什么是 -1】
   所有半透明表面都在 #root 里，图片必须在它们**后面**，否则会盖住界面。
   负 z-index 的固定定位子元素正好落在这个位置（和氛围光同一套做法）。 */

.dsh-glass-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  display: none;
  overflow: hidden;
  pointer-events: none;
}
html[data-dsh-glass][data-dsh-bg="on"] .dsh-glass-bg { display: block; }
.dsh-glass-bgImage {
  position: absolute;
  inset: 0;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
/* 蒙层：浅色盖白、深色盖黑 —— 和宿主「表面是白/黑半透明」同向，
   拉高后相当于给壁纸加雾，文字对比度立刻回来。透明度由 paint() 写到
   :root 的 --dsh-glass-bg-veil-alpha。 */
.dsh-glass-bgVeil {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, var(--dsh-glass-bg-veil-alpha, 0));
}
html[data-dsh-glass] body[data-ds-dark-theme] .dsh-glass-bgVeil {
  background: rgba(0, 0, 0, var(--dsh-glass-bg-veil-alpha, 0));
}

/* ---------- 2. 四套配色 × 明暗 ---------- */
html[data-dsh-glass="aurora"] body {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 10% 6%, rgba(99, 102, 241, 0.34) 0%, rgba(99, 102, 241, 0) 62%),
    radial-gradient(52% 48% at 90% 10%, rgba(20, 184, 166, 0.30) 0%, rgba(20, 184, 166, 0) 64%),
    radial-gradient(64% 58% at 72% 94%, rgba(168, 85, 247, 0.28) 0%, rgba(168, 85, 247, 0) 66%),
    linear-gradient(158deg, rgba(248, 250, 255, 0.94) 0%, rgba(238, 242, 255, 0.94) 46%, rgba(240, 253, 250, 0.94) 100%);
}
html[data-dsh-glass="aurora"] body[data-ds-dark-theme] {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 10% 6%, rgba(99, 102, 241, 0.50) 0%, rgba(99, 102, 241, 0) 62%),
    radial-gradient(52% 48% at 90% 10%, rgba(13, 148, 136, 0.42) 0%, rgba(13, 148, 136, 0) 64%),
    radial-gradient(64% 58% at 72% 94%, rgba(147, 51, 234, 0.38) 0%, rgba(147, 51, 234, 0) 66%),
    linear-gradient(158deg, rgba(10, 12, 22, 0.95) 0%, rgba(13, 17, 33, 0.95) 46%, rgba(7, 17, 23, 0.95) 100%);
}

html[data-dsh-glass="ocean"] body {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 12% 8%, rgba(56, 189, 248, 0.34) 0%, rgba(56, 189, 248, 0) 62%),
    radial-gradient(54% 50% at 88% 14%, rgba(37, 99, 235, 0.30) 0%, rgba(37, 99, 235, 0) 64%),
    radial-gradient(66% 60% at 68% 92%, rgba(45, 212, 191, 0.26) 0%, rgba(45, 212, 191, 0) 66%),
    linear-gradient(158deg, rgba(246, 251, 255, 0.94) 0%, rgba(235, 244, 255, 0.94) 46%, rgba(236, 254, 255, 0.94) 100%);
}
html[data-dsh-glass="ocean"] body[data-ds-dark-theme] {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 12% 8%, rgba(14, 165, 233, 0.46) 0%, rgba(14, 165, 233, 0) 62%),
    radial-gradient(54% 50% at 88% 14%, rgba(37, 99, 235, 0.42) 0%, rgba(37, 99, 235, 0) 64%),
    radial-gradient(66% 60% at 68% 92%, rgba(13, 148, 136, 0.36) 0%, rgba(13, 148, 136, 0) 66%),
    linear-gradient(158deg, rgba(8, 12, 22, 0.95) 0%, rgba(9, 16, 34, 0.95) 46%, rgba(6, 16, 22, 0.95) 100%);
}

html[data-dsh-glass="sunset"] body {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 10% 8%, rgba(251, 146, 60, 0.34) 0%, rgba(251, 146, 60, 0) 62%),
    radial-gradient(54% 50% at 90% 12%, rgba(244, 114, 182, 0.30) 0%, rgba(244, 114, 182, 0) 64%),
    radial-gradient(66% 60% at 70% 94%, rgba(139, 92, 246, 0.26) 0%, rgba(139, 92, 246, 0) 66%),
    linear-gradient(158deg, rgba(255, 250, 246, 0.94) 0%, rgba(255, 241, 242, 0.94) 46%, rgba(250, 245, 255, 0.94) 100%);
}
html[data-dsh-glass="sunset"] body[data-ds-dark-theme] {
  --dsh-glass-ambient:
    radial-gradient(58% 52% at 10% 8%, rgba(234, 88, 12, 0.46) 0%, rgba(234, 88, 12, 0) 62%),
    radial-gradient(54% 50% at 90% 12%, rgba(219, 39, 119, 0.40) 0%, rgba(219, 39, 119, 0) 64%),
    radial-gradient(66% 60% at 70% 94%, rgba(124, 58, 237, 0.38) 0%, rgba(124, 58, 237, 0) 66%),
    linear-gradient(158deg, rgba(22, 11, 10, 0.95) 0%, rgba(26, 12, 24, 0.95) 46%, rgba(16, 10, 24, 0.95) 100%);
}

html[data-dsh-glass="mono"] body {
  --dsh-glass-ambient:
    radial-gradient(60% 54% at 12% 8%, rgba(148, 163, 184, 0.26) 0%, rgba(148, 163, 184, 0) 62%),
    radial-gradient(56% 50% at 88% 14%, rgba(100, 116, 139, 0.22) 0%, rgba(100, 116, 139, 0) 64%),
    linear-gradient(158deg, rgba(249, 250, 251, 0.95) 0%, rgba(241, 243, 245, 0.95) 50%, rgba(248, 250, 252, 0.95) 100%);
}
html[data-dsh-glass="mono"] body[data-ds-dark-theme] {
  --dsh-glass-ambient:
    radial-gradient(60% 54% at 12% 8%, rgba(148, 163, 184, 0.20) 0%, rgba(148, 163, 184, 0) 62%),
    radial-gradient(56% 50% at 88% 14%, rgba(100, 116, 139, 0.18) 0%, rgba(100, 116, 139, 0) 64%),
    linear-gradient(158deg, rgba(16, 17, 20, 0.95) 0%, rgba(20, 21, 25, 0.95) 50%, rgba(14, 15, 18, 0.95) 100%);
}

/* ---------- 3. 清掉最外层双重底色 ----------
   .frame 与 .centerCol 都用 --dsw-alias-bg-base 铺底；两层叠加会让实际
   不透明度变成 1-(1-a)²（a=20% 时约 36%），滑块就对不上了。
   所以让最外层的 frame 透明，只由叶子表面承担半透明。
   !important 是必需的：这里要压过 CSS Modules 里同特异度的规则。 */
html[data-dsh-glass] [class*="_frame"] { background-color: transparent !important; }

/* ---------- 4. 表面模糊：把背后的氛围光真实模糊掉 ---------- */
html[data-dsh-glass] [class*="_sidebarCol"],
html[data-dsh-glass] [class*="_centerCol"],
html[data-dsh-glass] [class*="_rightbarCol"],
html[data-dsh-glass] [data-shortcut-modal] {
  -webkit-backdrop-filter: blur(var(--dsh-glass-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
  backdrop-filter: blur(var(--dsh-glass-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
}

/* ---------- 4a. 右栏 / 文件预览的真实铺底层（2026-10 本轮补）----------

   【为什么单列：上面 4 段只糊了"整列"，糊不到真正铺底的那一层】
   宿主右栏的结构是：
     [class*="_rightbarCol"]         ← 4 段在这里加了模糊
       └── [data-dockkit-pane]       ← 只是 flex 容器，自身无底色
             └── [class*="_tabHost_"] ← **真正铺底的一层**
                   （._tabHost_:not(._float_) / ._emptyTabHost_
                     { background: var(--dsw-alias-bg-base) }）
   第 5 段把 '_tabHost_' 的底色改成了 '--dsh-glass-panel-light/dark'
   （= panelOpacity，用户当前 50%），**但这一层自己没有 backdrop-filter**。
   结果就是：底色半透、背后正文清晰可见 —— 文件预览"又透明了"。

   为什么不能只靠 '_rightbarCol' 的模糊：
   'backdrop-filter' 只模糊**该元素背后**的内容。'_tabHost_' 在它**内部**，
   它那层半透明底色下面压着的是"已被模糊的列"，本来应该没问题；
   但 '_tabHost_' 一旦有自己更靠前的绘制层（或列本身没覆盖到这条链），
   就会露出未模糊的内容。直接给**铺底层自己**挂模糊，最确定。

   用 '--dsh-glass-overlay-blur'（浮层那一档，默认 32）而不是骨架档：
   这层要读文件内容，属于"要读字的地方"，和浮层是同一个可读性预算。

   【为什么这里加 backdrop-filter 是安全的】
   'backdrop-filter' 会为 fixed/absolute 后代建立包含块（见 4b 段）。
   dockkit 的定位于 fixed 的浮窗（'_float_'）在 '_floatingCell_' 里，
   与 pane/tabHost 是**兄弟**关系（'_floatingCell_' 与 '_tabCell_' 同级），
   不在这些元素的包含块链上。且 '_float_' 自己已在 4b 段有模糊。 */
html[data-dsh-glass] [data-dockkit-pane],
html[data-dsh-glass] [class*="_tabHost_"],
html[data-dsh-glass] [class*="_emptyTabHost_"] {
  -webkit-backdrop-filter: blur(var(--dsh-glass-overlay-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
  backdrop-filter: blur(var(--dsh-glass-overlay-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
}

/* ---------- 4b. 浮层模糊（本轮新增）----------

   【为什么需要这一段】
   第 3 层的 backdrop-filter 只加在三列（frame 骨架）上。浮在它们**之上**的
   窗口 —— 已归档面板、费用弹层、宿主各种 panel / dialog / float —— 自己带
   backdrop-filter 的只有少数几个（宿主用 --dsw-menu-backdrop-filter 的
   那批），其余都是「半透明底色 + 没有模糊」。底色一旦被 panelOpacity 压到
   50%，背后的对话正文就直接从窗口里透出来，字压字看不清。

   【为什么不靠改 token】
   --dsw-alias-bg-layer-1/2/3 是**全局**抬升面 token，除了浮层还被
   Input / JsonTree / SegmentedControl / 表格单元格消费。在 token 层给它们
   挂模糊会把这些小控件也变成毛玻璃，属于误伤。所以这里只在**浮层选择器**
   上挂 backdrop-filter。

   【选择器的两条线】
     A. 本工作区的三个插件用固定类名（.dsh-arch-panel / .dsh-cost-panel /
        .dsh-pet-dash-panel），直接点名最稳；
     B. 宿主用 CSS Modules，类名形如 <哈希>_<局部名>（client.js 内联样式）
        或 _<局部名>_<哈希>_<行>（web-frontend 打包产物）—— 两种约定在同一个
        应用里并存，所以**没有一种锚点能同时适配两者**，只能用子串匹配。
        局部名取自对 app.asar 的实测：
          _panel   → 11 个里 6 个已自带模糊，其余是半透明底
          _dialog  → Modal 内容层，宿主没给模糊
          _float_  → dockkit 浮窗（fixed + bg-layer-2）
        另外补一个**官方稳定钩子**：[role="dialog"][aria-modal="true"]。
        这是宿主 primitives 自己导出的 modalSelector
        （@deepseek-ai/dsh-client-ui-primitives：
        [role="dialog"][aria-modal="true"], [role="menu"]），
        官方拿它做快捷键的模态判定，所以比类名更不容易变。
        用它兜住「插件自己写的 Modal」——那些没有宿主 _dialog_ 类名。
        （[role="menu"] 没加：菜单表面由 .material 提供、已自带模糊。）

   【为什么要一串 :not() 排除（别删，删了会误伤）】
   [class*="_panel"] 是子串匹配，连侧栏的 _panelRow / _panelActive /
   _panelIcon / _panelTitle、按钮 _panelButton、提示 _panelHint 都会命中。
   这些是**行内小控件**，背后没有需要模糊的内容，挂上 backdrop-filter 只会
   白白多出几十个合成层（每行一个），换不来任何视觉效果。
   所以按「局部名」逐个排除 —— 局部名跨构建稳定，哈希变了也不影响。
   同理 [class*="_dialog"] 要排掉 _dialogButton。
   被保留下来的才是真浮层：wCInkW_panel（设置页）/ _1Wt2eq_panel（缩放条）/
   _VovcG_panel（字体提示）/ EBLgjq_panel（模型选择）等。

   【为什么 OUqwTW_panel 必须排除（最重要的一条）】
   它是右栏 dockkit 的**定位容器**（position:absolute，--dsh-dockkit-*），
   里面装着 position:fixed 的 _float_ 浮窗。CSS 规范
   （Filter Effects 2 §2.1）明确：backdrop-filter 非 none 的元素会**同时
   建立包含块**（"results in the creation of both a stacking context and a
   Containing Block for absolute and fixed position descendants"）。
   也就是说，一旦给 OUqwTW_panel 挂上 backdrop-filter，它内部所有 fixed 的
   dockkit 浮窗都会**改以这个容器为包含块**，整块跑偏 —— 这正是宿主在
   MenuSurface 注释里专门避开的坑（"keeps nested menus and fixed overlays
   free of an ancestor backdrop root or a new fixed-position containing
   block"）。所以必须用 :not([class*="OUqwTW_panel"]) 把它排除。
   （这一条同样排掉了 OUqwTW_panelBody，因为它是子串。）

   【为什么不用 min() 夹半径】
   上一版写了 blur(min(var(--dsh-glass-blur), 56px))。min() 在 blur() 里
   虽然合法，但一旦某个宿主/浏览器不认这个数学函数，整条 backdrop-filter
   声明会被判为非法而丢弃 —— 退化成"完全没有模糊"，正好是本段要修的问题。
   改为**由 JS 在 paint() 里夹好**再写入 --dsh-glass-overlay-blur
   （见 paint()），CSS 只读一个纯长度值，兼容性与可预测性都更好。

   【为什么不给 --dsw-alias-bg-layer-* 挂模糊】
   这三个是全局抬升面 token，还喂着 Input / JsonTree / SegmentedControl /
   表格单元格。在 token 层挂模糊会把它们一起变成毛玻璃（误伤）。

   【已知的重复（可接受）】
   Xt1eiG_panel / v1kfCW_panel / _2WTFBq_panel / zf92ZW_panel / CVUQCW_panel /
   EBLgjq_panel 这 6 个本来就用 :before 或自身挂了 --dsw-menu-backdrop-filter。
   它们也会被下面的选择器命中，等于同一个模糊值挂两遍 —— 值相同，
   视觉无差异，只是多一层合成。要用 CSS 区分"已有模糊"做不到，
   所以接受这点冗余，而不是把 6 个哈希写死进选择器（升级就失效）。 */

html[data-dsh-glass] .dsh-arch-panel,
html[data-dsh-glass] .dsh-cost-panel,
html[data-dsh-glass] .dsh-pet-dash-panel,
html[data-dsh-glass] [class*="_panel"]:not([class*="OUqwTW_panel"]):not([class*="_panelRow"]):not([class*="_panelActive"]):not([class*="_panelButton"]):not([class*="_panelHint"]):not([class*="_panelGlyph"]):not([class*="_panelIcon"]):not([class*="_panelList"]):not([class*="_panelTitle"]):not([class*="_panelHeader"]):not([class*="_panelCompact"]),
html[data-dsh-glass] [class*="_dialog"]:not([class*="_dialogButton"]),
html[data-dsh-glass] [class*="_float_"],
html[data-dsh-glass] [role="dialog"][aria-modal="true"] {
  -webkit-backdrop-filter: blur(var(--dsh-glass-overlay-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
  backdrop-filter: blur(var(--dsh-glass-overlay-blur, 32px)) saturate(var(--dsh-glass-saturate, 180%));
}

/* ---------- 4c. 发送框与任务面板模糊（2026-10 本轮新增）----------

   【为什么单独一段】
   4b 段按「浮层类名」匹配，覆盖不到这两处：
     - **发送框**（composer 输入卡片）不是浮层，它是嵌在对话流里的卡片，
       类名 .RlGAzG_card（ui-conversation 的 InputBar.module.css），
       底色 --dsw-specific-input-major，**没有** backdrop-filter。
     - **任务看板 / 任务面板**（EBLgjq_panel，experimental-agent-team）
       面板本体已由 4b 段覆盖，但它内部的卡片 EBLgjq_task / EBLgjq_member
       各自还有一层 --dsw-alias-bg-layer-2 底色 —— 半透明叠半透明，
       字会发灰。
   这两处都是「要读字」的地方，而且用户会长时间盯着（输入框、任务进度），
   所以它们跟随**面板不透明度**这一档，而不是表面档。

   【为什么发送框用 [data-composer-card] 而不是 .RlGAzG_card】
   哈希 RlGAzG 随构建变；而 data-composer-card 是宿主自己写在卡片上的
   **稳定 data 属性**，宿主内部多处拿它做锚点（agent-preset 的提示定位、
   input-trigger 的点击穿透判定、message-feedback 的 toast 挂载）——
   官方自己依赖它，所以比哈希可靠得多。实测（asar 扫描）：
   ui-conversation 里 "data-composer-card": true 正是挂在
   clsx(card, workspaceTrigger && cardWorkspaceTrigger) 那个 div 上。

   【为什么发送框挂模糊不会出问题】
   backdrop-filter 会建立 fixed 后代的包含块（见 4b 段的说明）。
   但 composer 卡片内部**没有 position:fixed 的元素**（已扫
   ui-input-trigger / ui-conversation / ui-chat 三个 bundle 的全部
   position:fixed 规则，只有 Xt1eiG_panel / _2WTFBq_panel 两个弹层，
   它们是 composer 的**兄弟**、不是子节点，且自身 portal 到 body）。
   所以给卡片挂模糊不会挪动任何浮层。

   【为什么任务卡片用 .EBLgjq_ 前缀而不是 [class*="_task"]】
   [class*="_task"] 会命中 q7hbua_rowTask（下拉菜单里的一行）和
   Dc7zOa_crumbSubagent 之类的无关项。这里点名 EBLgjq_ 这个
   实验性任务看板的局部名前缀，范围精确。它属于 experimental 包，
   万一将来移除，退化结果只是「任务卡片没有模糊」，不影响其他样式。

   【为什么不挂到 --dsw-specific-input-major 这个 token 上】
   实测它有 13 个消费点，包括 **ImageLightbox 的 .image 与 .close**
   （图片查看器的图片本体与关闭按钮）。在 token 层挂模糊会把图片本身
   也变成毛玻璃 —— 严重误伤。所以只在 composer 卡片的**选择器**上挂。

   【为什么还要带上审批卡 / 提问卡 / 文件卡】
   它们和发送框同属 composer 区域、同一个 --dsw-specific-input-major
   底色，视觉上是一组「输入区卡片」。只糊发送框、不糊旁边这几张，
   会显得一半糊一半不糊：
     - j_8BDW_card   → ui-approval 的审批卡（composer-side-clearance 对齐）
     - P2izSq_card / mAtvLq_card → ui-user-questions 的提问卡
     - GjTS2W_card   → ui-attachment 的文件卡（--dsw-specific-input-major,transparent）
     - KrzJGG_card   → ui-settings-account 的账号提示卡（同一底色）
   它们的哈希前缀各不相同，逐个写死等于给自己埋升级雷；改用
   「[class*="_card"] + 同一底色」是做不到的（CSS 无法按背景值选元素），
   所以这里点名这 5 个已知前缀。将来新增同类卡片时，
   退化结果只是「那张卡没模糊」，不会影响已覆盖的。 */

html[data-dsh-glass] [data-composer-card],
html[data-dsh-glass] [class*="EBLgjq_task"],
html[data-dsh-glass] [class*="EBLgjq_member"],
html[data-dsh-glass] [class*="j_8BDW_card"],
html[data-dsh-glass] [class*="P2izSq_card"],
html[data-dsh-glass] [class*="mAtvLq_card"],
html[data-dsh-glass] [class*="GjTS2W_card"],
html[data-dsh-glass] [class*="KrzJGG_card"] {
  -webkit-backdrop-filter: blur(var(--dsh-glass-composer-blur, 24px)) saturate(var(--dsh-glass-saturate, 180%));
  backdrop-filter: blur(var(--dsh-glass-composer-blur, 24px)) saturate(var(--dsh-glass-saturate, 180%));
}

/* ---------- 4d. composer 铺底模糊（2026-10 修正：只补模糊，绝不铺白底）----------

   【宿主的 composer 结构】
     div[data-composer-seat]          ← 宿主在这里铺了一层渐变底
       └── .composerStack
             ├── TodoPanel (.aSus8q_root)   ← 自带 backdrop-filter
             └── [data-composer-card]        ← 发送框
   卡片**之间还有一圈间隙**（卡片上方、清单与输入框之间、左右留白），
   那圈间隙没有元素负责模糊 —— 它就是 'composerSeat' 自己的底色：
     background: linear-gradient(180deg,
       color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
       var(--dsw-alias-bg-base) 36px);
   这层用的 '--dsw-alias-bg-base' 属于 SURFACES，本来就跟着「表面不透明度」
   半透明；问题只是**没有模糊**，背后的正文才会清清楚楚地透出来。
   所以这一段的全部职责就是补 blur —— 不写任何颜色。

   【血泪教训：不要在这里铺白色底】
   上一版为了"盖住背后的字"，给 composerSeat 和卡片逐层写了
   'background: color-mix(白 N%)'（还配了一个 'composerOpacity' 滑块）。后果：
     - 发送框的 background 被行内样式覆盖，不再跟随「表面不透明度」——
       拖透明度滑块时它一动不动，用户看到的就是"发送框不半透明了"；
     - composerSeat → composerStack → 卡片叠了三层白，越叠越实。
   正确的分工：**模糊负责挡住字，颜色继续交给 token。**
   发送框的底色是 '--dsw-specific-input-major'（同属 SURFACES），
   与其余半透明表面共用同一个「表面不透明度」滑块。

   【为什么这里加 backdrop-filter 是安全的】
   'backdrop-filter' 会为 fixed/absolute 后代建立包含块（见 4b 段）。
   composer 子树里唯一的 fixed 元素是 ContextMeter 的弹层
   （'_2WTFBq_panel'），而它是 **createPortal 到 body** 的
   （已核 'createPortal' 在该组件内为 true）→ 不在 composerSeat 的
   包含块链上，不会被带偏。stat-dialog（'Xt1eiG_panel'）同理是弹层。

   【为什么用 [data-composer-seat] 而不是 .Dc7zOa_composerSeat】
   'data-composer-seat' 是宿主自己写在那个 div 上的稳定 data 属性
   （实测 '"data-composer-seat": ""'），比哈希可靠。 */

html[data-dsh-glass] [data-composer-seat] {
  -webkit-backdrop-filter: blur(var(--dsh-glass-composer-blur, 24px)) saturate(var(--dsh-glass-saturate, 180%));
  backdrop-filter: blur(var(--dsh-glass-composer-blur, 24px)) saturate(var(--dsh-glass-saturate, 180%));
}

/* ---------- 4e. 发送框「零白底」（2026-10 第三修）----------

   【用户要什么】
   「白底还是挺明显，不能根除掉吗」。他要的是发送框不再自己铺一层白，
   只保留玻璃（模糊）+ 边框。

   【发送框身上的白色其实是两层】
     1. composerSeat 的渐变底 —— '--dsw-alias-bg-base'（SURFACES，30% 白）；
     2. 卡片自己的底色 —— '--dsw-specific-input-major'（同属 SURFACES）。
   两层叠起来 ≈ 1-(1-0.3)² ≈ 51% 白。在浅色背景上，"比周围白一截"就是这层差。

   【做法：两层都清成透明】
   注意这里是**直接清 background**，不是重定义 token：
     - 重定义 token 会波及 seat 子树里所有消费者（审批卡 / 提问卡 /
       文件卡都用 '--dsw-specific-input-major'），它们会一起失去底色；
     - 清 background 只作用于这两个元素自身，子卡片不受影响。

   【为什么清这两个就够】
   composerSeat → composerStack → 卡片的背景链上只有这两处有非透明底色
   （composerStack 是纯布局容器）。清掉后发送框 = 背后的对话表面 + 模糊，
   与页面其余部分同色。

   【代价（改之前想清楚）】
   发送框不再有独立面色，只剩 0.5px 边框与投影；背后内容滚过时是"纯毛玻璃"。
   哪天想找回一点分层，把 background 换成
   'color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 6%, transparent)'
   即可 —— 但那又开始"加白"了。

   【安全性】
   'background: transparent' 不会建立包含块，不影响 fixed 后代；
   模糊仍由 4d 的 backdrop-filter 承担。 */

html[data-dsh-glass] [data-composer-seat],
html[data-dsh-glass] [data-composer-card] {
  background: transparent;
}

/* ---------- 4f. 代码块底色（要读字的地方，必须给底）----------

   【现象】用户反馈：「代码里没有绿底的那些段直接是全透明的，字和背景糊在一起」。
   代码块（shiki 的 <pre>、工具卡里的 diff）本该有一层接近 #f8f9fa 的底色；
   周围表面被半透明主题压薄之后，它跟页面贴在一起，代码就"浮"在氛围光上了。

   【做法：把代码块钉回原生的 code-block 基色，不跟透明度走】
   代码是逐字读的内容，和「面板不透明度」是同一个可读性预算；但它不需要
   半透明 —— 半透明只会降低对比度。所以用静态基色：
   浅色 bluish-50（#f8f9fa）、深色 bluish-900。

   【为什么两套都写】
     - '--shiki-background'：shiki 给 <pre> 写的是行内
       'background-color: var(--shiki-background)'，所以改这个变量的值
       最干净（不用 !important 去顶行内样式）；
     - 'pre { background-color: … !important }'：兜底不走 shiki 的 <pre>
       （纯文本代码、diff 容器）。行内样式也能被 !important 盖过。

   【为什么不给行内 code 也加】
   行内代码自带 --dsw-alias-markdown-inline-code 底色（截图里是正常的灰底），
   不需要动；乱加会把正文行高和间距撑乱。 */

html[data-dsh-glass] body {
  --shiki-background: var(--dsw-static-neutral-bluish-50);
}
html[data-dsh-glass] body[data-ds-dark-theme] {
  --shiki-background: var(--dsw-static-neutral-bluish-900);
}
html[data-dsh-glass] pre {
  background-color: var(--dsw-static-neutral-bluish-50) !important;
}
html[data-dsh-glass] body[data-ds-dark-theme] pre {
  background-color: var(--dsw-static-neutral-bluish-900) !important;
}

/* ---------- 4g. 交付物 / 文件改动卡片（deliverables，2026-10 第四修）----------

   【现象】用户：「你给的任务结尾文件预览代码背景透明了」「代码里没有绿底色的
   那些段直接是全透明的，字和背景糊在一起」。

   【根因】这类卡片不属于 token 层的 PANELS，宿主用的是 **SURFACES 档**：
     - .kuvljq_card   —— 文件改动卡片（--dsw-alias-bg-layer-1）
     - .jmg6Sq_output —— 卡片里的代码输出块（--dsw-alias-bg-layer-1）
   而 '--dsw-alias-bg-layer-1' 被本插件归在 SURFACES（20% 白）→ 卡片和代码块
   几乎全透，代码字直接压在氛围光上。

   【修法】把它们接到**预览档**（previewOpacity，默认 85%）：这类卡片是"要读字"
   的内容，但又要和普通面板分开 —— 用户为了看清 diff 把它拉实，不该顺带
   把整个界面一起变实。所以给它们独立的 --dsh-glass-preview-* 变量。

   【为什么用类名子串】
   宿主是 CSS Modules，'kuvljq_/jmg6Sq_' 是局部名前缀（哈希随构建变，前缀稳定）。
   将来改名，退化结果只是"这两张卡又回到 20%"，不会误伤别处。 */

html[data-dsh-glass] [class*="kuvljq_card"],
html[data-dsh-glass] [class*="jmg6Sq_output"] {
  background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
}
html[data-dsh-glass] body[data-ds-dark-theme] [class*="kuvljq_card"],
html[data-dsh-glass] body[data-ds-dark-theme] [class*="jmg6Sq_output"] {
  background-color: var(--dsh-glass-preview-dark, var(--dsh-glass-panel-dark, transparent));
}

/* ---------- 4h. 文档预览自己的底色（2026-10 第四修·补）----------

   【现象】截图：文档的 diff 预览里，**带底色的增删行**还看得见，
   但**没有底色的上下文行**直接透出氛围光（#EDF8FF），字和背景糊在一起。

   【根因】文档预览组件 @deepseek-ai/dsh-client-ui-sidebar-documentpreview 的
   根节点根本没有 background：
     .TdjKvG_preview / .TdjKvG_body / .TdjKvG_textDocument 都不铺底，
   它**指望外层 _tabHost_ 给底色**。但这个预览并不总是住在 tabHost 里
   （浮动窗口 / 内嵌 diff 时外层是透明的），于是整块预览全透，
   只有 diff 行自己的绿/红底（.TdjKvG_line 上的 tint）还在。

   【修法】给预览根自己补一层**预览档**底色（previewOpacity，独立滑块），
   不再指望外层，也不跟面板档绑在一起。
   住在 tabHost 里时会叠成 panel + preview（70% + 85% ≈ 95%），可读性优先。

   【为什么连 _body 一起】
   文件预览有两种挂法：侧边栏是完整组件（根上带 _preview），
   而「鼠标悬停文件 → 查看代码」那个浮层只挂了内部节点（_body），
   没有 _preview 根。两处都写，悬停浮层才不会漏。
   代价：两处都命中时叠成 85% + 85% ≈ 97.75%（更实一点，可读性优先）。

   【为什么连 BMNXqa_frame 一起】
   它是 HTML/PDF 预览的 iframe frame，宿主原本用
   'background: var(--dsw-alias-bg-base)'（SURFACES 20%）→ 同样接近全透。 */

html[data-dsh-glass] [class*="TdjKvG_preview"],
html[data-dsh-glass] [class*="TdjKvG_body"],
html[data-dsh-glass] [class*="BMNXqa_frame"] {
  background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
}
html[data-dsh-glass] body[data-ds-dark-theme] [class*="TdjKvG_preview"],
html[data-dsh-glass] body[data-ds-dark-theme] [class*="TdjKvG_body"],
html[data-dsh-glass] body[data-ds-dark-theme] [class*="BMNXqa_frame"] {
  background-color: var(--dsh-glass-preview-dark, var(--dsh-glass-panel-dark, transparent));
}

/* ---------- 4i. 悬停预览卡（HoverCard 的 preview 变体，2026-10 第七修）----------

   【现象】「已编辑文件」卡片的底色已经实了，但**鼠标悬停到文件上弹出的
   代码浮层还是全透**，能看见后面的对话文字。

   【为什么前面几处都没修到它】
   那个浮层**不是**文档预览组件（没有 TdjKvG_* 的根），也不是 kuvlq 卡片本体。
   它是 @deepseek-ai/dsh-client-ui-primitives 的 HoverCard，由
   ui-deliverables 以 variant="preview" 渲染，宿主样式是：

     ._preview_38jqx_52 {
       background: var(--dsw-alias-bg-layer-1);   ← SURFACES（20% 白）
       box-shadow: var(--dsw-elevation-panel);
       …
     }

   '--dsw-alias-bg-layer-1' 被本插件归在 SURFACES（跟表面不透明度走），
   于是这张卡只有 20% 白 → 看起来跟全透差不多。

   【修法】把这张卡接到**预览档**（previewOpacity）。它和 kuvlq 卡片、
   文档预览是同一个可读性预算。

   【选择器为什么这么写】
   宿主的类是 CSS Modules：'_card_38jqx_9 _preview_38jqx_52'
   ——'38jqx' 是构建哈希，会变；'_card_' / '_preview_' 是局部名，稳定。
   用「同一个 class 属性里同时含 _preview_ 与 _card_」双匹配：
   既不吃哈希，也不会误伤名叫 '_cardPreview_' 之类的不含下划线的类。
   特异性（0,3,1）> 宿主的（0,1,0），能压过它的 background。 */

html[data-dsh-glass] [class*="_preview_"][class*="_card_"] {
  background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
}
html[data-dsh-glass] body[data-ds-dark-theme] [class*="_preview_"][class*="_card_"] {
  background-color: var(--dsh-glass-preview-dark, var(--dsh-glass-panel-dark, transparent));
}

/* ---------- 4j. 文字保护：壁纸上的字（2026-10-17 新增）----------

   【为什么需要这一段】
   设了背景图之后，用户很可能把「表面不透明度」压到个位数、把模糊调到 0
   （就是为了看清壁纸），于是对话正文几乎直接压在照片上：深色字和照片的
   明暗、纹理混在一起，读起来费劲。

   【为什么不能靠「把表面调实」】
   这位用户的原话是「改透明度为什么给发送框变成不半透明了，我要的是
   可调节透明度，不是加白色底色」——自动加白底等于替他改掉了他想要的
   透明度。所以这里**一个像素的底色都不加**。

   【做法：只给字加一圈光晕】
   text-shadow 在字形**背后**画光：深色字 + 白晕 = 字幕式的局部对比，
   背景完全不动。浅色主题白晕、深色主题黑晕，与表面明暗同向。
   它是可继承属性，写在 body 上就会覆盖所有文字（包括 portal 到 body 的浮层）。

   【为什么全局挂，而不是只挂正文区】
   壁纸铺满整个窗口，侧栏、顶栏、发送框里的字都在照片上；逐个点名宿主
   容器既容易漏、又会随宿主结构变化失效。光晕落在本来就有底色的面板上时
   （白晕叠白底）视觉上不可见，所以全局挂没有副作用。

   【强度为什么这么小】
   1px 实边 + 2px 柔边 + 3px 更柔的投影，是「描边」不是「发光」；
   再大就会让字看着发虚，反而不清楚。

   【第二轮：光晕不够，还要把「次要文字」加深一档】
   实测截图：状态栏、输入框占位符、侧栏「工作区」这类字用的是
   --dsw-alias-label-secondary / tertiary / caption，浅色主题下是
   bluish-700/600/400（#61666b / #81858c / #a3a8b0）。白晕在浅灰字上是
   **帮倒忙**（灰字压在白晕上，对比度反而更低），必须把字本身加深。
   这里按同一套调色板往下走：secondary→bluish-750（#43454a，保留层级感，
   不一步压到和正文一样黑）、tertiary/caption→bluish-700（#61666b）；
   深色主题反向：secondary→200、tertiary→300、caption→400。
   只改**颜色的明度**，不碰字号/字重，所以不会引起重排。

   【已知边界】
   内联 SVG 图标用 currentColor，会跟着上面三个 token 一起变深/变亮；
   真正画不了的只有**原生窗口菜单和标题栏按钮**（Electron / Windows 画的，
   不在 DOM 里），那是窗口材质的边界，CSS 够不到。 */

html[data-dsh-glass][data-dsh-bg="on"][data-dsh-guard="on"] body {
  text-shadow:
    0 0 1px rgba(255, 255, 255, 0.95),
    0 0 2px rgba(255, 255, 255, 0.85),
    0 1px 3px rgba(255, 255, 255, 0.55);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-700);
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-700);
}
html[data-dsh-glass][data-dsh-bg="on"][data-dsh-guard="on"] body[data-ds-dark-theme] {
  text-shadow:
    0 0 1px rgba(0, 0, 0, 0.95),
    0 0 2px rgba(0, 0, 0, 0.85),
    0 1px 3px rgba(0, 0, 0, 0.6);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-200);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-300);
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-400);
}

/* ---------- 4k. 去掉右上角窗口按钮的「盒子」（2026-10-17 新增）----------

   【现象】
   截图里右上角三个系统按钮（最小化 / 最大化 / 关闭）底下有一块比标题栏
   亮一档的方块 —— 用户描述为「有边框」。

   【根因（已从 preload 源码核实，不是猜）】
   Electron 的原生 titleBarOverlay 需要一个底色，DSH 的 preload 用一个隐藏
   probe 把**标题栏底色**算出来传给主进程：

     probe.style.background = var(--dsw-specific-sidebar-fill)
     getComputedStyle(probe) → rgba(…) → ipcRenderer.send(windowsAppearance, …)
     → mainWindow.setTitleBarOverlay({ color, symbolColor })

   而页面自己的标题条（[data-windows-titlebar] .frame:before）**也**铺了
   同一个 --dsw-specific-sidebar-fill。于是右上角那一块把同一个半透明白
   **刷了两遍**：opacity=5 时 0.05 叠 0.05 ≈ 0.0975，正好比标题栏亮一档，
   看起来就是一个方块/边框。

   【做法：让 probe 的底色变透明】
   只把这个 probe 的 background-color 改透明（它是 body 的直接子元素、
   无 class/id、空元素、内联样式里同时有 pointer-events 与 visibility），
   主进程就会收到 rgba(0,0,0,0) → 原生覆盖层不再画底 → 露出下面那条
   同样的标题栏，方块消失。**字形颜色不动**（symbolColor 读的是 color，
   不是 background-color）。

   选择器故意写得很窄：命中不到就退回现状（顶多还是有个方块），
   绝不会误伤别的元素。 */

html[data-dsh-glass] body > span:not([class]):not([id])[style*="pointer-events"][style*="visibility"]:empty {
  background-color: transparent !important;
}

/* ---------- 5. 信息面板底色（panelOpacity）----------
   右栏的 dockkit 宿主 —— 文件预览就住在这里 —— 原本用 --dsw-alias-bg-base
   铺底（见 web-frontend 里的 ._tabHost_:not(._float_),
   ._emptyTabHost_{background:var(--dsw-alias-bg-base)}），与中央列共用同一个
   token。直接改这个 token 会把整个对话区一起变实，所以在这里**局部重定义**：
   只作用于右栏子树、dockkit 的 pane 容器和 tab 宿主，中央列不受影响。

   为什么三个选择器都要：
     - [class*="_rightbarCol"] —— 右栏整列（macOS 上它自己就有底色）；
     - [data-dockkit-pane]     —— dockkit 的 pane 容器（稳定 data 属性）；
     - [class*="_tabHost_"]    —— 真正铺底的那一层（子串匹配避开
       _tabHostHeader_ / _emptyTabHost_ 的误伤：_tabHost_ 要求 tabHost
       后紧跟下划线，那两个都不满足）。

   面板底色走独立的 --dsh-glass-panel-* 变量（由 paint() 按 panelOpacity 写入），
   与 token 层的 PANELS 是同一个百分比 —— 两条路径都跟着同一个滑块。
   回退值写 transparent 而不是 var(--dsw-alias-bg-base)：
   自定义属性自引用会构成循环，整条声明会被丢弃。 */
html[data-dsh-glass] [class*="_rightbarCol"],
html[data-dsh-glass] [data-dockkit-pane],
html[data-dsh-glass] [class*="_tabHost_"],
html[data-dsh-glass] [class*="_emptyTabHost_"] {
  --dsw-alias-bg-base: var(--dsh-glass-panel-light, transparent);
}
html[data-dsh-glass] body[data-ds-dark-theme] [class*="_rightbarCol"],
html[data-dsh-glass] body[data-ds-dark-theme] [data-dockkit-pane],
html[data-dsh-glass] body[data-ds-dark-theme] [class*="_tabHost_"],
html[data-dsh-glass] body[data-ds-dark-theme] [class*="_emptyTabHost_"] {
  --dsw-alias-bg-base: var(--dsh-glass-panel-dark, transparent);
}

/* ---------- 6. 设置页 ---------- */
.dsh-glass-page { display: flex; flex-direction: column; width: 100%; }
.dsh-glass-intro {
  padding: 0 0 16px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh-glass-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-glass-row:last-child { border-bottom: none; }
.dsh-glass-rowMain { min-width: 0; }
.dsh-glass-title { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 20px; }
.dsh-glass-desc { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-glass-control { display: flex; flex: none; align-items: center; gap: 10px; }

/* 开关：照宿主 Switch 的观感手写（不引用 primitives 包） */
.dsh-glass-switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-state-idle-primary);
  cursor: pointer;
  transition: background var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease);
}
.dsh-glass-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); }
.dsh-glass-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb);
  transition: transform var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease);
}
.dsh-glass-switch[aria-checked="true"]::after { transform: translateX(16px); }
.dsh-glass-switch:focus-visible,
.dsh-glass-swatch:focus-visible,
.dsh-glass-segBtn:focus-visible,
.dsh-glass-button:focus-visible,
.dsh-glass-slider:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* 滑块 */
.dsh-glass-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 160px;
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dsh-glass-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0, 0, 0, 0.05));
  cursor: pointer;
}
.dsh-glass-value {
  min-width: 46px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* 配色选择 */
.dsh-glass-swatches { display: flex; gap: 8px; }
.dsh-glass-swatch {
  width: 36px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
.dsh-glass-swatch[aria-pressed="true"] {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-glass-swatch-aurora { background: linear-gradient(135deg, #6366f1, #14b8a6 55%, #a855f7); }
.dsh-glass-swatch-ocean { background: linear-gradient(135deg, #38bdf8, #2563eb 55%, #2dd4bf); }
.dsh-glass-swatch-sunset { background: linear-gradient(135deg, #fb923c, #f472b6 55%, #8b5cf6); }
.dsh-glass-swatch-mono { background: linear-gradient(135deg, #cbd5e1, #64748b 55%, #334155); }

/* ---------- 6b. 背景图片：缩略图 / 分段按钮 / 裁剪器（2026-10 本轮新增） ---------- */
.dsh-glass-bgControl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-glass-bgPreview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 60px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background-color: var(--dsw-alias-bg-layer-1);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 14px;
}
.dsh-glass-bgMeta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
.dsh-glass-bgError { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }

/* 分段按钮：显示方式 5 选 1 */
.dsh-glass-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md, 8px);
}
.dsh-glass-segBtn {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-glass-segBtn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-glass-segBtn[aria-pressed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 500;
}

/* 整段式设置块（裁剪器要占满宽度，Row 的「左文右控件」放不下） */
.dsh-glass-block { padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-glass-block:last-child { border-bottom: none; }
.dsh-glass-blockHead { margin-bottom: 12px; }
.dsh-glass-blockBody { display: flex; flex-direction: column; gap: 12px; }

/* 裁剪器 */
.dsh-glass-cropHead { display: flex; align-items: baseline; gap: 10px; }
.dsh-glass-cropHead .dsh-glass-title { flex: 1; }
.dsh-glass-cropValue {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dsh-glass-cropStage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  max-height: 280px;
  /* 10px 内边距很关键：四角手柄是以「边框中心」定位的（translate(-50%,-50%)），
     图片正好贴到舞台边缘时，手柄有一半会被 overflow:hidden 裁掉、点不到。
     留出 10px，手柄就完整落在舞台内部。 */
  padding: 10px;
  overflow: hidden;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1);
  user-select: none;
}
.dsh-glass-cropBox {
  position: relative;
  line-height: 0;
  cursor: crosshair;
  touch-action: none;
}
.dsh-glass-cropImg {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 260px;
  pointer-events: none;
  user-select: none;
}
/* 选择框自己带「压暗四周」的巨阴影：比再叠一个四块遮罩 DOM 简单得多 */
.dsh-glass-cropRect {
  position: absolute;
  border: 1px solid #fff;
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.55),
    0 0 0 9999px rgba(15, 23, 42, 0.55);
  cursor: move;
  touch-action: none;
}
.dsh-glass-cropHandle {
  position: absolute;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.55);
  touch-action: none;
}
.dsh-glass-cropHandle[data-handle="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.dsh-glass-cropHandle[data-handle="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.dsh-glass-cropHandle[data-handle="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.dsh-glass-cropHandle[data-handle="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.dsh-glass-cropHint { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 17px; }

/* 按钮 */
.dsh-glass-button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-glass-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-glass-button:disabled { opacity: 0.55; cursor: default; }
.dsh-glass-button:disabled:hover { background: transparent; }

/* 保存失败提示 */
.dsh-glass-error { padding: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }

/* 诊断行：等宽小字，太长时横向滚动而不是撑破设置页 */
.dsh-glass-diag {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
  font-family: var(--dsw-font-family-code, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
`;

    // ==========================================================================
    // 设置页组件
    // ==========================================================================

    /** 订阅模块级设置状态。 */
    function useGlassState() {
      const [snapshot, setSnapshot] = React.useState(getState);
      React.useEffect(() => subscribe(() => setSnapshot(getState())), []);
      return snapshot;
    }

    /**
     * 一行设置：左边标题+说明，右边控件。
     *
     * @param props - title / description / children。
     * @returns 该行的元素树。
     */
    function Row({ title, description, children }) {
      return h(
        'div',
        { className: 'dsh-glass-row' },
        h(
          'div',
          { className: 'dsh-glass-rowMain' },
          h('div', { className: 'dsh-glass-title' }, title),
          description ? h('div', { className: 'dsh-glass-desc' }, description) : null,
        ),
        h('div', { className: 'dsh-glass-control' }, children),
      );
    }

    /**
     * 手写开关（role="switch" + aria-checked，键盘可操作）。
     *
     * @param props - checked / label / onChange。
     * @returns 开关按钮。
     */
    function Switch({ checked, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        className: 'dsh-glass-switch',
        onClick: () => onChange(!checked),
      });
    }

    /**
     * 手写滑块：range 输入 + 右侧数值。
     *
     * @param props - value / min / max / step / label / unit / onChange。
     * @returns 滑块与数值。
     */
    function Slider({ value, min, max, step, label, unit, onChange }) {
      return h(
        React.Fragment,
        null,
        h('input', {
          type: 'range',
          className: 'dsh-glass-slider',
          min,
          max,
          step,
          value,
          'aria-label': label,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'dsh-glass-value' }, `${value}${unit}`),
      );
    }

    /**
     * 整段式设置块：标题 + 说明 + 占满整行的内容。
     *
     * 为什么不用 Row：Row 是「左文右控件」的两列布局，裁剪器需要整行宽度
     * （图片 + 选框），塞进右控件会被压成一条细缝。
     *
     * @param props - title / description / children。
     * @returns 该块的元素树。
     */
    function Block({ title, description, children }) {
      return h(
        'div',
        { className: 'dsh-glass-block' },
        h(
          'div',
          { className: 'dsh-glass-blockHead' },
          h('div', { className: 'dsh-glass-title' }, title),
          description ? h('div', { className: 'dsh-glass-desc' }, description) : null,
        ),
        h('div', { className: 'dsh-glass-blockBody' }, children),
      );
    }

    /**
     * 分段按钮（单选，role=group + aria-pressed）。
     *
     * @param props - value / options / label / onChange。
     * @returns 一排按钮。
     */
    function Segmented({ value, options, label, onChange }) {
      return h(
        'div',
        { className: 'dsh-glass-seg', role: 'group', 'aria-label': label },
        ...options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dsh-glass-segBtn',
              'aria-pressed': value === option.value,
              title: option.label,
              onClick: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      );
    }

    /**
     * 自定义裁剪器。
     *
     * 【交互】和系统截图 / 修图工具的裁剪框一致：
     *   - 在图片上按下拖动 → 重新框选一个区域；
     *   - 在框内按下拖动   → 整体平移（撞到边就停住）；
     *   - 在四个角按下拖动 → 改变尺寸（对角固定）。
     *
     * 【坐标全用比例（0..1），不用像素】
     *   图片在设置页里是被缩放的（max-height 260px）。像素坐标一旦遇到
     *   窗口缩放、面板变宽就会失准；比例坐标同时能和 CSS 的 % 定位、
     *   canvas 的像素裁切一一对应，存盘也不怕换分辨率。
     *
     * 【拖动过程只写本地 draft，松手才提交】
     *   每次提交都会触发 paint() → 重新裁一张 canvas → toBlob()。拖动时
     *   每帧都做这件事会让设置页卡顿，所以过程只更新选框，松手才落状态。
     *
     * @param props - url / crop / onChange / t。
     * @returns 裁剪器元素树。
     */
    function CropEditor({ url, crop, onChange, t }) {
      const boxRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const [draft, setDraft] = React.useState(null);
      const [natural, setNatural] = React.useState(null);
      const value = draft === null ? normalizeCrop(crop) : draft;

      /** 把一个 pointer 事件折成图片内的比例坐标。 */
      const fracOf = (event) => {
        const box = boxRef.current;
        if (box === null || box === undefined) return { x: 0, y: 0 };
        const rect = box.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : 1;
        const height = rect.height > 0 ? rect.height : 1;
        return {
          x: Math.min(1, Math.max(0, (event.clientX - rect.left) / width)),
          y: Math.min(1, Math.max(0, (event.clientY - rect.top) / height)),
        };
      };

      const onPointerDown = (event) => {
        event.preventDefault();
        const point = fracOf(event);
        const base = normalizeCrop(draft === null ? crop : draft);
        const handle = event.target !== null && event.target !== undefined ? event.target.dataset?.handle : undefined;
        let mode = 'new';
        if (typeof handle === 'string' && handle.length > 0) {
          mode = handle;
        } else if (
          point.x >= base.x &&
          point.x <= base.x + base.w &&
          point.y >= base.y &&
          point.y <= base.y + base.h
        ) {
          mode = 'move';
        }
        dragRef.current = { mode, start: point, base, next: base };
        setDraft(base);
        const box = boxRef.current;
        if (box !== null && box !== undefined && typeof box.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try {
            box.setPointerCapture(event.pointerId);
          } catch {
            // 某些环境不支持 pointer capture：拖动仍能工作，只是移出元素会断
          }
        }
      };

      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        const point = fracOf(event);
        const base = drag.base;
        let next;

        if (drag.mode === 'move') {
          next = normalizeCrop({
            x: base.x + (point.x - drag.start.x),
            y: base.y + (point.y - drag.start.y),
            w: base.w,
            h: base.h,
          });
        } else if (drag.mode === 'new') {
          const x = Math.min(drag.start.x, point.x);
          const y = Math.min(drag.start.y, point.y);
          next = normalizeCrop({
            x,
            y,
            w: Math.max(Math.abs(point.x - drag.start.x), CROP_MIN),
            h: Math.max(Math.abs(point.y - drag.start.y), CROP_MIN),
          });
        } else {
          // 四角缩放：对角固定，只推进被拖的那两条边
          const right = base.x + base.w;
          const bottom = base.y + base.h;
          let x = base.x;
          let y = base.y;
          let w = base.w;
          let h = base.h;
          if (drag.mode.includes('w')) {
            const edge = Math.min(point.x, right - CROP_MIN);
            x = edge;
            w = right - edge;
          }
          if (drag.mode.includes('e')) {
            w = Math.max(CROP_MIN, Math.min(point.x - base.x, 1 - base.x));
          }
          if (drag.mode.includes('n')) {
            const edge = Math.min(point.y, bottom - CROP_MIN);
            y = edge;
            h = bottom - edge;
          }
          if (drag.mode.includes('s')) {
            h = Math.max(CROP_MIN, Math.min(point.y - base.y, 1 - base.y));
          }
          next = normalizeCrop({ x, y, w, h });
        }

        drag.next = next;
        setDraft(next);
      };

      const onPointerUp = (event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        dragRef.current = null;
        setDraft(null);
        const box = boxRef.current;
        if (
          box !== null &&
          box !== undefined &&
          typeof box.releasePointerCapture === 'function' &&
          event !== undefined &&
          event.pointerId !== undefined
        ) {
          try {
            box.releasePointerCapture(event.pointerId);
          } catch {
            // 没捕获成功时 release 会抛，忽略即可
          }
        }
        onChange(normalizeCrop(drag.next));
      };

      const cropText = `${Math.round(value.w * 100)}% × ${Math.round(value.h * 100)}%`;
      const sizeText = natural === null ? '' : `${natural.w} × ${natural.h}`;

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dsh-glass-cropHead' },
          h('div', { className: 'dsh-glass-title' }, t('bg.crop.title')),
          h('div', { className: 'dsh-glass-cropValue' }, sizeText === '' ? cropText : `${cropText} · ${sizeText}`),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-glass-button',
              onClick: () => onChange({ ...CROP_FULL }),
            },
            t('bg.crop.reset'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-glass-cropStage' },
          h(
            'div',
            {
              ref: boxRef,
              className: 'dsh-glass-cropBox',
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
            },
            h('img', {
              className: 'dsh-glass-cropImg',
              src: url,
              alt: '',
              draggable: false,
              onLoad: (event) => {
                const element = event.currentTarget;
                setNatural({ w: element.naturalWidth, h: element.naturalHeight });
              },
            }),
            h('div', {
              className: 'dsh-glass-cropRect',
              style: {
                left: `${value.x * 100}%`,
                top: `${value.y * 100}%`,
                width: `${value.w * 100}%`,
                height: `${value.h * 100}%`,
              },
            },
              h('span', { className: 'dsh-glass-cropHandle', 'data-handle': 'nw' }),
              h('span', { className: 'dsh-glass-cropHandle', 'data-handle': 'ne' }),
              h('span', { className: 'dsh-glass-cropHandle', 'data-handle': 'sw' }),
              h('span', { className: 'dsh-glass-cropHandle', 'data-handle': 'se' }),
            ),
          ),
        ),
        h('div', { className: 'dsh-glass-cropHint' }, t('bg.crop.hint')),
      );
    }

    /**
     * 「自定义主题」设置分区。
     *
     * @param props - 宿主给的槽位 props，外加绑定了命名空间的翻译函数 t。
     * @returns 设置页元素树。
     */
    /**
     * 读取上一次 paint() 写下的自检快照，拼成一行可读的诊断文本。
     *
     * 为什么要把它显示在设置页上：这个环境拿不到 DevTools / CDP，
     * "改了没效果"只能靠推断。把浏览器算出来的**真值**（不是我们的意图）
     * 摆在用户眼前，能一眼区分是"没命中元素"还是"命中了但被覆盖"。
     * 用户拖任意滑块都会触发 paint → 快照刷新 → 这行字跟着更新。
     */
    function diagnose() {
      try {
        if (typeof window === 'undefined') return 'n/a';
        const snapshot = window.__dshGlass;
        if (snapshot === undefined || snapshot === null) return 'no snapshot';
        const parts = [
          `targets=${String(snapshot.targets)}`,
          `seat=${snapshot.seatFound === true ? 'Y' : 'N'}`,
          `bg=${String(snapshot.seatBackground)}`,
          `card=${String(snapshot.cardBackground)}`,
          `filter=${String(snapshot.seatBackdrop)}`,
          `blur=${String(snapshot.composerBlur)}`,
          // 背景图：img=N 表示没设图或不认识；有图时带上显示方式与裁剪比例。
          `img=${snapshot.bgImage === true ? `${String(snapshot.bgFit)}·${String(snapshot.bgCrop)}` : 'N'}`,
          `guard=${snapshot.bgGuard === true ? 'Y' : 'N'}`,
          `tone=${String(snapshot.bgTone)}/${String(snapshot.bgLuma)}`,
          `src=${String(snapshot.bgToneSource)}`,
          `mode=${String(snapshot.bgScheme)}`,
          snapshot.bgToneError === null || snapshot.bgToneError === undefined
            ? null
            : `err=${String(snapshot.bgToneError)}x${String(snapshot.bgToneAttempts)}`,
        ].filter((part) => part !== null);
        return parts.join(' · ');
      } catch {
        return 'n/a';
      }
    }

    function GlassSettingsSection(props) {
      const t = props.t;
      const settings = useGlassState();
      const [failed, setFailed] = React.useState(false);

      // ---- 背景图片（2026-10 本轮新增）----
      /** 隐藏的 <input type=file>：按钮点它，等价于系统文件选择框。 */
      const fileRef = React.useRef(null);
      const [bgBusy, setBgBusy] = React.useState(false);
      const [bgError, setBgError] = React.useState('');
      const hasBackground = typeof settings.bgImage === 'string' && settings.bgImage.length > 0;

      // 自动明暗的实时状态行（量到多少、切到哪、还是失败在重试）。
      const toneStatus = (() => {
        if (!hasBackground) return '';
        if (settings.bgAutoTone === false) return t('bgAutoTone.off');
        if (toneState.luminance === null) {
          return toneState.error
            ? `${t('bgAutoTone.failed')}${toneState.attempts > 0 ? ` (${toneState.attempts}/6)` : ''}`
            : t('bgAutoTone.measuring');
        }
        const luma = Math.round(toneState.luminance * 100) / 100;
        if (toneState.tone === 'dark') return `${t('bgAutoTone.measured')} ${luma} → ${t('bgAutoTone.dark')}`;
        if (toneState.tone === 'light') return `${t('bgAutoTone.measured')} ${luma} → ${t('bgAutoTone.light')}`;
        return `${t('bgAutoTone.measured')} ${luma} → ${t('bgAutoTone.keep')}`;
      })();

      // 所有改动都走同一条路：先改本地状态（即时生效），
      // 再由引擎的保存副作用异步落盘。
      const update = (patch) => {
        setFailed(false);
        patchState(patch);
      };

      /**
       * 选好图之后的完整流程：压缩 → 上传 → 换 token → 裁剪复位。
       *
       * 为什么裁剪要复位：裁剪坐标是相对**原图**的，换了一张图之后
       * 旧坐标会指到完全不同的位置，看起来像"随机裁了一块"。
       */
      const pickBackground = (file) => {
        setBgBusy(true);
        setBgError('');
        uploadBackground(file)
          .then((result) => {
            // 亮度图跟着图片一起存：自动明暗之后只需查表，不再依赖页面解码
            update({ bgImage: result.token, bgCrop: { ...CROP_FULL }, bgLumaGrid: result.grid });
            setBgBusy(false);
          })
          .catch((error) => {
            setBgError(
              error instanceof Error && error.message === 'route-missing'
                ? t('bg.needRestart')
                : t('bg.uploadError'),
            );
            setBgBusy(false);
          });
      };

      /** 打开文件选择框。 */
      const chooseBackground = () => {
        const input = fileRef.current;
        if (input !== null && input !== undefined && typeof input.click === 'function') input.click();
      };

      /** 文件框变化：取第一个文件，清空 value 以便再次选同一张也能触发。 */
      const onFilePicked = (event) => {
        const list = event.target.files;
        const file = list !== null && list !== undefined ? list[0] : undefined;
        event.target.value = '';
        if (file === undefined || file === null) return;
        pickBackground(file);
      };

      /** 移除背景图：本地立刻清空（宿主路由不存在时也不影响结果）。 */
      const clearBackground = () => {
        update({ bgImage: '', bgCrop: { ...CROP_FULL } });
        setBgError('');
        fetch(API_BG, { method: 'DELETE' }).catch(() => {});
      };

      return h(
        'div',
        { className: 'dsh-glass-page' },
        h('div', { className: 'dsh-glass-intro' }, t('intro')),

        h(Row, {
          title: t('enable.title'),
          description: t('enable.desc'),
          children: h(Switch, {
            checked: settings.enabled,
            label: t('enable.title'),
            onChange: (next) => update({ enabled: next }),
          }),
        }),

        h(Row, {
          title: t('opacity.title'),
          description: t('opacity.desc'),
          children: h(Slider, {
            value: settings.opacity,
            min: RANGES.opacity[0],
            max: RANGES.opacity[1],
            step: 1,
            label: t('opacity.title'),
            unit: t('unitPercent'),
            onChange: (next) => update({ opacity: next }),
          }),
        }),

        h(Row, {
          title: t('panelOpacity.title'),
          description: t('panelOpacity.desc'),
          children: h(Slider, {
            value: settings.panelOpacity,
            min: RANGES.panelOpacity[0],
            max: RANGES.panelOpacity[1],
            step: 1,
            label: t('panelOpacity.title'),
            unit: t('unitPercent'),
            onChange: (next) => update({ panelOpacity: next }),
          }),
        }),

        h(Row, {
          title: t('blur.title'),
          description: t('blur.desc'),
          children: h(Slider, {
            value: settings.blur,
            min: RANGES.blur[0],
            max: RANGES.blur[1],
            step: 1,
            label: t('blur.title'),
            unit: t('unitPx'),
            onChange: (next) => update({ blur: next }),
          }),
        }),

        h(Row, {
          title: t('overlayBlur.title'),
          description: t('overlayBlur.desc'),
          children: h(Slider, {
            value: settings.overlayBlur,
            min: RANGES.overlayBlur[0],
            max: RANGES.overlayBlur[1],
            step: 1,
            label: t('overlayBlur.title'),
            unit: t('unitPx'),
            onChange: (next) => update({ overlayBlur: next }),
          }),
        }),

        h(Row, {
          title: t('composerBlur.title'),
          description: t('composerBlur.desc'),
          children: h(Slider, {
            value: settings.composerBlur,
            min: RANGES.composerBlur[0],
            max: RANGES.composerBlur[1],
            step: 1,
            label: t('composerBlur.title'),
            unit: t('unitPx'),
            onChange: (next) => update({ composerBlur: next }),
          }),
        }),

        h(Row, {
          title: t('previewOpacity.title'),
          description: t('previewOpacity.desc'),
          children: h(Slider, {
            value: settings.previewOpacity,
            min: RANGES.previewOpacity[0],
            max: RANGES.previewOpacity[1],
            step: 1,
            label: t('previewOpacity.title'),
            unit: t('unitPercent'),
            onChange: (next) => update({ previewOpacity: next }),
          }),
        }),

        h(Row, {
          title: t('saturate.title'),
          description: t('saturate.desc'),
          children: h(Slider, {
            value: settings.saturate,
            min: RANGES.saturate[0],
            max: RANGES.saturate[1],
            step: 5,
            label: t('saturate.title'),
            unit: t('unitPercent'),
            onChange: (next) => update({ saturate: next }),
          }),
        }),

        h(Row, {
          title: t('ambient.title'),
          description: t('ambient.desc'),
          children: h(Switch, {
            checked: settings.ambient,
            label: t('ambient.title'),
            onChange: (next) => update({ ambient: next }),
          }),
        }),

        h(Row, {
          title: t('accent.title'),
          description: t('accent.desc'),
          children: h(
            'div',
            { className: 'dsh-glass-swatches', role: 'group', 'aria-label': t('accent.title') },
            ...ACCENTS.map((id) =>
              h('button', {
                key: id,
                type: 'button',
                className: `dsh-glass-swatch dsh-glass-swatch-${id}`,
                'aria-pressed': settings.accent === id,
                'aria-label': t(`accent.${id}`),
                title: t(`accent.${id}`),
                onClick: () => update({ accent: id }),
              }),
            ),
          ),
        }),

        h(Row, {
          title: t('bg.title'),
          description: t('bg.desc'),
          children: h(
            'div',
            { className: 'dsh-glass-bgControl' },
            h(
              'div',
              {
                className: 'dsh-glass-bgPreview',
                style: hasBackground ? { backgroundImage: `url("${backgroundUrl(settings.bgImage)}")` } : undefined,
                onDragOver: (event) => event.preventDefault(),
                onDrop: (event) => {
                  event.preventDefault();
                  const file = event.dataTransfer !== null && event.dataTransfer !== undefined
                    ? event.dataTransfer.files?.[0]
                    : undefined;
                  if (file !== undefined && file !== null) pickBackground(file);
                },
              },
              hasBackground ? null : t('bg.none'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-glass-button',
                disabled: bgBusy,
                onClick: chooseBackground,
              },
              t(bgBusy ? 'bg.busy' : hasBackground ? 'bg.replace' : 'bg.choose'),
            ),
            hasBackground
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-glass-button',
                  disabled: bgBusy,
                  onClick: clearBackground,
                },
                t('bg.remove'),
              )
              : null,
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/*',
              style: { display: 'none' },
              onChange: onFilePicked,
            }),
            bgError === '' ? null : h('span', { className: 'dsh-glass-bgError', role: 'alert' }, bgError),
          ),
        }),

        h(Row, {
          title: t('bg.fit.title'),
          description: t('bg.fit.desc'),
          children: h(Segmented, {
            value: normalizeFit(settings.bgFit),
            label: t('bg.fit.title'),
            options: FIT_MODES.map((id) => ({ value: id, label: t(`bg.fit.${id}`) })),
            onChange: (next) => update({ bgFit: next }),
          }),
        }),

        hasBackground
          ? h(Row, {
            title: t('bgGuard.title'),
            description: t('bgGuard.desc'),
            children: h(Switch, {
              // 默认开：缺键（宿主还没重启）时也按「开」处理
              checked: settings.bgGuard !== false,
              label: t('bgGuard.title'),
              onChange: (next) => update({ bgGuard: next }),
            }),
          })
          : null,

        hasBackground
          ? h(Row, {
            title: t('bgAutoTone.title'),
            description: h(
              React.Fragment,
              null,
              t('bgAutoTone.desc'),
              h('div', { className: 'dsh-glass-bgMeta' }, toneStatus),
            ),
            children: h(Switch, {
              checked: settings.bgAutoTone !== false,
              label: t('bgAutoTone.title'),
              onChange: (next) => update({ bgAutoTone: next }),
            }),
          })
          : null,

        hasBackground
          ? h(Row, {
            title: t('bg.dim.title'),
            description: t('bg.dim.desc'),
            children: h(Slider, {
              value: settings.bgDim,
              min: RANGES.bgDim[0],
              max: RANGES.bgDim[1],
              step: 1,
              label: t('bg.dim.title'),
              unit: t('unitPercent'),
              onChange: (next) => update({ bgDim: next }),
            }),
          })
          : null,

        hasBackground
          ? h(Block, {
            title: t('bg.crop.title'),
            description: t('bg.crop.desc'),
            children: h(CropEditor, {
              url: backgroundUrl(settings.bgImage),
              crop: settings.bgCrop,
              t,
              onChange: (next) => update({ bgCrop: next }),
            }),
          })
          : null,

        h(Row, {
          title: t('diag.title'),
          description: t('diag.desc'),
          children: h('code', { className: 'dsh-glass-diag' }, diagnose()),
        }),

        h(Row, {
          title: '',
          description: '',
          children: h(
            React.Fragment,
            null,
            failed ? h('span', { className: 'dsh-glass-error', role: 'alert' }, t('saveError')) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-glass-button',
                onClick: () => {
                  // 保留自动明暗的「切换前基准」：复位会清掉 bgImage，
                  // 紧接着 paint 会走还原路径；如果把基准一起清了，
                  // 重启过的情况下就不知道该切回哪个模式了。
                  // 还原完成后 restoreBackgroundTone 会把它清空。
                  update({ ...DEFAULTS, bgBaseTheme: getState().bgBaseTheme });
                  // 复位也把磁盘上的背景图删掉，否则留下一张永远用不到的大图。
                  fetch(API_BG, { method: 'DELETE' }).catch(() => {});
                },
              },
              t('reset'),
            ),
          ),
        }),
      );
    }

    // ==========================================================================
    // 插件主体
    // ==========================================================================

    /** 硬依赖的服务：slots（挂设置页）、locale（文案）、theme（token 覆盖层）。 */
    const inject = ['slots', 'locale', 'theme'];

    /**
     * 客户端插件主体。
     *
     * @param ctx - 客户端 cordis 上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'glass-theme: dictionaries');

      // 样式表：注册在 ctx.effect 里，插件卸载时随 <style> 一起回收。
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-glass-ranswork';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'glass-theme: stylesheet');

      const theme = ctx.theme;

      /** 当前生效的 token 覆盖层撤销函数。 */
      let disposeTokens = null;

      /** 把设置投影到文档：CSS 变量、data 属性、token 覆盖层。 */
      const paint = () => {
        const settings = getState();
        const root = document.documentElement;
        const panelPercent = clamp(settings.panelOpacity, RANGES.panelOpacity);
        const blurPx = clamp(settings.blur, RANGES.blur);
        root.style.setProperty('--dsh-glass-blur', `${blurPx}px`);
        root.style.setProperty('--dsh-glass-saturate', `${clamp(settings.saturate, RANGES.saturate)}%`);

        // 浮层模糊半径：在这里夹上限，而不是在 CSS 里用 min()。
        // 理由见 CSS 第 4b 段 —— CSS 数学函数一旦不被支持，整条
        // backdrop-filter 会被丢弃（退化成"完全没模糊"），而这里算出的
        // 永远是一个纯长度值，任何 Chromium 都认。
        //
        // 上限 56px 的来历：模糊半径要明显小于"浮层边缘到窗口边缘"的距离，
        // 否则边缘会露出背后没被模糊的像素。宿主最宽的对话框 680px、
        // 设置页 800px，在 1280 宽窗口里到边缘约 240~300px，56px 仍有富余。
        //
        // 【为什么要 or 一个默认值】
        // clamp() 对 undefined 的约定是"退回区间下界"，也就是 0 —— 对不透明度
        // 是对的（越界按最透处理），但对模糊是**静默失效**：宿主半侧的 DEFAULTS
        // 是模块加载时读进内存的，改了新键必须重启才认；在重启前的窗口期里
        // GET 回来的 value 没有 overlayBlur，clamp(undefined) 会算出 0，
        // 于是"浮层模糊"看起来像没生效。这里显式退回 DEFAULTS 的同名值，
        // 让新旧宿主都能立刻看到模糊。
        const blurOr = (key) => {
          const raw = settings[key];
          const fallback = DEFAULTS[key];
          const numeric = typeof raw === 'number' ? raw : Number(raw);
          return Number.isFinite(numeric) ? clamp(raw, RANGES[key]) : fallback;
        };
        const overlayBlur = blurOr('overlayBlur');
        root.style.setProperty('--dsh-glass-overlay-blur', `${Math.min(overlayBlur, 56)}px`);

        // 发送框 / 任务卡片模糊：独立一档（本轮新增）。
        // 它比浮层更"贴身"（卡片就在正文旁边），半径过大会让输入的字看着发飘，
        // 所以另给一个 40px 上限，并且默认值更低（24px）。
        const composerBlur = blurOr('composerBlur');
        root.style.setProperty('--dsh-glass-composer-blur', `${Math.min(composerBlur, 40)}px`);

        // 【关键：带 token 引用的颜色变量必须写在 body 上，不能写 :root】
        // 宿主的 `--dsw-static-neutral-bluish-00/950` 定义在 **body** 的规则里
        // （design-platform.css 的 `body{--dsw-static-…}`）。而自定义属性里的
        // var() 是在**声明它的那个元素**上求值的：
        //   :root { --dsh-glass-panel-light: color-mix(… var(--dsw-static-neutral-bluish-00) 70% …) }
        // 在 :root 上找不到这个 token → 整条自定义属性变成 guaranteed-invalid →
        // 所有 `var(--dsh-glass-panel-light)` 静默失效 → background 回退成
        // transparent。表现就是「面板 / 预览 / 改动卡片怎么调都还是全透」。
        // 所以颜色变量写到 body（token 的定义处）；模糊这类纯长度变量留在
        // :root 没关系（它们不引用 token）。
        const colorHost = document.body ?? root;

        // 清掉 inline-v2 写在 :root 上的 composer 白底变量。
        // HMR 热替换只换 JS、不刷新页面；旧版本写过的行内变量会留在 DOM 上，
        // 不清掉的话"白底"会像幽灵一样继续存在，用户以为改了没用。
        for (const target of [root, colorHost]) {
          target.style.removeProperty('--dsh-glass-composer-fill-light');
          target.style.removeProperty('--dsh-glass-composer-fill-dark');
        }

        // 文件预览 / 改动卡片的底色：**单独一档**（本轮新增）。
        // 为什么不能复用 panelOpacity：预览和 diff 要读代码，用户把面板调低之后
        // 它们会一起糊掉；为了看清 diff 去拉高面板，又会把整个界面一起变实。
        // 所以给它们自己的百分比，拉高只影响这几处。
        // 缺键（宿主还没重启、不认识 previewOpacity）时退回 DEFAULTS，
        // 避免 clamp(undefined) = 0 把预览变全透。
        const previewRaw = settings.previewOpacity;
        const previewPercent =
          previewRaw === undefined || previewRaw === null || !Number.isFinite(Number(previewRaw))
            ? DEFAULTS.previewOpacity
            : clamp(previewRaw, RANGES.previewOpacity);
        colorHost.style.setProperty(
          '--dsh-glass-preview-light',
          `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${previewPercent}%, transparent)`,
        );
        colorHost.style.setProperty(
          '--dsh-glass-preview-dark',
          `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${previewPercent}%, transparent)`,
        );

        // 信息面板底色：右栏（文件预览所在）与 dockkit pane 用它覆盖
        // --dsw-alias-bg-base，与 token 层的 PANELS 是同一个百分比。
        colorHost.style.setProperty(
          '--dsh-glass-panel-light',
          `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${panelPercent}%, transparent)`,
        );
        colorHost.style.setProperty(
          '--dsh-glass-panel-dark',
          `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${panelPercent}%, transparent)`,
        );

        if (settings.enabled) {
          root.setAttribute('data-dsh-glass', settings.accent);
          root.setAttribute('data-dsh-ambient', settings.ambient ? 'on' : 'off');
        } else {
          root.removeAttribute('data-dsh-glass');
          root.removeAttribute('data-dsh-ambient');
        }

        // ---- 背景图（2026-10 本轮新增）----
        //
        // 蒙层浓度：纯数字变量，写在 :root 上没问题（不引用任何 token）。
        // 缺键时退回 DEFAULTS，理由同 blurOr —— clamp(undefined) = 0 会让
        // 「蒙层」看起来没生效。
        const dimRaw = settings.bgDim;
        const dimPercent =
          dimRaw === undefined || dimRaw === null || !Number.isFinite(Number(dimRaw))
            ? DEFAULTS.bgDim
            : clamp(dimRaw, RANGES.bgDim);
        root.style.setProperty('--dsh-glass-bg-veil-alpha', String(dimPercent / 100));

        // 有图且主题开着 → 打开背景层（CSS 用这个属性决定 display）。
        const hasBackground = typeof settings.bgImage === 'string' && settings.bgImage.length > 0;
        if (settings.enabled && hasBackground) root.setAttribute('data-dsh-bg', 'on');
        else root.removeAttribute('data-dsh-bg');

        // 文字保护：只在「主题开着 + 有壁纸 + 开关没关」时打开。
        // 用 `!== false` 而不是 `=== true`：宿主还没重启时不认识这个键，
        // 此时应该按默认值（开）处理，而不是因为 undefined 变成关。
        if (settings.enabled && hasBackground && settings.bgGuard !== false) root.setAttribute('data-dsh-guard', 'on');
        else root.removeAttribute('data-dsh-guard');

        // 投影背景图本身：显示方式、裁剪合成、换图时 revoke 旧 blob URL。
        applyBackground(settings);

        // 自动明暗：按图片亮度切换 light / dark（只在图片/裁剪/开关变化时量一次）。
        syncBackgroundTone(theme, settings, paint);

        // 【行内兜底】composer 区域：只补模糊，**绝不写 background**
        //
        // 【为什么还要行内写一次】
        // 宿主把 composer 的底色放在 composerSeat 的 `background: linear-gradient(...)`
        // 上，而它下面还有 '.composerStack' / 卡片等容器。CSS 段的
        // backdrop-filter 已经覆盖了 seat 与卡片，但「哪一层是实际铺底的」
        // 会随宿主版本/展开状态变化；行内样式优先级最高，能保证这几个已知层
        // 一定拿到模糊，不依赖选择器是否被同特异度规则压过。
        //
        // 【为什么背景一律不碰（2026-10 修正，别改回去）】
        // 上一版在这里写了 `background: color-mix(白 N%)`，本意是"盖住背后的字"。
        // 代价是把发送框自己的 --dsw-specific-input-major 顶掉了：
        // 它不再跟随「表面不透明度」，拖滑块纹丝不动 —— 用户的原话是
        // "改透明度为什么给发送框变成不半透明了，我要的是可调节透明度"。
        // 挡住背后文字靠的是 blur，颜色必须留给 token。
        const paintComposer = () => {
          const filter = `blur(${Math.min(composerBlur, 40)}px) saturate(${clamp(settings.saturate, RANGES.saturate)}%)`;

          // 【为什么要"从内容往上爬"而不是只取 [data-composer-seat]】
          // 实测/读源码确认 composer 区域至少有这几层：
          //   [data-composer-seat]  → .composerStack → (TodoPanel | [data-composer-card])
          // 到底哪一层需要模糊，取决于宿主版本与展开状态；只赌一层就会像
          // 上一轮那样"改了但没效果"。所以这里以**实际内容元素**为锚点，
          // 向上走到 composer 区域边界，逐层补上 backdrop-filter。
          const boundaries = '[data-composer-seat], [data-conversation-region="composer"]';
          const anchors = [
            ...document.querySelectorAll('[data-testid="todo-panel"]'),
            ...document.querySelectorAll('[data-composer-card]'),
            ...document.querySelectorAll('[data-composer-seat]'),
            // 兜底：宿主的 CSS Modules 局部名（哈希会变，局部名稳定）。
            // 上面三个 data 属性若因版本变化失效，这两个还能命中。
            ...document.querySelectorAll('[class*="composerSeat"]'),
            ...document.querySelectorAll('[class*="composerStack"]'),
          ];
          const targets = new Set();
          for (const anchor of anchors) {
            let node = anchor;
            let depth = 0;
            while (node instanceof HTMLElement && depth < 6) {
              targets.add(node);
              if (node.matches(boundaries)) break;
              node = node.parentElement;
              depth += 1;
            }
          }
          for (const target of targets) {
            // 先清旧版本残留：inline-v2 曾给这些元素写过 background 与
            // composer 白底变量，热替换后行内样式不会自己消失。
            target.style.removeProperty('background');
            target.style.removeProperty('--dsh-glass-composer-fill-light');
            target.style.removeProperty('--dsh-glass-composer-fill-dark');
            target.style.setProperty('backdrop-filter', filter);
            target.style.setProperty('-webkit-backdrop-filter', filter);
          }
          return targets.size;
        };
        const composerTargets = paintComposer();

        // 【自检】把关键结论写到 window 上，便于在控制台一眼看到
        // 到底有没有命中、命中几个、以及浏览器算出来的真值。
        // 无副作用，下次 paint 覆盖。
        try {
          const seat = document.querySelector('[data-composer-seat]');
          const card = document.querySelector('[data-composer-card]');
          const cropForDiag = normalizeCrop(settings.bgCrop);
          // 当前生效的明暗（诊断用：确认 auto-tone 到底把主题切成了什么）
          let activeScheme = null;
          try {
            const themeSnapshot = theme !== undefined && typeof theme.getTheme === 'function' ? theme.getTheme() : null;
            if (themeSnapshot !== null && themeSnapshot !== undefined && themeSnapshot.active !== undefined) {
              activeScheme = themeSnapshot.active.colorScheme;
            }
          } catch {
            activeScheme = null;
          }
          window.__dshGlass = {
            rev: 'inline-v3',
            enabled: settings.enabled,
            targets: composerTargets,
            composerBlur,
            seatFound: seat !== null,
            seatBackground: seat === null ? null : getComputedStyle(seat).backgroundColor,
            seatBackdrop: seat === null ? null : getComputedStyle(seat).backdropFilter,
            seatHeight: seat === null ? null : Math.round(seat.getBoundingClientRect().height),
            cardBackground: card === null ? null : getComputedStyle(card).backgroundColor,
            // 背景图：有图 / 显示方式 / 裁剪比例（确认设置真的走到了 paint）
            bgImage: hasBackground,
            bgFit: normalizeFit(settings.bgFit),
            bgGuard: settings.bgGuard !== false,
            // 自动明暗：tone 是量出来的结论（'dark' / 'light' / null=中间调未切）
            bgTone: toneState.tone,
            bgLuma: toneState.luminance === null ? null : Math.round(toneState.luminance * 100) / 100,
            bgToneSource: toneState.source,
            bgToneError: toneState.error,
            bgToneAttempts: toneState.attempts,
            bgScheme: activeScheme,
            bgCrop: hasBackground
              ? `${Math.round(cropForDiag.w * 100)}%×${Math.round(cropForDiag.h * 100)}%`
              : '',
          };
        } catch {
          // 自检失败不影响绘制
        }

        // 先撤旧层再压新层：overrideTokens 同 source 重复调用是"整层替换"，
        // 但显式撤销能让"关闭主题"这条路径确定性地回到原生 token。
        if (disposeTokens !== null) {
          disposeTokens();
          disposeTokens = null;
        }
        if (settings.enabled && theme !== undefined && typeof theme.overrideTokens === 'function') {
          disposeTokens = theme.overrideTokens(TOKEN_SOURCE, buildTokens(settings));
        }
      };

      // 背景图层：在 paint 之前建好，保证首帧就有元素可写；
      // 卸载时连同 blob: URL 一起回收（否则每换一次裁剪就漏一个 URL）。
      ctx.effect(() => {
        ensureBackgroundLayer();
        return () => disposeBackgroundLayer();
      }, 'glass-theme: background layer');

      // 卸载时把我们替用户切换过的明暗还回去（不留「深色主题幽灵」），
      // 顺便清掉重试定时器。
      ctx.effect(() => () => {
        clearToneRetry();
        restoreBackgroundTone(theme, getState(), false);
      }, 'glass-theme: restore background tone');

      ctx.effect(() => {
        paint();
        return subscribe(paint);
      }, 'glass-theme: paint');

      // composerSeat 是宿主渲染出来的，paint() 首次执行时它可能还不存在
      // （首帧 / 切换会话时会重建）。所以额外挂一个轻量 MutationObserver：
      // 只在出现新的 [data-composer-seat] 时重跑一次 paint()，
      // 用 requestAnimationFrame 合并同一帧内的多次变动。
      ctx.effect(() => {
        let scheduled = false;
        const schedule = () => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            paint();
          });
        };
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof HTMLElement)) continue;
              if (node.matches('[data-composer-seat]') || node.querySelector('[data-composer-seat]') !== null) {
                schedule();
                return;
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        schedule();
        return () => observer.disconnect();
      }, 'glass-theme: composer seat observer');

      // 启动时从宿主读回上次的设置。读不到就沿用出厂默认值（首帧已经是玻璃），
      // 不把失败暴露给用户——这只是一个偏好文件。
      //
      // 合并顺序：DEFAULTS → 本地镜像 → 宿主。
      // **宿主认识的键以宿主为准；宿主不认识的键由镜像补上。**
      // 判断「认不认识」不能靠猜，直接用宿主的响应：它回了 `defaults`
      // 就说明它认识那些键 —— 在 `defaults` 里不存在的键，就是这份宿主
      // 还不认识的（改了 DEFAULTS 但还没重启的窗口期），必须保住镜像里的值，
      // 否则用户刚拖的滑块会被一次刷新打回默认。
      ctx.effect(() => {
        let alive = true;
        const mirrored = readMirror();
        patchState({ ...DEFAULTS, ...mirrored });
        fetch(API)
          .then((res) => (res.ok ? res.json() : null))
          .then((payload) => {
            if (!alive || payload === null || typeof payload !== 'object') return;
            const value = payload.value;
            if (value === null || typeof value !== 'object') return;
            // 宿主认识的键集 = 它自己的 defaults 键集（拿不到就退回本文件的 DEFAULTS）
            const hostDefaults = payload.defaults !== null && typeof payload.defaults === 'object' ? payload.defaults : null;
            const known = hostDefaults === null ? null : new Set(Object.keys(hostDefaults));
            const merged = { ...value };
            if (known !== null) {
              for (const key of Object.keys(DEFAULTS)) {
                // 宿主不认识这个键（旧版宿主还没重启），但镜像/当前状态里有 → 保住它。
                // 这里不能只处理 number：bgImage 是字符串、bgCrop 是对象，
                // 只按数字类型判断会把「选好的壁纸」在刷新后丢掉。
                if (!known.has(key) && getState()[key] !== undefined) {
                  merged[key] = getState()[key];
                }
              }
            }
            patchState(merged);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, 'glass-theme: load settings');

      // 写回宿主：合并 150ms 内的连续改动，避免拖滑块时把请求打爆。
      ctx.effect(() => {
        let timer = null;
        let pending = null;
        const flush = () => {
          timer = null;
          const body = pending;
          pending = null;
          if (body === null) return;
          fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).catch(() => {});
        };
        const off = subscribe(() => {
          pending = { ...getState() };
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(flush, 150);
        });
        return () => {
          off();
          if (timer !== null) clearTimeout(timer);
          flush();
        };
      }, 'glass-theme: save settings');

      // 设置页：等 shell 声明了 settings.section 槽位后再挂我们的条目。
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'glass-theme',
            order: SECTION_ORDER,
            label: () => t('nav'),
          },
          (ownerProps) => h(GlassSettingsSection, { ...ownerProps, t }),
        ),
      );
    }

    return { name: 'glass-theme', inject, apply };
  },
});
