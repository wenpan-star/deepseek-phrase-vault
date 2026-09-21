// filename: src/views/toast.js
// ========================================================================
// DeepSeek 语句工坊 · 通知条
// 底部居中浮层，2.2 秒后淡出。DOM 动态创建，无需预埋 HTML
// 安全：所有用户可控文本经 escapeHtml 转义后写入
// ========================================================================

import { TOAST_DURATION_MS } from '../constants.js';
import { escapeHtml } from '../utils/dom.js';

let toastElement = null;
let toastTimer = null;

/**
 * 初始化 Toast 容器（应用启动时调用一次）
 */
export function initializeToast() {
    if (toastElement) return;
    toastElement = document.createElement('div');
    toastElement.id = 'dynamicToast';
    toastElement.className = 'toast-msg';
    toastElement.setAttribute('role', 'status');
    toastElement.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastElement);
}

/**
 * 显示一条提示
 * @param {string} messageText
 * @param {boolean} [isError=false]
 */
export function showMessage(messageText, isError) {
    if (!toastElement) initializeToast();
    const iconClass = isError ? 'fa-exclamation-triangle' : 'fa-check-circle';
    const safeMessage = escapeHtml(String(messageText == null ? '' : messageText));
    toastElement.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i> ${safeMessage}`;
    toastElement.style.background = isError ? '#c62828e6' : '#1e4a6be6';
    toastElement.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toastElement.style.opacity = '0';
    }, TOAST_DURATION_MS);
}