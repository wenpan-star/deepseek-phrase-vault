// filename: src/views/recycle-card.js
// ========================================================================
// DeepSeek 语句工坊 · 回收站条目模板
// 纯函数：输入回收站条目与上下文，输出 HTML 字符串
// 所有动态文本均已转义
//
// 【方案 A（上一轮）】
//   新建本模块。
//
//   条目结构（从上到下、从左到右）：
//     [复选框]  [来源标签徽章] [相对时间]       [恢复按钮] [彻底删除按钮]
//               语句文本（1-2 行截断）
//
//   相对时间格式：
//     < 1 分钟   → "刚刚"
//     < 1 小时   → "N 分钟前"
//     < 24 小时  → "N 小时前"
//     < 30 天    → "N 天前"
//     其他       → 完整日期（YYYY-MM-DD HH:MM）
//
// 【本轮深度审核（第三批）】
//   本模块无需逻辑修改。
// ========================================================================

import { escapeHtml } from '../utils/dom.js';
import {
    TIME_THRESHOLD_JUST_NOW_MS,
    TIME_THRESHOLD_MINUTES_MS,
    TIME_THRESHOLD_HOURS_MS,
    TIME_THRESHOLD_DAYS_MS
} from '../constants.js';

/**
 * 将时间戳格式化为相对时间字符串
 *
 * @param {number} timestamp 毫秒时间戳（0 表示未知）
 * @param {number} [now] 可选的"当前时间"，用于测试；默认 Date.now()
 * @returns {string}
 */
export function formatRelativeTime(timestamp, now) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
        return '未知时间';
    }

    const currentTime = (typeof now === 'number' && Number.isFinite(now))
        ? now
        : Date.now();
    const deltaMilliseconds = currentTime - timestamp;

    // 未来时间（时钟偏差）：视为"刚刚"
    if (deltaMilliseconds < 0) return '刚刚';

    if (deltaMilliseconds < TIME_THRESHOLD_JUST_NOW_MS) {
        return '刚刚';
    }
    if (deltaMilliseconds < TIME_THRESHOLD_MINUTES_MS) {
        const minutes = Math.floor(deltaMilliseconds / (60 * 1000));
        return minutes + ' 分钟前';
    }
    if (deltaMilliseconds < TIME_THRESHOLD_HOURS_MS) {
        const hours = Math.floor(deltaMilliseconds / (60 * 60 * 1000));
        return hours + ' 小时前';
    }
    if (deltaMilliseconds < TIME_THRESHOLD_DAYS_MS) {
        const days = Math.floor(deltaMilliseconds / (24 * 60 * 60 * 1000));
        return days + ' 天前';
    }

    // 超过 30 天：显示完整日期
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return year + '-' + month + '-' + day + ' ' + hour + ':' + minute;
}

/**
 * 渲染单条回收站条目的 HTML
 *
 * @param {{
 *   id: string,
 *   text: string,
 *   copyCount: number,
 *   sourceTagId: string,
 *   sourceTagName: string,
 *   sourceTagColor: string|null,
 *   deletedAt: number,
 *   deletionSource: string
 * }} item
 * @param {{
 *   isChecked: boolean,
 *   now?: number
 * }} options
 * @returns {string}
 */
export function renderRecycleItem(item, options) {
    const effectiveOptions = options || {};
    const isChecked = !!effectiveOptions.isChecked;
    const checkboxChecked = isChecked ? 'checked' : '';

    // 来源标签徽章
    const tagName = item.sourceTagName || '未知标签';
    const tagColor = item.sourceTagColor;
    const tagBadgeStyle = tagColor
        ? `background:${escapeHtml(tagColor)};color:#ffffff;`
        : '';
    const tagBadgeHtml = `<span class="recycle-item-tag" style="${tagBadgeStyle}">${escapeHtml(tagName)}</span>`;

    // 相对时间
    const relativeTimeText = formatRelativeTime(item.deletedAt, effectiveOptions.now);
    const absoluteTimeText = (item.deletedAt > 0)
        ? new Date(item.deletedAt).toLocaleString('zh-CN')
        : '未知';

    // 正文：直接 escapeHtml；CSS 负责截断为 2 行
    const safeText = escapeHtml(item.text);

    return `
        <div class="recycle-item" data-id="${escapeHtml(item.id)}">
            <input
                type="checkbox"
                class="recycle-item-checkbox"
                data-id="${escapeHtml(item.id)}"
                ${checkboxChecked}
                aria-label="选择此回收站条目">
            <div class="recycle-item-content">
                <div class="recycle-item-header">
                    ${tagBadgeHtml}
                    <span class="recycle-item-time" title="${escapeHtml(absoluteTimeText)}">${escapeHtml(relativeTimeText)}</span>
                </div>
                <div class="recycle-item-text">${safeText}</div>
            </div>
            <div class="recycle-item-actions">
                <button
                    class="icon-btn recycle-restore-btn"
                    data-action="restore"
                    data-id="${escapeHtml(item.id)}"
                    type="button"
                    title="恢复"
                    aria-label="恢复此语句">
                    <i class="fas fa-undo" aria-hidden="true"></i>
                </button>
                <button
                    class="icon-btn recycle-purge-btn"
                    data-action="purge"
                    data-id="${escapeHtml(item.id)}"
                    type="button"
                    title="彻底删除"
                    aria-label="彻底删除此语句">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>
        </div>
    `;
}