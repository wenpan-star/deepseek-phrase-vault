// filename: src/shortcuts.js
// ========================================================================
// DeepSeek 语句工坊 · 键盘快捷键
// 全局键盘事件处理，聚焦时（输入框内）仅处理 Esc
//
// 【快捷键说明】
//   - Ctrl / Cmd + K：聚焦搜索框
//   - Ctrl / Cmd + /：聚焦新建语句输入框
//     （原 Ctrl+N 是浏览器"新建窗口"原生快捷键，无法被阻止，
//       因此改用无冲突的 Ctrl+/）
//   - Esc：按"模态框 → 菜单 → 浮层 → 清空搜索"优先级依次处理
//   - Delete：删除已勾选的语句
//
// 【Ctrl+/ 的判定】
//   除了 event.key === '/' 之外，增加 event.code === 'Slash' 的兼容。
//
//   原因：在部分非美式键盘布局下（如德语 QWERTZ、法语 AZERTY），
//   用户需要 Shift+7 或 Shift+: 才能打出 '/'。此时虽然 event.key
//   通常仍为 '/'，但在某些浏览器/系统组合下 event.key 会变成 '7'
//   或 ':'，导致快捷键失效。而 event.code 是物理按键代码，
//   在所有键盘布局下 'Slash' 恒指同一个物理按键（美式键盘 '/' 所在位置），
//   用它作为兜底判定可以显著提升跨布局兼容性。
//
// 【方案 A 收尾（上一轮）】
//   closeTopmostOverlay 的优先级链新增三类浮层：
//     1. forceCloseMoreMenu       —— 更多菜单（新建）
//     2. forceCloseSettingsModal  —— 设置面板（新建）
//     3. forceCloseRecycleBinModal—— 回收站面板（新建）
//
//   顺序（从高到低）：
//     confirm → edit → tag → select-tag
//       → settings → recycle-bin
//       → more-menu
//       → fulltext-popover
//
// 【本轮深度审核修复（第一批）】
//   C1（模块路径不匹配 —— 阻塞级）：
//     forceCloseRecycleBinModal 的 import 路径从
//     './views/modals/recycle-bin.js' 修正为
//     './views/modals/recycle-bin-modal.js'，
//     与实际文件名一致，避免 ESM 加载阶段白屏。
// ========================================================================

import { focusSearchInput, blurSearchInput } from './views/search-bar.js';
import { focusAddBarInput } from './views/add-bar.js';
import { forceCloseConfirmDialog } from './views/modals/confirm.js';
import { forceCloseEditModal } from './views/modals/edit.js';
import { forceCloseTagModal } from './views/modals/tag.js';
import { forceCloseSelectTagModal } from './views/modals/select-tag.js';
import { forceCloseSettingsModal } from './views/modals/settings.js';
import { forceCloseRecycleBinModal } from './views/modals/recycle-bin-modal.js';
import { forceCloseFullTextPopover } from './views/statement-list.js';
import { forceCloseMoreMenu } from './views/more-menu.js';

/**
 * 初始化快捷键
 * @param {{
 *   onDeleteSelected: () => void,
 *   onClearSearch: () => void,
 *   getSelectedCount: () => number
 * }} options
 */
export function initializeShortcuts(options) {
    document.addEventListener('keydown', function (event) {
        const targetTagName = event.target.tagName;
        const isInputFocused = targetTagName === 'INPUT'
            || targetTagName === 'TEXTAREA'
            || event.target.isContentEditable;

        if (isInputFocused) {
            // 输入框内仅处理 Escape（让输入框失焦）
            // 输入法合成中忽略（交给输入法处理）
            if (event.key === 'Escape' && !event.isComposing) {
                event.target.blur();
                return;
            }
            return;
        }

        // Ctrl / Cmd + K：聚焦搜索
        if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
            event.preventDefault();
            focusSearchInput();
            return;
        }

        // Ctrl / Cmd + /：聚焦新建语句输入框
        // 使用 Ctrl+/ 而非 Ctrl+N，因为后者是浏览器原生快捷键、无法被阻止
        // 使用 event.key === '/' || event.code === 'Slash' 双重判定，
        // 兼容非美式键盘布局
        if ((event.ctrlKey || event.metaKey)
            && (event.key === '/' || event.code === 'Slash')) {
            event.preventDefault();
            focusAddBarInput();
            return;
        }

        // Escape：按"模态框 → 菜单 → 浮层 → 清空搜索"的优先级依次处理
        if (event.key === 'Escape') {
            const closedAnyOverlay = closeTopmostOverlay();
            if (closedAnyOverlay) {
                return;
            }
            if (typeof options.onClearSearch === 'function') {
                options.onClearSearch();
            }
            blurSearchInput();
            return;
        }

        // Delete：删除选中项
        if (event.key === 'Delete' && typeof options.onDeleteSelected === 'function') {
            if (typeof options.getSelectedCount === 'function'
                && options.getSelectedCount() > 0) {
                event.preventDefault();
                options.onDeleteSelected();
            }
        }
    });

    /**
     * 依次尝试关闭最上层的浮层 / 模态框。
     *
     * 顺序说明（按打开时机与 z-index 综合判断）：
     *   1. 确认对话框     （modal）
     *   2. 编辑模态框     （modal）
     *   3. 标签模态框     （modal）
     *   4. 选择标签框     （modal）
     *   5. 设置面板       （modal）
     *   6. 回收站面板     （modal）
     *   7. 更多菜单       （popover，z-index 950）
     *   8. 全文浮层       （popover，z-index 900）
     *
     * forceCloseXxx 均返回布尔值，用于判断是否真的关闭了。
     *
     * @returns {boolean}
     */
    function closeTopmostOverlay() {
        if (forceCloseConfirmDialog()) return true;
        if (forceCloseEditModal()) return true;
        if (forceCloseTagModal()) return true;
        if (forceCloseSelectTagModal()) return true;
        if (forceCloseSettingsModal()) return true;
        if (forceCloseRecycleBinModal()) return true;
        if (forceCloseMoreMenu()) return true;
        if (forceCloseFullTextPopover()) return true;
        return false;
    }
}