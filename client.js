/**
 * dsh-hfsy-studio —— 浏览器半边。
 *
 * 结构：
 *   左侧栏「插件面板」入口 → 全屏工作台（自带一条竖向导航 + 分区页签）
 *   ├─ 创作：文生图 / 参考图 / 视频 三种模式，右侧是本次任务与最新结果
 *   ├─ 画廊：按 全部 / 图片 / 视频 / 4K 筛选
 *   ├─ 收藏：收藏夹分组
 *   ├─ 角色：角色卡（参考图 + 描述）
 *   └─ 工具：只保留 4K 增强
 *
 * 数据全部来自同源接口 /hfsy-studio/api/*，浏览器拿不到也不保存密钥。
 * 只用 React + 主题变量（--dsw-alias-*），不 import 任何 Harness Client 包。
 */

window.__ModuleLoader__.load({
  id: 'dsh-hfsy-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PLUGIN_ID = 'dsh-hfsy-studio'
    const PANEL_ID = 'hfsy-studio'
    const API = '/hfsy-studio/api'
    const POLL_MS = 1200
    const FORM_KEY = 'dsh-hfsy-studio:form:v1'

    const zh = typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')

    const T = zh
      ? {
        title: '生图工作台',
        subtitle: 'hfsy 中转 · 图片 / 视频',
        navCreate: '创作',
        navGallery: '画廊',
        navFavorites: '收藏',
        navCharacters: '角色',
        navTools: '工具',
        navCreateHint: '写提示词，出图或出片',
        navGalleryHint: '按类型翻看历史成品',
        navFavoritesHint: '收藏夹与精选图',
        navCharactersHint: '固定形象，跨次复用',
        navToolsHint: '4K 增强',
        modeText: '文生图',
        modeRef: '参考图',
        modeVideo: '视频',
        modeTextHint: '纯提示词出图',
        modeRefHint: '带参考图，走图生图',
        modeVideoHint: '按秒计费，异步任务',
        image: '图片',
        video: '视频',
        model: '模型',
        prompt: '提示词',
        promptPlaceholder: '描述画面：主体、构图、风格、光线、配色、不要什么…（Ctrl+Enter 生成）',
        size: '尺寸',
        quality: '质量',
        count: '数量',
        format: '格式',
        duration: '时长',
        resolution: '清晰度',
        generate: '生成',
        generating: '生成中…',
        cancel: '取消',
        clear: '清空',
        presets: '画风预设',
        running: '进行中',
        failedSection: '失败 / 已取消',
        runningEmpty: '生成中，完成后会出现在这里',
        dismiss: '关闭',
        history: '历史记录',
        latest: '最新结果',
        seeAll: '查看全部',
        empty: '还没有生成记录。左边填个提示词，点「生成」试试。',
        emptyHistory: '历史为空。',
        loading: '读取中…',
        download: '下载',
        copyPath: '复制路径',
        copied: '路径已复制',
        remove: '删除记录',
        openFolder: '打开输出目录',
        refresh: '刷新',
        keyReady: '密钥已就绪',
        keyMissing: '缺少密钥',
        keySource: '来源',
        outputDir: '输出目录',
        videoNote: '视频走中转的 /video/create + /video/query，按秒计费，通常要等 1~3 分钟；同一模型不同清晰度价格不同，选题前看下拉里的标价。',
        priceUnset: '未标价',
        perSecond: '/ 秒',
        perImage: '/ 张',
        estimate: '预计',
        failed: '失败',
        cancelled: '已取消',
        done: '已完成',
        queued: '排队中',
        limit: '并发上限',
        countUnit: '张',
        total: '共',
        items: '条',
        confirmClear: '清空全部历史记录？磁盘上的文件不会删。',
        confirmDelete: '删除这条历史记录？（磁盘文件保留）',
        close: '关闭',
        preview: '预览',
        customSize: '自定义 WxH',
        loadFailed: '读取工作台数据失败',
        refs: '参考图',
        addRefs: '选参考图',
        refsHint: '带参考图时走 /images/edits（图生图 / 角色一致性）',
        refsLimit: '最多',
        clearRefs: '清空参考图',
        characters: '角色',
        addCharacter: '存为角色',
        characterName: '角色名',
        characterDesc: '外貌 / 服装描述（会写进提示词）',
        characterEmpty: '还没有角色。先选参考图，再点「存为角色」。',
        saveCharacter: '保存角色',
        deleteCharacter: '删除角色',
        favorites: '收藏',
        favorite: '收藏',
        favorited: '已收藏',
        unfavorite: '取消收藏',
        allFolders: '全部',
        newFolder: '新建收藏夹',
        folderName: '收藏夹名字',
        favEmpty: '还没有收藏。在画廊里点 ☆ 就能收藏。',
        moveTo: '移动到',
        tools: '工具库',
        upscale: '4K 增强',
        upscaleHint: '把选中的图放大到 4K，只提清晰度、不改内容',
        upscaleNote: '走 /images/edits + gpt-image-2pro-4k，提示词固定为「保持构图与细节，只提高分辨率」。',
        source: '源图',
        pickSource: '选一张源图',
        runTool: '生成 4K',
        pickTitle: '从历史 / 收藏里挑图',
        selected: '已选',
        filters: { all: '全部', image: '图片', video: '视频', upscale: '4K' },
        overview: '概览',
        statsItems: '成品',
        statsFav: '收藏',
        statsChar: '角色',
        useChar: '引用',
        fromRefs: '用当前参考图新建',
        noCharRefs: '先在上方选好参考图',
        toolOpen: '选择源图',
        applyRef: '用作参考',
        upscaleThis: '4K 增强',
      }
      : {
        title: 'Image Studio',
        subtitle: 'hfsy relay · image / video',
        navCreate: 'Create',
        navGallery: 'Gallery',
        navFavorites: 'Favorites',
        navCharacters: 'Characters',
        navTools: 'Tools',
        navCreateHint: 'Prompt in, pictures out',
        navGalleryHint: 'Browse everything you made',
        navFavoritesHint: 'Folders of keepers',
        navCharactersHint: 'Reusable looks',
        navToolsHint: '4K upscale',
        modeText: 'Text to image',
        modeRef: 'With references',
        modeVideo: 'Video',
        modeTextHint: 'Prompt only',
        modeRefHint: 'Image-to-image',
        modeVideoHint: 'Per-second, async',
        image: 'Image',
        video: 'Video',
        model: 'Model',
        prompt: 'Prompt',
        promptPlaceholder: 'Describe the shot: subject, composition, style, light, palette, what to avoid…',
        size: 'Size',
        quality: 'Quality',
        count: 'Count',
        format: 'Format',
        duration: 'Duration',
        resolution: 'Resolution',
        generate: 'Generate',
        generating: 'Working…',
        cancel: 'Cancel',
        clear: 'Clear',
        presets: 'Style presets',
        running: 'Running',
        failedSection: 'Failed / cancelled',
        runningEmpty: 'Generating — results land here',
        dismiss: 'Dismiss',
        history: 'History',
        latest: 'Latest',
        seeAll: 'See all',
        empty: 'Nothing yet. Write a prompt on the left and hit Generate.',
        emptyHistory: 'History is empty.',
        loading: 'Loading…',
        download: 'Download',
        copyPath: 'Copy path',
        copied: 'Path copied',
        remove: 'Delete record',
        openFolder: 'Open output folder',
        refresh: 'Refresh',
        keyReady: 'Key ready',
        keyMissing: 'No key',
        keySource: 'source',
        outputDir: 'Output',
        videoNote: 'Video uses the relay /video/create + /video/query task API and bills per second; expect 1–3 minutes. Prices differ per resolution.',
        priceUnset: 'no price',
        perSecond: '/ sec',
        perImage: '/ image',
        estimate: 'est.',
        failed: 'Failed',
        cancelled: 'Cancelled',
        done: 'Done',
        queued: 'Queued',
        limit: 'Concurrency',
        countUnit: 'image(s)',
        total: 'Total',
        items: 'records',
        confirmClear: 'Clear all history? Files on disk stay.',
        confirmDelete: 'Delete this history record? The file stays on disk.',
        close: 'Close',
        preview: 'Preview',
        customSize: 'Custom WxH',
        loadFailed: 'Could not load studio state',
        refs: 'References',
        addRefs: 'Pick references',
        refsHint: 'References switch the request to /images/edits (image-to-image)',
        refsLimit: 'max',
        clearRefs: 'Clear references',
        characters: 'Characters',
        addCharacter: 'Save as character',
        characterName: 'Name',
        characterDesc: 'Look / outfit (goes into the prompt)',
        characterEmpty: 'No characters yet. Pick references, then save a character.',
        saveCharacter: 'Save',
        deleteCharacter: 'Delete',
        favorites: 'Favorites',
        favorite: 'Favorite',
        favorited: 'Favorited',
        unfavorite: 'Unfavorite',
        allFolders: 'All',
        newFolder: 'New folder',
        folderName: 'Folder name',
        favEmpty: 'Nothing favorited yet — hit ☆ on a tile.',
        moveTo: 'Move to',
        tools: 'Tools',
        upscale: '4K upscale',
        upscaleHint: 'Blow one image up to 4K — detail only, layout untouched',
        upscaleNote: 'Uses /images/edits with gpt-image-2pro-4k and a fixed "same picture, more resolution" prompt.',
        source: 'Source',
        pickSource: 'Pick a source image',
        runTool: 'Make 4K',
        pickTitle: 'Pick from history / favorites',
        selected: 'selected',
        filters: { all: 'All', image: 'Images', video: 'Video', upscale: '4K' },
        overview: 'Overview',
        statsItems: 'works',
        statsFav: 'favorites',
        statsChar: 'characters',
        useChar: 'Use',
        fromRefs: 'New from current references',
        noCharRefs: 'Pick references above first',
        toolOpen: 'Choose a source',
        applyRef: 'Use as reference',
        upscaleThis: 'Upscale 4K',
      }

    /** 常用尺寸：gpt-image 系只吃这几档，别的走自定义。 */
    const SIZE_PRESETS = [
      { label: '1:1', value: '1024x1024' },
      { label: '3:2', value: '1536x1024' },
      { label: '2:3', value: '1024x1536' },
      { label: '2:1 宽', value: '2048x1024' },
      { label: '1:2 竖', value: '1024x2048' },
    ]

    const STYLE_PRESETS = [
      { label: '游戏图标', text: 'game icon, centered subject, flat vector, bold outline, subtle glow, no text' },
      { label: '写实', text: 'photorealistic, natural lighting, 35mm lens, high detail' },
      { label: '赛博朋克', text: 'cyberpunk, neon rim light, wet asphalt reflections, teal and magenta palette' },
      { label: '像素风', text: 'pixel art, 32-bit, limited palette, crisp pixels, dithering' },
      { label: '国风', text: 'chinese ink painting style, xuan paper texture, muted colors, negative space' },
      { label: '暗黑奇幻', text: 'dark fantasy, volumetric fog, dramatic chiaroscuro, ember highlights' },
    ]

    const QUALITIES = ['auto', 'low', 'medium', 'high']
    const FORMATS = ['png', 'jpeg', 'webp']
    const DURATIONS = [4, 5, 6, 8, 10, 15, 20, 30]

    /* ------------------------------------------------------------------ 样式 */

    const CSS = [
      '.hs-root{display:flex;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#0f0f11);color:var(--dsw-alias-label-primary,#e9e9ec);font-size:13px;box-sizing:border-box}',
      '.hs-root *{box-sizing:border-box}',

      /* 左侧导航 */
      '.hs-rail{flex:0 0 208px;display:flex;flex-direction:column;gap:18px;padding:22px 14px 16px;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));background:var(--dsw-alias-bg-layer-1,#141416)}',
      '.hs-brand{display:flex;align-items:center;gap:10px;padding:0 8px}',
      '.hs-brand-name{display:flex;flex-direction:column;line-height:1.25}',
      '.hs-brand-name b{font-size:14px;font-weight:600;letter-spacing:.2px}',
      '.hs-brand-name span{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-nav{display:flex;flex-direction:column;gap:4px}',
      '.hs-nav-item{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary,#b6b9bd);font:inherit;font-size:13px;cursor:pointer;text-align:left;transition:background .12s ease,color .12s ease}',
      '.hs-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#e9e9ec)}',
      '.hs-nav-item[data-active="true"]{background:var(--dsw-alias-bg-layer-3,#26262b);color:var(--dsw-alias-label-primary,#fff);font-weight:500}',
      '.hs-nav-item .hs-nav-badge{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-variant-numeric:tabular-nums}',
      '.hs-rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#191919);font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-rail-foot b{color:var(--dsw-alias-label-secondary,#b6b9bd);font-weight:500;font-variant-numeric:tabular-nums}',

      /* 右侧舞台 */
      '.hs-stage{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}',
      '.hs-top{display:flex;align-items:center;gap:16px;padding:20px 26px 14px;flex:none}',
      '.hs-top-title{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.hs-top-title h1{margin:0;font-size:18px;font-weight:600;letter-spacing:.2px}',
      '.hs-top-title span{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
      '.hs-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#161618);color:var(--dsw-alias-label-secondary,#b6b9bd);font-size:11.5px;max-width:300px;overflow:hidden}',
      '.hs-chip .hs-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hs-chip.ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3ecf8e) 42%,transparent)}',
      '.hs-chip.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 48%,transparent);color:var(--dsw-alias-state-warn-label,#d29922)}',
      '.hs-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
      '.hs-dot.ok{background:var(--dsw-alias-state-success-primary,#3ecf8e)}',

      '.hs-content{flex:1;min-height:0;overflow:auto;padding:6px 26px 30px}',
      '.hs-content::-webkit-scrollbar{width:10px}',
      '.hs-content::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3,rgba(127,127,127,.3));border-radius:8px;border:3px solid transparent;background-clip:content-box}',

      /* 卡片与分栏 */
      '.hs-split{display:grid;grid-template-columns:minmax(340px,420px) minmax(0,1fr);gap:20px;align-items:start}',
      '@media (max-width:1080px){.hs-split{grid-template-columns:1fr}}',
      '.hs-card{display:flex;flex-direction:column;gap:16px;padding:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:20px;background:var(--dsw-alias-bg-layer-1,#151517)}',
      '.hs-card-head{display:flex;align-items:center;gap:10px}',
      '.hs-card-head h2{margin:0;font-size:13.5px;font-weight:600}',
      '.hs-card-head .hs-muted{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-card-head .hs-grow{margin-left:auto}',

      /* 页签 */
      '.hs-tabs{display:flex;gap:4px;padding:4px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1d1d20)}',
      '.hs-tab{flex:1;height:32px;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-secondary,#b6b9bd);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s ease,color .12s ease}',
      '.hs-tab:hover{color:var(--dsw-alias-label-primary,#fff)}',
      '.hs-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,.18)}',
      '.hs-tabs.ghost{background:transparent;padding:0;gap:8px}',
      '.hs-tabs.ghost .hs-tab{flex:0 0 auto;height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:999px;color:var(--dsw-alias-label-secondary,#b6b9bd)}',
      '.hs-tabs.ghost .hs-tab[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary,#fff);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 16%,transparent)}',
      '.hs-modehint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f95);margin-top:-6px}',

      /* 表单 */
      '.hs-field{display:flex;flex-direction:column;gap:8px}',
      '.hs-label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:11.5px}',
      '.hs-price{font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#6c8bff);white-space:nowrap}',
      '.hs-control{width:100%;height:38px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26));border-radius:12px;background:var(--dsw-alias-bg-base,#101012);color:var(--dsw-alias-label-primary,#e9e9ec);font:inherit;font-size:13px;outline:none}',
      'textarea.hs-control{height:auto;min-height:132px;padding:12px;line-height:1.6;resize:vertical}',
      '.hs-control:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.hs-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.hs-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}',
      '.hs-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.hs-pill{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#b6b9bd);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease}',
      '.hs-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.hs-pill[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary,#fff);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 18%,transparent)}',
      '.hs-link{border:none;background:none;color:var(--dsw-alias-brand-primary,#6c8bff);font:inherit;font-size:11.5px;cursor:pointer;padding:0}',
      '.hs-ref{position:relative;width:60px;height:60px;border-radius:14px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26))}',
      '.hs-ref img{width:100%;height:100%;object-fit:cover;display:block}',
      '.hs-ref-x{position:absolute;top:3px;right:3px;width:18px;height:18px;line-height:16px;border:none;border-radius:50%;background:rgba(0,0,0,.62);color:#fff;font-size:11px;cursor:pointer;padding:0}',
      '.hs-thumb{width:72px;height:72px;object-fit:cover;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24))}',
      '.hs-thumb.wide{width:100%;height:auto;max-height:46vh;object-fit:contain;background:var(--dsw-alias-bg-layer-2,#141416);border-radius:16px}',

      '.hs-actions{display:flex;gap:10px;margin-top:2px}',
      '.hs-button{flex:1;height:42px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1a1a1d);color:var(--dsw-alias-label-primary,#e9e9ec);font:inherit;font-size:13px;cursor:pointer}',
      '.hs-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.hs-button.primary{background:var(--dsw-alias-label-primary,#e9e9ec);color:var(--dsw-alias-bg-base,#101012);border-color:transparent;font-weight:600}',
      '.hs-button.primary:hover:not(:disabled){opacity:.88}',
      '.hs-button:disabled{opacity:.45;cursor:not-allowed}',
      '.hs-note{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a8f95);padding:10px 12px;border-radius:12px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.24))}',
      '.hs-note.error{color:var(--dsw-alias-label-error,#f16a6a);border-style:solid;border-color:color-mix(in srgb,var(--dsw-alias-label-error,#f16a6a) 40%,transparent)}',

      /* 画廊 */
      '.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,200px));gap:16px;justify-content:start}',
      '.hs-tile{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:18px;background:var(--dsw-alias-bg-layer-1,#151517);position:relative}',
      '.hs-tile-media{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;display:block;background:var(--dsw-alias-bg-layer-2,#101012);cursor:zoom-in}',
      '.hs-tile-badge{position:absolute;left:18px;top:18px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;letter-spacing:.6px}',
      '.hs-star{position:absolute;right:16px;top:16px;width:26px;height:26px;border:none;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:13px;cursor:pointer;padding:0;z-index:2}',
      '.hs-star[data-on="true"]{color:#f5c451}',
      '.hs-tile-acts{position:absolute;inset:auto 12px 12px 12px;display:flex;gap:6px;opacity:0;transition:opacity .12s ease}',
      '.hs-tile:hover .hs-tile-acts{opacity:1}',
      '.hs-mini{flex:1;height:26px;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(0,0,0,.55);color:#fff;font:inherit;font-size:11px;cursor:pointer}',
      '.hs-mini:hover{background:rgba(0,0,0,.75)}',
      '.hs-tile-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f95);white-space:nowrap}',
      '.hs-tile-meta .hs-ellip{min-width:0;flex:1}',

      /* 概览数字 */
      '.hs-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
      '.hs-stat{padding:14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#191919);display:flex;flex-direction:column;gap:4px}',
      '.hs-stat b{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.3px}',
      '.hs-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

      /* 任务卡 */
      '.hs-job{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#151517);margin-bottom:10px}',
      '.hs-job-head{display:flex;align-items:center;gap:10px;font-size:12.5px}',
      '.hs-job-title{font-weight:500}',
      '.hs-job-state{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8f95);font-variant-numeric:tabular-nums}',
      '.hs-bar{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#26262b);overflow:hidden}',
      '.hs-bar i{display:block;height:100%;width:40%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);animation:hs-slide 1.2s ease-in-out infinite}',
      '@keyframes hs-slide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}',
      '.hs-job-prompt{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a8f95);line-height:1.5;max-height:3em;overflow:hidden}',
      '.hs-job-error{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-error,#f16a6a);padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-label-error,#f16a6a) 10%,transparent)}',

      /* 空态 */
      '.hs-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:56px 20px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:20px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:12.5px;text-align:center}',

      /* 角色卡 / 工具卡 */
      '.hs-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}',
      '.hs-charcard{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:18px;background:var(--dsw-alias-bg-layer-1,#151517)}',
      '.hs-charcard-top{display:flex;align-items:center;gap:12px}',
      '.hs-charcard-name{font-weight:600;font-size:13px}',
      '.hs-charcard-desc{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#8a8f95);max-height:4.6em;overflow:hidden}',
      '.hs-charcard-acts{display:flex;gap:8px}',
      '.hs-charcard-acts .hs-button{height:34px;font-size:12px}',

      /* 弹层 */
      '.hs-modal-mask{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:40px;background:rgba(0,0,0,.62)}',
      '.hs-modal{width:min(860px,94vw);max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:22px;border-radius:22px;background:var(--dsw-alias-bg-base,#111);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.26));box-shadow:0 30px 80px rgba(0,0,0,.5)}',
      '.hs-modal.narrow{width:min(560px,94vw)}',
      '.hs-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.hs-modal-head strong{font-size:14px}',
      '.hs-pickgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}',
      '.hs-pick{padding:0;border:2px solid transparent;border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#161618);cursor:pointer;aspect-ratio:1}',
      '.hs-pick[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.hs-pick img{width:100%;height:100%;object-fit:cover;display:block}',
      '.hs-lightbox{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:44px;background:rgba(0,0,0,.8)}',
      '.hs-lightbox img,.hs-lightbox video{max-width:100%;max-height:calc(100vh - 120px);border-radius:18px;box-shadow:0 30px 70px rgba(0,0,0,.6)}',
      '.hs-lb-bar{position:absolute;top:20px;right:22px;display:flex;gap:10px}',
      '.hs-lb-bar button,.hs-lb-bar a{height:34px;padding:0 14px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:12px;background:rgba(0,0,0,.5);color:#fff;font:inherit;font-size:12px;cursor:pointer;text-decoration:none}',
      '.hs-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:var(--dsw-alias-toast-bg,rgba(30,30,34,.95));color:var(--dsw-alias-label-primary,#fff);font-size:12px;box-shadow:0 12px 30px rgba(0,0,0,.4);z-index:80}',
    ].join('')

    /* ------------------------------------------------------------------ 工具函数 */

    const readForm = () => {
      try {
        const raw = window.localStorage.getItem(FORM_KEY)
        return raw === null ? {} : JSON.parse(raw)
      } catch {
        return {}
      }
    }

    const writeForm = (value) => {
      try {
        window.localStorage.setItem(FORM_KEY, JSON.stringify(value))
      } catch {
        // 隐私模式下写不了，忽略即可
      }
    }

    const formatBytes = (bytes) => {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
      if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
      return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
    }

    const formatClock = (timestamp) => {
      if (!timestamp) return ''
      const date = new Date(timestamp)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const formatElapsed = (ms) => {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      if (total < 60) return `${total}s`
      return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`
    }

    const fileSrc = (rel) => `${API}/file?rel=${encodeURIComponent(rel)}`

    async function api(pathname, options = {}) {
      const init = { method: options.method ?? 'GET', headers: {} }
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(`${API}${pathname}`, init)
      const text = await response.text()
      let payload
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`非 JSON 响应：${text.slice(0, 120)}`)
      }
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? payload.message ?? `HTTP ${response.status}`)
      return payload
    }

    /* ------------------------------------------------------------------ 图标 */

    function StudioGlyph(props) {
      const size = props.size ?? 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 15.6, rx: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 8.2, cy: 9.4, r: 1.9, fill: 'currentColor' }),
        h('path', { d: 'M4.6 17.6l4.7-5.1 3 3.1 2.3-2.5 4.8 4.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M18.4 2.6l.66 1.84 1.84.66-1.84.66-.66 1.84-.66-1.84-1.84-.66 1.84-.66.66-1.84Z', fill: 'currentColor', opacity: .85 }))
    }

    function NavIcon(props) {
      const paths = {
        create: h('path', { d: 'M4 20l4.4-1.1L20 7.3a2.1 2.1 0 0 0 0-3L19.7 4a2.1 2.1 0 0 0-3 0L5.1 15.6 4 20Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        gallery: h('g', { stroke: 'currentColor', strokeWidth: 1.6 },
          h('rect', { x: 3.4, y: 3.4, width: 7.2, height: 7.2, rx: 2 }),
          h('rect', { x: 13.4, y: 3.4, width: 7.2, height: 7.2, rx: 2 }),
          h('rect', { x: 3.4, y: 13.4, width: 7.2, height: 7.2, rx: 2 }),
          h('rect', { x: 13.4, y: 13.4, width: 7.2, height: 7.2, rx: 2 })),
        favorites: h('path', { d: 'M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.8l5.9-.9L12 3.6Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        characters: h('g', { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
          h('circle', { cx: 12, cy: 8.4, r: 3.4 }),
          h('path', { d: 'M4.8 20c.9-3.4 3.6-5.2 7.2-5.2s6.3 1.8 7.2 5.2' })),
        tools: h('g', { stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' },
          h('path', { d: 'M14.2 6.4a3.6 3.6 0 0 1 4.9 4.6l-8 8-4.6.9.9-4.6 6.8-8.9Z' }),
          h('path', { d: 'M9.6 14.4l2 2' })),
      }
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, paths[props.name] ?? null)
    }

    /* ------------------------------------------------------------------ 小组件 */

    function Field(props) {
      return h('label', { className: 'hs-field' },
        h('span', { className: 'hs-label' }, h('span', null, props.label), props.extra ?? null),
        props.children)
    }

    function Tile(props) {
      const entry = props.entry
      const isVideo = entry.kind === 'video'
      return h('figure', { className: 'hs-tile' },
        isVideo
          ? h('video', { className: 'hs-tile-media', src: fileSrc(entry.rel), muted: true, playsInline: true, preload: 'metadata', onClick: () => props.onOpen(entry) })
          : h('img', { className: 'hs-tile-media', src: fileSrc(entry.rel), alt: entry.prompt || entry.file, loading: 'lazy', onClick: () => props.onOpen(entry) }),
        h('span', { className: 'hs-tile-badge' }, isVideo ? 'VIDEO' : (entry.tool === 'upscale' ? '4K' : 'IMAGE')),
        props.onFavorite === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'hs-star',
            'data-on': String(Boolean(props.favorited)),
            title: props.favorited ? T.unfavorite : T.favorite,
            onClick: (event) => { event.stopPropagation(); props.onFavorite(entry) },
          }, props.favorited ? '★' : '☆'),
        h('div', { className: 'hs-tile-acts' },
          h('button', { type: 'button', className: 'hs-mini', onClick: () => props.onOpen(entry) }, T.preview),
          props.onUseAsRef === undefined || isVideo
            ? null
            : h('button', { type: 'button', className: 'hs-mini', title: T.applyRef, onClick: () => props.onUseAsRef(entry) }, T.refs),
          props.onUpscale === undefined || isVideo
            ? null
            : h('button', { type: 'button', className: 'hs-mini', title: T.upscaleThis, onClick: () => props.onUpscale(entry) }, '4K'),
          h('a', { className: 'hs-mini', style: { display: 'grid', placeItems: 'center', textDecoration: 'none' }, href: fileSrc(entry.rel), download: entry.file }, T.download),
          props.onDelete === undefined
            ? null
            : h('button', { type: 'button', className: 'hs-mini', onClick: () => props.onDelete(entry) }, '×')),
        h('figcaption', { className: 'hs-tile-meta' },
          h('span', { className: 'hs-ellip', title: entry.prompt }, entry.prompt || entry.file),
          h('span', null, formatBytes(entry.bytes))),
        h('div', { className: 'hs-tile-meta' },
          h('span', { className: 'hs-ellip' }, entry.model),
          h('span', null, formatClock(entry.createdAt))))
    }

    function JobCard(props) {
      const job = props.job
      const running = job.status === 'running' || job.status === 'queued'
      const statusText = job.status === 'failed' ? T.failed
        : job.status === 'cancelled' ? T.cancelled
          : job.status === 'succeeded' ? T.done
            : job.phase || T.queued
      return h('div', { className: 'hs-job' },
        h('div', { className: 'hs-job-head' },
          h('span', { className: 'hs-job-title' }, `${job.model} · ${job.kind === 'video' ? T.video : (job.tool === 'upscale' ? T.upscale : T.image)}`),
          h('span', { className: 'hs-job-state' }, `${statusText} · ${formatElapsed(job.elapsedMs)}`),
          running
            ? h('button', { type: 'button', className: 'hs-pill', onClick: () => props.onCancel(job) }, T.cancel)
            : (props.onDismiss ? h('button', { type: 'button', className: 'hs-pill', onClick: () => props.onDismiss(job) }, T.dismiss) : null)),
        running ? h('div', { className: 'hs-bar' }, h('i')) : null,
        h('div', { className: 'hs-job-prompt' }, job.prompt),
        job.error ? h('div', { className: 'hs-job-error' }, job.error) : null)
    }

    /* ------------------------------------------------------------------ 主面板 */

    function StudioPanel() {
      const saved = useMemo(readForm, [])
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')
      const [dismissed, setDismissed] = useState(() => [])
      const [lightbox, setLightbox] = useState(null)
      const [view, setView] = useState('create')
      const [mode, setMode] = useState(saved.mode === 'ref' || saved.mode === 'video' ? saved.mode : 'text')
      const [model, setModel] = useState(saved.model || '')
      const [prompt, setPrompt] = useState(saved.prompt || '')
      const [size, setSize] = useState(saved.size || '1024x1024')
      const [customSize, setCustomSize] = useState(saved.customSize || '')
      const [quality, setQuality] = useState(saved.quality || 'auto')
      const [count, setCount] = useState(saved.count || 1)
      const [format, setFormat] = useState(saved.format || 'png')
      const [duration, setDuration] = useState(saved.duration || 5)
      const [resolution, setResolution] = useState(saved.resolution || '720p')
      const [refs, setRefs] = useState(() => (Array.isArray(saved.refs) ? saved.refs : []))
      const [pickedChars, setPickedChars] = useState(() => (Array.isArray(saved.characters) ? saved.characters : []))
      const [folderId, setFolderId] = useState('')
      const [galleryFilter, setGalleryFilter] = useState('all')
      const [picker, setPicker] = useState(null)
      const [charDraft, setCharDraft] = useState(null)
      const [toolSource, setToolSource] = useState(null)
      const aliveRef = useRef(true)

      const load = useCallback(async (silent) => {
        try {
          const data = await api('/state')
          if (!aliveRef.current) return
          setState(data)
          if (!silent) setError('')
        } catch (caught) {
          if (!aliveRef.current) return
          setError(`${T.loadFailed}：${caught.message}`)
        }
      }, [])

      useEffect(() => {
        aliveRef.current = true
        void load(false)
        return () => { aliveRef.current = false }
      }, [load])

      const jobs = state?.jobs ?? []
      const history = state?.history ?? []
      const runningJobs = jobs.filter((job) => job.status === 'running' || job.status === 'queued')
      const failedJobs = jobs.filter((job) => (job.status === 'failed' || job.status === 'cancelled') && !dismissed.includes(job.id))
      const hasRunning = runningJobs.length > 0

      useEffect(() => {
        if (!hasRunning) return undefined
        const timer = window.setInterval(() => { void load(true) }, POLL_MS)
        return () => { window.clearInterval(timer) }
      }, [hasRunning, load])

      useEffect(() => {
        if (!hasRunning) return undefined
        const timer = window.setTimeout(() => { void load(true) }, 300)
        return () => { window.clearTimeout(timer) }
      }, [hasRunning, load])

      // 宿主第一轮拉价目表可能还没回来，这里补几次
      useEffect(() => {
        if (state === undefined || state?.pricing?.ok !== false) return undefined
        const timer = window.setTimeout(() => { void load(true) }, 2500)
        return () => { window.clearTimeout(timer) }
      }, [state, load])

      const models = state?.models ?? { image: [], video: [], upscale: [] }
      const kind = mode === 'video' ? 'video' : 'image'
      const pool = kind === 'video' ? models.video : models.image
      const activeModel = pool.includes(model) ? model : (pool[0] ?? '')

      useEffect(() => {
        if (kind !== 'video') return
        const match = /(480|720|1080)/u.exec(activeModel)
        if (match !== null) setResolution(`${match[1]}p`)
      }, [kind, activeModel])

      /* ---- 价格 ---- */
      const pricing = state?.pricing ?? { ok: false, models: {}, currency: '$', error: '' }
      const symbol = pricing.currency || '$'
      const money = (value) => `${symbol}${Number(value || 0).toFixed(2)}`
      const priceOf = (id) => (pricing.models ? pricing.models[id] : undefined)

      const optionLabel = (id) => {
        const item = priceOf(id)
        if (item === undefined) return id
        return `${id} · ${money(item.price)}${item.perSecond ? T.perSecond : T.perImage}`
      }

      const priceLine = (id) => {
        const item = priceOf(id)
        if (item === undefined) return h('span', { className: 'hs-price' }, pricing.ok ? T.priceUnset : '…')
        if (item.perSecond) {
          return h('span', { className: 'hs-price' }, `${money(item.price)}${T.perSecond} · ${duration}s ≈ ${money(item.price * duration)}`)
        }
        const total = item.price * count
        return h('span', { className: 'hs-price' }, count > 1
          ? `${money(item.price)}${T.perImage} ×${count} ≈ ${money(total)}`
          : `${money(item.price)}${T.perImage}`)
      }

      const estimate = (() => {
        const item = priceOf(activeModel)
        if (item === undefined) return ''
        const total = item.perSecond ? item.price * duration : item.price * count
        return `${T.estimate} ${money(total)}`
      })()

      useEffect(() => {
        const payload = { mode, model: activeModel, prompt, size, customSize, quality, count, format, duration, resolution, refs, characters: pickedChars }
        writeForm(payload)
      }, [mode, activeModel, prompt, size, customSize, quality, count, format, duration, resolution, refs, pickedChars])

      useEffect(() => {
        if (lightbox === null) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setLightbox(null) }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [lightbox])

      useEffect(() => {
        if (toast === '') return undefined
        const timer = window.setTimeout(() => setToast(''), 1800)
        return () => { window.clearTimeout(timer) }
      }, [toast])

      const generate = async () => {
        if (prompt.trim() === '' || busy) return
        setBusy(true)
        setError('')
        try {
          await api('/generate', {
            method: 'POST',
            body: {
              kind,
              model: activeModel,
              prompt,
              size: customSize.trim() !== '' ? customSize.trim() : size,
              quality,
              count,
              format,
              duration,
              resolution,
              refs: mode === 'ref' ? refs : [],
              characters: mode === 'ref' ? pickedChars : [],
            },
          })
          await load(true)
          setView('create')
        } catch (caught) {
          setError(caught.message)
        } finally {
          setBusy(false)
        }
      }

      const cancelJob = async (job) => {
        try {
          await api(`/jobs/${encodeURIComponent(job.id)}`, { method: 'POST' })
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const deleteEntry = async (entry) => {
        if (!window.confirm(T.confirmDelete)) return
        try {
          await api('/history/delete', { method: 'POST', body: { id: entry.id } })
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const copyPath = async (entry) => {
        const full = `${state?.config?.outputDir ?? ''}/${entry.rel}`
        try {
          await navigator.clipboard.writeText(full)
          setToast(T.copied)
        } catch {
          setError(`复制失败，路径是：${full}`)
        }
      }

      const openFolder = async () => {
        try {
          await api('/open-output', { method: 'POST' })
        } catch (caught) {
          setError(caught.message)
        }
      }

      /* ---- 收藏 / 角色 / 工具 ---- */
      const favoriteIds = new Set((state?.favorites?.items ?? []).map((item) => item.rel))
      const allFavorites = state?.favorites?.items ?? []
      const folders = state?.favorites?.folders ?? []
      const favorites = folderId === '' ? allFavorites : allFavorites.filter((item) => item.folderId === folderId)
      const characters = state?.characters?.items ?? []
      const maxRefs = state?.limits?.maxRefs ?? 4

      const addRef = (entry) => {
        setRefs((current) => (current.includes(entry.rel) ? current : [...current, entry.rel].slice(0, maxRefs)))
        setMode('ref')
        setToast(`${T.refs} +1`)
      }

      const toggleFavorite = async (entry) => {
        const hit = allFavorites.find((item) => item.rel === entry.rel)
        try {
          if (hit === undefined) {
            await api('/favorites/add', { method: 'POST', body: { rel: entry.rel } })
            setToast(T.favorited)
          } else {
            await api('/favorites/remove', { method: 'POST', body: { id: hit.id } })
            setToast(T.unfavorite)
          }
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const newFolder = async () => {
        const name = window.prompt(T.folderName)
        if (name === null || name.trim() === '') return
        try {
          await api('/favorites/folder', { method: 'POST', body: { action: 'create', name: name.trim() } })
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const saveCharacter = async (draft) => {
        try {
          await api('/characters/save', { method: 'POST', body: draft })
          setCharDraft(null)
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const deleteCharacter = async (id) => {
        try {
          await api('/characters/delete', { method: 'POST', body: { id } })
          setPickedChars((current) => current.filter((item) => item !== id))
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const runUpscale = async (source, modelId, targetSize) => {
        try {
          await api('/generate', {
            method: 'POST',
            body: { kind: 'image', tool: 'upscale', model: modelId, size: targetSize, prompt: '', refs: [source], count: 1, format: 'png' },
          })
          setToolSource(null)
          setView('create')
          await load(true)
        } catch (caught) {
          setError(caught.message)
        }
      }

      const config = state?.config
      const sizeValue = SIZE_PRESETS.some((item) => item.value === size) ? size : ''
      const favCount = allFavorites.length
      const stats = state?.stats ?? { count: 0, bytes: 0 }

      /* ---- 视图数据 ---- */
      const galleryItems = history.filter((entry) => {
        if (galleryFilter === 'image') return entry.kind === 'image' && entry.tool !== 'upscale'
        if (galleryFilter === 'video') return entry.kind === 'video'
        if (galleryFilter === 'upscale') return entry.tool === 'upscale'
        return true
      })
      const latest = history.filter((entry) => entry.kind === 'image').slice(0, 6)
      const historyByRel = new Map(history.map((entry) => [entry.rel, entry]))

      const viewMeta = {
        create: { title: T.navCreate, hint: T.navCreateHint },
        gallery: { title: T.navGallery, hint: T.navGalleryHint },
        favorites: { title: T.navFavorites, hint: T.navFavoritesHint },
        characters: { title: T.navCharacters, hint: T.navCharactersHint },
        tools: { title: T.navTools, hint: T.navToolsHint },
      }[view]

      /* ---- 子视图 ---- */

      const refsField = h(Field, {
        label: `${T.refs} ${refs.length}/${maxRefs}`,
        extra: h('button', { type: 'button', className: 'hs-link', onClick: () => setPicker('refs') }, `+ ${T.addRefs}`),
      },
      refs.length === 0
        ? h('div', { className: 'hs-note' }, T.refsHint)
        : h('div', { className: 'hs-chips' },
          refs.map((rel) => h('div', { key: rel, className: 'hs-ref' },
            h('img', { src: fileSrc(rel), alt: '' }),
            h('button', { type: 'button', className: 'hs-ref-x', title: T.remove, onClick: () => setRefs((current) => current.filter((item) => item !== rel)) }, '×'))),
          h('button', { type: 'button', className: 'hs-link', onClick: () => setRefs([]) }, T.clearRefs)))

      const charsField = h(Field, {
        label: T.characters,
        extra: refs.length === 0
          ? h('span', { className: 'hs-price' }, T.noCharRefs)
          : h('button', { type: 'button', className: 'hs-link', onClick: () => setCharDraft({ refs }) }, `+ ${T.addCharacter}`),
      },
      characters.length === 0
        ? h('div', { className: 'hs-note' }, T.characterEmpty)
        : h('div', { className: 'hs-chips' }, characters.map((character) => h('button', {
          key: character.id,
          type: 'button',
          className: 'hs-pill',
          'data-active': String(pickedChars.includes(character.id)),
          title: [character.name, character.description].filter(Boolean).join(' · '),
          onClick: () => setPickedChars((current) => (current.includes(character.id) ? current.filter((item) => item !== character.id) : [...current, character.id])),
          onContextMenu: (event) => {
            event.preventDefault()
            if (window.confirm(`${T.deleteCharacter}：${character.name}?`)) void deleteCharacter(character.id)
          },
        }, character.name))))

      const formCard = h('section', { className: 'hs-card' },
        h('div', { className: 'hs-card-head' },
          h('h2', null, T.title),
          h('span', { className: 'hs-grow' }),
          h('span', { className: 'hs-muted' }, mode === 'video' ? T.video : mode === 'ref' ? T.modeRef : T.image)),
        h('div', { className: 'hs-tabs' },
          h('button', { type: 'button', className: 'hs-tab', 'data-active': String(mode === 'text'), onClick: () => setMode('text') }, T.modeText),
          h('button', { type: 'button', className: 'hs-tab', 'data-active': String(mode === 'ref'), onClick: () => setMode('ref') }, T.modeRef),
          h('button', { type: 'button', className: 'hs-tab', 'data-active': String(mode === 'video'), onClick: () => setMode('video') }, T.modeVideo)),
        h('div', { className: 'hs-modehint' },
          mode === 'video' ? T.modeVideoHint : mode === 'ref' ? T.modeRefHint : T.modeTextHint),

        mode === 'video' ? h('div', { className: 'hs-note' }, T.videoNote) : null,

        h(Field, { label: T.model, extra: priceLine(activeModel) },
          h('select', {
            className: 'hs-control',
            value: activeModel,
            onChange: (event) => setModel(event.target.value),
            disabled: pool.length === 0,
          }, pool.length === 0 ? h('option', { value: '' }, '—') : pool.map((id) => h('option', { key: id, value: id }, optionLabel(id))))),

        h(Field, { label: T.prompt, extra: h('span', null, `${prompt.length}/8000`) },
          h('textarea', {
            className: 'hs-control',
            value: prompt,
            placeholder: T.promptPlaceholder,
            spellCheck: false,
            onChange: (event) => setPrompt(event.target.value),
            onKeyDown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void generate()
              }
            },
          })),

        mode === 'ref' ? refsField : null,
        mode === 'ref' ? charsField : null,

        mode === 'video'
          ? h('div', { className: 'hs-row2' },
            h(Field, { label: T.duration },
              h('select', { className: 'hs-control', value: String(duration), onChange: (event) => setDuration(Number(event.target.value)) },
                DURATIONS.map((value) => h('option', { key: value, value: String(value) }, `${value}s`)))),
            h(Field, { label: T.resolution },
              h('select', { className: 'hs-control', value: resolution, onChange: (event) => setResolution(event.target.value) },
                ['480p', '720p', '1080p'].map((value) => h('option', { key: value, value }, value)))))
          : h(Field, { label: T.size },
            h('div', { className: 'hs-chips' },
              SIZE_PRESETS.map((item) => h('button', {
                key: item.value,
                type: 'button',
                className: 'hs-pill',
                'data-active': String(sizeValue === item.value && customSize.trim() === ''),
                onClick: () => { setSize(item.value); setCustomSize('') },
              }, `${item.label} · ${item.value}`)),
              h('input', {
                className: 'hs-control',
                style: { width: '128px', height: '30px', borderRadius: '999px', fontSize: '12px' },
                placeholder: T.customSize,
                value: customSize,
                onChange: (event) => setCustomSize(event.target.value),
              }))),

        mode === 'video'
          ? null
          : h('div', { className: 'hs-row3' },
            h(Field, { label: T.quality },
              h('select', { className: 'hs-control', value: quality, onChange: (event) => setQuality(event.target.value) },
                QUALITIES.map((value) => h('option', { key: value, value }, value)))),
            h(Field, { label: T.count },
              h('select', { className: 'hs-control', value: String(count), onChange: (event) => setCount(Number(event.target.value)) },
                [1, 2, 3, 4].map((value) => h('option', { key: value, value: String(value) }, `${value}`)))),
            h(Field, { label: T.format },
              h('select', { className: 'hs-control', value: format, onChange: (event) => setFormat(event.target.value) },
                FORMATS.map((value) => h('option', { key: value, value }, value))))),

        h(Field, { label: T.presets },
          h('div', { className: 'hs-chips' },
            STYLE_PRESETS.map((item) => h('button', {
              key: item.label,
              type: 'button',
              className: 'hs-pill',
              onClick: () => setPrompt((current) => (current.trim() === '' ? item.text : `${current.replace(/[,，\s]+$/u, '')}, ${item.text}`)),
            }, item.label)))),

        h('div', { className: 'hs-actions' },
          h('button', {
            type: 'button',
            className: 'hs-button primary',
            disabled: busy || prompt.trim() === '' || activeModel === '',
            onClick: () => void generate(),
          }, busy ? T.generating : (estimate === '' ? T.generate : `${T.generate} · ${estimate}`)),
          h('button', { type: 'button', className: 'hs-button', style: { flex: '0 0 96px' }, onClick: () => setPrompt('') }, T.clear)),

        config
          ? h('div', { className: 'hs-note' },
            `${T.limit} ${config.maxConcurrent} · ${T.total} ${stats.count} ${T.items} · ${formatBytes(stats.bytes)}`)
          : null)

      const jobsColumn = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } },
        runningJobs.length > 0
          ? h('section', { className: 'hs-card' },
            h('div', { className: 'hs-card-head' }, h('h2', null, T.running), h('span', { className: 'hs-muted' }, `${runningJobs.length}`)),
            h('div', null, runningJobs.map((job) => h(JobCard, { key: job.id, job, onCancel: cancelJob }))))
          : null,

        failedJobs.length > 0
          ? h('section', { className: 'hs-card' },
            h('div', { className: 'hs-card-head' }, h('h2', null, T.failedSection), h('span', { className: 'hs-muted' }, `${failedJobs.length}`)),
            h('div', null, failedJobs.map((job) => h(JobCard, {
              key: job.id,
              job,
              onDismiss: (item) => setDismissed((current) => [...current, item.id]),
            }))))
          : null,

        h('section', { className: 'hs-card' },
          h('div', { className: 'hs-card-head' },
            h('h2', null, T.latest),
            h('span', { className: 'hs-muted' }, `${stats.count} ${T.items}`),
            h('span', { className: 'hs-grow' }),
            h('button', { type: 'button', className: 'hs-pill', onClick: () => setView('gallery') }, T.seeAll)),
          latest.length === 0
            ? h('div', { className: 'hs-empty' },
              h(StudioGlyph, { size: 36 }),
              h('div', null, state === null ? T.loading : hasRunning ? T.runningEmpty : T.empty))
            : h('div', { className: 'hs-grid' }, latest.map((entry) => h(Tile, {
              key: entry.id,
              entry,
              onOpen: setLightbox,
              onCopy: copyPath,
              favorited: favoriteIds.has(entry.rel),
              onFavorite: toggleFavorite,
              onUseAsRef: addRef,
              onUpscale: (item) => setToolSource(item.rel),
            })))),

        h('section', { className: 'hs-card' },
          h('div', { className: 'hs-card-head' }, h('h2', null, T.overview), h('span', { className: 'hs-grow' }), h('span', { className: 'hs-muted' }, formatBytes(stats.bytes))),
          h('div', { className: 'hs-stats' },
            h('div', { className: 'hs-stat' }, h('b', null, `${stats.count}`), h('span', null, T.statsItems)),
            h('div', { className: 'hs-stat' }, h('b', null, `${favCount}`), h('span', null, T.statsFav)),
            h('div', { className: 'hs-stat' }, h('b', null, `${characters.length}`), h('span', null, T.statsChar)),
            h('div', { className: 'hs-stat' }, h('b', null, `${history.filter((entry) => entry.kind === 'video').length}`), h('span', null, T.video)))))

      const galleryView = h('section', { className: 'hs-card' },
        h('div', { className: 'hs-card-head' },
          h('h2', null, T.navGallery),
          h('span', { className: 'hs-muted' }, `${galleryItems.length} / ${stats.count}`),
          h('span', { className: 'hs-grow' }),
          h('div', { className: 'hs-tabs ghost' },
            ['all', 'image', 'video', 'upscale'].map((key) => h('button', {
              key,
              type: 'button',
              className: 'hs-tab',
              'data-active': String(galleryFilter === key),
              onClick: () => setGalleryFilter(key),
            }, T.filters[key])))),
        galleryItems.length === 0
          ? h('div', { className: 'hs-empty' }, h(StudioGlyph, { size: 36 }), h('div', null, T.emptyHistory))
          : h('div', { className: 'hs-grid' }, galleryItems.map((entry) => h(Tile, {
            key: entry.id,
            entry,
            onOpen: setLightbox,
            onCopy: copyPath,
            onDelete: deleteEntry,
            favorited: favoriteIds.has(entry.rel),
            onFavorite: toggleFavorite,
            onUseAsRef: addRef,
            onUpscale: (item) => setToolSource(item.rel),
          }))))

      const favoritesView = h('section', { className: 'hs-card' },
        h('div', { className: 'hs-card-head' },
          h('h2', null, T.navFavorites),
          h('span', { className: 'hs-muted' }, `${favorites.length}`),
          h('span', { className: 'hs-grow' }),
          h('button', { type: 'button', className: 'hs-pill', onClick: () => void newFolder() }, `+ ${T.newFolder}`)),
        h('div', { className: 'hs-chips' },
          h('button', { type: 'button', className: 'hs-pill', 'data-active': String(folderId === ''), onClick: () => setFolderId('') }, T.allFolders),
          folders.map((folder) => h('button', {
            key: folder.id,
            type: 'button',
            className: 'hs-pill',
            'data-active': String(folderId === folder.id),
            onClick: () => setFolderId(folder.id),
          }, folder.name))),
        favorites.length === 0
          ? h('div', { className: 'hs-empty' }, h(StudioGlyph, { size: 36 }), h('div', null, T.favEmpty))
          : h('div', { className: 'hs-grid' }, favorites.map((favorite) => h(Tile, {
            key: favorite.id,
            entry: historyByRel.get(favorite.rel) ?? {
              id: favorite.id,
              rel: favorite.rel,
              file: favorite.rel.split('/').pop(),
              kind: favorite.rel.endsWith('.mp4') ? 'video' : 'image',
              prompt: favorite.rel.split('/').pop(),
              model: '—',
              createdAt: favorite.createdAt,
            },
            onOpen: setLightbox,
            onCopy: copyPath,
            favorited: true,
            onFavorite: () => toggleFavorite(favorite),
            onUseAsRef: addRef,
            onUpscale: (item) => setToolSource(item.rel),
          }))))

      const charactersView = h('section', { className: 'hs-card' },
        h('div', { className: 'hs-card-head' },
          h('h2', null, T.navCharacters),
          h('span', { className: 'hs-muted' }, `${characters.length}`),
          h('span', { className: 'hs-grow' }),
          h('button', {
            type: 'button',
            className: 'hs-pill',
            disabled: refs.length === 0,
            title: refs.length === 0 ? T.noCharRefs : T.fromRefs,
            onClick: () => setCharDraft({ refs }),
          }, `+ ${T.addCharacter}`)),
        characters.length === 0
          ? h('div', { className: 'hs-empty' }, h(NavIcon, { name: 'characters' }), h('div', null, T.characterEmpty))
          : h('div', { className: 'hs-cards' }, characters.map((character) => h('div', { key: character.id, className: 'hs-charcard' },
            h('div', { className: 'hs-charcard-top' },
              h('img', { className: 'hs-thumb', src: fileSrc(character.refs[0] ?? ''), alt: '' }),
              h('div', { style: { minWidth: 0 } },
                h('div', { className: 'hs-charcard-name' }, character.name),
                h('div', { className: 'hs-charcard-desc' }, character.description || '—'))),
            h('div', { className: 'hs-charcard-acts' },
              h('button', {
                type: 'button',
                className: 'hs-button primary',
                onClick: () => {
                  setPickedChars((current) => (current.includes(character.id) ? current : [...current, character.id]))
                  setMode('ref')
                  setView('create')
                  setToast(`${T.useChar} ${character.name}`)
                },
              }, T.useChar),
              h('button', { type: 'button', className: 'hs-button', onClick: () => void deleteCharacter(character.id) }, T.deleteCharacter))))))

      const toolsView = h('section', { className: 'hs-card', style: { maxWidth: '760px' } },
        h('div', { className: 'hs-card-head' }, h('h2', null, T.tools), h('span', { className: 'hs-muted' }, `${models.upscale.length}`)),
        h('div', { className: 'hs-charcard' },
          h('div', { className: 'hs-charcard-top' },
            h('div', { style: { display: 'grid', placeItems: 'center', width: '72px', height: '72px', borderRadius: '18px', background: 'var(--dsw-alias-bg-layer-2,#161618)' } }, h(NavIcon, { name: 'tools' })),
            h('div', { style: { minWidth: 0 } },
              h('div', { className: 'hs-charcard-name' }, T.upscale),
              h('div', { className: 'hs-charcard-desc' }, T.upscaleHint))),
          h('div', { className: 'hs-note' }, T.upscaleNote),
          h('div', { className: 'hs-chips' },
            h('span', { className: 'hs-pill', style: { cursor: 'default' } }, '3840 \u00d7 2160'),
            h('span', { className: 'hs-pill', style: { cursor: 'default' } }, '2160 \u00d7 3840')),
          h('div', { className: 'hs-charcard-acts' },
            h('button', {
              type: 'button',
              className: 'hs-button primary',
              style: { flex: '0 0 auto', padding: '0 20px' },
              onClick: () => setPicker('upscale'),
            }, T.toolOpen))))

      const viewBody = view === 'create'
        ? h('div', { className: 'hs-split' }, formCard, jobsColumn)
        : view === 'gallery' ? galleryView
          : view === 'favorites' ? favoritesView
            : view === 'characters' ? charactersView
              : toolsView

      const navItems = [
        { key: 'create', label: T.navCreate, icon: 'create', badge: hasRunning ? `${runningJobs.length}` : '' },
        { key: 'gallery', label: T.navGallery, icon: 'gallery', badge: `${stats.count}` },
        { key: 'favorites', label: T.navFavorites, icon: 'favorites', badge: `${favCount}` },
        { key: 'characters', label: T.navCharacters, icon: 'characters', badge: `${characters.length}` },
        { key: 'tools', label: T.navTools, icon: 'tools' },
      ]

      return h('div', { className: 'hs-root' },
        h('aside', { className: 'hs-rail' },
          h('div', { className: 'hs-brand' },
            h(StudioGlyph, { size: 22 }),
            h('div', { className: 'hs-brand-name' }, h('b', null, T.title), h('span', null, T.subtitle))),
          h('nav', { className: 'hs-nav' }, navItems.map((item) => h('button', {
            key: item.key,
            type: 'button',
            className: 'hs-nav-item',
            'data-active': String(view === item.key),
            onClick: () => setView(item.key),
          }, h(NavIcon, { name: item.icon }), h('span', null, item.label), item.badge ? h('span', { className: 'hs-nav-badge' }, item.badge) : null))),
          h('div', { className: 'hs-rail-foot' },
            h('div', null, `${T.statsItems} `, h('b', null, `${stats.count}`), ` · ${formatBytes(stats.bytes)}`),
            h('div', null, `${T.statsFav} `, h('b', null, `${favCount}`), ` · ${T.statsChar} `, h('b', null, `${characters.length}`)),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              h('span', { className: `hs-dot ${config?.hasKey ? 'ok' : ''}` }),
              h('span', null, config?.hasKey ? `${T.keyReady} · ${config.keySource}` : T.keyMissing)))),

        h('main', { className: 'hs-stage' },
          h('header', { className: 'hs-top' },
            h('div', { className: 'hs-top-title' }, h('h1', null, viewMeta.title), h('span', null, viewMeta.hint)),
            h('div', { className: 'hs-top-actions' },
              h('button', {
                type: 'button',
                className: 'hs-pill',
                onClick: () => { void api('/pricing/refresh', { method: 'POST' }).catch(() => {}); void load(false) },
              }, T.refresh),
              config?.hasKey
                ? h('span', { className: 'hs-chip ok' }, h('span', { className: 'hs-dot ok' }), h('span', null, `${T.keyReady} · ${config.apiKeyEnv}`))
                : h('span', { className: 'hs-chip warn' }, h('span', { className: 'hs-dot' }), h('span', null, T.keyMissing)),
              config
                ? h('button', { type: 'button', className: 'hs-chip', title: config.outputDir, onClick: () => void openFolder() },
                  h('span', { className: 'hs-ellip' }, `${T.outputDir} ${config.outputDir}`))
                : null)),
          h('div', { className: 'hs-content' },
            error !== '' ? h('div', { className: 'hs-note error', style: { marginBottom: '16px' } }, error) : null,
            viewBody)),

        picker !== null
          ? h('div', { className: 'hs-modal-mask', onClick: () => setPicker(null) },
            h('div', { className: 'hs-modal', onClick: (event) => event.stopPropagation() },
              h('div', { className: 'hs-modal-head' },
                h('strong', null, picker === 'refs' ? T.addRefs : T.pickSource),
                h('button', { type: 'button', className: 'hs-pill', onClick: () => setPicker(null) }, T.close)),
              h('div', { className: 'hs-pickgrid' },
                history.filter((entry) => entry.kind === 'image').slice(0, 60).map((entry) => h('button', {
                  key: entry.id,
                  type: 'button',
                  className: 'hs-pick',
                  'data-active': String(picker === 'refs' ? refs.includes(entry.rel) : toolSource === entry.rel),
                  onClick: () => {
                    if (picker === 'refs') {
                      setRefs((current) => (current.includes(entry.rel) ? current.filter((item) => item !== entry.rel) : [...current, entry.rel].slice(0, maxRefs)))
                    } else {
                      setToolSource(entry.rel)
                      setPicker(null)
                    }
                  },
                }, h('img', { src: fileSrc(entry.rel), alt: '', loading: 'lazy' }))))))
          : null,

        charDraft !== null
          ? h('div', { className: 'hs-modal-mask', onClick: () => setCharDraft(null) },
            h('form', {
              className: 'hs-modal narrow',
              onClick: (event) => event.stopPropagation(),
              onSubmit: (event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                void saveCharacter({
                  name: String(data.get('name') ?? '').trim(),
                  description: String(data.get('description') ?? '').trim(),
                  refs: charDraft.refs,
                  ...(charDraft.id === undefined ? {} : { id: charDraft.id }),
                })
              },
            },
            h('div', { className: 'hs-modal-head' }, h('strong', null, T.addCharacter)),
            h(Field, { label: T.characterName }, h('input', { className: 'hs-control', name: 'name', defaultValue: charDraft.name ?? '', required: true, maxLength: 60 })),
            h(Field, { label: T.characterDesc }, h('textarea', { className: 'hs-control', name: 'description', rows: 3, defaultValue: charDraft.description ?? '', maxLength: 600 })),
            h('div', { className: 'hs-chips' }, charDraft.refs.map((rel) => h('img', { key: rel, className: 'hs-thumb', src: fileSrc(rel), alt: '' }))),
            h('div', { className: 'hs-actions' },
              h('button', { type: 'submit', className: 'hs-button primary' }, T.saveCharacter),
              h('button', { type: 'button', className: 'hs-button', onClick: () => setCharDraft(null) }, T.cancel))))
          : null,

        toolSource !== null
          ? h('div', { className: 'hs-modal-mask', onClick: () => setToolSource(null) },
            h('div', { className: 'hs-modal narrow', onClick: (event) => event.stopPropagation() },
              h('div', { className: 'hs-modal-head' },
                h('strong', null, `${T.tools} · ${T.upscale}`),
                h('button', { type: 'button', className: 'hs-pill', onClick: () => setToolSource(null) }, T.close)),
              h('img', { className: 'hs-thumb wide', src: fileSrc(toolSource), alt: '' }),
              h('div', { className: 'hs-note' }, T.upscaleHint),
              h('div', { className: 'hs-actions' },
                h('button', { type: 'button', className: 'hs-button primary', onClick: () => void runUpscale(toolSource, 'gpt-image-2pro-4k', '3840x2160') }, `${T.runTool} · 3840×2160`),
                h('button', { type: 'button', className: 'hs-button', onClick: () => void runUpscale(toolSource, 'gpt-image-2pro-4k', '2160x3840') }, `${T.runTool} · 2160×3840`))))
          : null,

        lightbox
          ? h('div', { className: 'hs-lightbox', role: 'dialog', 'aria-modal': 'true', onClick: () => setLightbox(null) },
            h('div', { className: 'hs-lb-bar', onClick: (event) => event.stopPropagation() },
              h('button', { type: 'button', onClick: () => void toggleFavorite(lightbox) }, favoriteIds.has(lightbox.rel) ? `★ ${T.unfavorite}` : `☆ ${T.favorite}`),
              h('a', { href: fileSrc(lightbox.rel), download: lightbox.file }, T.download),
              h('button', { type: 'button', onClick: () => setLightbox(null) }, T.close)),
            lightbox.kind === 'video'
              ? h('video', { src: fileSrc(lightbox.rel), controls: true, autoPlay: true, onClick: (event) => event.stopPropagation() })
              : h('img', { src: fileSrc(lightbox.rel), alt: lightbox.prompt || lightbox.file, onClick: (event) => event.stopPropagation() }))
          : null,

        toast !== '' ? h('div', { className: 'hs-toast' }, toast) : null)
    }

    /* ------------------------------------------------------------------ 入口 */

    function apply(ctx) {
      ctx.effect(() => {
        if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`)) return undefined
        const style = document.createElement('style')
        style.dataset.plugin = PLUGIN_ID
        style.textContent = CSS
        document.head.append(style)
        return () => { style.remove() }
      }, 'hfsy-studio: panel styles')

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: T.title,
      }, StudioGlyph))

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, StudioPanel))
    }

    return { name: 'hfsy-studio', inject: ['slots'], apply }
  },
})