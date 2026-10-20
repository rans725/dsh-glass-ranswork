# dsh-glass-ranswork · 自定义主题

给 DeepSeek Harness Web 界面加上「半透明 + 背景模糊」的毛玻璃外观，并在
**设置 → 自定义主题** 里提供一个完整的调参页（启用 / 不透明度 / 面板不透明度 /
模糊 / 饱和度 / 氛围光 / 配色 / **自定义背景图片**）。

出厂默认即用户要的 **80% 半透明**（`opacity: 20`，即表面 20% 不透明）；
**信息面板单独一档 `panelOpacity: 85`**，保证弹层和文件预览里的字看得清。

## 快速开始

> **升级之前先看「升级」一节。** 把 `.../main.tar.gz` 当安装地址时，pnpm 会把
> 那个 tarball 的 integrity 和 version 一起写进 lockfile —— `main` 会动，
> 你的依赖不会跟着动。重装多少次都还是当初装下的那个版本。

1. 打开 DSH → **设置 → 插件 → 安装插件**；
2. 粘贴地址（四选一，按网络环境挑）：

   **npm（推荐；能 `pnpm update`，也能走 npmmirror）**

   ```
   dsh-glass-ranswork@^1.0.2
   ```

   **codeload 固定版本（GitHub 主站不通时推荐）**

   ```
   https://codeload.github.com/rans725/dsh-glass-ranswork/tar.gz/refs/tags/v1.0.2
   ```

   **Release 安装包（固定版本）**

   ```
   https://github.com/rans725/dsh-glass-ranswork/releases/download/v1.0.2/dsh-glass-ranswork-1.0.2.tgz
   ```

   **本地目录**：把仓库 zip（Code → Download ZIP）或 Release 的 `.tgz` 解压，
   填含 `package.json` 的那层目录，例如 `D:\Plugins\dsh-glass-ranswork`。

3. 装完按提示**重启 DSH**，打开 **设置 → 自定义主题** 即可调外观。
4. 设置页顶部会显示当前加载的版本号（如 `v1.0.2`）；有新版时多一行提示。

## 安装

本包是一个 **DSH bundle**（`package.json` 的 `dsh.bundle.patch` 指向
`cordis.patch.yml`，`dsh.client` 声明浏览器半侧），不需要构建、没有依赖。

### 方式一：npm（推荐）

```
dsh-glass-ranswork@^1.0.2
```

npm 上的包与 GitHub tag 是同一份内容，由 CI 在打 tag 时自动发布（见文末「发布」）。
好处是版本可以写成 `^1.0.2`，升级走 `pnpm update`，也能命中 npmmirror 等镜像。

也可以在 profile 目录里直接装：

```powershell
pnpm add dsh-glass-ranswork@^1.0.2
```

### 方式二：codeload 直链（固定版本，不需要 Git）

```
https://codeload.github.com/rans725/dsh-glass-ranswork/tar.gz/refs/tags/v1.0.2
```

为什么不写 `https://github.com/.../archive/...`：

- `github.com` 只负责 302 跳到 `codeload.github.com`；主站被墙 / 不稳时，
  pnpm 的 HEAD 请求会 `ETIMEDOUT`，而真正下发 tar 的 codeload 往往是通的；
- codeload 直链少一次跳转，受限网络下成功率明显更高，代码不用改一行。

> **版本号必须写进 URL。** `refs/heads/main` 看着“永远最新”，但 lockfile 一旦
> 记录了这个 spec 的 integrity，pnpm 不会为了同一个 spec 重新解析远端。
> 升级 = 换成新 tag 的 URL 再装一次（见「升级」）。

> **为什么不推荐 `github:` 前缀**：pnpm 解析 `github:` 依赖会调用系统 `git`；
> Windows 上没装 Git 就会报 `git ls-remote failed`。上面的地址由 pnpm 直接
> 下载解包，不需要 Git。

### 方式三：Release 安装包（固定版本）

到 [Releases](https://github.com/rans725/dsh-glass-ranswork/releases) 下载
`dsh-glass-ranswork-1.0.2.tgz`，安装时填它的**本地路径**，或直接填资源地址：

```
https://github.com/rans725/dsh-glass-ranswork/releases/download/v1.0.2/dsh-glass-ranswork-1.0.2.tgz
```

> 资产地址同样先经过 `github.com`。主站不通时，改用上面的 codeload 直链或 npm。

### 方式四：本地目录 / zip

两种来源都可以：

- 仓库页 **Code → Download ZIP**（解压后是 `dsh-glass-ranswork-main/`）；
- 或 Release 里的 `dsh-glass-ranswork-1.0.2.tgz`（解压后是 `package/`）。

把**含 `package.json` 的那一层目录**放到任意位置，在安装入口填它的绝对路径，例如：

```
D:\Plugins\dsh-glass-ranswork
```

> 安装器会把依赖写进当前 profile 的 `package.json` 并激活 bundle，
> 不需要手动改配置文件。

### 兼容性

- 在 **DSH 0.2.0-rc.2**（Windows 桌面版）上开发与验证；
- 插件只用到公开客户端服务（`slots` / `locale` / `theme`）和宿主 `webServer`，
  没有私有 API、没有原生依赖；DSH 大版本升级后如果主题 token 改名，
  退化结果是「某块颜色/模糊不生效」，不会崩。

### 卸载

设置 → 插件 → 卸载。插件不会改 DSH 本体；设置文件在
`$DSH_HOME/glass-theme.json`，壁纸在 `$DSH_HOME/glass-theme-bg.<ext>`，
删掉即可彻底复位。

## 升级

先确认当前版本：**设置 → 自定义主题** 顶部有 `v1.0.2`（旧版宿主没有这行，
可以在 profile 的 `node_modules/dsh-glass-ranswork/package.json` 里看）。

### npm 装的

在 profile 目录（Windows 默认 `%USERPROFILE%\.dsh\profiles\desktop`）执行：

```powershell
pnpm update dsh-glass-ranswork
# 或显式指定版本
pnpm add dsh-glass-ranswork@^1.0.2
```

然后重启 DSH、刷新页面。设置与壁纸不会动（它们存在 `$DSH_HOME`）。

### tarball / Release 装的

三步：

1. 把 profile `package.json` 里的旧 spec 换成新 tag 的 URL；
2. 删掉 `pnpm-lock.yaml` 里对应的 `dsh-glass-ranswork@...` 条目（或整份 lockfile）；
3. `pnpm install`，重启 DSH。

或者一步到位：

```powershell
pnpm add https://codeload.github.com/rans725/dsh-glass-ranswork/tar.gz/refs/tags/v1.0.2
```

### 为什么“重装一次”不升级

pnpm 对 tarball 依赖记录的是 `spec + integrity + version`。spec 没变（还是
`.../heads/main.tar.gz`）时，它认为这份依赖已经解析过，直接用 lockfile 里的
旧包，**不会**去远端重新 HEAD。`main` 更新了、tag 打了，都和你的 lockfile 无关。

只有下面两种情况会真正换包：

- spec 变了（新 tag 的 URL / 新版本号）；
- 你显式让 pnpm 重新解析（`pnpm update`、删 lockfile）。

### 卡住时的自查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 重装后版本不变 | lockfile 钉住了旧 spec | 换成新 tag 的 URL，或 `pnpm update` |
| `HEAD https://github.com/.../main.tar.gz ... ETIMEDOUT` | `github.com` 不通 | 改用 codeload 直链或 npm |
| 安装返回 `changed:false`，日志只有 `fetch failed` | 旧依赖也在拉 `github.com`，一个失败整次回滚 | 先从 `package.json` 删掉旧条目再装 |
| 设置页没有版本行 | 宿主半侧还是旧版 | 重启 DSH（浏览器半侧热更新，宿主不会） |

> 安装器目前只会把 `fetch failed` 透出来，不会告诉你**是哪个 URL** 失败。
> 遇到时先看 profile 的 `package.json` 里还有没有 `github.com/.../archive/...`
> 的旧条目 —— 通常就是它。

## 设置

| 字段 | 默认 | 区间 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `true` | — | 关闭后完全恢复原生外观 |
| `opacity` | `20` | 0–100 | **表面**不透明度 %；20 = 80% 半透明，100 = 不透明 |
| `panelOpacity` | `85` | 0–100 | **信息面板**不透明度 %：弹层、文件预览、统计/费用面板、Modal 内容 |
| `blur` | `32` | 0–80 | 三列骨架背后那层的模糊半径（px） |
| `overlayBlur` | `32` | 0–80 | **浮层**模糊半径（px）：弹层、已归档面板、费用面板、Modal。运行时夹到 56px |
| `composerBlur` | `24` | 0–80 | **发送框 / 任务卡片**模糊半径（px）。运行时夹到 40px；设为 0 关闭这两处 |
| `previewOpacity` | `85` | 0–100 | **文件预览 / 改动卡片**不透明度 %：文件 diff、已编辑文件卡、文档预览 |
| `saturate` | `180` | 100–200 | 背景饱和度 % |
| `ambient` | `true` | — | 是否绘制氛围光背景 |
| `accent` | `aurora` | aurora / ocean / sunset / mono | 氛围光配色 |
| `bgImage` | `''` | — | 背景图 token（空串 = 没设图）。只是缓存键，不是文件名 |
| `bgFit` | `cover` | cover / contain / stretch / tile / center | 显示方式：填充 / 适应 / 拉伸 / 平铺 / 居中 |
| `bgCrop` | `{x:0,y:0,w:1,h:1}` | 每项 0–1 | 自定义裁剪区域（占原图比例，整图 = 0,0,1,1） |
| `bgDim` | `30` | 0–100 | 背景蒙层不透明度 %（浅色盖白、深色盖黑） |
| `bgGuard` | `true` | — | **文字保护**：有壁纸时给文字加光晕 + 加深次要文字（不加任何底色） |
| `bgAutoTone` | `true` | — | **跟随图片明暗**：暗图切深色主题、亮图切浅色，让文字颜色和图片对得上 |
| `bgBaseTheme` | `''` | light / dark / system | 内部状态：自动切换**前**用户的明暗偏好（空 = 没切过），删图/关开关时还原 |
| `bgLumaGrid` | `''` | — | 内部状态：上传时算好的 32×32 亮度图（base64），自动明暗按裁剪区域查表用 |

设置页常规是 **7 个滑块**：表面不透明度 / 面板不透明度 / 背景模糊 / 浮层模糊 /
发送框·任务模糊 / 文件预览·改动卡片 / 背景饱和度。**设了背景图之后多一个
「背景蒙层」滑块、两个开关（文字保护 / 跟随图片明暗）**，并多出整行宽的
「自定义裁剪」区（设图前这些不显示，避免摆一个当前没有作用的控件）。

发送框与任务卡片的**底色没有单独一档**：它就是 `--dsw-specific-input-major`
（属 `SURFACES`），跟着「表面不透明度」走。曾经有过 `composerOpacity`
滑块，实现方式是给卡片刷一层 `color-mix(白 N%)` 的白底 —— 行内
`background` 会顶掉卡片自己的 token，拖「表面不透明度」时发送框纹丝不动，
所以已删除。挡住背后的字靠**模糊**，不靠颜色。

设置持久化在 `$DSH_HOME/glass-theme.json`（宿主半侧用「临时文件 + rename」原子写入；
坏文件按默认值处理，删掉即可复位）。范围校验以**宿主半侧**为准。

### 为什么分成两档不透明度

`opacity` 管的是**装饰性骨架**（frame / 侧栏 / 输入框 / 选区），透一点更好看；
`panelOpacity` 管的是**要读字的地方**。这两类不是一个可读性预算：把统计弹层、
文件预览也压到 20% 不透明，正文和表格会直接糊在氛围光上。

面板这一档覆盖的 token 见 `client.js` 的 `PANELS`：

| token | 谁在用 |
| --- | --- |
| `--dsw-specific-menu` | 会话统计 / 逐轮用量弹层（宿主 `Xt1eiG_panel`）、所有下拉浮层 |
| `--dsw-alias-bg-document-preview` | 文件预览里 PDF 的底色 |
| `--dsw-alias-bg-layer-2` / `-3` | Modal 内容、Pill、轨迹列表、插件管理页、**桌宠的费用弹层与花费看板**（`dsh-cost-panel` / `dsh-pet-dash-panel`） |

**基色不能用 `--dsw-menu-surface-fill`**：那个值自带 alpha（`#f8f9fa94`），
再乘一次会变成 0.58 × 0.85 ≈ 49% 透明，比不改还透。所以 `PANELS` 用的是同色的
**不透明静态 token**（bluish-50 / bluish-750）。

### 宿主重启窗口期的保存

宿主半侧的 `DEFAULTS` 是模块加载时读进内存的，改它必须重启 DSH；
浏览器半侧走 HMR，刷新页面就生效。所以在「宿主还没重启」的窗口期里，
宿主不认识 `panelOpacity`：POST 上去会被旧键集丢掉，GET 回来也没有这个字段。

`client.js` 因此把设置镜像一份到 `localStorage`（键 `dsh-glass-theme:settings`），
**只用来补齐宿主不认识的键**；宿主认识的键永远以宿主为准。宿主重启后自然开始
持久化 `panelOpacity`，镜像里那份随即被覆盖成同一个值，不会分叉。

### 自定义背景图片

设置页可以选一张本机图片当壁纸，铺在所有半透明表面**后面**（不是盖在上面），
并像桌面壁纸设置一样有 **填充 / 适应 / 拉伸 / 平铺 / 居中** 五种显示方式，
外加一个**自定义裁剪**框和一个**背景蒙层**滑块。

**图片存在哪**：图片本体落盘成 `$DSH_HOME/glass-theme-bg.<ext>`，
设置里只存一个短 token（`bgImage`）。刻意**不**把图片转成 data URL 塞进设置 JSON：

- `glass-theme.json` 每次拖滑块都会被整体重写，塞几 MB 的 base64 会让每次
  保存都写一个大文件，`localStorage` 镜像也会跟着爆掉；
- 图片走独立路由，浏览器可以长缓存；token 一变 URL 就变，不会拿到旧图。

**路由**（宿主半侧 `index.js`）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/glass-theme/background/<token>` | 原样回传图片（`immutable` 长缓存 + `nosniff`） |
| `POST` | `/glass-theme/background` | 上传图片（body 是原始二进制，不是 multipart） |
| `DELETE` | `/glass-theme/background` | 删除图片并把 `bgImage` 清空 |

三条共用一个 **prefix** 路由（`kind: 'prefix'`）。GET 把 token 放在**路径段**里，
不放在 query 里 —— 这样不依赖「exact 路由会不会忽略 query」这种实现细节。

**安全边界**：文件名固定（`glass-theme-bg.<ext>`），扩展名只来自
content-type 白名单（webp / png / jpeg / gif / avif / bmp / svg），
不存在「往任意路径写任意文件」的通道；`bgImage` 只接受
`[A-Za-z0-9_-]{1,64}`，非法值在 `normalize()` 里退回空串。写操作同样过
DSH connection 层的来源信任检查（和设置路由一致）。

**上传前会压缩**：浏览器半侧用 `createImageBitmap` + canvas 把长边压到 3840px
以内并转成 WebP（质量 0.92），顺便剥掉 EXIF（含拍摄地点）。请求体上限 24 MiB。

**裁剪坐标是比例，不是像素**：`bgCrop = {x,y,w,h}` 全部是「占原图的比例」，
所以换分辨率、换窗口大小都不需要重算；服务端与浏览器半侧用同一套规则夹取
（`w/h ≥ 5%`，越界时把左上角往回推而不是把框压扁）。
渲染时用 canvas 把裁剪区域**真的重画**成一张新位图再交给 `background-size`
——用百分比位移模拟只对「铺满」成立，平铺/居中会露出整张原图。

**蒙层为什么默认 30**：玻璃表面默认只有 20% 不透明，直接压一张照片上去正文
会读不了。蒙层是**与明暗同向**的雾（浅色盖白、深色盖黑），和宿主表面的明暗
逻辑一致；它和「氛围光」是两件事，设图后氛围光仍然在，会在适应/平铺的留白处
透出来（配色选择依旧有意义）。

**文字保护（`bgGuard`）为什么只加光晕、不加底色**：壁纸下最自然的诱惑是
「把表面调实一点」，但那等于替用户改掉了他调好的透明度 —— 有人就是要把
表面压到 5%、模糊调到 0 来看壁纸。所以文字保护做两件事，**背景一个像素都不动**：

1. 用 `text-shadow` 在字形背后加一圈与明暗同向的光（浅色白晕、深色黑晕），
   形成字幕式的局部对比；它可继承，挂在 `body` 上就能覆盖侧栏、顶栏、
   发送框以及 portal 到 body 的浮层。
2. 把**次要文字**加深/提亮一档：宿主的 `--dsw-alias-label-secondary` /
   `tertiary` / `caption` 在浅色主题下是 `bluish-700/600/400`
   （#61666b / #81858c / #a3a8b0）。这类浅灰字压在照片上，光晕反而帮倒忙
   （灰字压在白晕上对比度更低），必须把字本身改深。按同一套调色板改成
   `secondary→bluish-750`、`tertiary/caption→bluish-700`（深色主题反向：
   200/300/400）。只改颜色明度，不碰字号字重，不会引起重排；内联 SVG 图标
   用 `currentColor`，也会跟着一起变清楚。

不喜欢光晕可以关掉开关，或者把「背景蒙层」拉高。

### 跟随图片明暗（`bgAutoTone`）

**为什么还需要它**：文字颜色是跟**主题模式**走的（浅色主题深字、深色主题浅字），
而**壁纸的明暗和模式无关**。换一张暗色壁纸后，浅色主题的深色字压在暗图上，
光晕和加深 token 都救不了 —— 那是「方向错了」。

做法：把背景图（**裁剪后**的那块）画到 32×32 画布上，算平均相对亮度
（`0.2126R + 0.7152G + 0.0722B`）：

| 平均亮度 | 动作 |
| --- | --- |
| < 0.42 | 切到 **dark**（字变浅、面板变暗、蒙层变黑） |
| > 0.58 | 切到 **light** |
| 0.42–0.58 | **不切**（明暗参半的图来回切会晃眼，交给文字保护兜） |

**亮度从哪来（两层）**：

1. **首选：上传时就算好。** 选图片时浏览器已经把图片画进了 canvas（压缩用），
   顺手把 32×32 的亮度图存成 `bgLumaGrid`。之后无论怎么裁剪，都只是按比例
   取子矩形求平均 —— **纯查表，不解码图片**，也就不会被 canvas 跨源/污染卡住。
2. **兜底：现场量。** 早于这个功能上传的旧图没有亮度图，就现场把图片
   `fetch` 成 `blob:` URL（同源、canvas 一定读得出来）再解码量一次；
   量不到会**退避重试 6 次**，并在开关下面显示状态（`测得亮度 0.38 → 已切深色主题`
   / `还没量到图片亮度，会自动重试`）。

- 切换走官方 `ctx.theme.setTheme()`，不是自己改 `data-ds-dark-theme`；
- **只动内置 `light / dark / system`**：用户如果选了第三方主题 id，一律不碰
  （`setTheme('dark')` 会把第三方主题顶掉）；
- 切换前把用户原来的偏好写进 `bgBaseTheme`（落盘 + localStorage 镜像），
  删图 / 关开关 / 卸载时还原 —— **重启后也认得**；
- 用户中途自己改过明暗 → 还原时发现当前偏好已经不是我们切的那个，就只清基准、
  不覆盖他的选择；
- 判断只在「图片 token / 裁剪区域 / 开关」变化时做一次，不是每帧都量。

> 原生窗口菜单和标题栏按钮是 Electron / Windows 画的（不在 DOM 里），
> CSS 够不到；能改的只有它们**下面**那层底色（见下一节）。

### 右上角窗口按钮的「方块」

截图里三个系统按钮（最小化 / 最大化 / 关闭）底下有一块比标题栏亮的方块。
根因是 DSH 的 preload 用一个隐藏 probe 把「标题栏底色」
（`--dsw-specific-sidebar-fill`）算出来传给主进程，作为 Electron 原生
`titleBarOverlay` 的底色；而页面自己的标题条**也**铺了同一个半透明白。
同一层颜色被刷了两遍（`opacity=5` 时 0.05 叠 0.05 ≈ 0.0975），
右上角就比标题栏亮出一块。

修法：把那个 probe 的 `background-color` 改成透明（选择器只认
「`body` 直接子元素 + 无 class/id + 空元素 + 内联式里有 pointer-events 与
visibility」），主进程就会收到 `rgba(0, 0, 0, 0)`，覆盖层不再画底，
露出下面同一条标题栏。**按钮字形颜色不受影响**（symbolColor 读的是 `color`）。

## 实现要点

**三层结构**（缺一不可）：

1. **氛围光背景** — `html[data-dsh-glass] body::before` 上一层固定定位渐变。
2. **半透明表面** — 通过官方 `ctx.theme.overrideTokens(source, tokens)` 把
   `--dsw-alias-bg-*` / `--dsw-specific-*` 等表面 token 改成
   `color-mix(in srgb, <原色> N%, transparent)`。走官方 token 层，可撤销、
   随主题切换自动重算明暗两套值。**表面与面板两套表，各用各的百分比。**
3. **背景模糊** — 给主要列/面板加 `backdrop-filter: blur() saturate()`，
   并把 `--dsw-menu-backdrop-filter` / `--dsw-mask-blur` 统一到同一档位。
4. **浮层模糊** — 三列之上的浮层（已归档面板、桌宠费用弹层、宿主
   `_panel` / `_dialog` / `_float_`、`[role=dialog][aria-modal]`）单独挂
   `backdrop-filter`，用 `--dsh-glass-overlay-blur`（由 `paint()` 按
   `overlayBlur` 夹到 56px 上限）。原因：这些窗口原本多数**没有**模糊，
   底色被 `panelOpacity` 压薄后背后正文会直接透出来，字压字看不清。

   两个必须记住的排除项（删了会出问题）：
   - `OUqwTW_panel`（右栏 dockkit 定位容器）**必须排除**：`backdrop-filter`
     会为该元素建立「fixed 后代的包含块」，挂上去会让内部 `position:fixed`
     的浮窗整体错位。
   - `_panelRow` / `_panelActive` / `_panelButton` / `_panelHint` 等行内小控件
     也要排除：它们是子串匹配的误命中，背后没有要模糊的内容。

5. **发送框 / 任务卡片模糊** — 发送框（`[data-composer-card]`）、审批卡、
   提问卡、文件卡、账号提示卡，以及任务看板的内部卡片
   （`EBLgjq_task` / `EBLgjq_member`）单独挂 `backdrop-filter`，
   用 `--dsh-glass-composer-blur`（按 `composerBlur` 夹到 40px 上限）。

   - 发送框用 `[data-composer-card]` 而不是哈希类名 `.RlGAzG_card`：
     那是宿主自己写、并在 4 处内部逻辑里当锚点用的稳定 data 属性。
   - **不要**把模糊挂到 `--dsw-specific-input-major` token 上：它还被
     ImageLightbox 的 `.image` / `.close` 消费，会把图片查看器里的图片本身
     变成毛玻璃。

6. **composer 铺底模糊（漏了就会「间隙透字」）** —
   宿主的 `[data-composer-seat]` 自己铺了一层渐变底，基色是
   `--dsw-alias-bg-base`（**骨架档**，由 `opacity` 控制）。卡片之间那圈
   间隙就是这层，**没有任何元素给它挂模糊**。所以：

   ```css
   html[data-dsh-glass] [data-composer-seat] {
     backdrop-filter: blur(var(--dsh-glass-composer-blur, 24px)) saturate(...);
   }
   ```

   **只加模糊，不加颜色。** 曾经在这块写过 `background: color-mix(白 N%)`，
   把发送框的 `--dsw-specific-input-major` 顶掉了 —— 用户拖「表面不透明度」
   时发送框不跟着变，看到的就是「发送框不半透明了」。`paint()` 还会主动
   `removeProperty` 清掉旧版本留下的行内 `background` 与
   `--dsh-glass-composer-fill-*`（HMR 只换 JS 不刷页面，行内样式会残留）。

7. **发送框零白底（CSS 第 4e 段）** — 发送框身上原本还有两层白：
   `composerSeat` 的渐变底（`--dsw-alias-bg-base`）和卡片自己的
   `--dsw-specific-input-major`；`opacity=30` 时复合约 51%，看起来就是白卡。
   现在两层都清成透明：

   ```css
   html[data-dsh-glass] [data-composer-seat],
   html[data-dsh-glass] [data-composer-card] {
     background: transparent;
   }
   ```

   清 `background` 而不是改 token：`--dsw-specific-input-major` 还被审批卡 /
   提问卡 / 文件卡消费，改 token 会把它们一起弄透明。代价是发送框只剩边框
   与投影，输入文字直接压在模糊背景上。

8. **代码块钉回原生基色（CSS 第 4f 段）** — 代码要逐字读，不能半透明。
   shiki 给 `<pre>` 写的是行内 `background-color: var(--shiki-background)`，
   所以改变量值最干净；再加一条 `pre { background-color: … !important }`
   兜底不走 shiki 的 `<pre>`：

   ```css
   html[data-dsh-glass] body { --shiki-background: var(--dsw-static-neutral-bluish-50); }
   html[data-dsh-glass] pre  { background-color: var(--dsw-static-neutral-bluish-50) !important; }
   ```

   深色分支用 `--dsw-static-neutral-bluish-900`。

9. **交付物 / 文件改动卡片接到预览档（CSS 第 4g 段）** — 宿主的
   `.kuvljq_card` 和 `.jmg6Sq_output` 用的是 `--dsw-alias-bg-layer-1`
   （在 `SURFACES` 骨架档 = 表面不透明度），于是任务结尾那张文件预览卡
   几乎全透、代码字糊在背景上。这两类是「要读字」的内容，改到
   `previewOpacity` 这一档：

   ```css
   html[data-dsh-glass] [class*="kuvljq_card"],
   html[data-dsh-glass] [class*="jmg6Sq_output"] {
     background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
   }
   ```

10. **文档预览根节点自己补底色（CSS 第 4h 段）** — `documentpreview` 的
    `TdjKvG_preview` / `TdjKvG_body` / `TdjKvG_textDocument` **自己不铺底**，
    指望外层 `_tabHost_`。预览浮动或内嵌在 diff 里时外层是透明的，于是
    整块预览全透，只有 diff 行自己的增删底色还在（没底色的上下文行直接
    透出氛围光）。给预览根补 `previewOpacity` 那一档：

    ```css
    html[data-dsh-glass] [class*="TdjKvG_preview"],
    html[data-dsh-glass] [class*="TdjKvG_body"],
    html[data-dsh-glass] [class*="BMNXqa_frame"] {
      background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
    }
    ```

    `_body` 是必需的：侧边栏预览根上带 `_preview`；而「鼠标悬停文件 → 看代码」
    那个浮层只挂内部节点（`_body`），没有 `_preview` 根 —— 只写根会漏掉悬停浮层。

    住在 tabHost 里时会叠成 panel + preview（70% + 85% ≈ 95%），可读性优先。

11. **颜色变量必须写在 `body` 上，不能写 `:root`（2026-10 真·根因）** —
    宿主的静态调色板定义在 `body{--dsw-static-neutral-bluish-*}`，
    而自定义属性里的 `var()` 是在**声明它的元素**上求值的。写成
    `document.documentElement.style.setProperty('--x', 'color-mix(… var(--dsw-static-…) …)')`
    时，`:root` 上找不到那个 token → 整条自定义属性变成 guaranteed-invalid →
    所有 `var(--x)` 静默失效 → `background-color` 回退成 **transparent**。

    ```js
    const colorHost = document.body ?? root;   // 颜色变量写这里
    colorHost.style.setProperty('--dsh-glass-panel-light', …);
    colorHost.style.setProperty('--dsh-glass-preview-light', …);
    // 模糊这种纯长度变量写 :root 没问题
    root.style.setProperty('--dsh-glass-blur', …);
    ```

    这条不修，第 5 段（右栏 / tabHost）和第 4g / 4h 段（改动卡片 / 文档预览）
    的底色**永远不会出现**，跟选择器写得对不对无关。

12. **悬停预览浮层是第三套实现（CSS 第 4i 段）** — 「鼠标悬停文件 → 看代码」
    弹出的浮层不是文档预览，也不是改动卡片，而是 primitives 的 `HoverCard`
    `variant="preview"`：

    ```css
    /* 宿主：web-frontend/dist/assets/index-*.css */
    ._preview_38jqx_52 { background: var(--dsw-alias-bg-layer-1); … }  /* SURFACES 20% */
    ```

    所以它同样全透，而且前两处规则都压不到。接法（双匹配局部名，不吃构建哈希）：

    ```css
    html[data-dsh-glass] [class*="_preview_"][class*="_card_"] {
      background-color: var(--dsh-glass-preview-light, var(--dsh-glass-panel-light, transparent));
    }
    ```

    文件预览一共三套宿主实现：侧边栏 `TdjKvG_*`、改动卡片 `kuvlq_card`、
    悬停浮层 `_preview_` —— 排查时别当成同一个。

13. **自定义背景图是独立的一层 DOM，不是伪元素（CSS 第 1b 段）** —
    固定定位、`z-index:-1`、`pointer-events:none`，追加在 `body` 末尾：

    ```html
    <div class="dsh-glass-bg" aria-hidden="true">
      <div class="dsh-glass-bgImage"></div>  <!-- background-size/position/repeat 由 paint() 写 -->
      <div class="dsh-glass-bgVeil"></div>   <!-- 蒙层 -->
    </div>
    ```

    不用 `body::before` 的原因：那里已经是氛围光；而且平铺/拉伸/居中需要
    每个元素自己的 `background-*` 三属性。层级上它**在氛围光之上、#root 之下**，
    所以填充时盖住氛围光，适应/平铺的留白处又能透出氛围光。

14. **裁剪结果用 canvas 真重画** — 拖完裁剪框后 `paint()` 会把原图按比例
    裁成一张新位图（WebP blob URL），再交给 `background-size`。
    用 `background-position` 百分比模拟只对「铺满」成立，平铺时会露出整张原图。
    每次重画前 `revokeObjectURL` 旧的，并用递增序号丢弃过期结果
    （否则「刚换成整图」会被上一次的异步裁剪结果覆盖）。

15. **文字保护只改文字（CSS 第 4j 段）** — 选择器是
    `html[data-dsh-glass][data-dsh-bg="on"][data-dsh-guard="on"] body`。
    两条规则：`text-shadow` 光晕（可继承，覆盖全部文字）+ 三个次要文字
    token 的调色板替换。**这条规则里不许出现任何 `background`** ——
    用户明确说过不要白底，靠加底色「修」可读性会直接违背他调好的透明度。
    测试把「规则体不含 background」钉成了回归断言。

16. **右上角原生按钮的底色（CSS 第 4k 段）** — DSH 的 preload 会把
    `--dsw-specific-sidebar-fill` 算成原生 `titleBarOverlay` 的底色，
    与页面标题条叠成两层。这里把 preload 那个隐藏 probe 的
    `background-color` 强制成透明（`!important` 才压得过内联样式），
    覆盖层就不再画底。选择器写得很窄，命中不到时只是退回原样。

17. **自动明暗走 `ctx.theme.setTheme()`，不是改 DOM** — 改
    `data-ds-dark-theme` 只是改了属性，宿主内部的调色板/组件状态不会跟着变
    （而且下一次主题变更就被覆盖）。`setTheme('dark' | 'light')` 是官方
    唯一的偏好写入口，会连启动画面之外的整棵 UI 一起切。代价是它会**持久化**
    用户偏好，所以必须把原值记在 `bgBaseTheme` 里，并在删图/关开关/卸载时
    还原；还原前要确认当前偏好仍是我们切的那个（用户中途改过就别覆盖）。




最外层的 `.frame` 底色被清成透明（一处必需的 `!important`）：`.frame` 与
`.centerCol` 都用 `--dsw-alias-bg-base` 铺底，两层叠加会让实际不透明度变成
`1-(1-a)²`（a=20% 时约 36%），滑块就对不上了。

**右栏 / 文件预览的底色**走局部变量重定义，而不是改 token：dockkit 的
`_tabHost_` 与中央列共用 `--dsw-alias-bg-base`，全局改会把对话区一起变实。
所以只在右栏子树里把它指向 `--dsh-glass-panel-light/dark`（由 `paint()` 按
`panelOpacity` 写入）：

```css
html[data-dsh-glass] [class*="_rightbarCol"],
html[data-dsh-glass] [data-dockkit-pane],
html[data-dsh-glass] [class*="_tabHost_"],
html[data-dsh-glass] [class*="_emptyTabHost_"] {
  --dsw-alias-bg-base: var(--dsh-glass-panel-light, transparent);
}
```

回退值必须写 `transparent` 而不是 `var(--dsw-alias-bg-base)`：自定义属性自引用
会构成循环，整条声明会被丢弃。

## 更新日志

### v1.0.2（2026-10-20）

安装 / 升级链路修复（对应 [issue #1](https://github.com/rans725/dsh-glass-ranswork/issues/1)）：

- **文档**：删掉「重装一次即拉最新 main」。明确写出 lockfile 会钉住
  tarball 的 integrity / version，升级必须换版本化地址；
- **安装源**：README 改为优先 npm 与 codeload 固定 tag 直链，绕开
  `github.com` 的 302 跳转（受限网络下最常卡住的就是这一步）；
- **npm 发布**：去掉 `private`，补 `repository` / `publishConfig`，
  新增 `.github/workflows/release.yml`（打 tag 自动发布 + 建 Release + 传 tgz）；
- **版本可见**：设置页顶部显示当前加载的版本；宿主半侧新增
  `/glass-theme/version`，静默比对 npm registry（官方 → npmmirror），
  有新版给一行链接，检查失败什么都不显示；
- **排错**：新增「升级」「卡住时的自查」，覆盖版本不变、ETIMEDOUT、
  `changed:false` 三类常见现象。

### v1.0.1（2026-10-19）

发送框（composer）相关的四处修复，都围绕同一类根因：`backdrop-filter`
不只是「给元素加个模糊」，它还会**改变元素的层叠与包含块语义**。

- **修复：输入法有字时，鼠标移到发送箭头，发送框会闪一下**
  `backdrop-filter` 会让元素成为 `position: fixed` 后代的包含块。宿主的
  Tooltip 气泡正是 fixed + 视口坐标、且默认不 portal，于是被祖先的模糊层
  带偏；每次插入 / 重定位都触发整块毛玻璃重新采样。
  现在模糊一律挂在 `::before` 伪元素上（伪元素没有后代，不会成为包含块）。
- **修复：发送框颜色和背景图对不上（比周围更艳）**
  `backdrop-filter` 是**逐层叠加**的 —— 列 200% × 内层 200% 实际是 400%+。
  现在饱和度只由最外层（三列 / 浮层）负责，内层只做模糊。
  实测框内与框外的色差从 Δ=31 降到 Δ=3。
- **修复：发送框左右和下方多出一圈毛玻璃**
  模糊原先挂在整列宽的 `composerSeat` 上，而卡片受
  `--dsh-composer-side-clearance`（16px）与底部 4px 内边距约束、比它窄一圈。
  现在模糊只挂在卡片自身，形状随 `border-radius` 走，不再外溢。
- **修复：「发送框 / 任务模糊」滑块拖动无反应**
  上一版把卡片规则拆出来单独声明时漏了伪元素骨架（`content` 等），
  没有 `content` 的 `::before` 不会生成，滑块的值没有消费者。
  已补回骨架，并且**调到 0 现在是真正关闭**（`backdrop-filter: none`），
  而不是留下一个仍然会建合成层的 `blur(0px)`。

### v1.0.0（2026-10-17）

首个版本：半透明毛玻璃外观、三档不透明度、自定义背景图（五种摆放 + 裁剪）、
文字保护、跟随图片明暗。

## 已知边界（Windows）

Electron 主窗口在 Windows 上创建时**没有** `transparent` / `backgroundMaterial`
（只有欢迎页用 `acrylic`；`vibrancy` 只在 macOS 主窗口）。所以：

- **Windows**：表面半透明后透出的是**本插件画的氛围光**，不是桌面壁纸。
- **macOS**：窗口本身透明，能真正透出桌面。

这是 Electron 窗口材质的边界，CSS 无法突破；宿主半侧跑在
`ELECTRON_RUN_AS_NODE` 子进程里，够不到 `BrowserWindow` API。

## 依赖的宿主 DOM 钩子

- `body::before` / `#root` — 自有选择器，稳定。
- `[data-shortcut-modal]` — 宿主写在组件上的 data 属性，稳定。
- `[data-dockkit-pane]` — dockkit 的 pane 容器（右栏 / 文件预览的宿主）。
- `[class*="_frame"]` / `[class*="_sidebarCol"]` / `[class*="_centerCol"]` /
  `[class*="_rightbarCol"]` / `[class*="_tabHost_"]` / `[class*="_emptyTabHost_"]`
  — DSH 用 CSS Modules，类名是 `<哈希>_<局部名>`，哈希随构建变、局部名稳定，
  所以用子串匹配。这是全局主题唯一无法避免的耦合点；
  万一哪天局部名改了，退化结果是「那一块没有模糊 / 底色回到骨架档」，
  token 带来的半透明仍然生效。
- 浮层模糊另外用 `[class*="_panel"]` / `[class*="_dialog"]` /
  `[class*="_float_"]` 与官方 `[role="dialog"][aria-modal="true"]`
  （宿主 primitives 导出的 `modalSelector`）。前者带一长串 `:not()` 排除，
  原因见上文「实现要点」第 4 条。

## 开发与验证

插件是**两个手写的普通 JS 文件**，没有构建步骤、没有依赖：

- `index.js` —— 宿主半侧（Node）：注册 `/glass-theme/settings`、
  `/glass-theme/background` 与 `/glass-theme/version` 路由，把设置写到
  `$DSH_HOME/glass-theme.json`；
- `client.js` —— 浏览器半侧：`window.__ModuleLoader__.load({ id, factory })`
  形态的 bundle，`factory(require)` 里拿 React，CSS 以字符串塞进 `<style>`。

改完只需要：

```powershell
# 语法检查（用 DSH 自带的 node 或任意 Node 20+）
node --check index.js
node --check client.js
```

浏览器半侧走客户端 HMR：改完 `client.js` **刷新页面**即可；宿主半侧的
`index.js` 改了路由/默认值时要**重启 DSH**。调试设置写入可以绕开 HTTP
直接 `import('./index.js')` 调 `normalize()`（DSH 的 connection 层会挡掉
命令行 POST，这是安全机制）。

> 作者工作区里有一套不随包发布的回归测试（`node:test` 风格、用假 DOM 跑
> 真实源码）；如果你想贡献，改动请保持「无依赖、自带降级」的原则，
> 并在 PR 里说明验证方式。

### 发布（维护者）

1. 改 `package.json` 的 `version`；
2. 提交后打 tag 并推送：

   ```powershell
   git tag v1.0.2
   git push origin v1.0.2
   ```

3. `.github/workflows/release.yml` 会：校验 tag 与 `version` 一致 → 语法检查 →
   打包 → 创建 Release 并上传 `.tgz` → `npm publish --access public --provenance`。

`NPM_TOKEN`（npm 的 Automation token）是可选的：没配时流水线只跳过
npm 发布，Release 与 `.tgz` 资产照常生成 —— 用户仍可用 codeload /
Release 安装，只是暂时拿不到 `pnpm update` 这条升级路径。
