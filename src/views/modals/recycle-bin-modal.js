// filename: src/views/modals/recycle-bin-modal.js
// ========================================================================
// DeepSeek 语句工坊 · 回收站面板模态框
//
// 【方案 A 收尾（上一轮）】
//   新建本模块，配套软删除语义。
//
//   职责划分（重要）：
//     本模块只负责"呈现 + 交互收集"，不执行业务操作。
//     所有恢复 / 彻底删除 / 清空的业务逻辑都交由 main.js 提供的
//     handlers 处理，本模块在操作完成后调用 getItems() 重新拉取
//     最新数据并重绘。
//
//   数据流：
//     openRecycleBinModal({
//       getItems: () => vault.recycleBin,        ← 拉取最新数据
//       handlers: {
//         onRestoreSingle(binId)        → Promise<boolean|void>,
//         onRestoreBatch(binIds)        → Promise<boolean|void>,
//         onPurgeSingle(binId)          → Promise<boolean|void>,
//         onPurgeBatch(binIds)          → Promise<boolean|void>,
//         onClearAll()                  → Promise<boolean|void>
//       }
//     })
//
//     每次操作完成后，本模块重新调用 getItems() 并重绘。
//     这样可以避免"面板内数据与 vault 不同步"的经典问题——
//     因为权威数据源永远是 vault，而非面板内部缓存。
//
//   UI 结构：
//     ┌─ 回收站 ──────────────────────────────────┐
//     │ [全选] [批量恢复] [批量彻底删除] [清空]    │
//     │                            共 N 条 已选 M │
//     ├──────────────────────────────────────────┤
//     │ [☐] [标签徽章] 3 分钟前     [恢复] [×]    │
//     │     语句文本...                          │
//     ├──────────────────────────────────────────┤
//     │ ...                                      │
//     ├──────────────────────────────────────────┤
//     │                              [关闭]      │
//     └──────────────────────────────────────────┘
//
//   单条操作不进入全局选中集：
//     单条"恢复"与"彻底删除"直接触发对应 handler；
//     批量操作才依赖 selectedIds。
//
// 【本轮重构（第一批）】
//   问题 B（批量恢复被取消时选中集被清空）：
//     原实现：
//       try {
//           await currentHandlers.onRestoreBatch(binIds);
//       } finally {
//           selectedIds.clear();
//           renderAll();
//       }
//
//     但 main.js 中 handleRecycleRestoreBatch 在"用户取消选择目标标签"
//     时直接 return，不执行任何操作。此时 modal 层的 finally 无条件
//     selectedIds.clear() 会把用户的勾选清空，与单条恢复的行为
//     （不清空）不一致，用户需要重新选择。
//
//     修复策略：
//       · 明确 handler 的返回语义：返回 false 表示"用户主动取消，
//         未执行任何操作"；返回其他值表示操作已执行（可能部分成功）。
//       · 本模块据返回值决定是否清空选中集。
//       · renderAll() 仍在 finally 中执行，确保列表与数据同步
//         （过期清理等操作可能在外部发生）。
//
//     同时对齐 handlePurgeBatchClick 与 handleClearAllClick。
//
// 【历史版本】
//   - 第四批深度审核：本模块无需逻辑修改。
//   - 本次重构：问题 B 修复（批量操作返回值语义）。
// ========================================================================

import {
    RECYCLE_BIN_MODAL_FOCUS_DELAY_MS
} from '../../constants.js';
import { renderRecycleItem } from '../recycle-card.js';

let modalElement = null;
let listElement = null;
let toolbarSelectAllButton = null;
let toolbarRestoreBatchButton = null;
let toolbarPurgeBatchButton = null;
let toolbarClearAllButton = null;
let toolbarCountLabel = null;
let closeButton = null;

let currentResolve = null;
let getItemsFunction = null;
let currentHandlers = null;
let selectedIds = new Set();
let lastFocusedElement = null;

// ==================== DOM 构造 ====================

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'recycleBinModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3>
                <i class="fas fa-trash-alt" aria-hidden="true"></i> 回收站
            </h3>
            <div class="recycle-bin-toolbar">
                <button class="btn btn-outline" id="recycleSelectAllBtn" type="button">
                    <i class="fas fa-check-square" aria-hidden="true"></i> 全选
                </button>
                <button class="btn btn-outline" id="recycleRestoreBatchBtn" type="button">
                    <i class="fas fa-undo" aria-hidden="true"></i> 批量恢复
                </button>
                <button class="btn btn-outline" id="recyclePurgeBatchBtn" type="button">
                    <i class="fas fa-trash-alt" aria-hidden="true"></i> 批量彻底删除
                </button>
                <button class="btn btn-outline" id="recycleClearAllBtn" type="button">
                    <i class="fas fa-broom" aria-hidden="true"></i> 清空回收站
                </button>
                <span class="recycle-bin-count" id="recycleBinCountLabel"></span>
            </div>
            <div class="recycle-bin-list" id="recycleBinList" role="list"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" id="recycleBinCloseBtn" type="button">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

// ==================== 生命周期 ====================

function cleanup() {
    if (!modalElement) return;
    modalElement.style.display = 'none';

    if (closeButton) {
        closeButton.removeEventListener('click', handleClose);
    }
    if (toolbarSelectAllButton) {
        toolbarSelectAllButton.removeEventListener('click', handleSelectAllClick);
    }
    if (toolbarRestoreBatchButton) {
        toolbarRestoreBatchButton.removeEventListener('click', handleRestoreBatchClick);
    }
    if (toolbarPurgeBatchButton) {
        toolbarPurgeBatchButton.removeEventListener('click', handlePurgeBatchClick);
    }
    if (toolbarClearAllButton) {
        toolbarClearAllButton.removeEventListener('click', handleClearAllClick);
    }
    modalElement.removeEventListener('click', handleBackdropClick);

    if (listElement) {
        listElement.removeEventListener('click', handleListClick);
        listElement.removeEventListener('change', handleListChange);
        listElement.innerHTML = '';
    }

    getItemsFunction = null;
    currentHandlers = null;
    selectedIds.clear();
}

/**
 * 恢复焦点到打开面板前的触发元素
 */
function restoreFocus() {
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        try {
            lastFocusedElement.focus();
        } catch (focusError) {
            // 忽略：触发元素可能已从 DOM 移除
        }
    }
    lastFocusedElement = null;
}

function handleClose() {
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    restoreFocus();
    if (resolver) resolver();
}

function handleBackdropClick(event) {
    if (event.target === modalElement) {
        handleClose();
    }
}

// ==================== 数据拉取与渲染 ====================

/**
 * 从 getItemsFunction 拉取最新条目
 * @returns {Array}
 */
function getCurrentItems() {
    if (typeof getItemsFunction !== 'function') return [];
    const items = getItemsFunction();
    return Array.isArray(items) ? items : [];
}

/**
 * 重绘列表与工具栏
 *
 * 【关键设计】
 *   每次操作完成后都重新拉取"权威数据源"（vault.recycleBin）
 *   并同步选中集，确保 UI 与数据强一致。
 */
function renderAll() {
    if (!listElement) return;

    const items = getCurrentItems();
    const existingIds = new Set();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        existingIds.add(items[itemIndex].id);
    }

    // 清理已不存在的选中项（例如被恢复 / 被彻底删除 / 被过期清理）
    for (const selectedId of Array.from(selectedIds)) {
        if (!existingIds.has(selectedId)) {
            selectedIds.delete(selectedId);
        }
    }

    // 列表内容
    if (items.length === 0) {
        listElement.innerHTML = `
            <div class="empty-state recycle-bin-empty">
                <i class="fas fa-trash-alt" aria-hidden="true"></i>
                <p>回收站是空的</p>
            </div>
        `;
    } else {
        let html = '';
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            html += renderRecycleItem(item, {
                isChecked: selectedIds.has(item.id)
            });
        }
        listElement.innerHTML = html;
    }

    // 工具栏状态
    updateToolbarState(items.length);
}

/**
 * 更新工具栏按钮与计数
 * @param {number} totalCount
 */
function updateToolbarState(totalCount) {
    const selectedCount = selectedIds.size;
    const hasItems = totalCount > 0;
    const hasSelection = selectedCount > 0;

    if (toolbarCountLabel) {
        if (hasItems) {
            toolbarCountLabel.textContent =
                '共 ' + totalCount + ' 条，已选 ' + selectedCount + ' 条';
        } else {
            toolbarCountLabel.textContent = '';
        }
    }

    if (toolbarRestoreBatchButton) {
        toolbarRestoreBatchButton.disabled = !hasSelection;
    }
    if (toolbarPurgeBatchButton) {
        toolbarPurgeBatchButton.disabled = !hasSelection;
    }
    if (toolbarClearAllButton) {
        toolbarClearAllButton.disabled = !hasItems;
    }

    if (toolbarSelectAllButton) {
        if (!hasItems) {
            toolbarSelectAllButton.disabled = true;
            toolbarSelectAllButton.innerHTML =
                '<i class="fas fa-check-square" aria-hidden="true"></i> 全选';
        } else if (selectedCount === totalCount) {
            toolbarSelectAllButton.disabled = false;
            toolbarSelectAllButton.innerHTML =
                '<i class="fas fa-square" aria-hidden="true"></i> 取消全选';
        } else {
            toolbarSelectAllButton.disabled = false;
            toolbarSelectAllButton.innerHTML =
                '<i class="fas fa-check-square" aria-hidden="true"></i> 全选';
        }
    }
}

// ==================== 列表交互 ====================

/**
 * 列表区复选框变更
 * 使用 change 事件（而非 click），以正确响应键盘操作与程序化修改
 * @param {Event} event
 */
function handleListChange(event) {
    const checkbox = event.target.closest('.recycle-item-checkbox');
    if (!checkbox) return;

    const binId = checkbox.getAttribute('data-id');
    if (!binId) return;

    if (checkbox.checked) {
        selectedIds.add(binId);
    } else {
        selectedIds.delete(binId);
    }

    updateToolbarState(getCurrentItems().length);
}

/**
 * 列表区按钮点击（恢复 / 彻底删除）
 * @param {MouseEvent} event
 */
function handleListClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    event.stopPropagation();

    const action = actionButton.getAttribute('data-action');
    const binId = actionButton.getAttribute('data-id');
    if (!binId) return;

    switch (action) {
        case 'restore':
            handleRestoreSingleClick(binId);
            break;
        case 'purge':
            handlePurgeSingleClick(binId);
            break;
        default:
            break;
    }
}

/**
 * 单条恢复
 * @param {string} binId
 */
async function handleRestoreSingleClick(binId) {
    if (!currentHandlers || typeof currentHandlers.onRestoreSingle !== 'function') {
        return;
    }
    try {
        await currentHandlers.onRestoreSingle(binId);
    } finally {
        // 单条操作不影响全局选中集，只刷新列表即可
        renderAll();
    }
}

/**
 * 单条彻底删除
 * @param {string} binId
 */
async function handlePurgeSingleClick(binId) {
    if (!currentHandlers || typeof currentHandlers.onPurgeSingle !== 'function') {
        return;
    }
    try {
        await currentHandlers.onPurgeSingle(binId);
    } finally {
        renderAll();
    }
}

// ==================== 工具栏交互 ====================

/**
 * 全选 / 取消全选
 */
function handleSelectAllClick() {
    const items = getCurrentItems();
    if (items.length === 0) return;

    const allSelected = items.every(function (item) {
        return selectedIds.has(item.id);
    });

    if (allSelected) {
        selectedIds.clear();
    } else {
        selectedIds = new Set(items.map(function (item) {
            return item.id;
        }));
    }

    renderAll();
}

/**
 * 批量恢复
 *
 * 【本轮重构 · 问题 B】
 *   handler 返回 false 表示"用户主动取消，未执行任何操作"。
 *   此时应保留用户的选中集，让用户可以直接重新选择目标标签，
 *   而无需重新勾选。
 *
 *   renderAll() 仍在 finally 中执行，处理"外部数据变化"的边界情况
 *   （例如打开面板期间条目被自动过期清理）。
 */
async function handleRestoreBatchClick() {
    if (selectedIds.size === 0) return;
    if (!currentHandlers || typeof currentHandlers.onRestoreBatch !== 'function') {
        return;
    }

    const binIds = Array.from(selectedIds);
    let shouldClearSelection = true;

    try {
        const handlerResult = await currentHandlers.onRestoreBatch(binIds);
        // 显式返回 false：用户取消，保留选中集
        if (handlerResult === false) {
            shouldClearSelection = false;
        }
    } finally {
        if (shouldClearSelection) {
            selectedIds.clear();
        }
        renderAll();
    }
}

/**
 * 批量彻底删除
 *
 * 【本轮重构】对齐问题 B 修复：用户在确认框中取消时保留选中集。
 */
async function handlePurgeBatchClick() {
    if (selectedIds.size === 0) return;
    if (!currentHandlers || typeof currentHandlers.onPurgeBatch !== 'function') {
        return;
    }

    const binIds = Array.from(selectedIds);
    let shouldClearSelection = true;

    try {
        const handlerResult = await currentHandlers.onPurgeBatch(binIds);
        if (handlerResult === false) {
            shouldClearSelection = false;
        }
    } finally {
        if (shouldClearSelection) {
            selectedIds.clear();
        }
        renderAll();
    }
}

/**
 * 清空回收站
 *
 * 【本轮重构】对齐问题 B 修复：用户在确认框中取消时保留选中集。
 */
async function handleClearAllClick() {
    if (!currentHandlers || typeof currentHandlers.onClearAll !== 'function') {
        return;
    }

    let shouldClearSelection = true;

    try {
        const handlerResult = await currentHandlers.onClearAll();
        if (handlerResult === false) {
            shouldClearSelection = false;
        }
    } finally {
        if (shouldClearSelection) {
            selectedIds.clear();
        }
        renderAll();
    }
}

// ==================== 对外接口 ====================

/**
 * 打开回收站面板
 *
 * @param {{
 *   getItems: () => Array,
 *   handlers: {
 *     onRestoreSingle: (binId: string) => Promise<void>|void,
 *     onRestoreBatch: (binIds: string[]) => Promise<boolean|void>|boolean|void,
 *     onPurgeSingle: (binId: string) => Promise<void>|void,
 *     onPurgeBatch: (binIds: string[]) => Promise<boolean|void>|boolean|void,
 *     onClearAll: () => Promise<boolean|void>|boolean|void
 *   }
 * }} options
 * @returns {Promise<void>} 关闭时 resolve
 */
export function openRecycleBinModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        listElement = modalElement.querySelector('#recycleBinList');
        toolbarSelectAllButton = modalElement.querySelector('#recycleSelectAllBtn');
        toolbarRestoreBatchButton = modalElement.querySelector('#recycleRestoreBatchBtn');
        toolbarPurgeBatchButton = modalElement.querySelector('#recyclePurgeBatchBtn');
        toolbarClearAllButton = modalElement.querySelector('#recycleClearAllBtn');
        toolbarCountLabel = modalElement.querySelector('#recycleBinCountLabel');
        closeButton = modalElement.querySelector('#recycleBinCloseBtn');
    }

    // 若已有打开的面板，先关闭旧实例（视为取消）
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        cleanup();
        if (oldResolver) oldResolver();
    }

    // 记录焦点触发元素
    if (document.activeElement && document.activeElement !== document.body) {
        lastFocusedElement = document.activeElement;
    } else {
        lastFocusedElement = null;
    }

    // 保存本次的数据拉取器与 handlers
    getItemsFunction = (typeof options.getItems === 'function')
        ? options.getItems
        : function () { return []; };
    currentHandlers = options.handlers || null;

    // 重置选中集
    selectedIds.clear();

    // 首次渲染
    renderAll();

    // 显示并绑定事件
    modalElement.style.display = 'flex';
    closeButton.addEventListener('click', handleClose);
    toolbarSelectAllButton.addEventListener('click', handleSelectAllClick);
    toolbarRestoreBatchButton.addEventListener('click', handleRestoreBatchClick);
    toolbarPurgeBatchButton.addEventListener('click', handlePurgeBatchClick);
    toolbarClearAllButton.addEventListener('click', handleClearAllClick);
    modalElement.addEventListener('click', handleBackdropClick);
    listElement.addEventListener('click', handleListClick);
    listElement.addEventListener('change', handleListChange);

    // 聚焦关闭按钮（延迟等待动画完成）
    setTimeout(function () {
        if (closeButton && typeof closeButton.focus === 'function') {
            closeButton.focus();
        }
    }, RECYCLE_BIN_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前回收站面板
 *
 * 供 src/shortcuts.js 的 Esc 优先级链调用。
 * 与其他模态框的 forceCloseXxx 保持一致的返回语义：
 *   返回 true  = 当前有打开的面板，已被关闭；
 *   返回 false = 当前无打开的面板，未做任何事。
 *
 * @returns {boolean}
 */
export function forceCloseRecycleBinModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    restoreFocus();
    if (resolver) resolver();
    return true;
}