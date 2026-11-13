# dsh-hfsy-studio

把 hfsy 中转的**生图 / 生视频**调用包成 DeepSeek Harness 里的一个可视化工作台：
侧栏点「生图工作台」→ 左边填参数、右边看结果。出图直接落到本地目录，历史可回看、可下载、可复制路径。

![工作台预览](assets/preview.png)

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| 参数面板 | 模型、提示词（Ctrl+Enter 生成）、尺寸预设 / 自定义 WxH、质量、数量、格式；视频走时长 + 清晰度 |
| 结果画廊 | 本次任务进度（阶段 + 计时 + 取消）、成品瀑布流、点开灯箱、下载、复制落盘路径、删除记录 |
| 失败可见 | 失败/取消的任务停在「失败 / 已取消」区，原样显示中转返回的错误，可手动关闭 |
| 本地落盘 | 默认 `hfsy-output/<日期>/<时分秒>-<id>-<提示词>.png`，历史写在 `hfsy-output/history.json` |
| 历史持久 | 重启 DSH 后历史仍在（磁盘文件 + history.json 双份） |
| 视频入口 | 已接 `Doubao-Seedance-*`；当前 hfsy 中转未配价格，提交会明确报 `model_price_error` |
| 密钥隔离 | 密钥只在宿主进程里解析，浏览器永远拿不到；路由只接受同源请求 |

## 安装

桌面端 profile 由 Electron 独占管理，不能用 CLI 改，所以走界面：

1. 打开 **设置 → 插件 → 安装第三方插件**（添加插件）
2. 填本机目录：`D:\lukezy\deepseek_harness\chat\dsh-hfsy-studio`
3. 装完刷新页面，左侧栏出现「生图工作台」

> 本地目录安装是**拷贝快照**：以后改了 `index.js` / `client.js`，卸载重装一次才会生效。
> 想在 web profile 里边改边试，可以用 `dsh plugin --profile web add file:<dir>`，再重载页面。

## 配置

改 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里这一行（或直接改本包自带的 `cordis.patch.yml` 后重装）：

```yaml
- id: hfsy-studio
  name: dsh-hfsy-studio
  config:
    baseUrl: https://www.hfsyapi.cn/v1   # OpenAI 兼容根地址，末尾不带 /
    apiKeyEnv: OPENAI_API_KEY            # DSH 凭据名，取不到时回落到同名环境变量
    outputDir: D:/lukezy/deepseek_harness/chat/hfsy-output
    imageModels: [gpt-image-2, gpt-image-2.5, gpt-image-2.6, gpt-image-2pro, gpt-image-2pro-4k]
    videoModels: [Doubao-Seedance-2.0-fast, Doubao-Seedance-2.0, Doubao-Seedance-2.5]
    maxConcurrent: 2                      # 同时最多几个任务
    # requestTimeoutMs: 240000            # 单次请求超时
    # maxRetries: 2                       # 网络 / 429 / 5xx 重试次数
    # videoPollMs: 5000                   # 视频任务轮询间隔
    # videoTimeoutMs: 900000              # 视频总等待上限
```

密钥：DSH 凭据里已有 `OPENAI_API_KEY`（就是 hfsy 的 key）时页头会显示「密钥已就绪 · 来源: file」；没有就显示黄色告警。

## 接口一览（宿主侧）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/hfsy-studio/api/state` | 配置、可用模型、最近任务、历史、统计 |
| POST | `/hfsy-studio/api/generate` | 提交任务 `{kind, model, prompt, size, quality, count, format, duration, resolution}` |
| POST | `/hfsy-studio/api/jobs/<id>` | 取消任务 |
| POST | `/hfsy-studio/api/history/delete` · `/history/clear` | 删一条 / 清空历史（不动磁盘文件） |
| GET | `/hfsy-studio/api/models` | 拉中转 `/models` 并按图/视频分类 |
| GET | `/hfsy-studio/api/file?rel=` | 回读落盘文件（限定在 outputDir 内，防路径穿越） |
| POST | `/hfsy-studio/api/open-output` | 打开输出目录 |

所有路由都做同源校验（`Origin`/`Sec-Fetch-Site`），跨站请求直接 403。

## 开发与验证

```powershell
node --check index.js
node --check client.js
node test/smoke.mjs          # 状态 / 参数校验 / 路径穿越，不花钱
node test/smoke.mjs --live   # 真调一次 gpt-image-2 并落盘到 test/output
node test/client.mjs         # 用假 React 跑工厂 + 渲染面板，验证插槽注册
```

已验证（2026-11-13）：

- `smoke.mjs --live`：真实出图 1254×1254 / 1.1 MB / 30.3s，`/file` 可回读，`history.json` 已写。
- `client.mjs`：ModuleLoader id、`sidebar.panellist` + `main` 两处注册、面板渲染 60 节点、样式只注入一次。
- 真实 dsh 实例（`dsh --profile hfsy-test`）里打开页面：侧栏入口、面板渲染、UI 内出图、灯箱、失败卡片（`model_price_error`）均正常。

未验证：视频成功链路（中转未开通）、多图并发出图、`open-output` 在非 Windows 平台的表现。

## 目录

```
index.js            宿主：路由 + 出图/出片引擎 + 落盘 + 历史
client.js           浏览器：侧栏入口 + 工作台页面（React，纯 theme token）
cordis.patch.yml    bundle 补丁与默认配置
locale/{zh,en}.json 插件市场里显示的标题/描述
icon.svg            插件图标
assets/preview*.png 界面截图
test/               smoke / client 两个独立测试
```

## 注意

- 视频模型能不能用取决于中转有没有配价格；`/models` 里列出来不代表能调。
- 出图模型走 `/images/generations`；MJ 系（`mj_imagine`）协议不同，本版未接。
- 历史只记元数据，删除记录不会删磁盘文件。