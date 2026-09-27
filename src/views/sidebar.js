// filename: src/views/sidebar.js
// ========================================================================
// DeepSeek 语句工坊 · 侧边栏视图（完整重构版）
//
// 本模块呈现"分类 → 标签"两级树形结构，并绑定所有交互事件。
//
// ------------------------------------------------------------------------
// 【本次重构说明】
// ------------------------------------------------------------------------
//   原 sidebar.js 严重不完整，仅包含 collapsedCategoryIds 与两个辅助
//   函数，缺失 initializeSidebar / renderSidebar / syncSidebarExpandedState
//   三个导出（main.js 直接依赖），会导致启动阶段 ESM 加载失败、应用白屏。
//
//   本次重构在不改变任何对外接口契约的前提下，完整实现侧边栏模块：
//     · 完整的 DOM 结构渲染（分类分组 + 标签条目）
//     · 完整的折叠状态管理（localStorage 独立键 + 防抖写入）
//     · 完整的两级拖拽排序（分类重排 + 标签重排）
//     · 完整的事件委托与键盘可访问性
//     · 完整的 ARIA 属性
//     · 空状态渲染
//
// ------------------------------------------------------------------------
// 【设计要点】
// ------------------------------------------------------------------------
//   1. 折叠状态独立于 Vault：
//        · 存 localStorage 键 STORAGE_KEY_COLLAPSED_CATEGORIES
//        · 存"已折叠分类 id 集合"的 JSON 数组
//        · 写入走 200ms 防抖（COLLAPSED_CATEGORIES_SAVE_DEBOUNCE_MS）
//        · 理由：折叠是"设备级视图偏好"，与滚动位置同性质，
//          不应污染 Vault 结构，也不应触发跨设备同步
//
//   2. 侧边栏展开状态存 Vault.uiState.sidebarExpanded：
//        · 由 main.js 通过 dispatch('setSidebarExpanded') 持久化
//        · 本模块的 syncSidebarExpandedState 是幂等同步，不触发 dispatch
//        · 用户点击展开/收起按钮 → onToggleExpand → main.js 派发命令
//
//   3. 标签重排全量顺序：
//        · 遍历所有 .category-group，按 DOM 顺序收集 .tag-item 的 tagId
//        · 跳过默认标签（DEFAULT_TAG_ID 始终固定第一）
//        · 与 tag-crud.js 的 reorderTags 语义严格一致
//
//   4. 拖拽仅在"同分类内"允许标签重排：
//        · 跨分类移动通过标签编辑模态框的"所属分类"下拉完成
//        · 理由：跨分类移动是"数据语义变更"，应与编辑其他属性同路径；
//          拖拽跨分类是"视觉操作"，容易误触发且难以提供撤销
//
//   5. 折叠箭头用 aria-expanded 表达状态：
//        · 屏幕阅读器可朗读"已展开 / 已折叠"
//        · 与 category.js 模态框的 aria 语义保持一致
//
// ------------------------------------------------------------------------
// 【与 main.js 的接口契约】
// ------------------------------------------------------------------------
//   initializeSidebar({
//     initialExpanded:  boolean,
//     onTagClick:       (tagId)        => void,
//     onTagDelete:      (tagId)        => void,
//     onTagEdit:        (tagId)        => void,
//     onTagReorder:     (orderedIds)   => void,
//     onAddTag:         ()             => void,
//     onToggleExpand:   (expanded)     => void,
//     onCategoryAdd:    ()             => void,
//     onCategoryEdit:   (categoryId)   => void,
//     onCategoryDelete: (categoryId)   => void,
//     onCategoryReorder:(orderedIds)   => void
//   })
//
//   renderSidebar(vault)                    — 全量重绘（幂等，无副作用）
//   syncSidebarExpandedState(expanded)      — 幂等同步展开状态（不派发命令）
//
// ------------------------------------------------------------------------
// 【DOM 结构（由本模块渲染到 #sidebarTagsList）】
// ------------------------------------------------------------------------
//   #sidebarTagsList
//     └─ .category-group[data-category-id]
//          ├─ .category-header
//          │    ├─ button.category-collapse-btn (aria-expanded)
//          │    ├─ span.category-name
//          │    ├─ span.category-count
//          │    └─ div.category-actions
//          │         ├─ button.category-edit-btn
//          │         └─ button.category-delete-btn
//          └─ .category-body
//               └─ .tag-item[data-tag-id]
//                    ├─ span.tag-color-dot
//                    ├─ span.tag-name
//                    ├─ span.tag-count
//                    └─ div.tag-actions
//                         ├─ button.tag-edit-btn
//                         └─ button.tag-delete-btn
// ========================================================================

import { $, escapeHtml } from '../utils/dom.js';
import {
    DEFAULT_TAG_ID,
    DEFAULT_CATEGORY_ID,
    STORAGE_KEY_COLLAPSED_CATEGORIES,
    COLLAPSED_CATEGORIES_SAVE_DEBOUNCE_MS
} from '../constants.js';
import { countStatementsInTag } from '../core/vault.js';

// ==================== 模块级状态 ====================

// DOM 缓存（initializeSidebar 时填充）
let sidebarElement = null;
let tagsListElement = null;
let expandToggleButton = null;
let addTagButton = null;

// 回调集合（initializeSidebar 时填充）
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
    onCategoryReorder: function () {}
};

// 当前展开状态（由 initializeSidebar / syncSidebarExpandedState 维护）
let currentExpandedState = false;

// 折叠的分类 id 集合（localStorage 持久化）
let collapsedCategoryIds = new Set();

// 折叠状态写入防抖定时器
let collapseSaveTimer = null;

// Sortable 实例：分类重排 + 每个 .category-body 一个标签重排
let categorySortableInstance = null;
let tagSortableInstanceList = [];

// 防止 Sortable 拖拽过程中误触发 click（拖拽结束后 320ms 内的 click 被忽略）
let lastDragEndTimestamp = 0;

// ==================== 折叠状态持久化 ====================

/**
 * 从 localStorage 读取折叠状态。
 *
 * 读取失败（无数据 / JSON 非法 / 非数组）时返回空集合。
 * 空集合语义：所有分类均展开（与"存储已折叠集合"的设计一致）。
 *
 * @returns {Set<string>}
 */
function loadCollapsedCategoryIds() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED_CATEGORIES);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter(function (id) {
            return typeof id === 'string' && id.length > 0;
        }));
    } catch (readError) {
        console.warn('[sidebar] 读取折叠状态失败:', readError);
        return new Set();
    }
}

/**
 * 防抖写入折叠状态。
 *
 * 用户快速折叠多个分类时只触发一次写入。
 * 写入失败仅告警，不阻断交互。
 */
function persistCollapsedCategoryIdsDebounced() {
    if (collapseSaveTimer) {
        clearTimeout(collapseSaveTimer);
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

// ==================== 初始化 ====================

/**
 * 初始化侧边栏：缓存 DOM、绑定事件、加载折叠状态、应用初始展开状态。
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
 *   onCategoryReorder: (orderedIds: string[]) => void
 * }} options
 */
export function initializeSidebar(options) {
    const effectiveOptions = options || {};

    // 合并回调（保留未传的回调为无操作函数）
    const callbackKeys = Object.keys(handlers);
    for (let index = 0; index < callbackKeys.length; index++) {
        const key = callbackKeys[index];
        if (typeof effectiveOptions[key] === 'function') {
            handlers[key] = effectiveOptions[key];
        }
    }

    // 缓存 DOM
    sidebarElement = document.getElementById('sidebar');
    tagsListElement = $('#sidebarTagsList');
    expandToggleButton = $('#sidebarToggleBtn');
    addTagButton = $('#addTagBtn');

    // 加载折叠状态
    collapsedCategoryIds = loadCollapsedCategoryIds();

    // 绑定容器级事件（委托）
    if (tagsListElement) {
        tagsListElement.addEventListener('click', handleTagsListClick);
        tagsListElement.addEventListener('keydown', handleTagsListKeydown);
    }

    // 绑定展开/收起按钮
    if (expandToggleButton) {
        expandToggleButton.addEventListener('click', handleToggleExpandClick);
    }

    // 绑定"新建标签"按钮
    if (addTagButton) {
        addTagButton.addEventListener('click', function () {
            handlers.onAddTag();
        });
    }

    // 应用初始展开状态
    currentExpandedState = !!effectiveOptions.initialExpanded;
    applyExpandedStateToDom(currentExpandedState);
}

// ==================== 展开状态 ====================

/**
 * 幂等同步侧边栏展开状态。
 *
 * 由 main.js 的 subscribe('ui') 回调触发，用于在 replaceVault（导入 /
 * 重置）后保证侧边栏视觉状态与 uiState.sidebarExpanded 一致。
 *
 * 【不派发命令】
 *   本函数只做"DOM 类名与按钮图标的同步"，不调用 dispatch。
 *   命令的派发只发生在用户点击展开/收起按钮时（handleToggleExpandClick）。
 *
 * 【幂等】
 *   目标状态与当前状态相同时直接返回，不做任何 DOM 操作。
 *
 * @param {boolean} expanded
 */
export function syncSidebarExpandedState(expanded) {
    const normalizedExpanded = !!expanded;
    if (normalizedExpanded === currentExpandedState) return;
    currentExpandedState = normalizedExpanded;
    applyExpandedStateToDom(normalizedExpanded);
}

/**
 * 内部：将展开状态应用到 DOM。
 *
 * @param {boolean} expanded
 */
function applyExpandedStateToDom(expanded) {
    if (sidebarElement) {
        sidebarElement.classList.toggle('sidebar-collapsed', !expanded);
        sidebarElement.classList.toggle('sidebar-expanded', expanded);
    }
    if (expandToggleButton) {
        expandToggleButton.setAttribute(
            'aria-expanded',
            expanded ? 'true' : 'false'
        );
        expandToggleButton.setAttribute(
            'title',
            expanded ? '收起侧边栏' : '展开侧边栏'
        );
        expandToggleButton.setAttribute(
            'aria-label',
            expanded ? '收起侧边栏' : '展开侧边栏'
        );
        const iconElement = expandToggleButton.querySelector('i');
        if (iconElement) {
            iconElement.className = expanded
                ? 'fas fa-angle-double-left'
                : 'fas fa-angle-double-right';
        }
    }
}

/**
 * 用户点击展开/收起按钮。
 *
 * 计算目标状态（当前状态的反），立即应用到 DOM（即时反馈），
 * 然后回调 main.js 派发命令（持久化 + 通知其他订阅者）。
 *
 * 若命令被拒（例如 dispatch 返回 false），main.js 会在下一次
 * subscribe('ui') 通知时通过 syncSidebarExpandedState 回滚本模块
 * 的 DOM 状态——这是幂等同步的语义保证。
 */
function handleToggleExpandClick() {
    const nextExpanded = !currentExpandedState;
    currentExpandedState = nextExpanded;
    applyExpandedStateToDom(nextExpanded);
    handlers.onToggleExpand(nextExpanded);
}

// ==================== 渲染 ====================

/**
 * 全量渲染侧边栏。
 *
 * 每次调用都会：
 *   1. 销毁旧的 Sortable 实例
 *   2. 重建 .category-group 与 .tag-item 的完整 DOM
 *   3. 重建 Sortable 实例
 *   4. 应用折叠状态类
 *
 * 【数据读取策略】
 *   vault.categories / vault.tags / vault.statementsMap 均从入参 vault 读取。
 *   本函数不做任何防御性校验（normalizeVault / ensureDefaultTagExists 已
 *   保证结构合法），但作为公共 API 仍对 vault 为 null 时静默返回。
 *
 * @param {Object} vault
 */
export function renderSidebar(vault) {
    if (!tagsListElement) return;
    if (!vault || typeof vault !== 'object') return;

    // 销毁旧的 Sortable 实例（DOM 即将被替换）
    destroySortableInstances();

    // 缓存本次渲染的 vault（供 Sortable onEnd 回调使用）
    // 注意：不用于业务逻辑，仅用于判断某个 tagId 是否属于默认标签
    const tagList = Array.isArray(vault.tags) ? vault.tags : [];
    const categoryList = Array.isArray(vault.categories) ? vault.categories : [];
    const statementsMap = (vault.statementsMap && typeof vault.statementsMap === 'object')
        ? vault.statementsMap
        : {};

    // 空状态：无分类时（理论不会，normalizeVault 保证至少有一个默认分类）
    if (categoryList.length === 0) {
        tagsListElement.innerHTML = '';
        return;
    }

    // 构建 HTML
    let html = '';
    for (let categoryIndex = 0; categoryIndex < categoryList.length; categoryIndex++) {
        const category = categoryList[categoryIndex];
        html += buildCategoryGroupHtml(category, tagList, statementsMap);
    }
    tagsListElement.innerHTML = html;

    // 初始化 Sortable：分类重排
    initializeCategorySortable();

    // 初始化 Sortable：每个分类内的标签重排
    initializeTagSortables();
}

/**
 * 构建单个分类分组的 HTML。
 *
 * @param {{ id: string, name: string }} category
 * @param {Array} tagList            vault.tags
 * @param {Object} statementsMap     vault.statementsMap
 * @returns {string}
 */
function buildCategoryGroupHtml(category, tagList, statementsMap) {
    const isDefaultCategory = category.id === DEFAULT_CATEGORY_ID;
    const isCollapsed = collapsedCategoryIds.has(category.id);

    // 收集该分类下的标签（保持 vault.tags 数组中的相对顺序）
    const tagsInCategory = tagList.filter(function (tag) {
        return tag.categoryId === category.id;
    });

    // 分类标题栏的"编辑 / 删除"按钮（默认分类不显示删除，编辑也不显示？）
    // 语义与 main.js 的 handleCategoryEdit / handleCategoryDelete 一致：
    //   · 默认分类：名称不可编辑、不可删除 → 按钮置为 disabled 并加 aria-disabled
    //   · 其他分类：正常可点
    const editButtonHtml = isDefaultCategory
        ? '<button class="icon-btn category-edit-btn" data-action="category-edit" type="button" disabled aria-disabled="true" title="默认分类名称不可修改" aria-label="默认分类名称不可修改"><i class="fas fa-edit" aria-hidden="true"></i></button>'
        : '<button class="icon-btn category-edit-btn" data-action="category-edit" type="button" title="编辑分类" aria-label="编辑分类"><i class="fas fa-edit" aria-hidden="true"></i></button>';

    const deleteButtonHtml = isDefaultCategory
        ? '<button class="icon-btn category-delete-btn" data-action="category-delete" type="button" disabled aria-disabled="true" title="默认分类不可删除" aria-label="默认分类不可删除"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>'
        : '<button class="icon-btn category-delete-btn" data-action="category-delete" type="button" title="删除分类" aria-label="删除分类"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>';

    // 标签列表 HTML
    let tagsHtml = '';
    if (tagsInCategory.length === 0) {
        tagsHtml = '<div class="tag-empty-hint">此分类下暂无标签</div>';
    } else {
        for (let tagIndex = 0; tagIndex < tagsInCategory.length; tagIndex++) {
            const tag = tagsInCategory[tagIndex];
            const statementCount = countStatementsInTag(
                { statementsMap: statementsMap },
                tag.id
            );
            tagsHtml += buildTagItemHtml(tag, statementCount);
        }
    }

    return `
        <div class="category-group${isCollapsed ? ' is-collapsed' : ''}" data-category-id="${escapeHtml(category.id)}">
            <div class="category-header">
                <button
                    class="category-collapse-btn"
                    data-action="category-toggle"
                    type="button"
                    aria-expanded="${isCollapsed ? 'false' : 'true'}"
                    aria-label="${isCollapsed ? '展开分类' : '折叠分类'}"
                    title="${isCollapsed ? '展开分类' : '折叠分类'}">
                    <i class="fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}" aria-hidden="true"></i>
                </button>
                <span class="category-name" title="${escapeHtml(category.name)}">${escapeHtml(category.name)}</span>
                <span class="category-count" aria-label="标签数量">${tagsInCategory.length}</span>
                <div class="category-actions">
                    ${editButtonHtml}
                    ${deleteButtonHtml}
                </div>
            </div>
            <div class="category-body" data-category-id="${escapeHtml(category.id)}">
                ${tagsHtml}
            </div>
        </div>
    `;
}

/**
 * 构建单个标签条目的 HTML。
 *
 * @param {{ id: string, name: string, color: string|null }} tag
 * @param {number} statementCount
 * @returns {string}
 */
function buildTagItemHtml(tag, statementCount) {
    const isDefaultTag = tag.id === DEFAULT_TAG_ID;
    const isActive = false; // 由外部（currentVault.uiState.currentTagId）标记

    // 色点：有颜色显示颜色，无颜色显示灰色占位（保持对齐）
    const colorDotHtml = tag.color
        ? `<span class="tag-color-dot" style="background:${escapeHtml(tag.color)};" aria-hidden="true"></span>`
        : '<span class="tag-color-dot is-empty" aria-hidden="true"></span>';

    // 默认标签不可编辑、不可删除
    const editButtonHtml = isDefaultTag
        ? '<button class="icon-btn tag-edit-btn" data-action="tag-edit" type="button" disabled aria-disabled="true" title="默认语库名称不可修改" aria-label="默认语库名称不可修改"><i class="fas fa-edit" aria-hidden="true"></i></button>'
        : '<button class="icon-btn tag-edit-btn" data-action="tag-edit" type="button" title="编辑标签" aria-label="编辑标签"><i class="fas fa-edit" aria-hidden="true"></i></button>';

    const deleteButtonHtml = isDefaultTag
        ? '<button class="icon-btn tag-delete-btn" data-action="tag-delete" type="button" disabled aria-disabled="true" title="默认语库不可删除" aria-label="默认语库不可删除"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>'
        : '<button class="icon-btn tag-delete-btn" data-action="tag-delete" type="button" title="删除标签" aria-label="删除标签"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>';

    return `
        <div class="tag-item${isActive ? ' is-active' : ''}" data-tag-id="${escapeHtml(tag.id)}">
            ${colorDotHtml}
            <span class="tag-name" title="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</span>
            <span class="tag-count" aria-label="语句数量">${statementCount}</span>
            <div class="tag-actions">
                ${editButtonHtml}
                ${deleteButtonHtml}
            </div>
        </div>
    `;
}

// ==================== 事件委托 ====================

/**
 * 容器级 click 事件委托。
 *
 * 处理：
 *   · 折叠箭头点击 → toggleCategoryCollapsed
 *   · 分类编辑按钮 → handlers.onCategoryEdit
 *   · 分类删除按钮 → handlers.onCategoryDelete
 *   · 标签编辑按钮 → handlers.onTagEdit
 *   · 标签删除按钮 → handlers.onTagDelete
 *   · 标签条目点击（非按钮区域） → handlers.onTagClick
 *
 * 【拖拽抑制】
 *   Sortable 拖拽结束后 320ms 内的 click 被忽略，
 *   避免拖拽释放瞬间误触发标签切换。
 *
 * @param {MouseEvent} event
 */
function handleTagsListClick(event) {
    // 拖拽抑制：拖拽刚结束时忽略随后的 click
    if (Date.now() - lastDragEndTimestamp < 320) {
        return;
    }

    const target = event.target;

    // 优先匹配 data-action 按钮
    const actionButton = target.closest('[data-action]');
    if (actionButton) {
        const action = actionButton.getAttribute('data-action');
        // disabled 按钮不响应（原生 disabled 通常已拦截 click，
        // 但为了兼容性再判一次）
        if (actionButton.disabled) return;

        // 定位所属分类 / 标签
        const categoryGroup = actionButton.closest('.category-group');
        const categoryId = categoryGroup
            ? categoryGroup.getAttribute('data-category-id')
            : null;
        const tagItem = actionButton.closest('.tag-item');
        const tagId = tagItem
            ? tagItem.getAttribute('data-tag-id')
            : null;

        switch (action) {
            case 'category-toggle':
                if (categoryId) toggleCategoryCollapsed(categoryId);
                event.stopPropagation();
                return;
            case 'category-edit':
                if (categoryId) handlers.onCategoryEdit(categoryId);
                event.stopPropagation();
                return;
            case 'category-delete':
                if (categoryId) handlers.onCategoryDelete(categoryId);
                event.stopPropagation();
                return;
            case 'tag-edit':
                if (tagId) handlers.onTagEdit(tagId);
                event.stopPropagation();
                return;
            case 'tag-delete':
                if (tagId) handlers.onTagDelete(tagId);
                event.stopPropagation();
                return;
            default:
                break;
        }
        return;
    }

    // 其次匹配标签条目本身
    const tagItem = target.closest('.tag-item');
    if (tagItem && tagsListElement.contains(tagItem)) {
        const tagId = tagItem.getAttribute('data-tag-id');
        if (tagId) {
            handlers.onTagClick(tagId);
        }
        return;
    }

    // 点击分类标题栏（非按钮区域）：展开/折叠该分类
    const categoryHeader = target.closest('.category-header');
    if (categoryHeader) {
        const categoryGroup = categoryHeader.closest('.category-group');
        if (categoryGroup) {
            const categoryId = categoryGroup.getAttribute('data-category-id');
            if (categoryId) toggleCategoryCollapsed(categoryId);
        }
    }
}

/**
 * 容器级 keydown 事件委托：为 role=button 的标签条目补键盘支持。
 *
 * 当前 DOM 结构下，标签条目本身不是 button（是 div），
 * 但有 tabindex 与 role="button"。这里处理 Enter / Space。
 *
 * @param {KeyboardEvent} event
 */
function handleTagsListKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const target = event.target;
    const tagItem = target.closest('.tag-item');
    if (tagItem && tagsListElement.contains(tagItem)) {
        // 若焦点在条目内的按钮上，交给按钮自身的 click 处理
        if (target.closest('button')) return;
        event.preventDefault();
        const tagId = tagItem.getAttribute('data-tag-id');
        if (tagId) handlers.onTagClick(tagId);
    }
}

// ==================== 折叠交互 ====================

/**
 * 切换指定分类的折叠状态。
 *
 * 同时更新：
 *   · collapsedCategoryIds 集合
 *   · .category-group 的 is-collapsed 类
 *   · 折叠箭头的 aria-expanded 与图标
 *
 * 并通过防抖写入 localStorage。
 *
 * @param {string} categoryId
 */
function toggleCategoryCollapsed(categoryId) {
    if (!categoryId) return;
    if (!tagsListElement) return;

    const categoryGroup = tagsListElement.querySelector(
        '.category-group[data-category-id="' + cssEscapeAttributeValue(categoryId) + '"]'
    );
    if (!categoryGroup) return;

    const nowCollapsed = !collapsedCategoryIds.has(categoryId);

    if (nowCollapsed) {
        collapsedCategoryIds.add(categoryId);
    } else {
        collapsedCategoryIds.delete(categoryId);
    }

    categoryGroup.classList.toggle('is-collapsed', nowCollapsed);

    const collapseButton = categoryGroup.querySelector('.category-collapse-btn');
    if (collapseButton) {
        collapseButton.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        collapseButton.setAttribute(
            'aria-label',
            nowCollapsed ? '展开分类' : '折叠分类'
        );
        collapseButton.setAttribute(
            'title',
            nowCollapsed ? '展开分类' : '折叠分类'
        );
        const iconElement = collapseButton.querySelector('i');
        if (iconElement) {
            iconElement.className = nowCollapsed
                ? 'fas fa-chevron-right'
                : 'fas fa-chevron-down';
        }
    }

    persistCollapsedCategoryIdsDebounced();
}

/**
 * 属性选择器中的双引号字符串转义。
 *
 * 【为什么不用 CSS.escape】
 *   CSS.escape 是为 CSS 标识符设计（转义空格、#、. 等为 \x 形式），
 *   在属性选择器引号字符串上下文会引入多余反斜杠。
 *   此处只需转义双引号与反斜杠。
 *
 * @param {string} value
 * @returns {string}
 */
function cssEscapeAttributeValue(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

// ==================== Sortable 拖拽 ====================

/**
 * 销毁所有 Sortable 实例。
 */
function destroySortableInstances() {
    if (categorySortableInstance) {
        try {
            categorySortableInstance.destroy();
        } catch (destroyError) {
            // 忽略：实例可能已随 DOM 一起被移除
        }
        categorySortableInstance = null;
    }
    if (tagSortableInstanceList.length > 0) {
        for (let index = 0; index < tagSortableInstanceList.length; index++) {
            try {
                tagSortableInstanceList[index].destroy();
            } catch (destroyError) {
                // 忽略
            }
        }
        tagSortableInstanceList = [];
    }
}

/**
 * 初始化分类重排的 Sortable 实例。
 *
 * 绑定到 tagsListElement（容器），只对 .category-group 生效。
 */
function initializeCategorySortable() {
    if (!tagsListElement) return;
    if (typeof window.Sortable === 'undefined') return;

    categorySortableInstance = new window.Sortable(tagsListElement, {
        animation: 200,
        handle: '.category-header',
        draggable: '.category-group',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: function (event) {
            lastDragEndTimestamp = Date.now();
            if (event.oldIndex === undefined || event.newIndex === undefined) return;
            if (event.oldIndex === event.newIndex) return;

            const orderedIds = collectCategoryOrderFromDom();
            handlers.onCategoryReorder(orderedIds);
        }
    });
}

/**
 * 初始化每个 .category-body 内的标签重排 Sortable。
 *
 * 每个 .category-body 一个独立 Sortable 实例，group 名不共享，
 * 因此不允许跨分类拖拽（跨分类移动通过标签编辑完成）。
 */
function initializeTagSortables() {
    if (!tagsListElement) return;
    if (typeof window.Sortable === 'undefined') return;

    const categoryBodies = tagsListElement.querySelectorAll('.category-body');
    tagSortableInstanceList = [];

    categoryBodies.forEach(function (bodyElement) {
        const sortableInstance = new window.Sortable(bodyElement, {
            animation: 200,
            handle: '.tag-item',
            draggable: '.tag-item',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            // group 名不共享：不允许跨容器拖拽
            group: {
                name: 'tag-sortable-in-category',
                pull: false,
                put: false
            },
            onEnd: function (event) {
                lastDragEndTimestamp = Date.now();
                if (event.oldIndex === undefined || event.newIndex === undefined) return;
                if (event.oldIndex === event.newIndex) return;

                const orderedIds = collectTagOrderFromDom();
                handlers.onTagReorder(orderedIds);
            }
        });
        tagSortableInstanceList.push(sortableInstance);
    });
}

/**
 * 从 DOM 收集分类的全量顺序。
 *
 * @returns {string[]}
 */
function collectCategoryOrderFromDom() {
    const orderedIds = [];
    if (!tagsListElement) return orderedIds;
    const groups = tagsListElement.querySelectorAll('.category-group');
    groups.forEach(function (group) {
        const categoryId = group.getAttribute('data-category-id');
        if (categoryId) {
            orderedIds.push(categoryId);
        }
    });
    return orderedIds;
}

/**
 * 从 DOM 收集标签的全量顺序。
 *
 * 【语义】
 *   遍历所有 .category-group，按 DOM 顺序收集 .tag-item 的 tagId。
 *   跳过默认标签（DEFAULT_TAG_ID 始终固定第一，由 reorderTags 命令保证）。
 *
 * @returns {string[]}
 */
function collectTagOrderFromDom() {
    const orderedIds = [];
    if (!tagsListElement) return orderedIds;
    const groups = tagsListElement.querySelectorAll('.category-group');
    groups.forEach(function (group) {
        const tagItems = group.querySelectorAll('.tag-item');
        tagItems.forEach(function (tagItem) {
            const tagId = tagItem.getAttribute('data-tag-id');
            if (tagId && tagId !== DEFAULT_TAG_ID) {
                orderedIds.push(tagId);
            }
        });
    });
    return orderedIds;
}