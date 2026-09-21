// filename: src/views/sidebar.js
// ========================================================================
// DeepSeek 语句工坊 · 侧边栏视图
// 渲染标签列表、支持 Sortable 拖拽、双击编辑、单击切换、删除
// 通过回调通知外部，不直接操作状态
//
// 【历史调整】
//   删除 restoreSidebarScroll 与 getSidebarScrollTop 两个导出函数。
//   原因：侧边栏滚动位置的保存与恢复由 main.js 中的
//         bindSidebarScrollMemory / restoreSidebarScrollState 全权负责，
//         直接操作 #sidebarTagsList 元素。
//   本模块中的这两个函数从未被任何调用方引用，属死代码，予以删除。
//
// 【本轮重构（第一批）】
//   1. 新增 syncSidebarExpandedState(expanded) 导出：
//      用于把 vault.uiState.sidebarExpanded 的权威值同步到本模块内部的
//      pinnedState 与 CSS 类。
//
//      背景（问题 C）：
//        在导入完整备份或重置全局时，replaceVault 会替换整个 Vault，
//        包含 uiState.sidebarExpanded。原实现中：
//          · pinnedState 仅在 initializeSidebar 时初始化一次
//          · subscribe('ui') 只更新搜索栏与计数，不处理 sidebar 展开态
//        导致"用户在某台设备以展开态导出 → 在另一台设备以收起态导入"后，
//        sidebar 视觉状态与 vault.uiState.sidebarExpanded 数据不一致。
//
//      设计要点：
//        · 值相同时立即返回，是幂等操作
//        · 仅更新 pinnedState 与 CSS 类，不触发 onToggleExpand
//          （避免"同步状态 → dispatch → 再同步"的循环）
//        · 桌面模式下若鼠标恰好悬停，hover 展开的 CSS 由 :hover 规则
//          独立驱动，与 .expanded 类不冲突
//
//   2. 渲染函数、事件绑定、Sortable 逻辑保持原样。
//
// 【历史版本】
//   - 第三批深度审核：本模块无需逻辑修改。
//   - 本次重构：问题 C 修复。
// ========================================================================

import { $, escapeHtml } from '../utils/dom.js';
import { DEFAULT_TAG_ID } from '../constants.js';

let sidebarElement = null;
let sidebarHeader = null;
let containerElement = null;
let addTagButton = null;
let sortableInstance = null;
let isTouchDevice = false;
let handlers = {
    onTagClick: function () {},
    onTagDelete: function () {},
    onTagEdit: function () {},
    onTagReorder: function () {},
    onAddTag: function () {},
    onToggleExpand: function () {}
};
let pinnedState = false;

/**
 * 检测是否为触屏设备
 * @returns {boolean}
 */
function detectTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

/**
 * 初始化侧边栏
 * @param {{
 *   onTagClick: (tagId: string) => void,
 *   onTagDelete: (tagId: string) => void,
 *   onTagEdit: (tagId: string) => void,
 *   onTagReorder: (orderedIds: string[]) => void,
 *   onAddTag: () => void,
 *   onToggleExpand: (expanded: boolean) => void,
 *   initialExpanded: boolean
 * }} options
 */
export function initializeSidebar(options) {
    handlers = Object.assign(handlers, options || {});
    sidebarElement = $('#sidebar');
    sidebarHeader = $('#sidebarHeader');
    containerElement = $('#sidebarTagsList');
    addTagButton = $('#sidebarAddTagBtn');
    isTouchDevice = detectTouchDevice();
    pinnedState = !!options.initialExpanded;

    if (addTagButton) {
        addTagButton.addEventListener('click', function (event) {
            event.stopPropagation();
            handlers.onAddTag();
        });
    }

    bindContainerEvents();
    bindSidebarBehavior();
}

function bindContainerEvents() {
    if (!containerElement) return;
    containerElement.addEventListener('click', function (event) {
        const deleteIcon = event.target.closest('[data-action="deleteTag"]');
        if (deleteIcon) {
            event.stopPropagation();
            const tagId = deleteIcon.getAttribute('data-tag-id');
            if (tagId) handlers.onTagDelete(tagId);
            return;
        }
        const tagItem = event.target.closest('.tag-item');
        if (tagItem) {
            const tagId = tagItem.getAttribute('data-tag-id');
            if (tagId) handlers.onTagClick(tagId);
        }
    });

    containerElement.addEventListener('dblclick', function (event) {
        const tagItem = event.target.closest('.tag-item');
        if (!tagItem) return;
        event.stopPropagation();
        const tagId = tagItem.getAttribute('data-tag-id');
        if (!tagId) return;
        if (tagId === DEFAULT_TAG_ID) return;
        handlers.onTagEdit(tagId);
    });
}

function bindSidebarBehavior() {
    if (!sidebarElement || !sidebarHeader) return;

    if (isTouchDevice) {
        sidebarElement.classList.add('touch-mode');
        if (pinnedState) sidebarElement.classList.add('expanded');
        else sidebarElement.classList.remove('expanded');

        sidebarElement.addEventListener('click', function (event) {
            if (event.target.closest('.delete-tag-icon') ||
                event.target.closest('.add-tag-btn') ||
                event.target.closest('.tag-item')) {
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

/**
 * 渲染侧边栏
 * @param {Object} vault
 */
export function renderSidebar(vault) {
    if (!containerElement) return;

    let html = '';
    const currentTagId = vault.uiState.currentTagId;

    vault.tags.forEach(function (tag) {
        const statementCount = (vault.statementsMap[tag.id] || []).length;
        const isActive = currentTagId === tag.id ? 'active' : '';
        const isDefault = tag.id === DEFAULT_TAG_ID;
        const colorDotStyle = tag.color ? `background:${escapeHtml(tag.color)};` : 'background:#ccc;';
        const iconClass = isDefault ? 'fa-home' : 'fa-tag';
        const deleteHtml = isDefault
            ? '<span style="width:26px;flex-shrink:0;"></span>'
            : `<span class="delete-tag-icon" data-action="deleteTag" data-tag-id="${escapeHtml(tag.id)}" role="button" aria-label="删除标签"><i class="fas fa-times" aria-hidden="true"></i></span>`;

        html += `
            <div class="tag-item ${isActive}"
                 data-tag-id="${escapeHtml(tag.id)}"
                 data-tag-name="${escapeHtml(tag.name)}"
                 data-tag-color="${escapeHtml(tag.color || '')}"
                 role="listitem"
                 tabindex="0">
                <span class="tag-color-dot" style="${colorDotStyle}"></span>
                <i class="fas ${iconClass}" aria-hidden="true"></i>
                <span class="tag-name">${escapeHtml(tag.name)}</span>
                <span class="tag-badge">${statementCount}</span>
                ${deleteHtml}
            </div>
        `;
    });

    containerElement.innerHTML = html;
    initializeSortable();
}

function initializeSortable() {
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
    if (!containerElement || !containerElement.children.length) return;
    if (typeof window.Sortable === 'undefined') return;

    sortableInstance = new window.Sortable(containerElement, {
        animation: 200,
        handle: '.tag-item',
        ghostClass: 'sortable-drag',
        touchStartThreshold: 2,
        onMove: function (event) {
            const draggedTagId = event.dragged.getAttribute('data-tag-id');
            if (draggedTagId === DEFAULT_TAG_ID) return false;
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

            const elements = containerElement.querySelectorAll('.tag-item');
            const orderedIds = [];
            elements.forEach(function (element) {
                const tagId = element.getAttribute('data-tag-id');
                if (tagId && tagId !== DEFAULT_TAG_ID) orderedIds.push(tagId);
            });
            handlers.onTagReorder(orderedIds);
        }
    });
}

/**
 * 同步侧边栏展开状态到内部 pinnedState 与 CSS 类。
 *
 * 【用途】
 *   把 vault.uiState.sidebarExpanded 的权威值同步到本模块的内部状态。
 *   主要调用场景：
 *     · main.js 的 subscribe('ui') 回调（导入 / 重置后 uiState 被替换）
 *
 * 【设计要点】
 *   1. 幂等：值相同时立即返回，无任何副作用。
 *   2. 只更新本地状态与 CSS，不触发 onToggleExpand 回调——
 *      避免"同步 → dispatch → 再同步"的循环。
 *   3. 桌面模式下的 hover 展开由 CSS :hover 规则独立驱动，
 *      与 .expanded 类不冲突，本函数无需感知鼠标位置。
 *   4. 触屏模式下 .expanded 类直接控制展开，本函数的效果与用户
 *      点击 header 切换等价。
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