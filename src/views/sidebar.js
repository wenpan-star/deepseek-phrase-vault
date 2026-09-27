// filename: src/views/sidebar.js
// ========================================================================
// DeepSeek 语句工坊 · 侧边栏视图
// 渲染"分类 → 标签"二级结构；支持分类与标签的双击编辑、单击交互、
// 拖拽排序；分类折叠状态独立于 Vault，存储于 localStorage。
// 通过回调通知外部，不直接操作状态
//
// 【历史调整】
//   删除 restoreSidebarScroll 与 getSidebarScrollTop 两个导出函数。
//   原因：侧边栏滚动位置的保存与恢复由 main.js 中的
//         bindSidebarScrollMemory / restoreSidebarScrollState 全权负责，
//         直接操作 #sidebarTagsList 元素。
//   本模块中的这两个函数从未被任何调用方引用，属死代码，予以删除。
//
// 【第一批重构（历史）】
//   新增 syncSidebarExpandedState(expanded) 导出。
//
// 【分类层级（本模块基础）】
//   侧边栏从"平铺标签"重构为"分类分组 → 标签"的二级结构。
//
//   【核心设计决策 1：折叠状态独立于 Vault】
//     折叠状态存于 localStorage 独立键 STORAGE_KEY_COLLAPSED_CATEGORIES。
//
//   【核心设计决策 2：存储"已折叠集合"而非"已展开集合"】
//     存储格式：JSON 数组字符串。
//
//   【核心设计决策 3：分类与标签的 Sortable 独立】
//     分类之间的排序 + 每个分类内部的标签排序，两者互不干扰。
//
//   【核心设计决策 4：标签排序收集全局顺序】
//     用户拖拽某分类内的标签后，收集全局顺序，
//     通过 reorderTags 命令更新 vault.tags 的数组顺序。
//
// 【上一轮 Bug 修复（Bug 1/4/5/6/7/8/9）】
//   Bug 1（折叠分类后当前标签"消失"）：
//     · 双保险：renderSidebar 中临时展开 + toggleCategoryCollapse 拒绝折叠
//
//   Bug 4（双击分类头部先触发单击折叠）：
//     · 单击延迟 300ms；dblclick 或 Sortable 启动时取消计时器
//
//   Bug 5（触摸设备点击分类子级空白误触侧边栏）：
//     · 触摸分支中判断扩展到 .category-group
//
//   Bug 6（getTagsInCategory / countTagsInCategory 未被使用）：
//     · renderSidebar 改为调用这两个 API
//
//   Bug 7（Sortable 全量重建）：
//     · 只为展开的分类创建标签 Sortable；折叠分类跳过
//     · toggleCategoryCollapse 展开时补创建
//
//   Bug 8（默认分类可被拖拽到非首位）：
//     · onMove 阻止将任何分类拖到默认分类之前
//
//   Bug 9（默认标签可被拖拽改变 DOM 位置）：
//     · onMove 恢复原实现的 relatedTagId 落点保护
//
// 【本轮 Bug 11 修复 · renderSidebar 清理挂起的延迟单击】
//   背景：
//     Bug 4 修复引入的"单击延迟 300ms"机制中，pendingCollapseTimer
//     会在定时器到期时执行折叠操作。但若在挂起期间触发了
//     renderSidebar（通过其他标签/分类操作 dispatch 导致 'tags'
//     切片通知），则：
//       1. renderSidebar 通过 containerElement.innerHTML = html
//          完全替换 DOM
//       2. 挂起的定时器在 300ms 后触发，调用
//          performToggleCategoryCollapse 操作**已被移除的旧 DOM 元素**
//       3. 虽然 performToggleCategoryCollapse 内已有
//          document.body.contains() 检查作为兜底，但属于
//          "防御性兜底"而非"主动清理"
//
//   为什么这是问题：
//     · 逻辑卫生：渲染入口应主动清理与旧 DOM 相关的挂起操作
//     · 未来若移除防御性检查（例如重构时"优化"），会引发操作
//       旧 DOM 的 bug
//     · 无意义地占用一个 300ms 的定时器槽位
//
//   修复方案：
//     renderSidebar 开头调用 cancelPendingCollapse()，主动取消挂起的
//     单击折叠操作。这样即使旧定时器未被触发，也不会有操作旧 DOM
//     的风险。
//
// 【本轮 Bug 8 配套说明】
//   normalizeCategories（core/vault.js）本轮修复后**强制默认分类
//   位于首位**。因此 renderSidebar 遍历 vault.categories 时，首项
//   必然是默认分类。侧边栏渲染天然满足"默认分类首位"的视觉不变式。
// ========================================================================

import { $, escapeHtml } from '../utils/dom.js';
import {
    DEFAULT_TAG_ID,
    DEFAULT_CATEGORY_ID,
    STORAGE_KEY_COLLAPSED_CATEGORIES,
    COLLAPSED_CATEGORIES_SAVE_DEBOUNCE_MS
} from '../constants.js';
import {
    getTagsInCategory,
    countTagsInCategory
} from '../core/vault.js';

// ---------- 模块级 DOM 缓存 ----------
let sidebarElement = null;
let sidebarHeader = null;
let containerElement = null;
let addTagButton = null;
let addCategoryButton = null;

// ---------- Sortable 实例管理 ----------
// categorySortableInstance：分类之间的排序实例（唯一）
// tagSortableInstancesByCategoryId：Map<categoryId, SortableInstance>
//   只为"展开的分类"创建；折叠的分类不创建（Bug 7 优化）
//   每次 renderSidebar 时清空重建
let categorySortableInstance = null;
let tagSortableInstancesByCategoryId = new Map();

// ---------- 侧边栏展开状态（与 Vault 同步）----------
let isTouchDevice = false;
let pinnedState = false;

// ---------- 分类折叠状态（独立于 Vault）----------
let collapsedCategoryIds = new Set();
let collapseSaveTimer = null;

// ---------- 当前标签上下文缓存（供 Bug 1 的双保险使用）----------
// renderSidebar 时更新；performToggleCategoryCollapse 中读取，
// 用于判断"当前标签是否在被折叠的分类中"
let currentTagIdCache = null;
let currentTagCategoryIdCache = null;

// ---------- 单击延迟（Bug 4 修复）----------
// 用户单击分类头部时，不立即折叠，而是延迟 300ms。
// 若期间触发 dblclick（编辑分类）或 Sortable 启动（拖拽排序），
// 则取消延迟的折叠操作。
//
// 为什么 300ms：
//   · 双击的时间阈值通常为 250-500ms
//   · 300ms 略大于浏览器常用的 250ms 双击窗口，能可靠区分单击和双击
//   · 又不会让用户感到单击响应迟钝
let pendingCollapseTimer = null;
let pendingCollapseContext = null;

// ---------- 回调集合 ----------
let handlers = {
    onTagClick: function () {},
    onTagDelete: function () {},
    onTagEdit: function () {},
    onTagReorder: function () {},
    onAddTag: function () {},
    onToggleExpand: function () {},
    onCategoryAdd: function () {},
    onCategoryEdit: function () {},
    onCategoryDelete: function () {},
    onCategoryReorder: function () {},
    // Bug 1 配套：当用户尝试折叠当前标签所在的分类时触发
    onCategoryCollapseBlocked: function () {}
};

/**
 * 检测是否为触屏设备
 * @returns {boolean}
 */
function detectTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

// ==================== 折叠状态读写 ====================

/**
 * 从 localStorage 读取"已折叠分类 id 集合"。
 *
 * 容错策略：
 *   · 键不存在 → 返回空集（默认全部展开）
 *   · JSON 解析失败 → 记录告警，返回空集
 *   · 解析结果不是数组 → 返回空集
 *   · 数组中的非字符串元素 → 过滤掉
 *
 * @returns {Set<string>}
 */
function loadCollapsedCategoryIds() {
    try {
        const rawValue = localStorage.getItem(STORAGE_KEY_COLLAPSED_CATEGORIES);
        if (rawValue === null) return new Set();

        const parsedValue = JSON.parse(rawValue);
        if (!Array.isArray(parsedValue)) {
            console.warn(
                '[sidebar] 折叠状态格式异常（非数组），已重置为默认（全部展开）'
            );
            return new Set();
        }

        const validIds = new Set();
        for (const id of parsedValue) {
            if (typeof id === 'string' && id.length > 0) {
                validIds.add(id);
            }
        }
        return validIds;
    } catch (readError) {
        console.warn('[sidebar] 读取折叠状态失败:', readError);
        return new Set();
    }
}

/**
 * 防抖写入折叠状态到 localStorage。
 *
 * 防抖时长：COLLAPSED_CATEGORIES_SAVE_DEBOUNCE_MS = 200ms
 */
function persistCollapsedCategoryIdsDebounced() {
    if (collapseSaveTimer) {
        clearTimeout(collapseSaveTimer);
        collapseSaveTimer = null;
    }
    collapseSaveTimer = setTimeout(function () {
        collapseSaveTimer = null;
        try {
            localStorage.setItem(
                STORAGE_KEY_COLLAPSED_CATEGORIES,
                JSON.stringify(Array.from(collapsedCategoryIds))
            );
        } catch (writeError) {
            console.warn('[sidebar] 写入折叠状态失败:', writeError);
        }
    }, COLLAPSED_CATEGORIES_SAVE_DEBOUNCE_MS);
}

/**
 * 立即将折叠状态写入 localStorage（用于 beforeunload 兜底）。
 */
export function flushCollapsedCategoryState() {
    if (collapseSaveTimer) {
        clearTimeout(collapseSaveTimer);
        collapseSaveTimer = null;
    }
    try {
        localStorage.setItem(
            STORAGE_KEY_COLLAPSED_CATEGORIES,
            JSON.stringify(Array.from(collapsedCategoryIds))
        );
    } catch (writeError) {
        console.warn('[sidebar] 写入折叠状态失败:', writeError);
    }
}

// ==================== 单击延迟（Bug 4 修复） ====================

/**
 * 取消挂起的单击折叠操作。
 *
 * 触发时机：
 *   · 用户双击分类头部（意图是"编辑分类"）
 *   · Sortable 开始拖拽分类（意图是"排序"）
 *   · 用户点击其他元素
 *   · renderSidebar 被调用（Bug 11 修复新增）
 */
function cancelPendingCollapse() {
    if (pendingCollapseTimer) {
        clearTimeout(pendingCollapseTimer);
        pendingCollapseTimer = null;
    }
    pendingCollapseContext = null;
}

/**
 * 安排延迟的单击折叠操作。
 *
 * @param {{ categoryId: string, groupElement: HTMLElement, headerElement: HTMLElement }} context
 */
function schedulePendingCollapse(context) {
    // 清除之前的挂起操作
    cancelPendingCollapse();

    pendingCollapseContext = context;
    pendingCollapseTimer = setTimeout(function () {
        pendingCollapseTimer = null;
        const ctx = pendingCollapseContext;
        pendingCollapseContext = null;
        if (!ctx) return;

        // 二次确认：目标元素仍在 DOM 中
        if (!document.body.contains(ctx.groupElement)) return;
        if (!document.body.contains(ctx.headerElement)) return;

        performToggleCategoryCollapse(ctx.categoryId, ctx.groupElement, ctx.headerElement);
    }, 300);
}

// ==================== 初始化 ====================

/**
 * 初始化侧边栏
 *
 * @param {{
 *   initialExpanded: boolean,
 *   onTagClick: (tagId: string) => void,
 *   onTagDelete: (tagId: string) => void,
 *   onTagEdit: (tagId: string) => void,
 *   onTagReorder: (orderedIds: string[]) => void,
 *   onAddTag: () => void,
 *   onToggleExpand: (expanded: boolean) => void,
 *   onCategoryAdd: () => void,
 *   onCategoryEdit: (categoryId: string) => void,
 *   onCategoryDelete: (categoryId: string) => void,
 *   onCategoryReorder: (orderedIds: string[]) => void,
 *   onCategoryCollapseBlocked: (categoryName: string) => void
 * }} options
 */
export function initializeSidebar(options) {
    handlers = Object.assign(handlers, options || {});
    sidebarElement = $('#sidebar');
    sidebarHeader = $('#sidebarHeader');
    containerElement = $('#sidebarTagsList');
    addTagButton = $('#sidebarAddTagBtn');
    addCategoryButton = $('#sidebarAddCategoryBtn');
    isTouchDevice = detectTouchDevice();
    pinnedState = !!options.initialExpanded;

    // 从 localStorage 读取折叠状态
    collapsedCategoryIds = loadCollapsedCategoryIds();

    if (addTagButton) {
        addTagButton.addEventListener('click', function (event) {
            event.stopPropagation();
            handlers.onAddTag();
        });
    }

    if (addCategoryButton) {
        addCategoryButton.addEventListener('click', function (event) {
            event.stopPropagation();
            handlers.onCategoryAdd();
        });
    }

    bindContainerEvents();
    bindSidebarBehavior();
}

/**
 * 绑定容器内的所有委托事件（分类头部 + 标签项）
 *
 * 事件优先级（在 click 处理器内）：
 *   1. 分类的删除按钮     → onCategoryDelete
 *   2. 标签的删除按钮     → onTagDelete
 *   3. 分类头部           → 安排延迟折叠（Bug 4 修复）
 *   4. 标签项             → onTagClick
 */
function bindContainerEvents() {
    if (!containerElement) return;

    // ---------- 单击事件 ----------
    containerElement.addEventListener('click', function (event) {
        // 1. 分类删除按钮
        const deleteCategoryIcon = event.target.closest('[data-action="deleteCategory"]');
        if (deleteCategoryIcon) {
            event.stopPropagation();
            const categoryId = deleteCategoryIcon.getAttribute('data-category-id');
            if (categoryId) handlers.onCategoryDelete(categoryId);
            return;
        }

        // 2. 标签删除按钮
        const deleteTagIcon = event.target.closest('[data-action="deleteTag"]');
        if (deleteTagIcon) {
            event.stopPropagation();
            const tagId = deleteTagIcon.getAttribute('data-tag-id');
            if (tagId) handlers.onTagDelete(tagId);
            return;
        }

        // 3. 分类头部：安排延迟折叠（Bug 4）
        const categoryHeader = event.target.closest('.category-header');
        if (categoryHeader) {
            event.stopPropagation();
            const categoryGroup = categoryHeader.closest('.category-group');
            if (categoryGroup) {
                const categoryId = categoryGroup.getAttribute('data-category-id');
                if (categoryId) {
                    schedulePendingCollapse({
                        categoryId: categoryId,
                        groupElement: categoryGroup,
                        headerElement: categoryHeader
                    });
                }
            }
            return;
        }

        // 4. 标签项：切换标签（现有行为）
        const tagItem = event.target.closest('.tag-item');
        if (tagItem) {
            const tagId = tagItem.getAttribute('data-tag-id');
            if (tagId) handlers.onTagClick(tagId);
        }
    });

    // ---------- 双击事件 ----------
    containerElement.addEventListener('dblclick', function (event) {
        // 双击时立即取消挂起的单击折叠（Bug 4 修复关键步骤）
        cancelPendingCollapse();

        // 分类头部双击：编辑分类
        const categoryHeader = event.target.closest('.category-header');
        if (categoryHeader) {
            event.stopPropagation();
            const categoryGroup = categoryHeader.closest('.category-group');
            if (!categoryGroup) return;
            const categoryId = categoryGroup.getAttribute('data-category-id');
            if (!categoryId) return;
            // 默认分类不可编辑
            if (categoryId === DEFAULT_CATEGORY_ID) return;
            handlers.onCategoryEdit(categoryId);
            return;
        }

        // 标签双击：编辑标签（现有行为）
        const tagItem = event.target.closest('.tag-item');
        if (!tagItem) return;
        event.stopPropagation();
        const tagId = tagItem.getAttribute('data-tag-id');
        if (!tagId) return;
        if (tagId === DEFAULT_TAG_ID) return;
        handlers.onTagEdit(tagId);
    });
}

/**
 * 执行分类折叠切换。
 *
 * 【Bug 1 修复 · 双保险的第二层】
 *   若用户尝试折叠的分类**包含当前标签**，则拒绝折叠并触发
 *   onCategoryCollapseBlocked 回调。
 *
 * @param {string} categoryId
 * @param {HTMLElement} categoryGroupElement
 * @param {HTMLElement} categoryHeaderElement
 */
function performToggleCategoryCollapse(categoryId, categoryGroupElement, categoryHeaderElement) {
    const isCurrentlyCollapsed = categoryGroupElement.classList.contains('collapsed');
    const willBeCollapsed = !isCurrentlyCollapsed;

    // ---------- Bug 1 修复 · 第二层防护 ----------
    // 用户尝试折叠当前标签所在的分类 → 拒绝
    if (willBeCollapsed && categoryId === currentTagCategoryIdCache) {
        const categoryNameElement = categoryHeaderElement.querySelector('.category-name');
        const categoryName = categoryNameElement
            ? categoryNameElement.textContent
            : '该分类';
        handlers.onCategoryCollapseBlocked(categoryName);
        return;
    }

    // 切换 CSS 类
    categoryGroupElement.classList.toggle('collapsed', willBeCollapsed);

    // 更新 ARIA 属性
    categoryHeaderElement.setAttribute(
        'aria-expanded',
        willBeCollapsed ? 'false' : 'true'
    );

    // 切换文件夹图标
    const folderIcon = categoryHeaderElement.querySelector('.category-folder-icon');
    if (folderIcon) {
        folderIcon.classList.toggle('fa-folder', willBeCollapsed);
        folderIcon.classList.toggle('fa-folder-open', !willBeCollapsed);
    }

    // 更新折叠集合
    if (willBeCollapsed) {
        collapsedCategoryIds.add(categoryId);
        // Bug 7 修复：折叠分类时，销毁其标签 Sortable 实例
        destroyTagSortableForCategory(categoryId);
    } else {
        collapsedCategoryIds.delete(categoryId);
        // Bug 7 修复：展开分类时，补创建其标签 Sortable 实例
        const childrenElement = categoryGroupElement.querySelector('.category-children');
        if (childrenElement) {
            createTagSortableForCategory(categoryId, childrenElement);
        }
    }

    persistCollapsedCategoryIdsDebounced();
}

/**
 * 绑定侧边栏本身的展开/折叠行为
 */
function bindSidebarBehavior() {
    if (!sidebarElement || !sidebarHeader) return;

    if (isTouchDevice) {
        sidebarElement.classList.add('touch-mode');
        if (pinnedState) sidebarElement.classList.add('expanded');
        else sidebarElement.classList.remove('expanded');

        sidebarElement.addEventListener('click', function (event) {
            // 【Bug 5 修复】判断扩展到 .category-group
            if (event.target.closest('.delete-tag-icon') ||
                event.target.closest('.delete-category-icon') ||
                event.target.closest('.add-tag-btn') ||
                event.target.closest('.add-category-btn') ||
                event.target.closest('.tag-item') ||
                event.target.closest('.category-header') ||
                event.target.closest('.category-group')) {
                return;
            }
            const nextExpanded = !sidebarElement.classList.contains('expanded');
            sidebarElement.classList.toggle('expanded', nextExpanded);
            pinnedState = nextExpanded;
            handlers.onToggleExpand(nextExpanded);
        });
    } else {
        if (pinnedState) sidebarElement.classList.add('expanded');
        else sidebarElement.classList.remove('expanded');

        sidebarElement.addEventListener('mouseenter', function () {
            if (!pinnedState) sidebarElement.classList.add('expanded');
        });

        sidebarElement.addEventListener('mouseleave', function () {
            if (!pinnedState) sidebarElement.classList.remove('expanded');
        });

        sidebarHeader.addEventListener('click', function (event) {
            event.stopPropagation();
            pinnedState = !pinnedState;
            sidebarElement.classList.toggle('expanded', pinnedState);
            handlers.onToggleExpand(pinnedState);
        });

        sidebarHeader.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                sidebarHeader.click();
            }
        });
    }
}

// ==================== 渲染 ====================

/**
 * 渲染侧边栏为"分类 → 标签"二级结构。
 *
 * 渲染流程：
 *   1. 【Bug 11 修复】取消挂起的单击折叠操作
 *   2. 更新当前标签上下文缓存（Bug 1 使用）
 *   3. 清理"指向已被删除分类"的陈旧折叠状态
 *   4. 遍历 vault.categories，为每个分类生成分类分组
 *   5. 应用折叠状态（但当前标签所在的分类强制展开，Bug 1 修复第一层）
 *   6. 重建 Sortable 实例（Bug 7 优化：只对展开的分类创建标签 Sortable）
 *
 * @param {Object} vault
 */
export function renderSidebar(vault) {
    if (!containerElement) return;

    // ---------- 【Bug 11 修复】取消挂起的单击折叠 ----------
    // 在渲染入口主动清理，避免定时器操作已被替换的旧 DOM 元素。
    //
    // 虽然 performToggleCategoryCollapse 内有 document.body.contains()
    // 的兜底检查，但"主动清理"比"防御兜底"更清晰：
    //   · 语义清晰：渲染入口就是"重置 UI 状态"的时机
    //   · 性能更好：不需要等待 300ms 执行无意义的定时器回调
    //   · 未来安全：即使移除兜底检查也不会引发 bug
    cancelPendingCollapse();

    // 销毁旧的 Sortable 实例
    destroySortables();

    // ---------- 更新当前标签上下文缓存（Bug 1 使用）----------
    currentTagIdCache = vault.uiState.currentTagId || null;
    if (currentTagIdCache) {
        const currentTag = vault.tags.find(function (tag) {
            return tag.id === currentTagIdCache;
        });
        currentTagCategoryIdCache = currentTag ? currentTag.categoryId : null;
    } else {
        currentTagCategoryIdCache = null;
    }

    // ---------- 清理陈旧的折叠状态 ----------
    const knownCategoryIds = new Set(
        (Array.isArray(vault.categories) ? vault.categories : []).map(function (category) {
            return category.id;
        })
    );
    let collapseStateChanged = false;
    for (const id of Array.from(collapsedCategoryIds)) {
        if (!knownCategoryIds.has(id)) {
            collapsedCategoryIds.delete(id);
            collapseStateChanged = true;
        }
    }
    if (collapseStateChanged) {
        persistCollapsedCategoryIdsDebounced();
    }

    // ---------- 生成 HTML ----------
    let html = '';

    for (const category of vault.categories) {
        // 【Bug 6 修复】复用 vault.js 中的公共 API
        const categoryTags = getTagsInCategory(vault, category.id);
        const categoryTagCount = countTagsInCategory(vault, category.id);

        // 【Bug 1 修复 · 第一层防护】
        // 若当前标签所在分类在 collapsedCategoryIds 中，**临时展开**：
        const isInCollapsedSet = collapsedCategoryIds.has(category.id);
        const isCurrentTagInThisCategory = (category.id === currentTagCategoryIdCache);
        const isEffectiveCollapsed = isInCollapsedSet && !isCurrentTagInThisCategory;

        const collapsedClass = isEffectiveCollapsed ? 'collapsed' : '';
        const folderIconClass = isEffectiveCollapsed ? 'fa-folder' : 'fa-folder-open';
        const isDefaultCategory = category.id === DEFAULT_CATEGORY_ID;
        const ariaExpanded = isEffectiveCollapsed ? 'false' : 'true';

        // 分类删除按钮（默认分类不显示，但保留占位保持对齐）
        const categoryDeleteHtml = isDefaultCategory
            ? '<span class="delete-category-icon-placeholder" aria-hidden="true"></span>'
            : '<span class="delete-category-icon" data-action="deleteCategory"'
                + ' data-category-id="' + escapeHtml(category.id) + '"'
                + ' role="button" aria-label="删除分类">'
                + '<i class="fas fa-times" aria-hidden="true"></i></span>';

        html += '<div class="category-group ' + collapsedClass + '"'
            + ' data-category-id="' + escapeHtml(category.id) + '">'
            + '<div class="category-header"'
            + ' role="button" tabindex="0"'
            + ' aria-expanded="' + ariaExpanded + '"'
            + ' aria-label="分类 ' + escapeHtml(category.name) + '">'
            + '<i class="fas ' + folderIconClass + ' category-folder-icon" aria-hidden="true"></i>'
            + '<span class="category-name">' + escapeHtml(category.name) + '</span>'
            + '<span class="category-badge">' + categoryTagCount + '</span>'
            + categoryDeleteHtml
            + '</div>'
            + '<div class="category-children" role="list">';

        for (const tag of categoryTags) {
            const statementCount = (vault.statementsMap[tag.id] || []).length;
            const isActive = currentTagIdCache === tag.id ? 'active' : '';
            const isDefaultTag = tag.id === DEFAULT_TAG_ID;
            const colorDotStyle = tag.color
                ? 'background:' + escapeHtml(tag.color) + ';'
                : 'background:#ccc;';
            const iconClass = isDefaultTag ? 'fa-home' : 'fa-tag';
            const deleteHtml = isDefaultTag
                ? '<span style="width:26px;flex-shrink:0;"></span>'
                : '<span class="delete-tag-icon"'
                    + ' data-action="deleteTag"'
                    + ' data-tag-id="' + escapeHtml(tag.id) + '"'
                    + ' role="button" aria-label="删除标签">'
                    + '<i class="fas fa-times" aria-hidden="true"></i></span>';

            html += '<div class="tag-item ' + isActive + '"'
                + ' data-tag-id="' + escapeHtml(tag.id) + '"'
                + ' data-tag-name="' + escapeHtml(tag.name) + '"'
                + ' data-tag-color="' + escapeHtml(tag.color || '') + '"'
                + ' data-tag-category-id="' + escapeHtml(tag.categoryId || '') + '"'
                + ' role="listitem" tabindex="0">'
                + '<span class="tag-color-dot" style="' + colorDotStyle + '"></span>'
                + '<i class="fas ' + iconClass + '" aria-hidden="true"></i>'
                + '<span class="tag-name">' + escapeHtml(tag.name) + '</span>'
                + '<span class="tag-badge">' + statementCount + '</span>'
                + deleteHtml
                + '</div>';
        }

        html += '</div></div>';
    }

    containerElement.innerHTML = html;

    // ---------- 重建 Sortable 实例 ----------
    initializeSortables();
}

/**
 * 销毁所有 Sortable 实例。
 */
function destroySortables() {
    if (categorySortableInstance) {
        categorySortableInstance.destroy();
        categorySortableInstance = null;
    }
    for (const instance of tagSortableInstancesByCategoryId.values()) {
        instance.destroy();
    }
    tagSortableInstancesByCategoryId.clear();
}

/**
 * 销毁指定分类的标签 Sortable 实例（若存在）。
 * @param {string} categoryId
 */
function destroyTagSortableForCategory(categoryId) {
    const instance = tagSortableInstancesByCategoryId.get(categoryId);
    if (instance) {
        instance.destroy();
        tagSortableInstancesByCategoryId.delete(categoryId);
    }
}

/**
 * 为指定分类创建标签 Sortable 实例（若尚未创建）。
 *
 * @param {string} categoryId
 * @param {HTMLElement} childrenElement 该分类的 .category-children 元素
 */
function createTagSortableForCategory(categoryId, childrenElement) {
    if (!childrenElement) return;
    if (typeof window.Sortable === 'undefined') return;

    // 已存在实例：先销毁，避免重复绑定
    destroyTagSortableForCategory(categoryId);

    const instance = new window.Sortable(childrenElement, {
        animation: 200,
        handle: '.tag-item',
        draggable: '.tag-item',
        group: {
            // 禁止跨分类拖拽
            name: 'sidebar-tags',
            pull: false,
            put: false
        },
        ghostClass: 'sortable-drag',
        touchStartThreshold: 2,
        onMove: function (event) {
            const draggedTagId = event.dragged
                ? event.dragged.getAttribute('data-tag-id')
                : null;

            // 默认标签不可拖拽
            if (draggedTagId === DEFAULT_TAG_ID) return false;

            // 【Bug 9 修复】落点保护：
            // 若目标落点是"默认标签之前"，拒绝本次拖拽移动。
            const relatedTagId = event.related
                ? event.related.getAttribute('data-tag-id')
                : null;

            if (relatedTagId === DEFAULT_TAG_ID && event.willInsertAfter === false) {
                return false;
            }

            return true;
        },
        onEnd: function (event) {
            if (event.oldIndex === undefined || event.newIndex === undefined) return;
            if (event.oldIndex === event.newIndex) return;

            const orderedIds = collectAllTagIdsInOrder();
            handlers.onTagReorder(orderedIds);
        }
    });

    tagSortableInstancesByCategoryId.set(categoryId, instance);
}

/**
 * 重建分类与标签的 Sortable 实例。
 *
 * 【Bug 7 优化】
 *   · 只为**展开的分类**创建标签 Sortable
 *   · 折叠的分类跳过
 */
function initializeSortables() {
    if (!containerElement) return;
    if (typeof window.Sortable === 'undefined') return;

    // ---------- 分类之间的排序 ----------
    categorySortableInstance = new window.Sortable(containerElement, {
        animation: 200,
        handle: '.category-header',
        draggable: '.category-group',
        ghostClass: 'sortable-category-drag',
        touchStartThreshold: 2,
        onStart: function () {
            // 【Bug 4 修复】Sortable 启动时取消挂起的单击折叠
            cancelPendingCollapse();
        },
        onMove: function (event) {
            const draggedCategoryId = event.dragged
                ? event.dragged.getAttribute('data-category-id')
                : null;

            // 默认分类不可拖拽
            if (draggedCategoryId === DEFAULT_CATEGORY_ID) return false;

            // 【Bug 8 修复】落点保护：
            // 若目标落点是"默认分类之前"，拒绝本次拖拽移动。
            const relatedCategoryId = event.related
                ? event.related.getAttribute('data-category-id')
                : null;

            if (relatedCategoryId === DEFAULT_CATEGORY_ID && event.willInsertAfter === false) {
                return false;
            }

            return true;
        },
        onEnd: function (event) {
            if (event.oldIndex === undefined || event.newIndex === undefined) return;
            if (event.oldIndex === event.newIndex) return;

            const orderedIds = collectAllCategoryIdsInOrder();
            handlers.onCategoryReorder(orderedIds);
        }
    });

    // ---------- 每个展开分类内部的标签排序 ----------
    const categoryGroupElements = containerElement.querySelectorAll('.category-group');
    categoryGroupElements.forEach(function (groupElement) {
        // 折叠的分类跳过
        if (groupElement.classList.contains('collapsed')) return;

        const categoryId = groupElement.getAttribute('data-category-id');
        if (!categoryId) return;

        const childrenElement = groupElement.querySelector('.category-children');
        if (!childrenElement) return;

        createTagSortableForCategory(categoryId, childrenElement);
    });
}

/**
 * 按 DOM 顺序收集所有分类的 id。
 * @returns {string[]}
 */
function collectAllCategoryIdsInOrder() {
    const orderedIds = [];
    if (!containerElement) return orderedIds;

    const categoryGroups = containerElement.querySelectorAll('.category-group');
    categoryGroups.forEach(function (group) {
        const categoryId = group.getAttribute('data-category-id');
        if (categoryId) orderedIds.push(categoryId);
    });
    return orderedIds;
}

/**
 * 按 DOM 顺序收集所有标签的 id（跳过默认标签）。
 * @returns {string[]}
 */
function collectAllTagIdsInOrder() {
    const orderedIds = [];
    if (!containerElement) return orderedIds;

    const tagItems = containerElement.querySelectorAll('.tag-item');
    tagItems.forEach(function (tagItem) {
        const tagId = tagItem.getAttribute('data-tag-id');
        if (tagId && tagId !== DEFAULT_TAG_ID) {
            orderedIds.push(tagId);
        }
    });
    return orderedIds;
}

// ==================== 侧边栏展开状态同步 ====================

/**
 * 同步侧边栏展开状态到内部 pinnedState 与 CSS 类。
 *
 * @param {boolean} expanded 目标展开状态
 */
export function syncSidebarExpandedState(expanded) {
    const nextExpanded = !!expanded;
    if (pinnedState === nextExpanded) return;

    pinnedState = nextExpanded;

    if (sidebarElement) {
        sidebarElement.classList.toggle('expanded', nextExpanded);
    }
}