// filename: src/core/fa-loader.js
// ========================================================================
// DeepSeek 语句工坊 · Font Awesome 混合加载器
//
// 主方案：SVG + JS（多 CDN 依次尝试）
// 降级方案：CSS + Web Font（多 CDN 依次尝试）
// 冲突处理：SVG 成功后移除已注入的 CSS 链接
//
// 【重入保护（历史）】
//   loadCss 有两条触发路径：SVG 全部 CDN 失败、SVG 加载 5 秒超时。
//   若两条路径先后触发，会导致同一个 CSS 被注入两次。
//   现通过 cssLoadStarted 标志位确保 loadCss 只启动一次。
//
// 【本轮 P1 修复 · CSS 加载成功 ≠ 字体可用】
//
//   背景（用户日志暴露的真实问题）：
//     1. CSS 文件加载成功（link.onload 触发）
//     2. 但 CSS 引用的字体文件内容损坏
//        （浏览器内核：Failed to decode downloaded font、
//         OTS parsing error、Invalid table tag: 0x204F53）
//     3. 用户看到"图标完全不显示"
//     4. 应用日志却显示"✅ CSS 降级加载成功"——误导！
//
//   根因：
//     link.onload 只表示 **CSS 文件本身**加载完成。
//     CSS 中 @font-face 引用的字体文件是**懒加载**的——只有
//     页面真正使用某个字体时才触发下载。原实现未检测这一步。
//
//   修复方案：
//     CSS onload 后，主动调用 document.fonts.load() 触发字体加载，
//     并等待检测结果：
//       · 字体可用 → 记为成功，停止降级
//       · 字体不可用 / 超时 → 移除当前 <link>，继续尝试下一个 CDN
//
//   为什么用 document.fonts.load() 而非 check()：
//     · check() 是同步的，只检查"字体是否已加载完成"
//     · load() 是异步的，**触发**字体加载并返回 Promise
//     CSS 刚加载成功时字体尚未触发加载，必须用 load()。
//
//   为什么加超时保护：
//     某些网络环境下，字体请求会无限挂起（既无成功也无失败回调）。
//     若不设超时，Promise 会一直 pending，导致后续 CDN 永远无法尝试。
//     超时视为"不可用"，继续降级。
//
//   为什么移除 <link> 而非保留：
//     同一字体族名（"Font Awesome 6 Free"）被多个 CDN 的
//     @font-face 定义时，**后加载的会覆盖先加载的**（CSS 层叠规则）。
//     若不移除损坏的 CSS，它会与新 CDN 的 @font-face 定义共存，
//     造成不可预期的渲染结果。
//     显式移除保证"任何时刻只有一个 Font Awesome CSS 生效"。
//
// 【本轮 P3 修复 · 超时日志文案】
//   原文案："SVG JS 5 秒超时未加载，启动 CSS 降级"
//   "未加载" 可被误读为"加载失败"（有 onerror 事件）。
//   实际场景是"请求挂起无响应"（既没 onload 也没 onerror）。
//   新文案："SVG JS 5 秒内无 CDN 响应"——语义准确。
//   数字动态取自常量 FONTAWESOME_LOAD_TIMEOUT_MS / 1000，
//   未来调整超时时间无需改文案。
//
// 【SVG JS 成功后的二次处理】
//   CSS 降级和字体检测都是异步的。在此期间的任意时刻，SVG JS 可能
//   突然加载成功。此时需要放弃 CSS 分支，避免"SVG 和 CSS 双模式冲突"。
//   在 loadCss 的每个异步回调开始处，先检查 svgLoaded，若已成功
//   则直接移除当前 <link> 并返回。
//
// 【为什么不做 P4（引入 jsdelivr）】
//   index.html 的 CSP 白名单未包含 jsdelivr。引入需要同时修改
//   style-src 和 font-src，影响面扩大。当前 4 个域名已覆盖主要
//   公共 CDN，调整顺序（见 constants.js）即可显著提升命中率。
// ========================================================================

import {
    FONTAWESOME_SVG_CDNS,
    FONTAWESOME_CSS_CDNS,
    FONTAWESOME_LOAD_TIMEOUT_MS,
    FONTAWESOME_FONT_CHECK_TIMEOUT_MS,
    FONTAWESOME_FONT_FAMILY
} from '../constants.js';

// ---------- 模块级加载状态 ----------
// svgLoaded：SVG JS 是否成功加载（成功即意味着图标已可用，无需 CSS）
// cssLoaded：CSS 是否已成功加载**且字体可用**
//            （注意：CSS 文件加载成功不等于此标志为 true）
// cssFallbackTriggered：CSS 降级是否已生效（用于 SVG 成功后反向清理）
// cssLoadStarted：CSS 加载流程是否已启动（防重入）
let svgLoaded = false;
let cssLoaded = false;
let cssFallbackTriggered = false;
let cssLoadStarted = false;

/**
 * 移除所有已注入的 Font Awesome CSS 链接
 *
 * 用途：
 *   1. SVG JS 成功后清理可能已注入的 CSS
 *      避免 SVG 图标与字体图标双模式冲突
 *   2. 字体检测失败后清理损坏的 CSS
 *      避免损坏的 @font-face 定义污染字体命名空间
 *
 * 匹配规则：href 含 "font-awesome" 的 <link rel="stylesheet">
 *   当前 4 个 CDN 的 URL 均含此片段：
 *     · cdnjs:      .../font-awesome/6.1.0/css/all.min.css
 *     · staticfile: .../font-awesome/6.1.0/css/all.min.css
 *     · baomitu:    .../font-awesome/6.1.0/css/all.min.css
 *     · bootcdn:    .../font-awesome/6.1.0/css/all.min.css
 */
function removeInjectedCssLinks() {
    const links = document.querySelectorAll('link[href*="font-awesome"]');
    links.forEach(function (link) {
        if (link.rel === 'stylesheet') {
            link.remove();
        }
    });
}

// ========================================================================
// 字体可用性检测（本轮 P1 新增）
// ========================================================================

/**
 * 检测 Font Awesome 字体是否真正可用。
 *
 * 工作流程：
 *   1. 检查 document.fonts API 是否可用
 *      - 不可用：保守返回"可用"（信任 CSS 加载成功）
 *   2. 主动触发字体加载：document.fonts.load('900 16px "Font Awesome 6 Free"')
 *      - 使用 900 字重是因为 Solid 图标是 Font Awesome 的主要用途
 *   3. 等待字体加载完成或超时
 *      - 加载完成且返回非空数组 → 可用
 *      - 加载完成但返回空数组 → 不可用（字体未定义或加载失败）
 *      - Promise 被 reject → 不可用
 *      - 超时 → 不可用
 *
 * 【为什么用 900 字重】
 *   Font Awesome 6 免费版提供多个字重的图标：
 *     · Solid (900)：绝大部分图标
 *     · Regular (400)：部分轮廓图标
 *   Solid 字重覆盖最广。只要 Solid 可用，绝大多数图标即可正常渲染。
 *
 * 【为什么用引号包裹字体名】
 *   "Font Awesome 6 Free" 含空格，作为 CSS font-family 值必须用
 *   单引号或双引号包裹，否则会被解析为 3 个独立的 family 名。
 *
 * 【为什么加超时保护】
 *   某些网络环境下，字体请求可能无限挂起（无成功也无失败回调）。
 *   若不设超时，Promise 会一直 pending，导致后续 CDN 永远无法尝试。
 *
 * @returns {Promise<{isAvailable: boolean, reason: string, error?: Error}>}
 *   isAvailable：字体是否可用
 *   reason：判定原因（用于日志）
 *     - 'loaded'               字体成功加载
 *     - 'empty-result'         字体未定义或加载失败
 *     - 'load-failed'          调用 load 时抛错或 Promise reject
 *     - 'timeout'              超时未响应
 *     - 'font-check-unsupported'  浏览器不支持 document.fonts
 *   error：仅在失败时提供（可选）
 */
function checkFontAwesomeFontAvailability() {
    // ---------- 步骤 1：检查 API 可用性 ----------
    // document.fonts 是 CSS Font Loading API 的核心接口。
    // 目标浏览器（Chrome 35+ / Firefox 41+ / Safari 10+）全部支持，
    // 但作为防御层，此处仍然检查，避免在不支持的环境抛异常。
    //
    // 不可用时的降级策略：返回"可用"。
    //   理由：无法检测时，信任 CSS 加载成功是更保守的选择——
    //         避免因检测 API 缺失导致图标完全不加载。
    if (!document.fonts || typeof document.fonts.load !== 'function') {
        return Promise.resolve({
            isAvailable: true,
            reason: 'font-check-unsupported'
        });
    }

    // ---------- 步骤 2：主动触发字体加载 ----------
    // 格式："<weight> <size> <family>"
    // CSS font 简写属性允许省略非关键部分。
    const fontRequest = '900 16px "' + FONTAWESOME_FONT_FAMILY + '"';

    let loadPromise;
    try {
        loadPromise = document.fonts.load(fontRequest);
    } catch (loadError) {
        // load 同步抛错（例如参数格式错误，理论上不会）→ 判为不可用
        return Promise.resolve({
            isAvailable: false,
            reason: 'load-failed',
            error: loadError
        });
    }

    // ---------- 步骤 3：超时保护 ----------
    // 使用 Promise.race 竞速：字体加载 vs 超时
    const timeoutPromise = new Promise(function (resolve) {
        setTimeout(function () {
            resolve({
                isAvailable: false,
                reason: 'timeout'
            });
        }, FONTAWESOME_FONT_CHECK_TIMEOUT_MS);
    });

    // ---------- 步骤 4：构建检测 Promise ----------
    // 包裹为 Promise.resolve 是为了兼容极少数实现中 load 返回
    // 非 Promise 的情况（防御性）。
    const checkPromise = Promise.resolve(loadPromise)
        .then(function (loadedFontFaces) {
            // document.fonts.load 的 resolve 值：成功加载的 FontFace 数组
            //   · 非空数组 → 至少有一个匹配的字体成功加载
            //   · 空数组   → 无匹配字体（@font-face 未定义或加载失败）
            if (Array.isArray(loadedFontFaces) && loadedFontFaces.length > 0) {
                return {
                    isAvailable: true,
                    reason: 'loaded'
                };
            }
            return {
                isAvailable: false,
                reason: 'empty-result'
            };
        })
        .catch(function (fontError) {
            // Promise reject 通常意味着字体加载明确失败
            return {
                isAvailable: false,
                reason: 'load-failed',
                error: fontError
            };
        });

    return Promise.race([checkPromise, timeoutPromise]);
}

// ========================================================================
// SVG JS 加载
// ========================================================================

/**
 * 依次尝试加载 SVG + JS。
 *
 * 策略：
 *   · 从 index 开始，依次尝试 FONTAWESOME_SVG_CDNS 中的每个 CDN
 *   · 某个 CDN 加载成功 → 设置 svgLoaded = true，停止尝试
 *   · 某个 CDN 加载失败 → 尝试下一个
 *   · 全部失败 → 启动 CSS 降级
 *
 * 【为什么 SVG JS 不做"字体检测"】
 *   SVG JS 模式下，Font Awesome 的 JS 会将 <i class="fas fa-xxx">
 *   替换为内联 SVG 元素。此过程**不依赖字体文件**——图标以矢量
 *   路径直接绘制。
 *   因此"脚本加载成功"即意味着"图标可用"，无需额外的字体检测。
 *
 * 【为什么用 script.onerror 而非其他失败检测】
 *   浏览器对 <script> 的失败检测只有 onerror 事件。
 *   超时检测由 initializeFontAwesomeLoader 中的 setTimeout 统一处理
 *   （见该函数注释）。
 *
 * @param {number} index 当前尝试的 CDN 索引
 */
function loadSvgJs(index) {
    if (index >= FONTAWESOME_SVG_CDNS.length) {
        console.warn(
            '[FontAwesome] SVG JS 所有 CDN 均失败，启动 CSS 降级方案'
        );
        loadCss(0);
        return;
    }

    const currentSvgJsUrl = FONTAWESOME_SVG_CDNS[index];

    const script = document.createElement('script');
    script.src = currentSvgJsUrl;

    script.onload = function () {
        svgLoaded = true;
        console.log(
            '[FontAwesome] ✅ SVG JS 加载成功:',
            currentSvgJsUrl
        );

        // 若 CSS 降级已经生效，移除它（SVG 与 CSS 双模式会冲突）
        //
        // 判定依据：cssFallbackTriggered 只在 CSS 加载**成功且字体可用**
        //          后被设置为 true。因此若它为 true，说明 CSS 正在生效，
        //          需要清理。
        if (cssFallbackTriggered) {
            removeInjectedCssLinks();
            cssFallbackTriggered = false;
            cssLoaded = false;
        }
    };

    script.onerror = function () {
        console.warn(
            '[FontAwesome] ❌ SVG JS 加载失败:',
            currentSvgJsUrl
        );
        loadSvgJs(index + 1);
    };

    document.head.appendChild(script);
}

// ========================================================================
// CSS 加载 + 字体可用性检测（本轮重构核心）
// ========================================================================

/**
 * 依次尝试加载 CSS，并验证字体是否真正可用。
 *
 * 完整流程（单个 CDN）：
 *   1. 注入 <link rel="stylesheet">
 *   2. 等待 link.onload（CSS 文件加载完成）
 *      或 link.onerror（CSS 文件加载失败）
 *   3a. onerror → 尝试下一个 CDN
 *   3b. onload → 调用 checkFontAwesomeFontAvailability()
 *   4. 等待字体检测结果
 *   5a. 字体可用 → 设置 cssLoaded / cssFallbackTriggered = true，停止
 *   5b. 字体不可用 → 移除当前 <link>，尝试下一个 CDN
 *   5c. 检测期间 SVG JS 突然成功 → 移除当前 <link>，不再继续
 *
 * 防重入：
 *   首次调用时（index === 0）设置 cssLoadStarted 标志。
 *   之后无论从哪条路径再次进入 loadCss(0)，都会直接返回。
 *
 * 终止条件：
 *   · 字体检测通过 → 成功
 *   · 遍历完所有 CDN → 失败
 *
 * 【为什么移除 <link> 而不是保留】
 *   同一字体族名（"Font Awesome 6 Free"）被多个 CDN 的 @font-face
 *   定义时，后加载的会覆盖先加载的（CSS 层叠规则）。
 *   若不移除损坏的 CSS，它会与新 CDN 的 @font-face 定义共存，
 *   造成不可预期的渲染结果。
 *   显式移除保证"任何时刻只有一个 Font Awesome CSS 生效"。
 *
 * 【为什么在回调开头检查 svgLoaded】
 *   CSS 加载和字体检测都是异步的。期间任意时刻 SVG JS 可能突然成功。
 *   此时应放弃 CSS 分支——SVG 模式更优（无字体依赖），且避免
 *   "SVG 和 CSS 双模式冲突"。
 *
 * @param {number} index 当前尝试的 CDN 索引
 */
function loadCss(index) {
    // ---------- 防重入：仅首次调用时设置标志 ----------
    if (index === 0) {
        if (cssLoadStarted) return;
        cssLoadStarted = true;
    }

    // ---------- 终止条件：全部 CDN 尝试完毕 ----------
    if (index >= FONTAWESOME_CSS_CDNS.length) {
        console.warn(
            '[FontAwesome] 所有 CSS CDN 均失败（CSS 文件或字体不可用），'
            + '图标将不可用。'
            + '可能原因：网络受限 / CDN 不可达 / 字体文件被拦截。'
        );
        return;
    }

    const currentCssUrl = FONTAWESOME_CSS_CDNS[index];

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = currentCssUrl;

    // ---------- 成功回调：CSS 加载后进入字体检测阶段 ----------
    link.onload = function () {
        // 二次检查：link.onload 也可能在 SVG JS 已成功后才触发
        if (svgLoaded) {
            if (link.parentNode) link.remove();
            return;
        }

        console.log(
            '[FontAwesome] CSS 文件加载成功，开始检测字体可用性:',
            currentCssUrl
        );

        checkFontAwesomeFontAvailability().then(function (fontResult) {
            // 三次检查：字体检测期间 SVG JS 可能已成功
            if (svgLoaded) {
                if (link.parentNode) link.remove();
                return;
            }

            if (fontResult.isAvailable) {
                // ---------- 字体可用：成功 ----------
                cssLoaded = true;
                cssFallbackTriggered = true;
                console.log(
                    '[FontAwesome] ✅ CSS 降级加载成功（字体可用，'
                    + '检测原因：' + fontResult.reason + '）:',
                    currentCssUrl
                );
                return;
            }

            // ---------- 字体不可用：尝试下一个 CDN ----------
            let warnMessage =
                '[FontAwesome] ⚠️ CSS 文件加载成功但字体不可用'
                + '（原因：' + fontResult.reason + '），'
                + '尝试下一个 CDN: ' + currentCssUrl;

            // 若失败原因是 load-failed 且有 error 对象，附加到日志
            if (fontResult.error) {
                console.warn(warnMessage, fontResult.error);
            } else {
                console.warn(warnMessage);
            }

            // 移除损坏的 CSS（避免 @font-face 命名空间污染）
            if (link.parentNode) link.remove();

            // 尝试下一个 CDN
            loadCss(index + 1);
        });
    };

    // ---------- 失败回调：CSS 文件本身加载失败 ----------
    link.onerror = function () {
        // SVG JS 已成功时，不再尝试后续 CSS CDN
        if (svgLoaded) return;

        console.warn(
            '[FontAwesome] ❌ CSS 文件加载失败:',
            currentCssUrl
        );
        loadCss(index + 1);
    };

    document.head.appendChild(link);
}

// ========================================================================
// 初始化入口
// ========================================================================

/**
 * 启动 Font Awesome 加载流程。
 *
 * 应在应用初始化早期调用。
 *
 * 流程：
 *   1. 立即启动 SVG JS 加载（首选方案）
 *   2. 5 秒超时兜底：若 SVG JS 未成功且未触发 CSS 降级，
 *      主动触发 CSS 降级
 *
 * 【为什么需要超时兜底】
 *   <script> 标签的失败检测只有 onerror 事件。某些网络环境下
 *   （如请求被静默阻断、DNS 挂起），请求可能"既不成功也不失败"，
 *   onerror 永远不会触发。
 *   此时 setTimeout 兜底可以确保用户不会永远等待。
 *
 * 【本轮 P3 修复 · 日志文案】
 *   原文案："SVG JS 5 秒超时未加载"
 *   新文案："SVG JS 5 秒内无 CDN 响应"
 *   原因：原文案的"未加载"可被误读为"加载失败"，但实际场景是
 *         "请求挂起"，语义不同。新文案更准确。
 *   数字动态取自常量，未来调整超时时间无需改文案。
 *
 * 【为什么分别检查 svgLoaded 和 cssLoaded】
 *   两个标志反映不同路径的成功：
 *     · svgLoaded：SVG JS 主路径成功
 *     · cssLoaded：CSS 降级路径成功（且字体可用）
 *   任意一个成功都不需要启动 CSS 降级。
 *   cssFallbackTriggered 不需要在此检查——它只在 CSS 成功后被设置，
 *   而 cssLoaded 是更权威的判据。
 */
export function initializeFontAwesomeLoader() {
    // ---------- 步骤 1：立即启动 SVG JS 加载 ----------
    loadSvgJs(0);

    // ---------- 步骤 2：超时兜底 ----------
    setTimeout(function () {
        if (!svgLoaded && !cssLoaded) {
            const timeoutSeconds = FONTAWESOME_LOAD_TIMEOUT_MS / 1000;
            console.warn(
                '[FontAwesome] SVG JS ' + timeoutSeconds
                + ' 秒内无 CDN 响应，启动 CSS 降级'
            );
            loadCss(0);
        }
    }, FONTAWESOME_LOAD_TIMEOUT_MS);
}