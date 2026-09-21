// filename: src/views/statement-card.js
// ========================================================================
// DeepSeek 语句工坊 · 单张语句卡片模板函数
// 纯函数：输入 statement 与显示上下文，输出 HTML 字符串
// 所有动态文本均已转义
//
// 【本次改进 · P2-N5 修复】
//   复选框去掉了 "visible" 类。
//
//   背景：
//     原 CSS 中 .card-checkbox 定义 display: none，
//     .card-checkbox.visible 定义 display: flex。
//     但卡片模板始终带 visible 类，导致：
//       1. .card-checkbox 的 display: none 是死规则
//       2. "visible" 这个类名暗示存在"非 visible 状态"，实际不存在
//       3. 未来维护者可能被误导
//
//   修复：
//     - 卡片模板去掉 "visible" 类
//     - styles/statements.css 中 .card-checkbox 直接定义 display: flex，
//       删除 .card-checkbox.visible 冗余规则
//     保持视觉与行为完全不变，同时清理死代码。
// ========================================================================

import { escapeHtml } from '../utils/dom.js';
import { DEFAULT_TAG_ID } from '../constants.js';

/**
 * 渲染单张卡片 HTML
 * @param {{
 *   id: string,
 *   text: string,
 *   tagId?: string,
 *   tagName?: string,
 *   tagColor?: string|null
 * }} statement
 * @param {{
 *   displayIndex: number,
 *   isChecked: boolean,
 *   isGlobalMode: boolean,
 *   currentTagId: string,
 *   highlightedHtml: string
 * }} options
 * @returns {string}
 */
export function renderStatementCard(statement, options) {
    const cardTagId = statement.tagId || options.currentTagId;
    const isDefaultTag = cardTagId === DEFAULT_TAG_ID;

    let tagLabelHtml = '';
    if (options.isGlobalMode && statement.tagName) {
        const tagColorStyle = statement.tagColor
            ? `background:${escapeHtml(statement.tagColor)};color:white;`
            : '';
        tagLabelHtml = `<span class="card-tag-label" style="${tagColorStyle}">${escapeHtml(statement.tagName)}</span>`;
    }

    const copyToDefaultHtml = isDefaultTag
        ? ''
        : `<button class="icon-btn copy-to-default-btn" data-action="copyToDefault" data-id="${escapeHtml(statement.id)}" title="添加到默认语库" aria-label="添加到默认语库">
               <i class="fas fa-star" aria-hidden="true"></i>
           </button>`;

    const checkboxChecked = options.isChecked ? 'checked' : '';

    return `
        <div class="statement-card" data-id="${escapeHtml(statement.id)}" data-tag-id="${escapeHtml(cardTagId)}">
            <input type="checkbox" class="card-checkbox" data-id="${escapeHtml(statement.id)}" ${checkboxChecked} aria-label="选择此语句">
            <div class="card-index">#${options.displayIndex}</div>
            <div class="card-content">${tagLabelHtml}${options.highlightedHtml}</div>
            <div class="card-actions">
                <button class="icon-btn copy-to-tag-btn" data-action="copyToTag" data-id="${escapeHtml(statement.id)}" title="复制到其他标签" aria-label="复制到其他标签">
                    <i class="fas fa-share-square" aria-hidden="true"></i>
                </button>
                ${copyToDefaultHtml}
                <button class="icon-btn delete-btn" data-action="delete" data-id="${escapeHtml(statement.id)}" title="删除" aria-label="删除">
                    <i class="fas fa-trash-alt" aria-hidden="true"></i>
                </button>
                <button class="icon-btn edit-btn" data-action="edit" data-id="${escapeHtml(statement.id)}" title="编辑" aria-label="编辑">
                    <i class="fas fa-edit" aria-hidden="true"></i>
                </button>
                <button class="icon-btn copy-btn" data-action="copy" data-id="${escapeHtml(statement.id)}" title="复制文本" aria-label="复制文本">
                    <i class="fas fa-copy" aria-hidden="true"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * 渲染空状态 HTML
 * @param {{ type: 'no-match'|'empty'|'search-prompt', keyword?: string }} options
 * @returns {string}
 */
export function renderEmptyState(options) {
    if (options.type === 'no-match') {
        return `
            <div class="empty-state">
                <i class="fas fa-search" aria-hidden="true"></i>
                <p>🔍 没有找到包含 "${escapeHtml(options.keyword || '')}" 的语句</p>
            </div>
        `;
    }
    if (options.type === 'empty') {
        return `
            <div class="empty-state">
                <i class="fas fa-comment-dots" aria-hidden="true"></i>
                <p>✨ 暂无语句，添加一条吧～</p>
            </div>
        `;
    }
    return `
        <div class="empty-state">
            <i class="fas fa-search" aria-hidden="true"></i>
            <p>🔍 输入关键词搜索语句</p>
        </div>
    `;
}