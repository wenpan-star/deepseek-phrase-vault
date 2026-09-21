// filename: src/core/fa-loader.js
// ========================================================================
// DeepSeek 语句工坊 · Font Awesome 混合加载器
// 主方案：SVG + JS（多 CDN 依次尝试）
// 降级方案：CSS（SVG 全部失败或超时后启用）
// 冲突处理：SVG 成功后移除已注入的 CSS 链接
//
// 【重入保护（历史）】
//   loadCss 有两条触发路径：SVG 全部 CDN 失败、SVG 加载 5 秒超时。
//   若两条路径先后触发，会导致同一个 CSS 被注入两次。
//   现通过 cssLoadStarted 标志位确保 loadCss 只启动一次。
//
// 【本轮深度审核（第二批）】
//   本模块无需修改。
// ========================================================================

import {
    FONTAWESOME_SVG_CDNS,
    FONTAWESOME_CSS_CDNS,
    FONTAWESOME_LOAD_TIMEOUT_MS
} from '../constants.js';

let svgLoaded = false;
let cssLoaded = false;
let cssFallbackTriggered = false;
// CSS 加载流程是否已启动（防重入）
let cssLoadStarted = false;

/**
 * 移除所有已注入的 Font Awesome CSS 链接
 * 用于避免 SVG 与 CSS 双模式同时生效导致的图标冲突
 */
function removeInjectedCssLinks() {
    const links = document.querySelectorAll('link[href*="font-awesome"]');
    links.forEach(function (link) {
        if (link.rel === 'stylesheet') {
            link.remove();
        }
    });
}

/**
 * 依次尝试加载 SVG + JS
 * @param {number} index  当前尝试的 CDN 索引
 */
function loadSvgJs(index) {
    if (index >= FONTAWESOME_SVG_CDNS.length) {
        console.warn('[FontAwesome] SVG JS 所有 CDN 均失败，启动 CSS 降级方案');
        loadCss(0);
        return;
    }
    const script = document.createElement('script');
    script.src = FONTAWESOME_SVG_CDNS[index];
    script.onload = function () {
        svgLoaded = true;
        console.log('[FontAwesome] ✅ SVG JS 加载成功:', FONTAWESOME_SVG_CDNS[index]);
        if (cssFallbackTriggered) {
            removeInjectedCssLinks();
            cssFallbackTriggered = false;
            cssLoaded = false;
        }
    };
    script.onerror = function () {
        console.warn('[FontAwesome] ❌ SVG JS 加载失败:', FONTAWESOME_SVG_CDNS[index]);
        loadSvgJs(index + 1);
    };
    document.head.appendChild(script);
}

/**
 * 依次尝试加载 CSS
 * 首次调用（index === 0）时设置 cssLoadStarted 标志位；
 * 之后无论从哪条路径再次进入 loadCss(0)，都会直接返回。
 * @param {number} index  当前尝试的 CDN 索引
 */
function loadCss(index) {
    // 防重入：仅当首次进入 index === 0 时设标志
    if (index === 0) {
        if (cssLoadStarted) return;
        cssLoadStarted = true;
    }
    if (index >= FONTAWESOME_CSS_CDNS.length) {
        console.warn('[FontAwesome] 所有 CSS CDN 均失败，图标将不可用');
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTAWESOME_CSS_CDNS[index];
    link.onload = function () {
        cssLoaded = true;
        cssFallbackTriggered = true;
        console.log('[FontAwesome] ✅ CSS 降级加载成功:', FONTAWESOME_CSS_CDNS[index]);
    };
    link.onerror = function () {
        console.warn('[FontAwesome] ❌ CSS 加载失败:', FONTAWESOME_CSS_CDNS[index]);
        loadCss(index + 1);
    };
    document.head.appendChild(link);
}

/**
 * 启动 Font Awesome 加载流程
 * 应在应用初始化早期调用
 */
export function initializeFontAwesomeLoader() {
    loadSvgJs(0);
    setTimeout(function () {
        if (!svgLoaded && !cssLoaded) {
            console.warn('[FontAwesome] SVG JS 5 秒超时未加载，启动 CSS 降级');
            loadCss(0);
        }
    }, FONTAWESOME_LOAD_TIMEOUT_MS);
}