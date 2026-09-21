// filename: src/views/modals/settings.js
// ========================================================================
// DeepSeek 语句工坊 · 设置面板模态框
// 呈现所有可配置的设置项，用户点击开关即时生效
//
// 【方案 A 收尾（上一轮）】
//   1. 删除未使用的 escapeHtml 死导入（此前为占位遗留）。
//   2. 新增 forceCloseSettingsModal 导出：
//      与 confirm / edit / tag / select-tag 四个模态框保持一致的模式，
//      供 src/shortcuts.js 的 Esc 优先级链调用。
//      此前缺失该导出，导致 Esc 无法关闭设置面板。
//   3. 开关点击后检查 onToggle 返回值：
//      若主控方显式返回 false（表示 dispatch 被拒），回滚 UI 视觉状态，
//      避免"UI 显示已开启但数据未变更"的状态不一致。
//      兼容原行为：onToggle 若返回 undefined 或非 false 的值，视为成功。
//   4. 抽出 restoreFocus 内部函数，避免 handleClose 与
//      forceCloseSettingsModal 中重复的焦点恢复逻辑。
//
// 【本轮深度审核（第四批）】
//   本模块无需逻辑修改。
//   main.js 的 handleSettingsToggle（M3 修复）通过
//   "dispatch 返回值 + 读取最新 vault" 双保险判定，
//   在幂等场景下返回 true（不回滚），语义与本模块的
//   `accepted === false` 判定完全对齐。
// ========================================================================

import { SETTINGS_MODAL_FOCUS_DELAY_MS } from '../../constants.js';

let modalElement = null;
let listElement = null;
let closeButton = null;
let currentResolve = null;
let currentToggleHandler = null;
let lastFocusedElement = null;

function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'settingsModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-card">
            <h3><i class="fas fa-cog" aria-hidden="true"></i> 设置</h3>
            <div class="settings-list" id="settingsList" role="list"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" id="settingsCloseBtn" type="button">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function cleanup() {
    if (!modalElement) return;
    modalElement.style.display = 'none';
    if (closeButton) closeButton.removeEventListener('click', handleClose);
    modalElement.removeEventListener('click', handleBackdropClick);
    // 清理渲染出的设置项事件监听（通过重建 innerHTML 自动清理）
    if (listElement) {
        listElement.innerHTML = '';
    }
    currentToggleHandler = null;
}

/**
 * 恢复焦点到打开设置面板前的触发元素
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

/**
 * 渲染设置项列表
 *
 * @param {Object} settings 当前的 vault.settings
 * @param {(key: string, nextValue: any) => boolean|undefined} onToggle 切换回调
 *   返回值语义：
 *     - 返回 false 表示命令被拒，UI 应回滚；
 *     - 返回其他值（包括 undefined）表示成功，保持当前视觉状态。
 */
function renderSettingsList(settings, onToggle) {
    if (!listElement) return;
    listElement.innerHTML = '';

    // ---------- 设置项 1：首字母搜索 ----------
    const enableInitialsSearch = !!settings.enableInitialsSearch;

    const item = document.createElement('div');
    item.className = 'settings-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-setting-key', 'enableInitialsSearch');

    item.innerHTML = `
        <div class="settings-item-content">
            <div class="settings-item-title">
                <i class="fas fa-search" aria-hidden="true"></i>
                <span>首字母搜索</span>
            </div>
            <div class="settings-item-description">
                用拼音首字母搜索中文语句（如 zfb → 支付宝）
            </div>
        </div>
        <button
            class="settings-toggle${enableInitialsSearch ? ' is-on' : ''}"
            role="switch"
            type="button"
            aria-checked="${enableInitialsSearch ? 'true' : 'false'}"
            aria-label="切换首字母搜索"
            data-setting-key="enableInitialsSearch">
            <span class="settings-toggle-thumb" aria-hidden="true"></span>
        </button>
    `;

    listElement.appendChild(item);

    // 绑定开关点击事件
    const toggleButton = item.querySelector('.settings-toggle');
    toggleButton.addEventListener('click', function (event) {
        event.stopPropagation();
        const currentlyOn = toggleButton.classList.contains('is-on');
        const nextValue = !currentlyOn;

        // 即时视觉反馈
        toggleButton.classList.toggle('is-on', nextValue);
        toggleButton.setAttribute('aria-checked', nextValue ? 'true' : 'false');

        // 通知 main.js 执行 dispatch
        if (typeof onToggle === 'function') {
            const accepted = onToggle('enableInitialsSearch', nextValue);
            // 主控方显式返回 false：命令被拒，回滚视觉状态
            if (accepted === false) {
                toggleButton.classList.toggle('is-on', currentlyOn);
                toggleButton.setAttribute(
                    'aria-checked',
                    currentlyOn ? 'true' : 'false'
                );
            }
        }
    });
}

/**
 * 打开设置面板模态框
 *
 * @param {{
 *   settings: Object,
 *   onToggle: (key: string, nextValue: any) => boolean|undefined
 * }} options
 * @returns {Promise<void>} 关闭时 resolve（无返回值）
 */
export function openSettingsModal(options) {
    if (!modalElement) {
        modalElement = buildModal();
        listElement = modalElement.querySelector('#settingsList');
        closeButton = modalElement.querySelector('#settingsCloseBtn');
    }
    if (currentResolve) {
        // 已有打开的设置面板：先关闭旧实例（视为取消）
        const oldResolver = currentResolve;
        currentResolve = null;
        cleanup();
        if (oldResolver) oldResolver();
    }

    // 记录焦点触发元素（用于关闭后返回）
    if (document.activeElement && document.activeElement !== document.body) {
        lastFocusedElement = document.activeElement;
    } else {
        lastFocusedElement = null;
    }

    // 保存本次的切换回调
    currentToggleHandler = options.onToggle || null;

    // 渲染设置项
    renderSettingsList(options.settings || {}, currentToggleHandler);

    // 显示模态框
    modalElement.style.display = 'flex';
    closeButton.addEventListener('click', handleClose);
    modalElement.addEventListener('click', handleBackdropClick);

    // 聚焦第一个设置项的开关（延迟 100ms，等待动画稳定）
    setTimeout(function () {
        if (!listElement) return;
        const firstToggle = listElement.querySelector('.settings-toggle');
        if (firstToggle && typeof firstToggle.focus === 'function') {
            firstToggle.focus();
        } else if (closeButton) {
            closeButton.focus();
        }
    }, SETTINGS_MODAL_FOCUS_DELAY_MS);

    return new Promise(function (resolve) {
        currentResolve = resolve;
    });
}

/**
 * 强制关闭当前设置面板（视为取消）
 *
 * 供 src/shortcuts.js 的 Esc 优先级链调用。
 * 与其他模态框的 forceCloseXxx 保持一致的返回语义：
 *   返回 true  = 当前有打开的面板，已被关闭；
 *   返回 false = 当前无打开的面板，未做任何事。
 *
 * @returns {boolean}
 */
export function forceCloseSettingsModal() {
    if (!currentResolve) return false;
    const resolver = currentResolve;
    currentResolve = null;
    cleanup();
    restoreFocus();
    if (resolver) resolver();
    return true;
}