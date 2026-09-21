// filename: src/views/batch-bar.js
// ========================================================================
// DeepSeek 语句工坊 · 批量操作栏
// 显示全选 / 批量删除 / 移动到标签 三个按钮与选中计数
// 通过回调通知外部
//
// 【本轮深度审核（第三批）】
//   本模块无需逻辑修改。
// ========================================================================

import { $ } from '../utils/dom.js';

let barElement = null;
let countElement = null;
let selectAllButton = null;
let deleteButton = null;
let moveButton = null;
let handlers = {
    onSelectAll: function () {},
    onDelete: function () {},
    onMove: function () {}
};

/**
 * 初始化批量操作栏
 * @param {{
 *   onSelectAll: () => void,
 *   onDelete: () => void,
 *   onMove: () => void
 * }} options
 */
export function initializeBatchBar(options) {
    handlers = Object.assign(handlers, options || {});
    barElement = $('#batchActionBar');
    countElement = $('#batchCount');
    selectAllButton = $('#batchSelectAllBtn');
    deleteButton = $('#batchDeleteBtn');
    moveButton = $('#batchMoveBtn');

    if (selectAllButton) {
        selectAllButton.addEventListener('click', function () {
            handlers.onSelectAll();
        });
    }
    if (deleteButton) {
        deleteButton.addEventListener('click', function () {
            handlers.onDelete();
        });
    }
    if (moveButton) {
        moveButton.addEventListener('click', function () {
            handlers.onMove();
        });
    }
}

/**
 * 根据选中数量刷新 UI
 * @param {{ selectedCount: number, allSelected: boolean }} state
 */
export function updateBatchBar(state) {
    if (!barElement || !countElement) return;
    if (state.selectedCount > 0) {
        barElement.style.display = 'flex';
        countElement.innerText = `已选 ${state.selectedCount} 条`;
    } else {
        barElement.style.display = 'none';
        countElement.innerText = '';
    }
    if (selectAllButton) {
        selectAllButton.innerText = state.allSelected ? '取消全选' : '全选';
    }
}