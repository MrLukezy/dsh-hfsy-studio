/**
 * dsh-hfsy-studio —— 浏览器半边。
 *
 * 1) 左侧栏「插件面板」里多一个图片图标「生图工作台」；
 * 2) 点进去是全屏工作台：左边参数（模型 / 尺寸 / 质量 / 数量 / 提示词 / 预设词），
 *    右边是本次任务进度 + 结果画廊 + 历史记录，可预览、下载、复制路径、删除；
 * 3) 数据全部来自同源接口 /hfsy-studio/api/*，浏览器拿不到也不保存密钥。
 *
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
        favEmpty: '还没有收藏。在历史或画廊里点 ☆ 就能收藏。',
        moveTo: '移动到',
        tools: '工具库',
        upscale: '4K 增强',
        upscaleHint: '把选中的图放大到 4K，只提清晰度、不改内容',
        source: '源图',
        pickSource: '选一张源图',
        runTool: '生成 4K',
        pickTitle: '从历史 / 收藏里挑图',
        selected: '已选',
        cancel: '取消',
      }
      : {
        title: 'Image Studio',
        subtitle: 'hfsy relay · image / video',
        image: 'Image',
        video: 'Video',
        model: 'Model',
        prompt: 'Prompt',
        promptPlaceholder: 'Describe the shot: subject, composition, style, light, palette, exclusions… (Ctrl+Enter to generate)',
        size: 'Size',
        quality: 'Quality',
        count: 'Count',
        format: 'Format',
        duration: 'Duration',
        resolution: 'Resolution',
        generate: 'Generate',
        generating: 'Generating…',
        cancel: 'Cancel',
        clear: 'Clear',
        presets: 'Style presets',
        running: 'Running',
        failedSection: 'Failed / cancelled',
        runningEmpty: 'Rendering — the result lands here when it finishes',
        dismiss: 'Dismiss',
        history: 'History',
        empty: 'Nothing generated yet. Write a prompt on the left and hit Generate.',
        emptyHistory: 'History is empty.',
        loading: 'Loading…',
        download: 'Download',
        copyPath: 'Copy path',
        copied: 'Path copied',
        remove: 'Delete record',
        openFolder: 'Open output folder',
        refresh: 'Refresh',
        keyReady: 'Key ready',
        keyMissing: 'Missing key',
        keySource: 'source',
        outputDir: 'Output',
        videoNote: 'Video goes through the relay /video/create + /video/query and bills per second; expect 1–3 minutes. Prices differ per resolution — check the dropdown.',
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
        confirmDelete: 'Delete this history record? The file on disk stays.',
        close: 'Close',
        preview: 'Preview',
        customSize: 'Custom WxH',
        loadFailed: 'Could not load studio state',
        refs: 'References',
        addRefs: 'Pick references',
        refsHint: 'With references the request goes to /images/edits (image-to-image, character consistency)',
        refsLimit: 'max',
        clearRefs: 'Clear references',
        characters: 'Characters',
        addCharacter: 'Save as character',
        characterName: 'Name',
        characterDesc: 'Look / outfit description (goes into the prompt)',
        characterEmpty: 'No characters yet. Pick references first, then save as a character.',
        saveCharacter: 'Save',
        deleteCharacter: 'Delete',
        favorites: 'Favorites',
        favorite: 'Favorite',
        favorited: 'Favorited',
        unfavorite: 'Unfavorite',
        allFolders: 'All',
        newFolder: 'New folder',
        folderName: 'Folder name',
        favEmpty: 'Nothing favorited yet. Hit ☆ on a tile to keep it.',
        moveTo: 'Move to',
        tools: 'Tools',
        upscale: '4K upscale',
        upscaleHint: 'Blow one image up to 4K — sharper detail only, layout untouched',
        source: 'Source',
        pickSource: 'Pick a source image',
        runTool: 'Make 4K',
        pickTitle: 'Pick from history / favorites',
        selected: 'selected',
        cancel: 'Cancel',
      }

    /** 常用尺寸：gpt-image 系只吃这几档，别的走自定义。 */
    const SIZE_PRESETS = [
      { label: '1:1', value: '1024x1024' },
      { label: '3:2', value: '1536x1024' },
      { label: '2:3', value: '1024x1536' },
      { label: '2:1 宽', value: '2048x1024' },
      { label: '1:2 竖', value: '1024x2048' },
    ]

    /** 画风预设：点一下把词缀接到提示词后面，游戏素材最常用。 */
    const STYLE_PRESETS = [
      { label: '游戏图标', text: 'game item icon, centered, bold silhouette, clean edge, mobile game asset, no text' },
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
      '.hs-root{display:flex;flex-direction:column;height:100%;min-height:0;padding:18px 20px 16px;gap:14px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;box-sizing:border-box}',
      '.hs-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex:none}',
      '.hs-title{display:flex;align-items:baseline;gap:8px;font-size:16px;font-weight:600;letter-spacing:.2px}',
      '.hs-sub{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-head-meta{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.hs-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:7px;background:var(--dsw-alias-bg-layer-1,#1c1c1e);color:var(--dsw-alias-label-secondary,#b6b9bd);font-size:11.5px;line-height:1;max-width:320px;overflow:hidden}',
      '.hs-chip .hs-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hs-chip.ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3ecf8e) 45%,transparent)}',
      '.hs-chip.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 50%,transparent);color:var(--dsw-alias-state-warn-label,#d29922)}',
      '.hs-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',
      '.hs-dot.ok{background:var(--dsw-alias-state-success-primary,#3ecf8e)}',
      '.hs-dot.warn{background:var(--dsw-alias-state-warn-primary,#d29922)}',
      '.hs-body{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;min-height:0;flex:1}',
      '@media (max-width:960px){.hs-body{grid-template-columns:1fr;grid-template-rows:minmax(0,auto) minmax(0,1fr)}}',
      '.hs-form{display:flex;flex-direction:column;gap:12px;min-height:0;overflow-y:auto;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1b1b1d)}',
      '.hs-tabs{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#232325)}',
      '.hs-tab{flex:1;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#b6b9bd);font:inherit;font-size:12.5px;cursor:pointer}',
      '.hs-tab[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,.14)}',
      '.hs-field{display:flex;flex-direction:column;gap:6px}',
      '.hs-label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:11.5px}',
      '.hs-price{font-variant-numeric:tabular-nums;color:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap}',
      '.hs-control{width:100%;box-sizing:border-box;min-height:32px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#232325);color:var(--dsw-alias-label-primary,#eee);font:inherit;font-size:12.5px;outline:none}',
      '.hs-control:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.hs-control[disabled]{opacity:.6;cursor:not-allowed}',
      'textarea.hs-control{min-height:118px;resize:vertical;line-height:1.55}',
      '.hs-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.hs-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}',
      '.hs-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.hs-pill{height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:14px;background:transparent;color:var(--dsw-alias-label-secondary,#b6b9bd);font:inherit;font-size:11.5px;cursor:pointer}',
      '.hs-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.hs-pill[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-label-primary,#f0f0f0);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8dff) 16%,transparent)}',
      '.hs-actions{display:flex;gap:8px;margin-top:2px}',
      '.hs-button{flex:1;height:34px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:9px;background:var(--dsw-alias-bg-layer-2,#232325);color:var(--dsw-alias-label-primary,#eee);font:inherit;font-size:12.5px;cursor:pointer}',
      '.hs-button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.hs-button[disabled]{opacity:.5;cursor:not-allowed}',
      '.hs-button.primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#4c8dff);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}',
      '.hs-button.primary:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover,#3f7ce6)}',
      '.hs-button.danger{color:var(--dsw-alias-label-error,#e5534b)}',
      '.hs-note{padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;border:1px dashed var(--dsw-alias-border-l3,rgba(127,127,127,.36));color:var(--dsw-alias-label-tertiary,#8a8f95)}',
      '.hs-note.warn{border-style:solid;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 10%,transparent);color:var(--dsw-alias-state-warn-label,#d9a53a)}',
      '.hs-note.error{border-style:solid;border-color:color-mix(in srgb,var(--dsw-alias-label-error,#e5534b) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-label-error,#e5534b) 10%,transparent);color:var(--dsw-alias-label-error,#e5534b)}',
      '.hs-main{display:flex;flex-direction:column;gap:12px;min-height:0;min-width:0}',
      '.hs-scroll{flex:1;min-height:0;overflow-y:auto;padding-right:4px;overscroll-behavior:contain}',
      '.hs-section-head{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin:2px 0 8px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:11.5px;letter-spacing:.3px;text-transform:uppercase}',
      '.hs-section-head .hs-count{margin-left:auto;text-transform:none;letter-spacing:0}',
      '.hs-job{display:flex;flex-direction:column;gap:8px;padding:11px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1b1b1d)}',
      '.hs-job-head{display:flex;align-items:center;gap:8px}',
      '.hs-job-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hs-job-state{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:11.5px;flex:none}',
      '.hs-job-prompt{color:var(--dsw-alias-label-secondary,#b6b9bd);font-size:12px;line-height:1.5;max-height:44px;overflow:hidden}',
      '.hs-bar{position:relative;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3,#2c2c2f);overflow:hidden}',
      '.hs-bar>i{position:absolute;inset:0;width:40%;border-radius:2px;background:linear-gradient(90deg,transparent,var(--dsw-alias-brand-primary,#4c8dff),transparent);animation:hsSweep 1.3s ease-in-out infinite}',
      '@keyframes hsSweep{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}',
      '.hs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(186px,1fr));gap:10px}',
      '.hs-tile{position:relative;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#232325);cursor:zoom-in}',
      '.hs-tile-media{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--dsw-alias-bg-layer-3,#2c2c2f)}',
      '.hs-tile-badge{position:absolute;top:7px;left:7px;height:19px;padding:0 6px;border-radius:5px;background:rgba(0,0,0,.62);color:#f2f2f2;font-size:10.5px;line-height:19px;letter-spacing:.4px}',
      '.hs-tile-acts{position:absolute;inset:auto 0 0 0;display:flex;gap:4px;padding:6px;background:linear-gradient(transparent,rgba(0,0,0,.72));opacity:0;transition:opacity .12s ease}',
      '.hs-tile:hover .hs-tile-acts,.hs-tile:focus-within .hs-tile-acts{opacity:1}',
      '.hs-mini{flex:1;height:24px;border:0;border-radius:6px;background:rgba(255,255,255,.16);color:#fff;font:inherit;font-size:11px;cursor:pointer;backdrop-filter:blur(2px)}',
      '.hs-mini:hover{background:rgba(255,255,255,.3)}',
      '.hs-tile-meta{display:flex;align-items:center;gap:6px;padding:6px 8px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:10.5px;line-height:1.4}',
      '.hs-tile-meta .hs-ellip{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hs-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:180px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:12px;color:var(--dsw-alias-label-tertiary,#8a8f95);font-size:12.5px;text-align:center;padding:24px}',
      '.hs-lightbox{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:36px;background:rgba(0,0,0,.78)}',
      '.hs-lightbox img,.hs-lightbox video{max-width:100%;max-height:calc(100vh - 96px);border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.55)}',
      '.hs-tabsline{display:flex;gap:6px;align-items:center}',
      '.hs-tab.sm{flex:0 0 auto;height:26px;padding:0 12px;font-size:12px;white-space:nowrap}',
      '.hs-link{border:none;background:none;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:11.5px;cursor:pointer;padding:0}',
      '.hs-ref{position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))}',
      '.hs-ref img{width:100%;height:100%;object-fit:cover;display:block}',
      '.hs-ref-x{position:absolute;top:2px;right:2px;width:16px;height:16px;line-height:14px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:11px;cursor:pointer;padding:0}',
      '.hs-thumb{width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))}',
      '.hs-thumb.wide{width:100%;height:auto;max-height:44vh;object-fit:contain;background:var(--dsw-alias-bg-layer-2,#161618)}',
      '.hs-modal{width:min(760px,92vw);max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:14px;background:var(--dsw-alias-bg-base,#111);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))}',
      '.hs-modal.narrow{width:min(520px,92vw)}',
      '.hs-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.hs-pickgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}',
      '.hs-pick{padding:0;border:2px solid transparent;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#161618);cursor:pointer;aspect-ratio:1}',
      '.hs-pick[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.hs-pick img{width:100%;height:100%;object-fit:cover;display:block}',
      '.hs-star{position:absolute;top:6px;right:6px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:12px;cursor:pointer;padding:0;z-index:2}',
      '.hs-star[data-on="true"]{color:#f5c451}',
      '.hs-lb-bar{position:absolute;top:14px;right:14px;display:flex;gap:8px}',
      '.hs-lb-bar button{height:30px;padding:0 12px;border:1px solid rgba(255,255,255,.24);border-radius:8px;background:rgba(0,0,0,.5);color:#fff;font:inherit;font-size:12px;cursor:pointer}',
      '.hs-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:70;padding:8px 14px;border-radius:8px;background:var(--dsw-alias-toast-bg,rgba(30,30,30,.92));color:var(--dsw-alias-toast-label,#fff);font-size:12px;box-shadow:0 8px 28px rgba(0,0,0,.35)}',
    ].join('\n')

    /* ------------------------------------------------------------- 数据访问 */

    async function api(path, options = {}) {
      const init = { method: options.method ?? 'GET', headers: {} }
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(`${API}${path}`, init)
      const text = await response.text()
      let payload
      try {
        payload = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(`接口返回了非 JSON：${text.slice(0, 160)}`)
      }
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    function readForm() {
      try {
        const raw = window.localStorage.getItem(FORM_KEY)
        return raw ? JSON.parse(raw) : {}
      } catch {
        return {}
      }
    }

    function writeForm(value) {
      try {
        window.localStorage.setItem(FORM_KEY, JSON.stringify(value))
      } catch {
        /* 隐私模式下写不进去，忽略 */
      }
    }

    const formatBytes = (bytes) => {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
      return `${(value / 1024 / 1024).toFixed(1)} MB`
    }

    const formatClock = (timestamp) => {
      const date = new Date(timestamp)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const formatElapsed = (ms) => {
      const value = Math.max(0, Number(ms) || 0)
      if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
      return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
    }

    const fileSrc = (rel) => `${API}/file?rel=${encodeURIComponent(rel)}`

    /* ------------------------------------------------------------------ 图标 */

    function StudioGlyph(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
        style: { display: 'block' },
      },
      h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 15.6, rx: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('circle', { cx: 8.2, cy: 9.4, r: 1.9, fill: 'currentColor' }),
      h('path', { d: 'M4.6 17.6l4.7-5.1 3 3.1 2.3-2.5 4.8 4.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M18.4 2.6l.66 1.84 1.84.66-1.84.66-.66 1.84-.66-1.84-1.84-.66 1.84-.66.66-1.84Z', fill: 'currentColor', opacity: .85 }))
    }

    /* ------------------------------------------------------------------ 组件 */

    function Field(props) {
      return h('label', { className: 'hs-field' },
        h('span', { className: 'hs-label' }, h('span', null, props.label), props.extra ?? null),
        props.children)
    }

    function Tile(props) {
      const entry = props.entry
      const isVideo = entry.kind === 'video'
      return h('figure', { className: 'hs-tile', style: { margin: 0 } },
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
          h('a', { className: 'hs-mini', style: { display: 'grid', placeItems: 'center', textDecoration: 'none' }, href: fileSrc(entry.rel), download: entry.file }, T.download),
          props.onUseAsRef === undefined || isVideo
            ? null
            : h('button', { type: 'button', className: 'hs-mini', onClick: () => props.onUseAsRef(entry) }, T.refs),
          h('button', { type: 'button', className: 'hs-mini', onClick: () => props.onCopy(entry) }, T.copyPath),
          props.onDelete === undefined
            ? null
            : h('button', { type: 'button', className: 'hs-mini', onClick: () => props.onDelete(entry) }, '×')),
        h('figcaption', { className: 'hs-tile-meta' },
          h('span', { className: 'hs-ellip', title: entry.prompt }, entry.prompt || entry.file),
          h('span', null, formatBytes(entry.bytes))),
        h('div', { className: 'hs-tile-meta', style: { paddingTop: 0 } },
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
          h('span', { className: 'hs-job-title' }, `${job.model} · ${job.kind === 'video' ? T.video : T.image}`),
          h('span', { className: 'hs-job-state' }, `${statusText} · ${formatElapsed(job.elapsedMs)}`),
          running
            ? h('button', { type: 'button', className: 'hs-pill', onClick: () => props.onCancel(job) }, T.cancel)
            : (props.onDismiss ? h('button', { type: 'button', className: 'hs-pill', onClick: () => props.onDismiss(job) }, T.dismiss) : null)),
        h('div', { className: 'hs-job-prompt', title: job.prompt }, job.prompt),
        running ? h('div', { className: 'hs-bar' }, h('i', null)) : null,
        job.error ? h('div', { className: 'hs-note error' }, job.error) : null)
    }

    function StudioPanel() {
      const saved = useMemo(readForm, [])
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')
      const [dismissed, setDismissed] = useState(() => [])
      const [lightbox, setLightbox] = useState(null)
      const [kind, setKind] = useState(saved.kind === 'video' ? 'video' : 'image')
      const [model, setModel] = useState(saved.model || '')
      const [prompt, setPrompt] = useState(saved.prompt || '')
      const [size, setSize] = useState(saved.size || '1024x1024')
      const [customSize, setCustomSize] = useState(saved.customSize || '')
      const [quality, setQuality] = useState(saved.quality || 'auto')
      const [count, setCount] = useState(saved.count || 1)
      const [format, setFormat] = useState(saved.format || 'png')
      const [duration, setDuration] = useState(saved.duration || 5)
      const [resolution, setResolution] = useState(saved.resolution || '720p')
      const [refs, setRefs] = useState(() => Array.isArray(saved.refs) ? saved.refs : [])
      const [pickedChars, setPickedChars] = useState(() => Array.isArray(saved.characters) ? saved.characters : [])
      const [tab, setTab] = useState('history')
      const [folderId, setFolderId] = useState('')
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

      // 宿主第一轮拉价目表可能还没回来，这里补几次，别让页面一直停在「…」
      useEffect(() => {
        if (state === undefined || state?.pricing?.ok !== false) return undefined
        const timer = window.setTimeout(() => { void load(true) }, 2500)
        return () => { window.clearTimeout(timer) }
      }, [state, load])

      // 完成瞬间再拉一次，把任务卡换成画廊里的成品
      useEffect(() => {
        if (hasRunning) return
        const timer = window.setTimeout(() => { void load(true) }, 300)
        return () => { window.clearTimeout(timer) }
      }, [hasRunning, load])

      const models = state?.models ?? { image: [], video: [] }
      const pool = kind === 'video' ? models.video : models.image
      const activeModel = pool.includes(model) ? model : (pool[0] ?? '')

      // 视频模型的清晰度写死在名字里（sd-2-fast-480 / wan-3.0-720 …），选模型时跟着走
      useEffect(() => {
        if (kind !== 'video') return
        const match = /(480|720|1080)/u.exec(activeModel)
        if (match !== null) setResolution(`${match[1]}p`)
      }, [kind, activeModel])

      /* ---- 价格展示 ---- */
      const pricing = state?.pricing ?? { ok: false, models: {}, currency: '$', error: '' }
      const symbol = pricing.currency || '$'
      const money = (value) => `${symbol}${Number(value || 0).toFixed(2)}`
      const priceOf = (id) => (pricing.models ? pricing.models[id] : undefined)

      /** 下拉里的选项：模型名 + 单价，鼠标悬浮看说明。 */
      const optionLabel = (id) => {
        const item = priceOf(id)
        if (item === undefined) return id
        return `${id} · ${money(item.price)}${item.perSecond ? T.perSecond : T.perImage}`
      }

      /** 模型行右侧的单价与本次预计花费。 */
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

      /** 生成按钮上的预计花费；没有标价就返回空串。 */
      const estimate = (() => {
        const item = priceOf(activeModel)
        if (item === undefined) return ''
        const total = item.perSecond ? item.price * duration : item.price * count
        return `${T.estimate} ${money(total)}`
      })()

      useEffect(() => {
        const payload = { kind, model: activeModel, prompt, size, customSize, quality, count, format, duration, resolution, refs, characters: pickedChars }
        writeForm(payload)
      }, [kind, activeModel, prompt, size, customSize, quality, count, format, duration, resolution, refs, pickedChars])

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
              refs: kind === 'image' ? refs : [],
              characters: kind === 'image' ? pickedChars : [],
            },
          })
          await load(true)
        } catch (caught) {
          setError(caught.message)
        } finally {
          setBusy(false)
        }
      }

      /* ---- 收藏 / 角色 / 工具 ---- */

      const favoriteIds = new Set((state?.favorites?.items ?? []).map((item) => item.rel))
      const allFavorites = state?.favorites?.items ?? []
      const favorites = folderId === '' ? allFavorites : allFavorites.filter((item) => item.folderId === folderId)
      const characters = state?.characters?.items ?? []
      const maxRefs = state?.limits?.maxRefs ?? 4

      /** 把某张图加进参考图（去重、限个数）。 */
      const addRef = (entry) => {
        setRefs((current) => (current.includes(entry.rel) ? current : [...current, entry.rel].slice(0, maxRefs)))
      }

      const toggleFavorite = async (entry) => {
        const hit = (state?.favorites?.items ?? []).find((item) => item.rel === entry.rel)
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

      const moveFavorite = async (favorite, target) => {
        try {
          await api('/favorites/move', { method: 'POST', body: { id: favorite.id, folderId: target } })
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

      const runUpscale = async (source, model, size) => {
        try {
          await api('/generate', {
            method: 'POST',
            body: { kind: 'image', tool: 'upscale', model, size, prompt: '', refs: [source], count: 1, format: 'png' },
          })
          setToolSource(null)
          await load(true)
        } catch (caught) {
          setError(caught.message)
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

      const config = state?.config
      const sizeValue = SIZE_PRESETS.some((item) => item.value === size) ? size : ''

      return h('div', { className: 'hs-root' },
        h('header', { className: 'hs-head' },
          h('div', { className: 'hs-title' }, T.title, h('span', { className: 'hs-sub' }, T.subtitle)),
          h('div', { className: 'hs-head-meta' },
            h('button', { type: 'button', className: 'hs-pill', onClick: () => { void api('/pricing/refresh', { method: 'POST' }).catch(() => {}); void load(false) } }, T.refresh),
            config
              ? h('span', { className: `hs-chip ${config.hasKey ? 'ok' : 'warn'}` },
                h('i', { className: `hs-dot ${config.hasKey ? 'ok' : 'warn'}` }),
                h('span', { className: 'hs-ellip' },
                  config.hasKey ? `${T.keyReady} · ${config.apiKeyEnv}${config.keySource ? ` (${T.keySource}: ${config.keySource})` : ''}` : `${T.keyMissing} · ${config.apiKeyEnv}`))
              : null,
            config
              ? h('button', { type: 'button', className: 'hs-chip', title: config.outputDir, onClick: () => void openFolder() },
                h('span', null, T.outputDir), h('span', { className: 'hs-ellip', style: { color: 'var(--dsw-alias-label-tertiary,#8a8f95)' } }, config.outputDir))
              : null)),

        h('div', { className: 'hs-body' },
          h('aside', { className: 'hs-form' },
            h('div', { className: 'hs-tabs' },
              h('button', { type: 'button', className: 'hs-tab', 'data-active': String(kind === 'image'), onClick: () => setKind('image') }, T.image),
              h('button', { type: 'button', className: 'hs-tab', 'data-active': String(kind === 'video'), onClick: () => setKind('video') }, T.video)),

            kind === 'video' ? h('div', { className: 'hs-note' }, T.videoNote) : null,

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

            kind === 'image'
              ? h(Field, {
                label: `${T.refs} ${refs.length}/${maxRefs}`,
                extra: h('button', { type: 'button', className: 'hs-link', onClick: () => setPicker('refs') }, `+ ${T.addRefs}`),
              },
              refs.length === 0
                ? h('div', { className: 'hs-note' }, T.refsHint)
                : h('div', { className: 'hs-chips' },
                  refs.map((rel) => h('div', { key: rel, className: 'hs-ref' },
                    h('img', { src: fileSrc(rel), alt: '' }),
                    h('button', { type: 'button', className: 'hs-ref-x', title: T.remove, onClick: () => setRefs((current) => current.filter((item) => item !== rel)) }, '\u00d7')),
                  h('button', { type: 'button', className: 'hs-link', onClick: () => setRefs([]) }, T.clearRefs))))
              : null,

            kind === 'image'
              ? h(Field, {
                label: T.characters,
                extra: refs.length === 0 ? null : h('button', { type: 'button', className: 'hs-link', onClick: () => setCharDraft({ refs }) }, `+ ${T.addCharacter}`),
              },
              characters.length === 0
                ? h('div', { className: 'hs-note' }, T.characterEmpty)
                : h('div', { className: 'hs-chips' },
                  characters.map((character) => h('button', {
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
              : null,

            kind === 'image'
              ? h(Field, { label: T.size },
                h('div', { className: 'hs-chips' },
                  SIZE_PRESETS.map((item) => h('button', {
                    key: item.value,
                    type: 'button',
                    className: 'hs-pill',
                    'data-active': String(customSize.trim() === '' && sizeValue === item.value),
                    onClick: () => { setSize(item.value); setCustomSize('') },
                  }, `${item.label} · ${item.value}`)),
                  h('input', {
                    className: 'hs-control',
                    style: { width: 110, flex: '0 0 110px', minHeight: 26, padding: '2px 8px', fontSize: 11.5 },
                    placeholder: T.customSize,
                    value: customSize,
                    onChange: (event) => setCustomSize(event.target.value),
                  })))
              : h('div', { className: 'hs-row' },
                h(Field, { label: T.duration },
                  h('select', { className: 'hs-control', value: String(duration), onChange: (event) => setDuration(Number(event.target.value)) },
                    DURATIONS.map((value) => h('option', { key: value, value: String(value) }, `${value}s`)))),
                h(Field, { label: T.resolution },
                  h('select', { className: 'hs-control', value: resolution, onChange: (event) => setResolution(event.target.value) },
                    ['480p', '720p', '1080p'].map((value) => h('option', { key: value, value }, value))))),

            kind === 'image'
              ? h('div', { className: 'hs-row3' },
                h(Field, { label: T.quality },
                  h('select', { className: 'hs-control', value: quality, onChange: (event) => setQuality(event.target.value) },
                    QUALITIES.map((value) => h('option', { key: value, value }, value)))),
                h(Field, { label: T.count },
                  h('select', { className: 'hs-control', value: String(count), onChange: (event) => setCount(Number(event.target.value)) },
                    [1, 2, 3, 4].map((value) => h('option', { key: value, value: String(value) }, `${value}`)))),
                h(Field, { label: T.format },
                  h('select', { className: 'hs-control', value: format, onChange: (event) => setFormat(event.target.value) },
                    FORMATS.map((value) => h('option', { key: value, value }, value)))))
              : null,

            h(Field, { label: T.presets },
              h('div', { className: 'hs-chips' },
                STYLE_PRESETS.map((item) => h('button', {
                  key: item.label,
                  type: 'button',
                  className: 'hs-pill',
                  onClick: () => setPrompt((current) => (current.trim() === '' ? item.text : `${current.replace(/[,，\s]+$/u, '')}, ${item.text}`)),
                }, item.label)))),

            h(Field, { label: T.tools },
              h('div', { className: 'hs-chips' },
                h('button', { type: 'button', className: 'hs-pill', onClick: () => setPicker('upscale') }, T.upscale))),

            h('div', { className: 'hs-actions' },
              h('button', {
                type: 'button',
                className: 'hs-button primary',
                disabled: busy || prompt.trim() === '' || activeModel === '',
                onClick: () => void generate(),
              }, busy ? T.generating : (estimate === '' ? T.generate : `${T.generate} · ${estimate}`)),
              h('button', {
                type: 'button',
                className: 'hs-button',
                style: { flex: '0 0 92px' },
                onClick: () => setPrompt(''),
              }, T.clear)),

            config
              ? h('div', { className: 'hs-note' },
                `${T.limit} ${config.maxConcurrent} · ${T.total} ${state?.stats?.count ?? 0} ${T.items} · ${formatBytes(state?.stats?.bytes ?? 0)}`)
              : null),

          h('section', { className: 'hs-main' },
            error !== '' ? h('div', { className: 'hs-note error' }, error) : null,
            h('div', { className: 'hs-scroll' },
              runningJobs.length > 0
                ? h('div', null,
                  h('div', { className: 'hs-section-head' }, T.running, h('span', { className: 'hs-count' }, `${runningJobs.length}`)),
                  runningJobs.map((job) => h(JobCard, { key: job.id, job, onCancel: cancelJob })))
                : null,

              failedJobs.length > 0
                ? h('div', null,
                  h('div', { className: 'hs-section-head' }, T.failedSection, h('span', { className: 'hs-count' }, `${failedJobs.length}`)),
                  failedJobs.map((job) => h(JobCard, {
                    key: job.id,
                    job,
                    onDismiss: (item) => setDismissed((current) => [...current, item.id]),
                  })))
                : null,

              tab === 'favorites'
                ? h('div', null,
                  h('div', { className: 'hs-chips', style: { marginBottom: '10px' } },
                    h('button', { type: 'button', className: 'hs-pill', 'data-active': String(folderId === ''), onClick: () => setFolderId('') }, T.allFolders),
                    (state?.favorites?.folders ?? []).map((folder) => h('button', {
                      key: folder.id,
                      type: 'button',
                      className: 'hs-pill',
                      'data-active': String(folderId === folder.id),
                      onClick: () => setFolderId(folder.id),
                    }, folder.name)),
                    h('button', { type: 'button', className: 'hs-pill', onClick: () => void newFolder() }, `+ ${T.newFolder}`)),
                  favorites.length === 0
                    ? h('div', { className: 'hs-empty' }, h('div', null, T.favEmpty))
                    : h('div', { className: 'hs-grid' },
                      favorites.map((favorite) => h(Tile, {
                        key: favorite.id,
                        entry: { id: favorite.id, rel: favorite.rel, file: favorite.rel.split('/').pop(), kind: favorite.rel.endsWith('.mp4') ? 'video' : 'image', prompt: favorite.name, createdAt: favorite.createdAt },
                        onOpen: setLightbox,
                        onCopy: copyPath,
                        favorited: true,
                        onFavorite: () => toggleFavorite(favorite),
                        onUseAsRef: addRef,
                      }))))
                : null,
              h('div', { className: 'hs-section-head' },
                h('div', { className: 'hs-tabsline' },
                  h('button', { type: 'button', className: 'hs-tab sm', 'data-active': String(tab === 'history'), onClick: () => setTab('history') }, `${T.history} ${history.length}`),
                  h('button', { type: 'button', className: 'hs-tab sm', 'data-active': String(tab === 'favorites'), onClick: () => setTab('favorites') }, `${T.favorites} ${allFavorites.length}`)),
                h('span', { className: 'hs-count' }, tab === 'history' ? `${state?.stats?.count ?? 0}` : `${favorites.length}`)),
              tab === 'favorites' ? null : history.length === 0
                ? h('div', { className: 'hs-empty' },
                  h(StudioGlyph, { size: 34 }),
                  h('div', null, state === null ? T.loading : hasRunning ? T.runningEmpty : T.empty))
                : h('div', { className: 'hs-grid' },
                  history.map((entry) => h(Tile, {
                    key: entry.id,
                    entry,
                    onOpen: setLightbox,
                    onCopy: copyPath,
                    onDelete: deleteEntry,
                    favorited: favoriteIds.has(entry.rel),
                    onFavorite: toggleFavorite,
                    onUseAsRef: addRef,
                  })))))),

        picker !== null
          ? h('div', { className: 'hs-lightbox', role: 'dialog', 'aria-modal': 'true', onClick: () => setPicker(null) },
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
                  onClick: () => (picker === 'refs'
                    ? setRefs((current) => (current.includes(entry.rel) ? current.filter((item) => item !== entry.rel) : [...current, entry.rel].slice(0, maxRefs)))
                    : (setToolSource(entry.rel), setPicker(null))),
                }, h('img', { src: fileSrc(entry.rel), alt: '', loading: 'lazy' }))))))
          : null,

        charDraft !== null
          ? h('div', { className: 'hs-lightbox', role: 'dialog', 'aria-modal': 'true', onClick: () => setCharDraft(null) },
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
          ? h('div', { className: 'hs-lightbox', role: 'dialog', 'aria-modal': 'true', onClick: () => setToolSource(null) },
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
              h('button', { type: 'button', onClick: () => void toggleFavorite(lightbox) }, favoriteIds.has(lightbox.rel) ? `\u2605 ${T.unfavorite}` : `\u2606 ${T.favorite}`),
              h('a', { href: fileSrc(lightbox.rel), download: lightbox.file, style: { textDecoration: 'none', display: 'grid', placeItems: 'center' } }, h('button', { type: 'button' }, T.download)),
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