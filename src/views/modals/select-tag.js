// filename: src/views/modals/select-tag.js
// ========================================================================
// DeepSeek 语句工坊 · 选择目标标签模态框
// 用于"复制到其他标签"与"批量移动到标签"
// 返回 Promise<{ tagId: string } | null>
//
// 【本轮深度审核（第三批）】
//   本模块无需逻辑修改。
// ========================================================================

import { escapeHtml } from '../../utils/dom.js';

let modalElement = null;
let listElement = null;
let cancelButton = null;
let currentResolve = null;

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'selectTagModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3><i class="fas fa-share-alt" aria-hidden="true"></i> 选择目标标签</h3>
            <div id="tagSelectList" class="tag-select-list" role="list"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" id="cancelSelectTagBtn" type="button">取消</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function cleanup() {
    if (!modalElement) return null;
    modalElement.style.display = 'none';
    cancelButton.removeEventListener('click', handleCancel);
    modalElement.removeEventListener('click', handleBackdropClick);
    const resolver = currentResolve;
    currentResolve = null;
    return resolver;
}

function handleCancel() {
    const resolver = cleanup();
    if (resolver) resolver(null);
}

function handleBackdropClick(event) {
    if (event.target === modalElement) handleCancel();
}

/**
 * 打开选择标签模态框
 * @param {{
 *   title: string,
 *   tags: Array<{id: string, name: string, color: string|null}>,
 *   counts: Object<string, number>,
 *   excludeTagId?: string|null
 * }} options
 * @returns {Promise<{ tagId: string } | null>}
 */
export function openSelectTagModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        listElement = modalElement.querySelector('#tagSelectList');
        cancelButton = modalElement.querySelector('#cancelSelectTagBtn');
    }
    if (currentResolve) {
        const oldResolver = currentResolve;
        currentResolve = null;
        oldResolver(null);
        cleanup();
    }

    // 更新标题
    const titleElement = modalElement.querySelector('h3');
    titleElement.innerHTML = '<i class="fas fa-share-alt" aria-hidden="true"></i> '
        + escapeHtml(options.title || '选择目标标签');

    // 渲染选项
    listElement.innerHTML = '';
    const excludeId = options.excludeTagId || null;
    const candidateTags = options.tags.filter(function (tag) {
        return tag.id !== excludeId;
    });

    if (candidateTags.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'tag-option';
        emptyMessage.style.cursor = 'default';
        emptyMessage.textContent = '没有可选的目标标签';
        listElement.appendChild(emptyMessage);
    } else {
        candidateTags.forEach(function (tag) {
            const option = document.createElement('div');
            option.className = 'tag-option';
            option.setAttribute('role', 'listitem');
            const colorDotHtml = tag.color
                ? '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:'
                    + escapeHtml(tag.color) + ';flex-shrink:0;"></span>'
                : '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ccc;flex-shrink:0;"></span>';
            const count = options.counts[tag.id] || 0;
            option.innerHTML = colorDotHtml
                + ' <span style="flex:1;">' + escapeHtml(tag.name) + '</span>'
                + ' <span style="color:#8ba0ae;font-size:0.75rem;">' + count + ' 条</span>';
            option.addEventListener('click', function () {
                const resolver = cleanup();
                if (resolver) resolver({ tagId: tag.id });
            });
            listElement.appendChild(option);
        });
    }

    modalElement.style.display = 'flex';
    cancelButton.addEventListener('click', handleCancel);
    modalElement.addEventListener('click', handleBackdropClick);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前选择框
 * @returns {boolean} true 表示确实关闭了弹窗；false 表示当前没有弹窗
 */
export function forceCloseSelectTagModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    resolver(null);
    return true;
}