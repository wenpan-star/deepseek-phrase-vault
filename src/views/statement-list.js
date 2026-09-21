// filename: src/views/statement-list.js
// ========================================================================
// DeepSeek 语句工坊 · 语句列表视图
// 负责渲染、Sortable 排序、选中状态管理、事件委托、滚动位置记忆
// 选中状态为本模块内部瞬态，不进入持久化 Vault
//
// 滚动位置按"上下文"独立记忆：
//   - 本地模式：每个标签独立记忆（键 = local:<tagId>）
//   - 全局模式：全局搜索独立记忆（键 = global）
// 存储介质为 sessionStorage，与 Vault 持久化解耦
//
// 【两行截断 + 悬停全文浮层】
//   CSS 层：.card-content 使用 -webkit-line-clamp: 2 截断为两行，高度恒定
//   JS  层：
//     - mouseover 事件委托至 #statementsList 容器
//     - 仅当 scrollHeight > clientHeight（内容真正溢出）时才启用浮层
//     - 加入 POPOVER_SHOW_DELAY_MS / POPOVER_HIDE_DELAY_MS 延迟
//     - 触屏设备完全跳过此逻辑
//     - Sortable 拖拽过程中不显示浮层
//
// 【浮层宽度与定位（历史重构）】
//   定位基准：.card-index（序号）左边缘
//   宽度基准：从 .card-index 左边缘 → .card-actions 左边缘 的距离
//   宽度取值：直接等于上述距离，不做 640px 上限截断，
//             也不做 300px 下限撑开（仅在测量异常时用 300px 兜底）
//
// 【方案 A（历史）】
//   1. renderStatementList 中读取 vault.settings.enableInitialsSearch，
//      并向 filterStatements / highlightText 传递第 4 个参数，
//      使首字母搜索开关真正生效。
//   2. 防御性读取：vault.settings 理论上必定存在（normalizeVault 保证），
//      但用 `!!` 加短路保护，避免极端情况下读取到 undefined 抛错。
//
// 【第一批重构（历史）】
//   问题 A（快速切标签时滚动位置丢失）：
//     原实现的滚动保存流程：
//       scroll 事件 → currentScrollTop 更新 → 150ms 防抖定时器
//       定时器触发 → persistCurrentScrollPosition()
//                   → 用 lastRenderedVault 计算上下文键
//
//     若用户在 150ms 防抖窗口内点击另一个标签：
//       1. dispatch('switchTag') → renderStatementList 执行
//       2. lastRenderedVault 立即被覆盖为新标签
//       3. 定时器触发时，用新标签的上下文键写入旧标签的滚动位置
//          → 旧标签的滚动位置丢失；新标签被写入错误的滚动值
//
//     修复策略（双保险）：
//       (a) scroll 事件里记录"滚动发生时"的上下文键到
//           pendingScrollSaveSnapshot；定时器与 flush 时优先使用该快照，
//           不再依赖 lastRenderedVault 事后重新计算。
//       (b) main.js 的 handleTagClick 在 dispatch 前主动调用
//           flushScrollPosition()，把防抖窗口内待保存的值立即落盘。
//       二者叠加可覆盖任意切换时机的组合。
//
//   问题 E（toggleSelectAllVisible 中的引用共享）：
//     原实现 `selectedStatementIds = visibleIdSet;` 直接赋同一引用。
//     当前无 bug（visibleIdSet 是局部变量），但若未来有人把
//     visibleIdSet 别处保存，会引入共享状态隐患。
//     现改为 `selectedStatementIds = new Set(visibleIdSet);`。
//
//   问题 H（每次渲染重建 statementTextById）：
//     保持现有实现。理由：全量 Map 构建是 O(N) 一次性操作，查询是 O(1)；
//     相较逐卡片 findStatementById 的 O(N²) 整体更优。
//     10000 条语句 ≈ 10–30ms，可接受。
//
// 【第二批重构（本轮）】
//   问题 J（persistCurrentScrollPosition 使用 DOM 值而非记录值）：
//     历史实现虽然"当前所有路径都安全"，但存在隐式契约：
//     所有标签切换路径都必须先调用 flushScrollPosition。
//     若未来新增路径（快捷键 / URL 跳转 / 其他批量操作自动切换）
//     忘记调用，就会用新标签的 DOM 滚动值覆盖旧标签的记录：
//       · pendingScrollSaveContextKey 保留为 'local:A'
//       · mainListElement.scrollTop 已被新标签的 render 覆盖为 0
//       · 写入 local:A = 0 → 标签 A 的位置丢失
//
//     修复：将 pending 从"仅存 contextKey"改为"存 {contextKey, scrollTop}
//     快照对象"。scroll 事件中一次性记录两值，persistCurrentScrollPosition
//     优先使用快照中的 scrollTop，避免读取已被渲染覆盖的 DOM 值。
//
//     补充：回退路径（从未滚动过 / 早期初始化）仍使用 DOM 值，
//     因为此时不存在"记录值"的概念，DOM 值即当前状态的唯一真相源。
//
//   问题 K（statementTextById 全量构建）：
//     原实现在 renderStatementList 开头无条件遍历所有标签的所有语句
//     构建 statementTextById，O(N) 其中 N = 全部语句数（跨标签）。
//     但 hover 浮层只对当前可见列表中的卡片触发，全量构建包含大量
//     "当前不显示"的语句，浪费计算。
//
//     修复：把 Map 构建移到 visibleStatements 计算之后，
//     仅遍历当前可见列表。语义上完全等价（浮层查询的 id 一定
//     属于可见列表），性能上从 O(全部语句) 降为 O(可见语句)。
//
//     空状态分支（visibleStatements.length === 0）下，Map 为空，
//     与"没有卡片可悬停"的语义一致。同时，由于每次用 new Map()
//     重建，旧数据自动清空，不存在陈旧命中。
//
// 【历史版本】
//   - 第四批深度审核：本模块无需逻辑修改。
//   - 第一批重构：问题 A、E 修复。
//   - 第二批重构：问题 J、K 修复。
// ========================================================================

import { $, escapeHtml } from '../utils/dom.js';
import {
    DEFAULT_TAG_ID,
    SEARCH_SCOPE_GLOBAL,
    SESSION_KEY_SCROLL_POSITION_PREFIX,
    SCROLL_SAVE_DEBOUNCE_MS,
    POPOVER_SHOW_DELAY_MS,
    POPOVER_HIDE_DELAY_MS,
    POPOVER_VERTICAL_GAP_PX,
    POPOVER_ARROW_OFFSET_PX,
    POPOVER_MIN_WIDTH_PX
} from '../constants.js';
import { filterStatements, highlightText, sortByCopyCount } from '../commands/search.js';
import { renderStatementCard, renderEmptyState } from './statement-card.js';

let containerElement = null;
let mainListElement = null;
let sortableInstance = null;
let selectedStatementIds = new Set();
let currentVisibleStatementIds = [];
let handlers = {
    onEdit: function () {},
    onDelete: function () {},
    onCopy: function () {},
    onCopyToTag: function () {},
    onCopyToDefault: function () {},
    onReorder: function () {},
    onSelectionChange: function () {}
};
let lastRenderedVault = null;

// ---------- 语句文本索引（供全文浮层查询） ----------
// 结构：Map<statementId, text>
// 在 renderStatementList 中用**当前可见列表**重建。
// 目的：
//   1. 将 getFullStatementText 的 O(N) 扫描降为 O(1)
//   2. 只对可见语句建索引，避免全量遍历（问题 K 修复）
let statementTextById = new Map();

// ---------- 滚动位置状态 ----------
// lastRenderedScrollContextKey：上一次渲染时所处的上下文键
// currentScrollTop：本上下文下的"内存记忆"，用于在上下文未变时
//                   恢复 innerHTML 替换前的滚动位置
// scrollSaveTimer：滚动保存防抖定时器
// pendingScrollSaveSnapshot：滚动发生时记录的 { contextKey, scrollTop } 快照
//   —— 用于在防抖窗口内切换标签时，仍能正确写回"发生滚动时所在的上下文"
//      及其"滚动位置"（问题 J 修复）
let lastRenderedScrollContextKey = null;
let currentScrollTop = 0;
let scrollSaveTimer = null;
let pendingScrollSaveSnapshot = null;

// ---------- 全文浮层状态 ----------
// popoverElement：单例浮层 DOM（惰性创建）
// currentHoveredCardContent：当前鼠标所在的 .card-content 元素
// showPopoverTimer / hidePopoverTimer：显示/隐藏延迟定时器
// isTouchDevice：触屏设备检测结果
let popoverElement = null;
let currentHoveredCardContent = null;
let showPopoverTimer = null;
let hidePopoverTimer = null;
let isTouchDevice = false;

/**
 * 属性值转义（用于 [attribute="value"] 选择器中的双引号字符串）。
 *
 * 【与 CSS.escape 的区别】
 *   CSS.escape 用于把任意字符串转成合法的 CSS 标识符
 *   （例如类名、ID 名）。它会转义空格、#、. 等为 \x 形式。
 *
 *   但属性选择器 [attr="value"] 中的双引号字符串遵循
 *   **CSS 字符串字面量**的转义规则：
 *     - 只需转义双引号 \"
 *     - 只需转义反斜杠 \\
 *     - 其他字符（包括空格、#、.）无需转义
 *     - 换行符按 CSS 规范需转义为 \A 或 \a，但 ID 中不会出现
 *
 * @param {string} value
 * @returns {string}
 */
function escapeAttributeValueForSelector(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

/**
 * 检测是否为触屏设备
 * 触屏设备无 hover 语义，直接跳过全文浮层逻辑
 * @returns {boolean}
 */
function detectTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

/**
 * 初始化语句列表
 * @param {{
 *   onEdit: (statementId: string) => void,
 *   onDelete: (statementId: string) => void,
 *   onCopy: (statementId: string) => void,
 *   onCopyToTag: (statementId: string) => void,
 *   onCopyToDefault: (statementId: string) => void,
 *   onReorder: (tagId: string, fromIndex: number, toIndex: number) => void,
 *   onSelectionChange: (selectedCount: number) => void
 * }} options
 */
export function initializeStatementList(options) {
    handlers = Object.assign(handlers, options || {});
    containerElement = $('#statementsList');
    mainListElement = $('#mainListContainer');
    isTouchDevice = detectTouchDevice();
    bindContainerEvents();
    bindScrollMemoryInternal();
    bindFullTextPopoverEvents();
}

function bindContainerEvents() {
    if (!containerElement) return;

    // 单击卡片操作按钮
    containerElement.addEventListener('click', function (event) {
        // 复选框
        if (event.target.classList.contains('card-checkbox')) {
            const statementId = event.target.getAttribute('data-id');
            if (statementId) {
                toggleStatementSelection(statementId);
            }
            return;
        }

        // 操作按钮
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        event.stopPropagation();

        const action = actionButton.getAttribute('data-action');
        const statementId = actionButton.getAttribute('data-id');
        if (!statementId) return;

        switch (action) {
            case 'edit':
                handlers.onEdit(statementId);
                break;
            case 'delete':
                handlers.onDelete(statementId);
                break;
            case 'copy':
                handlers.onCopy(statementId);
                break;
            case 'copyToTag':
                handlers.onCopyToTag(statementId);
                break;
            case 'copyToDefault':
                handlers.onCopyToDefault(statementId);
                break;
            default:
                break;
        }
    });

    // 双击卡片编辑
    containerElement.addEventListener('dblclick', function (event) {
        if (event.target.closest('button')) return;
        if (event.target.classList.contains('card-checkbox')) return;
        const card = event.target.closest('.statement-card');
        if (!card) return;
        const statementId = card.getAttribute('data-id');
        if (statementId) {
            event.preventDefault();
            handlers.onEdit(statementId);
        }
    });
}

// ==================== 全文浮层 ====================

/**
 * 绑定全文浮层相关事件
 * 触屏设备完全跳过（无 hover 语义）
 */
function bindFullTextPopoverEvents() {
    if (isTouchDevice) return;
    if (!containerElement) return;

    containerElement.addEventListener('mouseover', handleCardContentMouseOver);
    containerElement.addEventListener('mouseout', handleCardContentMouseOut);

    // 窗口 resize 与主列表滚动时立即隐藏浮层（位置计算基于视口，避免错位）
    window.addEventListener('resize', hideFullTextPopover, { passive: true });
    if (mainListElement) {
        mainListElement.addEventListener('scroll', hideFullTextPopover, { passive: true });
    }
}

/**
 * 惰性创建单例浮层 DOM
 * 仅在首次需要显示时才注入 body，减少初始化开销
 *
 * 创建时同步绑定浮层自身的 mouseenter / mouseleave，
 * 使浮层可交互（鼠标进入浮层不清除浮层，离开浮层延时隐藏）。
 *
 * 同时设置 title 属性，提示用户浮层内文字可选中复制。
 *
 * @returns {HTMLElement}
 */
function ensurePopoverElement() {
    if (popoverElement) return popoverElement;

    popoverElement = document.createElement('div');
    popoverElement.className = 'statement-fulltext-popover';
    popoverElement.setAttribute('role', 'tooltip');
    popoverElement.setAttribute('aria-hidden', 'true');
    // 提示用户浮层可交互：鼠标悬停其上可选中文字
    popoverElement.setAttribute('title', '可选中文字复制');
    popoverElement.style.display = 'none';

    // 鼠标进入浮层：清除隐藏定时器，保持显示
    // 这样用户可以从卡片移入浮层选中/复制文本
    popoverElement.addEventListener('mouseenter', function () {
        if (hidePopoverTimer) {
            clearTimeout(hidePopoverTimer);
            hidePopoverTimer = null;
        }
    });

    // 鼠标离开浮层：延时隐藏
    popoverElement.addEventListener('mouseleave', function () {
        if (hidePopoverTimer) {
            clearTimeout(hidePopoverTimer);
            hidePopoverTimer = null;
        }
        hidePopoverTimer = setTimeout(function () {
            hidePopoverTimer = null;
            hideFullTextPopover();
        }, POPOVER_HIDE_DELAY_MS);
    });

    document.body.appendChild(popoverElement);
    return popoverElement;
}

/**
 * 判断卡片内容是否被截断
 * scrollHeight：内容实际总高度（包含被 -webkit-line-clamp 隐藏的部分）
 * clientHeight：可见区域高度（约 2 行）
 * 加 1px 容差以应对像素级舍入误差
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isTextTruncated(element) {
    if (!element) return false;
    return element.scrollHeight > element.clientHeight + 1;
}

/**
 * 根据语句 ID 查询语句全文。
 *
 * 使用在 renderStatementList 中构建的 statementTextById Map 完成 O(1) 查询。
 * 无需再遍历整个 vault.statementsMap。
 *
 * @param {string} statementId
 * @returns {string}
 */
function getFullStatementText(statementId) {
    if (!statementId) return '';
    return statementTextById.get(statementId) || '';
}

/**
 * 计算并应用浮层位置与尺寸（相对视口）
 *
 * 【定位策略（历史重构）】
 *   浮层左边缘 = .card-index（序号）左边缘
 *   浮层宽度   = 从 .card-index 左边缘 → .card-actions 左边缘 的距离
 *
 * 【为什么用"序号左边缘 → 按钮区左边缘"作为基准】
 *   这是用户视图上"文字可以占据的区域"的自然边界：
 *     · 左边界：序号之后（.card-content 起始处附近的视觉起点）
 *     · 右边界：功能按钮之前（不遮挡任何按钮）
 *   直接采用该区间作为宽度，视觉上与"文字区一样宽"完全一致。
 *
 * @param {HTMLElement} popover
 * @param {HTMLElement} anchorElement   卡片文本区（.card-content）
 * @param {HTMLElement} cardElement     整张卡片（.statement-card）
 */
function positionPopover(popover, anchorElement, cardElement) {
    const EDGE_MARGIN = 8;
    const GAP = POPOVER_VERTICAL_GAP_PX;

    const anchorRect = anchorElement.getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // ------------------------------------------------------------
    // 计算基准宽度：从 .card-index 左边缘 → .card-actions 左边缘
    // ------------------------------------------------------------
    const cardIndexElement = cardElement.querySelector('.card-index');
    const cardActionsElement = cardElement.querySelector('.card-actions');

    let popoverWidth;

    if (cardIndexElement && cardActionsElement) {
        const cardIndexRect = cardIndexElement.getBoundingClientRect();
        const cardActionsRect = cardActionsElement.getBoundingClientRect();
        const measuredWidth = cardActionsRect.left - cardIndexRect.left;

        // 使用实测宽度；仅在测量异常（<=0）时退化为 card-content 宽度
        popoverWidth = measuredWidth > 0
            ? measuredWidth
            : anchorRect.width;
    } else {
        // 极端兜底：理论上 .card-index 和 .card-actions 总是存在
        popoverWidth = anchorRect.width;
    }

    // 只在极端异常时启用下限保护。
    if (popoverWidth < POPOVER_MIN_WIDTH_PX) {
        popoverWidth = POPOVER_MIN_WIDTH_PX;
    }

    popover.style.width = popoverWidth + 'px';

    // ------------------------------------------------------------
    // 水平定位：浮层左边缘 = .card-index 左边缘
    // 保留右边界保护，防止极端测量误差（浮层宽度理论上不会越界）
    // ------------------------------------------------------------
    const cardIndexElementForLeft = cardElement.querySelector('.card-index');
    const baseLeft = cardIndexElementForLeft
        ? cardIndexElementForLeft.getBoundingClientRect().left
        : anchorRect.left;

    const left = Math.min(
        baseLeft,
        viewportWidth - popoverWidth - EDGE_MARGIN
    );
    popover.style.left = Math.max(EDGE_MARGIN, left) + 'px';

    // ------------------------------------------------------------
    // 首次测量高度（此时宽度已设定）
    // ------------------------------------------------------------
    const popoverRect = popover.getBoundingClientRect();

    // ------------------------------------------------------------
    // 垂直定位：
    //   默认卡片下方
    //   越界时翻到上方
    //   都放不下时夹紧至顶部
    // ------------------------------------------------------------
    let top = cardRect.bottom + GAP;
    let placement = 'below';

    if (top + popoverRect.height > viewportHeight - EDGE_MARGIN) {
        const topAbove = cardRect.top - popoverRect.height - GAP;
        if (topAbove >= EDGE_MARGIN) {
            top = topAbove;
            placement = 'above';
        } else {
            // 上下都放不下：夹紧至顶部，允许内部滚动
            top = EDGE_MARGIN;
        }
    }

    popover.style.top = top + 'px';

    // ------------------------------------------------------------
    // 小箭头水平位置
    //   箭头默认指向 card-content 左边缘（即文本起始处）
    //   相对浮层左边缘（card-index 左边缘）的偏移量
    // ------------------------------------------------------------
    const textStartRelativeToPopoverLeft = anchorRect.left - baseLeft;
    const desiredArrowLeft = Math.max(
        POPOVER_ARROW_OFFSET_PX,
        textStartRelativeToPopoverLeft
    );
    const maxArrowLeft = popoverWidth - POPOVER_ARROW_OFFSET_PX - 12;
    const finalArrowLeft = Math.min(desiredArrowLeft, maxArrowLeft);

    popover.style.setProperty(
        '--popover-arrow-left',
        finalArrowLeft + 'px'
    );

    // 记录方向，供 CSS 控制小箭头翻转
    popover.setAttribute('data-placement', placement);
}

/**
 * 显示全文浮层
 * 使用 visibility 技巧：先设为 hidden 以便测量尺寸和定位，避免闪烁
 *
 * @param {HTMLElement} anchorElement 卡片文本区（.card-content）
 * @param {HTMLElement} cardElement   整张卡片（.statement-card）
 * @param {string} fullText
 */
function showFullTextPopover(anchorElement, cardElement, fullText) {
    const popover = ensurePopoverElement();
    popover.textContent = fullText;
    popover.style.display = 'block';
    popover.style.visibility = 'hidden';
    popover.style.top = '0';
    popover.style.left = '0';
    // 测量 + 定位
    positionPopover(popover, anchorElement, cardElement);
    popover.style.visibility = 'visible';
    popover.setAttribute('aria-hidden', 'false');
}

/**
 * 隐藏全文浮层
 * 保留 DOM 与 textContent（下次显示会覆盖），仅切换 display
 */
function hideFullTextPopover() {
    if (!popoverElement) return;
    popoverElement.style.display = 'none';
    popoverElement.setAttribute('aria-hidden', 'true');
}

/**
 * 清理所有浮层相关定时器与状态
 */
function clearPopoverTimers() {
    if (showPopoverTimer) {
        clearTimeout(showPopoverTimer);
        showPopoverTimer = null;
    }
    if (hidePopoverTimer) {
        clearTimeout(hidePopoverTimer);
        hidePopoverTimer = null;
    }
}

/**
 * mouseover 委托处理
 * @param {MouseEvent} event
 */
function handleCardContentMouseOver(event) {
    const cardContent = event.target.closest('.card-content');
    if (!cardContent) return;
    if (!containerElement.contains(cardContent)) return;
    if (cardContent === currentHoveredCardContent) return;

    // Sortable 拖拽进行中：`.sortable-chosen` 是 Sortable 拖拽起始元素上的类
    if (document.querySelector('.sortable-chosen')) return;

    clearPopoverTimers();
    hideFullTextPopover();

    currentHoveredCardContent = cardContent;
    const targetContent = cardContent;

    showPopoverTimer = setTimeout(function () {
        showPopoverTimer = null;
        // 目标已变（鼠标移开或移到其他卡片）
        if (currentHoveredCardContent !== targetContent) return;
        // 目标已从 DOM 移除（例如重渲染）
        if (!containerElement.contains(targetContent)) return;
        // 定时器触发时再次检查拖拽状态
        if (document.querySelector('.sortable-chosen')) return;
        // 内容未溢出：不需要显示浮层
        if (!isTextTruncated(targetContent)) return;

        const card = targetContent.closest('.statement-card');
        if (!card) return;
        const statementId = card.getAttribute('data-id');
        const fullText = statementId ? getFullStatementText(statementId) : '';
        if (!fullText) return;

        showFullTextPopover(targetContent, card, fullText);
    }, POPOVER_SHOW_DELAY_MS);
}

/**
 * mouseout 委托处理
 * @param {MouseEvent} event
 */
function handleCardContentMouseOut(event) {
    const cardContent = event.target.closest('.card-content');
    if (!cardContent) return;
    if (cardContent !== currentHoveredCardContent) return;

    // 检查鼠标是否真的离开了 card-content（而非在其中子元素间移动）
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && cardContent.contains(relatedTarget)) return;

    clearPopoverTimers();
    currentHoveredCardContent = null;

    hidePopoverTimer = setTimeout(function () {
        hidePopoverTimer = null;
        hideFullTextPopover();
    }, POPOVER_HIDE_DELAY_MS);
}

// ==================== 滚动位置记忆 ====================

/**
 * 绑定主列表滚动监听（内部实现，与 main.js 解耦）
 *
 * 【第一批重构 · 问题 A】
 *   滚动发生时立即记录当时的上下文键到 pendingScrollSaveSnapshot。
 *   后续 persistCurrentScrollPosition 优先使用该快照写入 sessionStorage，
 *   避免防抖窗口内切标签时用"新标签的上下文"覆盖"旧标签的位置"。
 *
 * 【第二批重构 · 问题 J】
 *   快照对象同时记录 scrollTop 值。原因：
 *     若只记录 contextKey，而 persistCurrentScrollPosition 内部读取
 *     mainListElement.scrollTop，则在"防抖窗口内切标签"的场景下，
 *     DOM 的 scrollTop 已被新标签的 render 覆盖为 0，导致写入旧标签
 *     的记录值为 0（位置丢失）。
 *   现在快照同时携带 scrollTop，persistCurrentScrollPosition 优先使用
 *   快照值而非 DOM 实时值，保证写入的是"滚动发生时的位置"。
 */
function bindScrollMemoryInternal() {
    if (!mainListElement) return;
    mainListElement.addEventListener('scroll', function () {
        currentScrollTop = mainListElement.scrollTop;

        // 记录"发生滚动时"的上下文键与滚动位置快照
        // 若 lastRenderedVault 尚不可用（应用初始化早期），保持原值不变
        if (lastRenderedVault) {
            pendingScrollSaveSnapshot = {
                contextKey: computeScrollContextKey(lastRenderedVault),
                scrollTop: mainListElement.scrollTop
            };
        }

        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(function () {
            scrollSaveTimer = null;
            persistCurrentScrollPosition();
        }, SCROLL_SAVE_DEBOUNCE_MS);
    }, { passive: true });
}

/**
 * 计算当前上下文键
 * @param {Object} vault
 * @returns {string}
 */
function computeScrollContextKey(vault) {
    const isGlobalMode = vault.uiState.searchScope === SEARCH_SCOPE_GLOBAL;
    if (isGlobalMode) return 'global';
    const currentTagId = vault.uiState.currentTagId || DEFAULT_TAG_ID;
    return `local:${currentTagId}`;
}

/**
 * 获取当前上下文对应的 sessionStorage 完整键名
 * @param {string} contextKey
 * @returns {string}
 */
function getScrollStorageKey(contextKey) {
    return SESSION_KEY_SCROLL_POSITION_PREFIX + contextKey;
}

/**
 * 立即把当前滚动位置写入 sessionStorage
 *
 * 【第一批重构 · 问题 A】
 *   上下文键优先使用 pendingScrollSaveSnapshot（滚动发生时记录），
 *   只有当该值缺失（从未滚动过）时才回退到用 lastRenderedVault 计算。
 *
 *   这样在"防抖窗口内切标签"的场景下：
 *     · scroll 时记录键 = local:标签A
 *     · 用户切到标签B → renderStatementList 执行，lastRenderedVault 变为 B
 *     · flush 触发 → 使用记录的键 local:标签A 写入 → 位置写入正确
 *
 * 【第二批重构 · 问题 J】
 *   滚动位置值同样优先使用快照中的 scrollTop，避免读取 DOM 实时值：
 *     · DOM 值在切标签后会被 restoreMainListScroll 覆盖为新标签的位置
 *     · 快照值恒等于"发生滚动时"的位置，语义上明确
 *
 *   回退路径（从未滚动过 / 早期初始化）仍使用 DOM 值：
 *     此时不存在快照概念，DOM 值即当前状态的唯一真相源。
 */
function persistCurrentScrollPosition() {
    if (!mainListElement) return;

    let contextKey;
    let scrollTopToSave;

    if (pendingScrollSaveSnapshot) {
        // 优先使用"滚动发生时"记录的快照
        contextKey = pendingScrollSaveSnapshot.contextKey;
        scrollTopToSave = pendingScrollSaveSnapshot.scrollTop;
    } else if (lastRenderedVault) {
        // 回退：从未滚动过（或 lastRenderedVault 尚不可用）时，
        // 用当前 vault 计算上下文，用 DOM 实时值作为滚动位置
        contextKey = computeScrollContextKey(lastRenderedVault);
        scrollTopToSave = mainListElement.scrollTop;
    } else {
        // 两个来源都不可用：无法确定写入目标，直接返回
        return;
    }

    if (!contextKey) return;

    const storageKey = getScrollStorageKey(contextKey);
    try {
        sessionStorage.setItem(storageKey, String(scrollTopToSave));
    } catch (storageError) {
        console.warn('[statement-list] sessionStorage 写入失败:', storageError);
    }

    // 写入完成后清空待保存快照，避免后续无滚动时重复写入旧键
    pendingScrollSaveSnapshot = null;
}

/**
 * 导出给 main.js：beforeunload 时强制保存滚动位置
 * 也用于"切标签前主动 flush"，避免防抖窗口内丢位置
 */
export function flushScrollPosition() {
    if (scrollSaveTimer) {
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = null;
    }
    persistCurrentScrollPosition();
}

/**
 * 恢复滚动位置（在每次渲染后调用）
 * - 上下文变化：从 sessionStorage 读取并应用
 * - 上下文未变：用内存记忆的位置还原
 * @param {Object} vault
 */
function restoreMainListScroll(vault) {
    if (!mainListElement) return;
    const contextKey = computeScrollContextKey(vault);

    if (contextKey !== lastRenderedScrollContextKey) {
        // 上下文已变：从 sessionStorage 恢复
        const storageKey = getScrollStorageKey(contextKey);
        let restoredScrollTop = 0;
        try {
            const savedValue = sessionStorage.getItem(storageKey);
            if (savedValue !== null) {
                const parsed = parseFloat(savedValue);
                if (!Number.isNaN(parsed)) {
                    restoredScrollTop = parsed;
                }
            }
        } catch (storageError) {
            console.warn('[statement-list] sessionStorage 读取失败:', storageError);
        }
        mainListElement.scrollTop = restoredScrollTop;
        currentScrollTop = restoredScrollTop;
        lastRenderedScrollContextKey = contextKey;
    } else {
        // 上下文未变：还原 innerHTML 替换前的位置
        mainListElement.scrollTop = currentScrollTop;
    }
}

// ==================== 渲染主函数 ====================

/**
 * 渲染语句列表
 * @param {Object} vault
 */
export function renderStatementList(vault) {
    if (!containerElement) return;

    // 重渲染会替换所有卡片 DOM，先清理浮层相关状态
    clearPopoverTimers();
    hideFullTextPopover();
    currentHoveredCardContent = null;

    lastRenderedVault = vault;

    const currentTagId = vault.uiState.currentTagId;
    const isGlobalMode = vault.uiState.searchScope === SEARCH_SCOPE_GLOBAL;
    const keyword = vault.uiState.searchKeyword;
    const useRegex = vault.uiState.useRegex;

    // 读取首字母搜索开关
    // vault.settings 理论上必定存在（normalizeVault 保证），
    // 但用短路保护 + 双非，避免极端情况下读取到 undefined 抛错。
    const enableInitialsSearch = !!(vault.settings
        && vault.settings.enableInitialsSearch);

    // 计算可见列表
    let visibleStatements;
    if (isGlobalMode) {
        // 全局模式：扁平化所有标签
        visibleStatements = [];
        for (const tag of vault.tags) {
            const list = vault.statementsMap[tag.id] || [];
            for (const statement of list) {
                visibleStatements.push({
                    ...statement,
                    tagId: tag.id,
                    tagName: tag.name,
                    tagColor: tag.color
                });
            }
        }
        if (keyword) {
            visibleStatements = filterStatements(
                visibleStatements,
                keyword,
                useRegex,
                enableInitialsSearch
            );
        }
    } else {
        // 本地模式：只取当前标签
        const localList = vault.statementsMap[currentTagId] || [];
        if (keyword) {
            visibleStatements = filterStatements(
                localList,
                keyword,
                useRegex,
                enableInitialsSearch
            );
        } else if (currentTagId === DEFAULT_TAG_ID) {
            // 默认标签且无搜索：按 copyCount 降序
            visibleStatements = sortByCopyCount(localList);
        } else {
            visibleStatements = localList.slice();
        }
    }

    // ---------- 用可见列表重建语句文本索引（问题 K 修复） ----------
    // 原实现无条件遍历所有标签的全部语句，即使这些语句当前不可见。
    // 现改为只对可见列表建索引：
    //   · 语义完全等价（浮层只对可见卡片触发，查询 id 一定属于可见列表）
    //   · 性能从 O(全部语句) 降为 O(可见语句)
    //   · 用 new Map() 重建，自动清空旧数据，不存在陈旧命中
    //   · 空状态分支下 Map 为空，与"没有卡片可悬停"的语义一致
    statementTextById = new Map();
    for (let index = 0; index < visibleStatements.length; index++) {
        const statementItem = visibleStatements[index];
        statementTextById.set(statementItem.id, statementItem.text);
    }

    currentVisibleStatementIds = visibleStatements.map(function (statement) {
        return statement.id;
    });

    // 清理已不存在的选中项
    const visibleIdSet = new Set(currentVisibleStatementIds);
    let selectionChanged = false;
    for (const id of Array.from(selectedStatementIds)) {
        if (!visibleIdSet.has(id)) {
            selectedStatementIds.delete(id);
            selectionChanged = true;
        }
    }
    if (selectionChanged) {
        notifySelectionChange();
    }

    // 空状态
    if (visibleStatements.length === 0) {
        containerElement.innerHTML = renderEmptyState({
            type: keyword
                ? 'no-match'
                : (isGlobalMode ? 'search-prompt' : 'empty'),
            keyword
        });
        destroySortable();
        restoreMainListScroll(vault);
        return;
    }

    // 生成 HTML
    let html = '';
    visibleStatements.forEach(function (statement, index) {
        const highlightedHtml = keyword
            ? highlightText(
                statement.text,
                keyword,
                useRegex,
                enableInitialsSearch
            )
            : escapeHtml(statement.text);
        html += renderStatementCard(statement, {
            displayIndex: index + 1,
            isChecked: selectedStatementIds.has(statement.id),
            isGlobalMode,
            currentTagId,
            highlightedHtml
        });
    });
    containerElement.innerHTML = html;

    // Sortable 绑定
    const canReorder = !isGlobalMode && !keyword && currentTagId !== DEFAULT_TAG_ID;
    if (canReorder) {
        initializeSortable(currentTagId);
    } else {
        destroySortable();
    }

    restoreMainListScroll(vault);
}

function initializeSortable(tagId) {
    destroySortable();
    if (!containerElement || !containerElement.children.length) return;
    if (typeof window.Sortable === 'undefined') return;

    sortableInstance = new window.Sortable(containerElement, {
        animation: 200,
        handle: '.statement-card',
        ghostClass: 'sortable-drag',
        touchStartThreshold: 2,
        onEnd: function (event) {
            if (event.oldIndex === undefined || event.newIndex === undefined) return;
            if (event.oldIndex === event.newIndex) return;
            handlers.onReorder(tagId, event.oldIndex, event.newIndex);
        }
    });
}

function destroySortable() {
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
}

// ==================== 选中状态管理 ====================

function toggleStatementSelection(statementId) {
    if (selectedStatementIds.has(statementId)) {
        selectedStatementIds.delete(statementId);
    } else {
        selectedStatementIds.add(statementId);
    }
    if (lastRenderedVault) {
        // 只更新该复选框和 batch bar，避免全量重绘丢焦点。
        //
        // 使用 escapeAttributeValueForSelector 而非 CSS.escape：
        // CSS.escape 是为 CSS 标识符设计的，在属性选择器的引号字符串
        // 上下文中会引入多余的反斜杠，导致匹配失败。
        const escapedId = escapeAttributeValueForSelector(statementId);
        const checkbox = containerElement.querySelector(
            `.card-checkbox[data-id="${escapedId}"]`
        );
        if (checkbox) checkbox.checked = selectedStatementIds.has(statementId);
    }
    notifySelectionChange();
}

function notifySelectionChange() {
    const count = selectedStatementIds.size;
    handlers.onSelectionChange(count);
}

/**
 * 获取当前选中的 ID 集合副本
 * @returns {Set<string>}
 */
export function getSelectedStatementIds() {
    return new Set(selectedStatementIds);
}

/**
 * 清空选中
 * @param {boolean} [shouldRerender=true] 是否立即重渲染（默认 true）
 */
export function clearStatementSelection(shouldRerender) {
    if (selectedStatementIds.size === 0) return;
    selectedStatementIds.clear();
    const effectiveRerender = shouldRerender !== false;
    if (effectiveRerender && lastRenderedVault) {
        renderStatementList(lastRenderedVault);
    }
    notifySelectionChange();
}

/**
 * 全选 / 取消全选
 *
 * 【第一批重构 · 问题 E】
 *   原实现 `selectedStatementIds = visibleIdSet;` 直接共享引用。
 *   现改为赋新 Set，切断与局部变量的引用耦合。
 *
 * @returns {boolean} true 表示执行了全选
 */
export function toggleSelectAllVisible() {
    const visibleIdSet = new Set(currentVisibleStatementIds);
    const isAllSelected = currentVisibleStatementIds.length > 0 &&
        currentVisibleStatementIds.every(function (id) {
            return selectedStatementIds.has(id);
        });

    if (isAllSelected) {
        selectedStatementIds.clear();
    } else {
        // 赋新 Set，避免与 visibleIdSet 共享引用
        selectedStatementIds = new Set(visibleIdSet);
    }

    if (lastRenderedVault) {
        renderStatementList(lastRenderedVault);
    }
    notifySelectionChange();
    return !isAllSelected;
}

/**
 * 判断是否全部可见项都被选中
 * @returns {boolean}
 */
export function isAllVisibleSelected() {
    if (currentVisibleStatementIds.length === 0) return false;
    return currentVisibleStatementIds.every(function (id) {
        return selectedStatementIds.has(id);
    });
}

// ==================== 对外滚动控制 ====================

/**
 * 滚动到底部
 */
export function scrollMainListToBottom() {
    if (mainListElement) {
        mainListElement.scrollTop = mainListElement.scrollHeight;
        currentScrollTop = mainListElement.scrollTop;
    }
}

// ==================== 卡片视觉位置补偿 ====================

/**
 * 获取指定语句卡片在**视口坐标系**中的 top 坐标。
 *
 * 用途：
 *   在 dispatch 前后各调用一次，通过比较两次的差值，
 *   判断卡片是否因排序变化而"视觉上移动"。
 *
 * 返回：
 *   - 若卡片存在且在主列表容器内：返回 `getBoundingClientRect().top`
 *   - 若卡片不存在（被删除 / 被搜索过滤掉）：返回 null
 *
 * 使用 escapeAttributeValueForSelector 而非 CSS.escape。
 *
 * @param {string} statementId
 * @returns {number|null}
 */
export function getStatementCardViewportTopById(statementId) {
    if (!statementId || !containerElement) return null;

    const escapedId = escapeAttributeValueForSelector(statementId);
    const card = containerElement.querySelector(
        `.statement-card[data-id="${escapedId}"]`
    );
    if (!card) return null;

    return card.getBoundingClientRect().top;
}

/**
 * 调整主列表的滚动位置，补偿视觉位置变化。
 *
 * 工作原理：
 *   若卡片原视觉位置是 `previousTop`，重排后是 `nextTop`，
 *   则 `deltaY = nextTop - previousTop` 就是卡片"在视口中移动的距离"。
 *
 *   要使卡片在视口中的位置恢复到原始值，需要：
 *     - 卡片下移（deltaY > 0）→ 主列表向下滚动 deltaY
 *     - 卡片上移（deltaY < 0）→ 主列表向上滚动 |deltaY|
 *
 *   即：`mainListElement.scrollTop += deltaY`
 *
 * 【为什么同时更新 currentScrollTop】
 *   currentScrollTop 是本模块内部的"内存记忆"，用于在上下文未变时
 *   恢复 innerHTML 替换前的滚动位置。若此处只改 DOM 而不同步内存，
 *   下一次渲染（如再次复制）会用旧的 currentScrollTop 覆盖当前值，
 *   导致视觉位置回退。
 *
 * @param {number} deltaY
 */
export function compensateMainListScrollBy(deltaY) {
    if (!mainListElement) return;
    if (typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return;
    if (deltaY === 0) return;

    // 直接赋值而非 +=，确保读取的是浏览器实际接受的 scrollTop
    // （浏览器会在边界处自动夹紧到 [0, scrollHeight - clientHeight]）
    mainListElement.scrollTop = mainListElement.scrollTop + deltaY;
    currentScrollTop = mainListElement.scrollTop;
}

// ==================== 对外浮层控制 ====================

/**
 * 强制关闭当前全文浮层（供快捷键 Esc 调用）
 *
 * 若当前没有浮层显示，返回 false；
 * 若成功关闭，返回 true。
 *
 * @returns {boolean}
 */
export function forceCloseFullTextPopover() {
    if (!popoverElement) return false;
    if (popoverElement.style.display === 'none') return false;

    clearPopoverTimers();
    hideFullTextPopover();
    currentHoveredCardContent = null;
    return true;
}