// filename: src/main.js
// ========================================================================
// DeepSeek 语句工坊 · 应用入口
// 唯一职责：初始化所有子系统并接线
// 不包含任何业务逻辑
//
// 【历史改进】
//   1. handleTagDelete：确认框显示该标签下的语句数
//   2. handleBatchMove：预计算实际可移动数，给出明细提示
//   3. handleFullImport：报告归一化过程中丢弃的非法数据数
//
// 【第 4~5 轮系列修复（历史）】
//   M2（滚动补偿误触发）
//   M4（useRegex 未纳入上下文校验）
//   P1-N2（成功提示不可信）
//   P2-N1（导入 / 重置异常路径 UI 不一致）
//   P2-N2（静默忽略用户操作）
//   P3-N4（Safari 下载兼容性，延迟释放 ObjectURL）
//   统一清空顺序：handleBatchDelete 与 handleBatchMove 一致
//
// 【第 6 轮系列修复（R1~R5 + W2/W3）】
//   R1（sessionStorage 读取健壮性）
//   R2（剪贴板写入降级）
//   R3（FileReader 异常处理）
//   R4 / R5（targetTag 存在性防御）
//   W2（下载链接 DOM 挂载）
//   W3（persist.js 中的解密失败备份保护）
//
// 【第 7 轮补充修复（N1 / N2）】
//   N1（Safari 下载兼容性强化）
//   N2（iOS Safari 剪贴板降级路径兼容性）
//
// 【方案 A 收尾（历史）】
//   1. computeVisibleCount 补 matchSearch 第 4 参数（enableInitialsSearch）。
//   2. 初始化 more-menu，订阅 'recycleBin' 切片更新徽章。
//   3. 新增 8 个 handlers。
//   4. renderAll 首屏调用 updateMoreMenuBadge 设定初始值。
//
// 【第一批深度审核修复（历史）】
//   C1（模块路径不匹配 —— 阻塞级）
//   C2（设置面板无 UI 入口）
//   C3（导出数据缺失 recycleBin 与 settings）
//   C4（replaceVault 切片列表遗漏 'recycleBin'）
//   M1（批量删除未警告回收站溢出）
//   M3（设置开关回滚依赖 dispatch 布尔返回值语义）
//
// 【第一批重构（历史）】
//   问题 A（快速切标签时滚动位置丢失）：
//     handleTagClick 在 dispatch('switchTag') 之前调用
//     flushScrollPosition()，把防抖窗口内待保存的滚动位置立即落盘。
//     与 statement-list.js 中"scroll 事件记录上下文键"的修复形成双保险。
//
//   问题 B（批量恢复被取消时选中集被清空）：
//     handleRecycleRestoreBatch / handleRecyclePurgeBatch /
//     handleRecycleClearAll 显式返回 boolean：
//       · 返回 true  = 操作已执行（可能部分成功）
//       · 返回 false = 用户主动取消，未执行任何操作
//     与 recycle-bin-modal.js 的返回值判断逻辑对齐。
//
//   问题 C（导入后侧边栏展开状态失同步）：
//     · subscribe('ui') 中调用 syncSidebarExpandedState，
//       把 vault.uiState.sidebarExpanded 的权威值同步到 sidebar.js。
//     · 该调用是幂等的（值相同时立即返回），无副作用。
//
// 【第二批重构（本轮）】
//   问题 I（bootstrap 未处理 initializeFacade 返回 null）：
//     FA-4 修复后，initializeFacade 在 loadVaultFromStorage 抛异常时
//     会返回 null（而非抛异常）。但 bootstrap 未检查返回值，直接
//     继续执行 initializeAllViews，而 initializeAllViews 内部第一行
//     就是 getVaultSnapshot().uiState.sidebarExpanded——会在 null 上
//     抛 TypeError，被 bootstrap().catch 捕获后只显示"应用启动失败"，
//     掩盖真实根因（数据加载失败 vs 其他异常）。
//
//     修复：
//       · bootstrap 中检查返回值
//       · 为 null 时：记录明确错误日志 + 用户提示 + 提前返回
//       · 不执行后续初始化（不注册命令、不初始化视图、不渲染）
//
//     为什么不自动回退到内置预设：
//       若加载失败是因为存储损坏（例如 localStorage 读取异常、
//       解密失败但 persist.js 未识别），自动回退并用预设覆盖会
//       丢失备份键 ds_encrypted_vault_v4_backup 中的原始数据。
//       让用户主动刷新 / 联系支持是更保守的选择。
//
//   问题 M（剪贴板降级的 console.warn 刷屏）：
//     在 HTTP 上下文中（例如本地 http://localhost 之外的开发环境、
//     企业内网非 HTTPS 部署），navigator.clipboard.writeText 每次
//     调用都会失败。原实现每次失败都 console.warn，用户长时间使用
//     会积累大量重复日志。
//
//     修复：增加模块级布尔标志 hasLoggedModernClipboardFailure。
//     仅在本会话首次失败时 warn（保留完整信息，含 Error 对象），
//     后续调用静默降级。这属于"日志降噪"而非"删除日志"——
//     首次 warn 完整保留，开发者仍可在控制台第一时间看到问题。
//
//     为什么不改用 console.debug：
//       console.debug 在 Chrome DevTools 默认过滤级别下不显示，
//       会让开发者错过诊断信息。用"首次 warn"策略兼顾两者。
// ========================================================================

import {
    initializeFacade,
    subscribe,
    dispatch,
    replaceVault,
    getVaultSnapshot
} from './core/facade.js';
import { initializeFontAwesomeLoader } from './core/fa-loader.js';
import { flushDebouncedPersist } from './core/persist.js';
import { isCryptoAvailable } from './core/crypto.js';
import { registerAllCommands } from './commands/index.js';
import {
    DEFAULT_TAG_ID,
    SEARCH_SCOPE_GLOBAL,
    SESSION_KEY_SIDEBAR_SCROLL_POSITION,
    SCROLL_SAVE_DEBOUNCE_MS,
    ADD_STATEMENT_SCROLL_DELAY_MS,
    MAX_IMPORT_FILE_SIZE_BYTES,
    MAX_RECYCLE_BIN_SIZE
} from './constants.js';
import {
    createVaultFromBuiltinPreset,
    findStatementById,
    getAllStatementsWithTags,
    normalizeVault,
    ensureDefaultTagExists,
    isDuplicateInTag
} from './core/vault.js';
import { matchSearch } from './commands/search.js';

import { initializeToast, showMessage } from './views/toast.js';
import { showConfirmDialog } from './views/modals/confirm.js';
import { openEditModal } from './views/modals/edit.js';
import { openTagModal } from './views/modals/tag.js';
import { openSelectTagModal } from './views/modals/select-tag.js';
import { openSettingsModal } from './views/modals/settings.js';
import { openRecycleBinModal } from './views/modals/recycle-bin-modal.js';

import {
    initializeSidebar,
    renderSidebar,
    syncSidebarExpandedState
} from './views/sidebar.js';
import { initializeHeader, updateHeaderStats } from './views/header.js';
import {
    initializeSearchBar,
    updateSearchBarUI
} from './views/search-bar.js';
import {
    initializeStatementList,
    renderStatementList,
    getSelectedStatementIds,
    clearStatementSelection,
    toggleSelectAllVisible,
    isAllVisibleSelected,
    scrollMainListToBottom,
    flushScrollPosition,
    getStatementCardViewportTopById,
    compensateMainListScrollBy
} from './views/statement-list.js';
import {
    initializeBatchBar,
    updateBatchBar
} from './views/batch-bar.js';
import {
    initializeAddBar,
    clearAddBarInput
} from './views/add-bar.js';
import {
    initializeMoreMenu,
    updateMoreMenuBadge
} from './views/more-menu.js';
import { initializeShortcuts } from './shortcuts.js';

// ==================== 模块级状态（剪贴板日志降噪，问题 M） ====================
// 语义：本会话是否已经记录过"现代 Clipboard API 失败"的警告。
// 用途：避免在 HTTP 上下文中每次复制都刷 console.warn。
// 生命周期：模块级，不进入 Vault，不持久化；页面刷新后重置。
let hasLoggedModernClipboardFailure = false;

// ==================== 浏览器剪贴板 ====================

/**
 * 复制文本到剪贴板。
 *
 * 【策略】双路径降级：
 *   1. 优先使用现代 Clipboard API（需要 HTTPS 或 localhost 上下文）
 *   2. 若现代 API 不存在，或调用时抛异常（例如在 HTTP 上下文、
 *      或用户拒绝权限），则回退到旧的 execCommand('copy')
 *
 * 【问题 M 修复 · 日志降噪】
 *   在 HTTP 上下文中，现代 API 每次调用都会失败。若每次都 warn，
 *   用户长时间使用会积累大量重复日志。
 *
 *   修复：用模块级标志 hasLoggedModernClipboardFailure 记录"是否
 *   已警告过"。首次失败时记录完整 warn（含错误对象），后续失败
 *   静默降级。这保留了首次诊断信息，同时避免日志刷屏。
 *
 *   该标志不重置（除非页面刷新），因为失败是环境级属性，
 *   同一会话内不会自愈。
 *
 * @param {string} text
 * @returns {Promise<void>} 两条路径均失败时抛出异常
 */
async function copyTextToClipboard(text) {
    // ---------- 路径 1：现代 Clipboard API ----------
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (modernClipboardError) {
            // 【问题 M 修复】仅在本会话首次失败时 warn
            if (!hasLoggedModernClipboardFailure) {
                hasLoggedModernClipboardFailure = true;
                console.warn(
                    '[main] 现代剪贴板 API 失败，将使用 execCommand 降级。'
                    + '此消息仅在本会话首次失败时记录。',
                    modernClipboardError
                );
            }
        }
    }

    // ---------- 路径 2：execCommand('copy') 降级 ----------
    const textareaElement = document.createElement('textarea');
    textareaElement.value = text;
    // 使用 fixed 定位 + 透明，避免触发页面滚动或视觉闪烁
    textareaElement.style.position = 'fixed';
    textareaElement.style.top = '0';
    textareaElement.style.left = '0';
    textareaElement.style.width = '1px';
    textareaElement.style.height = '1px';
    textareaElement.style.padding = '0';
    textareaElement.style.border = 'none';
    textareaElement.style.outline = 'none';
    textareaElement.style.boxShadow = 'none';
    textareaElement.style.background = 'transparent';
    textareaElement.style.opacity = '0';
    textareaElement.setAttribute('readonly', '');
    document.body.appendChild(textareaElement);

    try {
        textareaElement.select();
        // 不再调用 setSelectionRange：
        //   · select() 已经完整选中 textarea 内容，等价于
        //     setSelectionRange(0, textareaElement.value.length)
        //   · iOS Safari 对 readonly textarea 调用 setSelectionRange
        //     可能抛 InvalidStateError
        //   · 一旦抛异常，execCommand('copy') 不会执行，
        //     用户看到"复制失败"——而实际上 execCommand 本可成功
        //   · 移除冗余调用可最大化跨浏览器成功率

        const succeeded = document.execCommand('copy');
        if (!succeeded) {
            throw new Error('execCommand 返回 false');
        }
    } finally {
        // 无论成功或失败，都要清理临时元素
        document.body.removeChild(textareaElement);
    }
}

// ==================== 应用初始化 ====================

/**
 * 应用启动主流程。
 *
 * 【问题 I 修复 · 加载失败保护】
 *   initializeFacade 在 loadVaultFromStorage 抛异常时会返回 null
 *   （见 facade.js 的 FA-4 保护）。此时不能继续初始化视图层——
 *   否则 initializeAllViews 内部的第一行 getVaultSnapshot().uiState
 *   会在 null 上抛 TypeError，掩盖真实根因。
 *
 *   修复策略：
 *     1. 检查 initializeFacade 返回值
 *     2. 为 null 时：记录明确的错误日志 + 用户提示 + 提前返回
 *     3. 不执行后续初始化（不注册命令、不初始化视图、不渲染）
 *
 *   为什么不自动回退到内置预设：
 *     若加载失败是因为存储损坏（例如 localStorage 读取异常、
 *     解密失败但 persist.js 未识别、vault 结构严重损坏），
 *     自动回退并用预设覆盖会丢失备份键
 *     ds_encrypted_vault_v4_backup 中的原始数据。
 *     让用户主动刷新 / 联系支持是更保守的选择——备份键里的
 *     密文仍然完整保留，具备人工恢复的可能性。
 *
 *   用户可见行为：
 *     · Toast 显示"应用数据加载失败，请刷新页面重试"
 *     · 页面保持"已加载但未初始化"状态
 *     · 用户手动刷新可再次尝试（可能与临时性存储异常有关）
 */
async function bootstrap() {
    // 1. Font Awesome 异步加载，不阻塞初始化
    initializeFontAwesomeLoader();

    // 2. Toast 容器
    initializeToast();

    // 3. 初始化 Facade（从存储加载 Vault）
    const loadedVault = await initializeFacade({ toastHandler: showMessage });

    // ---------- 【问题 I 修复】检查加载结果 ----------
    if (!loadedVault) {
        console.error(
            '[main] Vault 加载失败：initializeFacade 返回 null。'
            + '应用将保持未初始化状态，不执行后续渲染。'
            + '可能原因：localStorage 读取异常 / 数据解密失败 / '
            + '浏览器禁用了本地存储。'
        );
        showMessage(
            '⚠️ 应用数据加载失败。请刷新页面重试；若持续失败，'
            + '请检查浏览器是否禁用了本地存储。',
            true
        );
        // 提前返回：不注册命令、不初始化视图、不渲染
        // 保持页面在"静态 HTML 已加载，但 JS 侧未启动"状态，
        // 用户刷新可重试
        return;
    }

    // 3.1 明文降级提示（Web Crypto 不可用时，数据实际以明文保存）
    if (!isCryptoAvailable()) {
        showMessage('⚠️ 当前环境不支持加密，数据将以明文保存', true);
    }

    // 4. 注册所有命令
    registerAllCommands();

    // 5. 初始化各视图（含主列表滚动监听）
    initializeAllViews();

    // 6. 首次渲染
    renderAll();

    // 7. 恢复侧边栏滚动位置
    restoreSidebarScrollState();

    // 8. 快捷键
    initializeShortcuts({
        onDeleteSelected: handleBatchDelete,
        onClearSearch: handleClearSearch,
        getSelectedCount: function () {
            return getSelectedStatementIds().size;
        }
    });

    // 9. 侧边栏滚动监听 + beforeunload 兜底
    bindSidebarScrollMemory();
}

// ==================== 视图接线 ====================

function initializeAllViews() {
    const initialVault = getVaultSnapshot();

    initializeSidebar({
        initialExpanded: initialVault.uiState.sidebarExpanded,
        onTagClick: handleTagClick,
        onTagDelete: handleTagDelete,
        onTagEdit: handleTagEdit,
        onTagReorder: handleTagReorder,
        onAddTag: handleAddTag,
        onToggleExpand: handleToggleExpand
    });

    initializeHeader({
        onExport: handleExport,
        onImport: handleImport,
        onReset: handleReset
    });

    initializeSearchBar({
        onKeywordChange: handleKeywordChange,
        onRegexToggle: handleRegexToggle,
        onScopeToggle: handleScopeToggle,
        onClear: handleClearSearch
    });

    initializeStatementList({
        onEdit: handleCardEdit,
        onDelete: handleCardDelete,
        onCopy: handleCardCopy,
        onCopyToTag: handleCardCopyToTag,
        onCopyToDefault: handleCardCopyToDefault,
        onReorder: handleStatementReorder,
        onSelectionChange: handleSelectionChange
    });

    initializeBatchBar({
        onSelectAll: handleBatchSelectAll,
        onDelete: handleBatchDelete,
        onMove: handleBatchMove
    });

    initializeAddBar({
        onAdd: handleAddStatement
    });

    initializeMoreMenu({
        onOpenRecycleBin: handleOpenRecycleBin,
        onOpenShortcutsHelp: handleOpenShortcutsHelp,
        onOpenSettings: handleOpenSettings,
        onOpenAbout: handleOpenAbout
    });

    // 订阅状态变更
    subscribe('tags', function () {
        renderSidebar(getVaultSnapshot());
    });
    subscribe('statements', function () {
        renderStatementList(getVaultSnapshot());
        updateHeaderStats(computeVisibleCount());
    });
    subscribe('ui', function () {
        const vault = getVaultSnapshot();
        updateSearchBarUI({
            keyword: vault.uiState.searchKeyword,
            useRegex: vault.uiState.useRegex,
            searchScope: vault.uiState.searchScope
        });
        updateHeaderStats(computeVisibleCount());
        // 【第一批重构 · 问题 C】同步侧边栏展开状态
        // 场景：导入完整备份 / 重置全局时 replaceVault 替换整个 Vault，
        //       uiState.sidebarExpanded 可能与 sidebar.js 内部的 pinnedState
        //       不同步。此调用保证两者始终一致。
        // 该函数幂等：值相同时立即返回，无副作用、不触发 dispatch。
        syncSidebarExpandedState(vault.uiState.sidebarExpanded);
    });
    // 订阅回收站切片 → 更新徽章
    subscribe('recycleBin', function () {
        const vault = getVaultSnapshot();
        if (!vault || !Array.isArray(vault.recycleBin)) return;
        updateMoreMenuBadge(vault.recycleBin.length);
    });
}

function renderAll() {
    const vault = getVaultSnapshot();
    renderSidebar(vault);
    renderStatementList(vault);
    updateSearchBarUI({
        keyword: vault.uiState.searchKeyword,
        useRegex: vault.uiState.useRegex,
        searchScope: vault.uiState.searchScope
    });
    updateHeaderStats(computeVisibleCount());
    updateBatchBar({
        selectedCount: getSelectedStatementIds().size,
        allSelected: isAllVisibleSelected()
    });
    // 首屏设定更多菜单的徽章计数
    if (vault && Array.isArray(vault.recycleBin)) {
        updateMoreMenuBadge(vault.recycleBin.length);
    }
}

// ==================== 标签事件 ====================

/**
 * 切换标签
 *
 * 【第一批重构 · 问题 A】
 *   在 dispatch('switchTag') 之前先 flush 主列表的滚动位置。
 *
 *   背景：
 *     statement-list.js 的滚动保存采用 150ms 防抖。若用户在防抖
 *     窗口内切换标签，renderStatementList 会立即把 lastRenderedVault
 *     更新为新标签，导致定时器触发时用错误的上下文键写入。
 *
 *     虽然 statement-list.js 已经通过"scroll 事件记录上下文键 + 滚动
 *     位置快照"做了双重防御，但主动 flush 后，防抖窗口立即结束，
 *     不存在"待保存"的中间态，是更稳妥的双保险。
 *
 *   本调用是幂等的：若无待保存的滚动位置，persistCurrentScrollPosition
 *   内部会因无有效快照与 lastRenderedVault 状态而无操作。
 *
 * @param {string} tagId
 */
function handleTagClick(tagId) {
    flushScrollPosition();
    dispatch('switchTag', { tagId: tagId });
}

/**
 * 删除标签
 *
 * 确认框显示该标签下的语句数，
 * 让用户能准确评估操作损失。
 */
async function handleTagDelete(tagId) {
    const vault = getVaultSnapshot();
    const tag = vault.tags.find(function (item) {
        return item.id === tagId;
    });
    if (!tag) return;

    const statementCountInTag = (vault.statementsMap[tagId] || []).length;

    let confirmMessage;
    if (statementCountInTag > 0) {
        confirmMessage = '确定删除标签「' + tag.name + '」及其下的 '
            + statementCountInTag + ' 条语句吗？\n\n此操作不可撤销。';
    } else {
        confirmMessage = '确定删除空标签「' + tag.name + '」吗？\n\n此操作不可撤销。';
    }

    const confirmed = await showConfirmDialog(confirmMessage);
    if (!confirmed) return;

    const didDelete = dispatch('deleteTag', { tagId: tagId });
    if (didDelete) {
        showMessage('标签已删除');
    }
}

async function handleTagEdit(tagId) {
    if (tagId === DEFAULT_TAG_ID) {
        showMessage('默认语库名称不可修改', true);
        return;
    }
    const vault = getVaultSnapshot();
    const tag = vault.tags.find(function (item) {
        return item.id === tagId;
    });
    if (!tag) return;

    const result = await openTagModal({
        mode: 'edit',
        initialName: tag.name,
        initialColor: tag.color
    });
    if (!result) return;

    const isDuplicate = vault.tags.some(function (item) {
        return item.id !== tagId && item.name.trim() === result.name.trim();
    });
    if (isDuplicate) {
        showMessage('标签名已存在，请更换名称', true);
        return;
    }

    const didEdit = dispatch('editTag', {
        tagId: tagId,
        name: result.name,
        color: result.color
    });

    if (!didEdit) {
        showMessage('标签更新失败：名称无效或已被占用', true);
        return;
    }

    showMessage('已更新');
}

function handleTagReorder(orderedIds) {
    const didReorder = dispatch('reorderTags', { orderedIds: orderedIds });
    if (!didReorder) {
        // 拖拽回原位（无变化）时静默，无需提示
    }
}

async function handleAddTag() {
    const result = await openTagModal({
        mode: 'create',
        initialName: '',
        initialColor: null
    });
    if (!result) return;

    const vault = getVaultSnapshot();
    const isDuplicate = vault.tags.some(function (tag) {
        return tag.name.trim() === result.name.trim();
    });
    if (isDuplicate) {
        showMessage('标签名已存在，请更换名称', true);
        return;
    }

    const didAdd = dispatch('addTag', {
        name: result.name,
        color: result.color
    });

    if (!didAdd) {
        showMessage('创建失败：名称重复或超长', true);
        return;
    }

    showMessage('新标签已创建');
}

function handleToggleExpand(expanded) {
    dispatch('setSidebarExpanded', { expanded: expanded });
}

// ==================== 搜索事件 ====================

function handleKeywordChange(keyword) {
    dispatch('setSearchKeyword', { keyword: keyword });
}

function handleRegexToggle(useRegex) {
    dispatch('setUseRegex', { useRegex: useRegex });
}

/**
 * 切换搜索作用域
 * 保留关键词，仅切换范围
 * @param {string} scope
 */
function handleScopeToggle(scope) {
    dispatch('setSearchScope', { scope: scope });
}

function handleClearSearch() {
    const vault = getVaultSnapshot();
    if (vault.uiState.searchKeyword) {
        dispatch('setSearchKeyword', { keyword: '' });
    }
}

// ==================== 语句卡片事件 ====================

async function handleCardEdit(statementId) {
    const vault = getVaultSnapshot();
    const found = findStatementById(vault, statementId);
    if (!found) return;

    const result = await openEditModal({ initialText: found.statement.text });
    if (!result) return;

    // 文本未变：给出明确反馈，避免用户以为按钮失灵
    if (result.text === found.statement.text.trim()) {
        showMessage('未做修改');
        return;
    }

    const isDuplicate = vault.statementsMap[found.tagId].some(function (item) {
        return item.id !== statementId && item.text.trim() === result.text;
    });
    if (isDuplicate) {
        showMessage('❌ 修改后的语句与当前标签下已有语句重复', true);
        return;
    }

    const didEdit = dispatch('editStatement', {
        statementId: statementId,
        newText: result.text
    });

    if (!didEdit) {
        showMessage('修改失败：文本无效或已被占用', true);
        return;
    }

    showMessage('已更新');
}

async function handleCardDelete(statementId) {
    const vault = getVaultSnapshot();
    const found = findStatementById(vault, statementId);
    if (!found) return;

    const confirmed = await showConfirmDialog(
        '确定删除此语句吗？\n\n' + found.statement.text
    );
    if (!confirmed) return;

    const didDelete = dispatch('deleteStatement', { statementId: statementId });
    if (didDelete) {
        showMessage('已删除');
    }
}

/**
 * 复制语句到剪贴板，并累加复制计数。
 *
 * 【M2 修复】增加"卡片是否原本在视口内"的判断。
 *
 * 默认标签下无搜索时，列表按 copyCount 降序排列。
 * 复制操作会使该语句的 copyCount +1，可能导致卡片在列表中重排。
 *
 * 若卡片原本就在视口内：记录前后 top 坐标，位置变化时补偿
 *   scrollTop，使卡片视觉位置保持不变。
 * 若卡片原本就在视口外：位置变化不影响用户视觉焦点，
 *   强行补偿反而会导致"列表莫名跳动"，因此跳过。
 */
async function handleCardCopy(statementId) {
    const vault = getVaultSnapshot();
    const found = findStatementById(vault, statementId);
    if (!found) return;

    try {
        await copyTextToClipboard(found.statement.text);

        // 记录复制前卡片在视口中的 top 坐标
        const previousViewportTop = getStatementCardViewportTopById(statementId);

        // 判断卡片原本是否在视口内
        const wasCardInViewport = previousViewportTop !== null
            && previousViewportTop >= 0
            && previousViewportTop <= window.innerHeight;

        // 执行复制计数递增：可能触发重排
        dispatch('incrementCopyCount', { statementId: statementId });

        // 仅当卡片原本在视口内时才补偿
        if (wasCardInViewport) {
            const nextViewportTop = getStatementCardViewportTopById(statementId);
            if (nextViewportTop !== null) {
                const deltaY = nextViewportTop - previousViewportTop;
                if (Math.abs(deltaY) >= 1) {
                    compensateMainListScrollBy(deltaY);
                }
            }
        }

        showMessage('✅ 已复制到剪贴板');
    } catch (clipboardError) {
        console.warn('[main] 剪贴板写入失败:', clipboardError);
        showMessage('复制失败，请手动复制', true);
    }
}

async function handleCardCopyToTag(statementId) {
    const vault = getVaultSnapshot();
    const found = findStatementById(vault, statementId);
    if (!found) return;

    const candidateTags = vault.tags.filter(function (tag) {
        return tag.id !== found.tagId;
    });
    if (candidateTags.length === 0) {
        showMessage('没有其他标签可复制', true);
        return;
    }

    const counts = {};
    for (const tag of candidateTags) {
        counts[tag.id] = (vault.statementsMap[tag.id] || []).length;
    }

    const result = await openSelectTagModal({
        title: '复制语句到标签',
        tags: candidateTags,
        counts: counts,
        excludeTagId: null
    });
    if (!result) return;

    const targetTagId = result.tagId;

    // 【R4 防御】检查目标标签是否存在
    const targetTag = vault.tags.find(function (tag) {
        return tag.id === targetTagId;
    });
    if (!targetTag) {
        showMessage('目标标签不存在，请刷新页面后重试', true);
        return;
    }

    const isDuplicate = (vault.statementsMap[targetTagId] || []).some(function (item) {
        return item.text.trim() === found.statement.text.trim();
    });
    if (isDuplicate) {
        showMessage('❌ 目标标签「' + targetTag.name + '」中已存在相同语句', true);
        return;
    }

    const didCopy = dispatch('copyStatementToTag', {
        text: found.statement.text,
        targetTagId: targetTagId
    });

    if (!didCopy) {
        showMessage('复制失败：目标标签无效或已存在相同语句', true);
        return;
    }

    showMessage('✅ 已复制到「' + targetTag.name + '」');
}

async function handleCardCopyToDefault(statementId) {
    const vault = getVaultSnapshot();
    const found = findStatementById(vault, statementId);
    if (!found) return;

    if (found.tagId === DEFAULT_TAG_ID) {
        showMessage('该语句已在默认语库中', true);
        return;
    }

    const isDuplicate = (vault.statementsMap[DEFAULT_TAG_ID] || []).some(function (item) {
        return item.text.trim() === found.statement.text.trim();
    });
    if (isDuplicate) {
        showMessage('❌ 默认语库中已存在相同语句', true);
        return;
    }

    const didCopy = dispatch('copyStatementToDefault', { text: found.statement.text });

    if (!didCopy) {
        showMessage('复制失败：默认语库无效或已存在相同语句', true);
        return;
    }

    showMessage('✨ 已添加至默认语库');
}

function handleStatementReorder(tagId, fromIndex, toIndex) {
    const didReorder = dispatch('reorderStatementsInTag', {
        tagId: tagId,
        fromIndex: fromIndex,
        toIndex: toIndex
    });

    if (didReorder) {
        showMessage('顺序已更新');
    }
}

// ==================== 选中与批量事件 ====================

function handleSelectionChange(selectedCount) {
    updateBatchBar({
        selectedCount: selectedCount,
        allSelected: isAllVisibleSelected()
    });
}

function handleBatchSelectAll() {
    toggleSelectAllVisible();
    updateBatchBar({
        selectedCount: getSelectedStatementIds().size,
        allSelected: isAllVisibleSelected()
    });
}

/**
 * 批量删除
 *
 * 【统一清空顺序】与 handleBatchMove 保持一致：
 *   先 clearStatementSelection(false) 清空选中（不渲染），
 *   再 dispatch（触发一次渲染）。
 * 这样渲染函数看到的选中集就是"已清空"的，无需在内部
 * 隐式清理选中状态，职责更清晰。
 *
 * 【M1 修复】回收站溢出警告。
 *   当待删除数量超过 MAX_RECYCLE_BIN_SIZE 时，多余的条目会被
 *   从回收站挤出并永久删除。此约束在原实现中未在确认框中提示，
 *   用户会误以为"所有删除都能恢复"。现附加明确的警告文案，
 *   让用户在点击"确定"之前充分知情。
 */
async function handleBatchDelete() {
    const selectedIds = getSelectedStatementIds();
    if (selectedIds.size === 0) return;

    const vault = getVaultSnapshot();
    const allSelected = getAllStatementsWithTags(vault).filter(function (statement) {
        return selectedIds.has(statement.id);
    });

    // 按 codePoint 截断预览，避免断开 surrogate pair。
    const previewLines = allSelected.slice(0, 3).map(function (statement) {
        const allCharacters = Array.from(statement.text);
        if (allCharacters.length > 30) {
            return allCharacters.slice(0, 30).join('') + '...';
        }
        return statement.text;
    }).join('\n');
    const moreSuffix = allSelected.length > 3 ? '\n...' : '';

    let confirmMessage = '确定删除选中的 ' + selectedIds.size + ' 条语句吗？\n\n'
        + previewLines + moreSuffix;

    // 【M1 修复】回收站溢出警告
    if (selectedIds.size > MAX_RECYCLE_BIN_SIZE) {
        const overflowCount = selectedIds.size - MAX_RECYCLE_BIN_SIZE;
        confirmMessage += '\n\n⚠️ 回收站容量上限为 ' + MAX_RECYCLE_BIN_SIZE
            + ' 条。本次删除后，最旧的 ' + overflowCount
            + ' 条将被永久移除，无法恢复。';
    }

    const confirmed = await showConfirmDialog(confirmMessage);
    if (!confirmed) return;

    // 先清空选中（不渲染），再 dispatch（触发一次渲染）
    clearStatementSelection(false);

    dispatch('batchDeleteStatements', {
        statementIds: Array.from(selectedIds)
    });

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    showMessage('批量删除完成，共移除 ' + selectedIds.size + ' 条');
}

/**
 * 批量移动到标签
 *
 * 【预计算】
 *   在 dispatch 之前做一次完整的预计算，明确区分三类结果：
 *     - 实际移动的数量
 *     - 因"目标标签就是源标签"被跳过的数量
 *     - 因"目标标签中已有相同文本"被跳过的数量
 *
 *   然后根据预计算结果决定：
 *     a) 全部跳过 → 不发 dispatch，直接给出原因
 *     b) 有实际移动 → 发 dispatch，展示明细
 */
async function handleBatchMove() {
    const selectedIds = getSelectedStatementIds();
    if (selectedIds.size === 0) return;

    const vault = getVaultSnapshot();
    const currentTagId = vault.uiState.currentTagId;

    const candidateTags = vault.tags.filter(function (tag) {
        return tag.id !== currentTagId;
    });
    if (candidateTags.length === 0) {
        showMessage('没有其他标签可移动', true);
        return;
    }

    const counts = {};
    for (const tag of candidateTags) {
        counts[tag.id] = (vault.statementsMap[tag.id] || []).length;
    }

    const result = await openSelectTagModal({
        title: '移动选中语句到标签',
        tags: candidateTags,
        counts: counts,
        excludeTagId: null
    });
    if (!result) return;

    const targetTagId = result.tagId;

    // 【R5 防御】检查目标标签是否存在
    const targetTag = vault.tags.find(function (tag) {
        return tag.id === targetTagId;
    });
    if (!targetTag) {
        showMessage('目标标签不存在，请刷新页面后重试', true);
        return;
    }

    // ---------- 预计算 ----------
    const selectedItems = [];
    for (const sourceTagId of Object.keys(vault.statementsMap)) {
        for (const statement of vault.statementsMap[sourceTagId]) {
            if (selectedIds.has(statement.id)) {
                selectedItems.push({
                    statement: statement,
                    sourceTagId: sourceTagId
                });
            }
        }
    }

    const targetExistingTexts = new Set(
        (vault.statementsMap[targetTagId] || []).map(function (item) {
            return String(item.text).trim();
        })
    );

    let willMoveCount = 0;
    let sameTagSkippedCount = 0;
    let duplicateSkippedCount = 0;

    for (const item of selectedItems) {
        if (item.sourceTagId === targetTagId) {
            sameTagSkippedCount++;
            continue;
        }
        const normalizedText = String(item.statement.text).trim();
        if (targetExistingTexts.has(normalizedText)) {
            duplicateSkippedCount++;
            continue;
        }
        targetExistingTexts.add(normalizedText);
        willMoveCount++;
    }

    // ---------- 分支 a：全部被跳过 ----------
    if (willMoveCount === 0) {
        clearStatementSelection();

        let reasonMessage = '未移动任何语句';
        const skipParts = [];
        if (sameTagSkippedCount > 0) {
            skipParts.push(sameTagSkippedCount + ' 条已在目标标签中');
        }
        if (duplicateSkippedCount > 0) {
            skipParts.push(duplicateSkippedCount + ' 条与目标标签已有语句重复');
        }
        if (skipParts.length > 0) {
            reasonMessage += '（' + skipParts.join('、') + '）';
        }
        showMessage(reasonMessage, true);
        return;
    }

    // ---------- 分支 b：执行移动 ----------
    // 先清空选中（不触发渲染），再 dispatch（触发一次渲染）
    clearStatementSelection(false);

    dispatch('batchMoveStatements', {
        statementIds: Array.from(selectedIds),
        targetTagId: targetTagId
    });

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    let message = '✅ 已移动 ' + willMoveCount + ' 条到「' + targetTag.name + '」';
    if (sameTagSkippedCount > 0 || duplicateSkippedCount > 0) {
        const skipParts = [];
        if (sameTagSkippedCount > 0) {
            skipParts.push(sameTagSkippedCount + ' 条已在目标标签中');
        }
        if (duplicateSkippedCount > 0) {
            skipParts.push(duplicateSkippedCount + ' 条文本重复');
        }
        message += '；跳过 ' + (sameTagSkippedCount + duplicateSkippedCount)
            + ' 条（' + skipParts.join('、') + '）';
    }
    showMessage(message);
}

// ==================== 添加语句 ====================

/**
 * 添加语句到底部输入区。
 *
 * 【M4 修复】延迟滚动的上下文校验扩展为四元组。
 *
 * 【P1-N2 修复】使用 dispatch 返回值判断命令是否真的执行。
 */
function handleAddStatement(text) {
    const vault = getVaultSnapshot();
    const currentTagId = vault.uiState.currentTagId;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const isDuplicate = (vault.statementsMap[currentTagId] || []).some(function (item) {
        return item.text.trim() === trimmedText;
    });
    if (isDuplicate) {
        showMessage('❌ 当前标签下已存在相同语句', true);
        return;
    }

    // 记录添加时的上下文快照（四元组）
    const scrollContextAtAddTime = {
        tagId: currentTagId,
        searchScope: vault.uiState.searchScope,
        searchKeyword: vault.uiState.searchKeyword,
        useRegex: vault.uiState.useRegex
    };

    const didAdd = dispatch('addStatement', {
        tagId: currentTagId,
        text: trimmedText
    });

    if (!didAdd) {
        showMessage('添加失败：语句重复或标签无效', true);
        return;
    }

    clearAddBarInput();
    showMessage('添加成功');

    setTimeout(function () {
        const latestVault = getVaultSnapshot();
        if (!latestVault || !latestVault.uiState) return;

        // 若上下文已改变，跳过滚动，避免滚错标签 / 滚错可见集
        if (latestVault.uiState.currentTagId !== scrollContextAtAddTime.tagId) return;
        if (latestVault.uiState.searchScope !== scrollContextAtAddTime.searchScope) return;
        if (latestVault.uiState.searchKeyword !== scrollContextAtAddTime.searchKeyword) return;
        if (latestVault.uiState.useRegex !== scrollContextAtAddTime.useRegex) return;

        scrollMainListToBottom();
    }, ADD_STATEMENT_SCROLL_DELAY_MS);
}

// ==================== 导入 / 导出 / 重置 ====================

/**
 * 导出完整工作区为 JSON 文件。
 *
 * 【P3-N4 + W2 + N1 修复】延迟释放 ObjectURL、挂载到 DOM、
 * 使用屏幕外绝对定位（非 display: none）。
 *
 * 【C3 修复】补全导出字段。
 *   exportData 现完整包含 tags / statementsMap / recycleBin /
 *   uiState / settings 五个字段，与 Vault 顶层结构一一对应。
 */
async function handleExport() {
    const vault = getVaultSnapshot();
    const exportData = {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings,
        version: '7.0.0',
        exportDate: new Date().toISOString()
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    const downloadLink = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    downloadLink.href = objectUrl;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const totalStatements = Object.values(vault.statementsMap).reduce(function (sum, list) {
        return sum + list.length;
    }, 0);

    downloadLink.download = 'deepseek_backup_' + timestamp
        + '_tags' + vault.tags.length
        + '_items' + totalStatements + '.json';

    // 挂载到 DOM 且保持可渲染（屏幕外定位）
    downloadLink.style.position = 'absolute';
    downloadLink.style.left = '-9999px';
    downloadLink.style.top = '0';
    downloadLink.style.width = '1px';
    downloadLink.style.height = '1px';
    downloadLink.style.opacity = '0';
    document.body.appendChild(downloadLink);

    downloadLink.click();

    // 立即从 DOM 移除（click 已同步触发下载启动）
    document.body.removeChild(downloadLink);

    // 延迟释放 ObjectURL，确保下载已启动
    setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
    }, 1000);

    showMessage('已导出完整工作区');
}

async function handleImport(file) {
    if (!file) return;

    // 文件大小上限校验，防止超大文件阻塞主线程
    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
        const fileSizeInMegabytes = (file.size / 1024 / 1024).toFixed(1);
        const limitInMegabytes = (MAX_IMPORT_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0);
        showMessage(
            '导入文件过大（' + fileSizeInMegabytes + ' MB），上限 ' + limitInMegabytes + ' MB',
            true
        );
        return;
    }

    const reader = new FileReader();

    reader.onload = async function (event) {
        try {
            const parsedData = JSON.parse(event.target.result);

            if (Array.isArray(parsedData)) {
                await handleLegacyImport(parsedData);
                return;
            }

            if (parsedData && parsedData.tags && parsedData.statementsMap) {
                await handleFullImport(parsedData);
                return;
            }

            throw new Error('格式不支持');
        } catch (importError) {
            showMessage('导入失败: ' + importError.message, true);
        }
    };

    // 【R3 修复】处理文件读取失败
    reader.onerror = function (readErrorEvent) {
        console.error('[main] FileReader 读取失败:', readErrorEvent);
        showMessage('读取文件失败，请重试', true);
    };

    reader.readAsText(file);
}

/**
 * 旧格式（纯数组）导入：一次性批处理，避免逐条 dispatch 触发 N 次加密
 * @param {Array} parsedArray
 */
async function handleLegacyImport(parsedArray) {
    const confirmed = await showConfirmDialog(
        '检测到旧格式语句列表。是否导入到【当前标签】？(重复语句将被跳过)'
    );
    if (!confirmed) return;

    const vault = getVaultSnapshot();
    const currentTagId = vault.uiState.currentTagId;
    const beforeCount = (vault.statementsMap[currentTagId] || []).length;

    const validEntries = [];
    for (const item of parsedArray) {
        const rawText = String((item && item.text) || '');
        const trimmedText = rawText.trim();
        if (!trimmedText) continue;
        const rawCopyCount = item && item.copyCount;
        const copyCount = (typeof rawCopyCount === 'number' && Number.isFinite(rawCopyCount))
            ? Math.max(0, Math.floor(rawCopyCount))
            : 0;
        validEntries.push({ text: trimmedText, copyCount: copyCount });
    }

    if (validEntries.length === 0) {
        showMessage('导入文件中没有有效语句', true);
        return;
    }

    const didAdd = dispatch('addStatementsBatch', {
        tagId: currentTagId,
        entries: validEntries
    });

    if (!didAdd) {
        showMessage('导入失败：没有可添加的新语句', true);
        return;
    }

    const afterVault = getVaultSnapshot();
    const afterCount = (afterVault.statementsMap[currentTagId] || []).length;
    const addedCount = afterCount - beforeCount;
    const skippedCount = validEntries.length - addedCount;

    showMessage('导入完成: 新增 ' + addedCount + ' 条，跳过重复 ' + skippedCount + ' 条');
}

/**
 * 完整备份导入：归一化后整块替换
 *
 * 【P2-N1 修复】
 *   归一化步骤包入 try 块，异常时提前返回，
 *   不改变当前选中状态与 Vault。
 *
 * 【C3 / C4 修复】
 *   C3：从 parsedData 读取 recycleBin 与 settings 并传给
 *       normalizeVault，避免导入后回收站与用户偏好丢失。
 *   C4：replaceVault 的切片列表补 'recycleBin'，
 *       使更多菜单徽章计数随新数据同步刷新。
 *
 * 【第一批重构】
 *   subscribe('ui') 中已增加 syncSidebarExpandedState，
 *   无需在此处额外处理侧边栏展开状态。
 *
 * @param {Object} parsedData
 */
async function handleFullImport(parsedData) {
    const confirmed = await showConfirmDialog('导入完整备份将覆盖当前所有数据，确定吗？');
    if (!confirmed) return;

    // ---------- 导入前的原始统计 ----------
    const originalTagCount = Array.isArray(parsedData.tags)
        ? parsedData.tags.length
        : 0;

    let originalStatementCount = 0;
    if (parsedData.statementsMap
        && typeof parsedData.statementsMap === 'object') {
        for (const tagId of Object.keys(parsedData.statementsMap)) {
            const list = parsedData.statementsMap[tagId];
            if (Array.isArray(list)) {
                originalStatementCount += list.length;
            }
        }
    }

    // ---------- 归一化（包入 try，异常时提前返回） ----------
    let normalizedVault;
    try {
        normalizedVault = ensureDefaultTagExists(normalizeVault({
            tags: parsedData.tags,
            statementsMap: parsedData.statementsMap,
            recycleBin: parsedData.recycleBin,
            uiState: parsedData.uiState,
            settings: parsedData.settings
        }));
    } catch (normalizeError) {
        console.error('[main] 归一化导入数据失败:', normalizeError);
        showMessage('导入失败：数据格式异常，未修改任何数据', true);
        return;
    }

    // ---------- 归一化后的统计 ----------
    let normalizedStatementCount = 0;
    for (const tagId of Object.keys(normalizedVault.statementsMap)) {
        normalizedStatementCount += normalizedVault.statementsMap[tagId].length;
    }

    const droppedTagCount = Math.max(
        0,
        originalTagCount - normalizedVault.tags.length
    );
    const droppedStatementCount = Math.max(
        0,
        originalStatementCount - normalizedStatementCount
    );

    // 先清空选中（不触发重渲染，避免与 replaceVault 的重渲染竞争）
    clearStatementSelection(false);

    // 整块替换：切片列表补 'recycleBin'
    replaceVault(normalizedVault, ['tags', 'statements', 'ui', 'recycleBin']);

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    // ---------- 结果提示 ----------
    let message = '导入成功：' + normalizedVault.tags.length
        + ' 个标签，' + normalizedStatementCount + ' 条语句';

    // 提示回收站条目数（若有）
    if (normalizedVault.recycleBin.length > 0) {
        message += '，回收站 ' + normalizedVault.recycleBin.length + ' 条';
    }

    if (droppedTagCount > 0 || droppedStatementCount > 0) {
        const dropParts = [];
        if (droppedTagCount > 0) {
            dropParts.push(droppedTagCount + ' 个非法标签');
        }
        if (droppedStatementCount > 0) {
            dropParts.push(droppedStatementCount + ' 条非法语句');
        }
        message += '（已忽略 ' + dropParts.join('、') + '）';
    }

    showMessage(message);
}

/**
 * 重置全局
 *
 * 【C4 修复】replaceVault 的切片列表补 'recycleBin'，
 *   使更多菜单徽章计数与重置后的空回收站同步刷新。
 *
 * 【第一批重构】
 *   subscribe('ui') 中已增加 syncSidebarExpandedState，
 *   无需在此处额外处理侧边栏展开状态。
 */
async function handleReset() {
    const confirmed = await showConfirmDialog(
        '重置全局会丢失所有自定义数据，恢复为内置语料库。确定吗？'
    );
    if (!confirmed) return;

    const presetVault = ensureDefaultTagExists(
        normalizeVault(createVaultFromBuiltinPreset())
    );

    clearStatementSelection(false);

    // 切片列表补 'recycleBin'
    replaceVault(presetVault, ['tags', 'statements', 'ui', 'recycleBin']);

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    showMessage('已恢复内置语料库');
}

// ==================== 更多菜单 / 设置 / 回收站 ====================

/**
 * 打开回收站面板
 *
 * 流程：
 *   1. 先 dispatch 清理过期条目（幂等：无过期时 Facade 会返回 false）
 *   2. 打开面板，传入最新数据拉取器与 handlers
 */
async function handleOpenRecycleBin() {
    // 1. 清理过期条目
    //    幂等命令：若无过期条目，Facade 会返回 false，静默无副作用
    dispatch('cleanupExpiredRecycleBinItems', {});

    // 2. 打开面板
    await openRecycleBinModal({
        getItems: function () {
            const vault = getVaultSnapshot();
            return (vault && Array.isArray(vault.recycleBin))
                ? vault.recycleBin
                : [];
        },
        handlers: {
            onRestoreSingle: handleRecycleRestoreSingle,
            onRestoreBatch: handleRecycleRestoreBatch,
            onPurgeSingle: handleRecyclePurgeSingle,
            onPurgeBatch: handleRecyclePurgeBatch,
            onClearAll: handleRecycleClearAll
        }
    });
}

/**
 * 更多菜单 → 快捷键帮助
 *
 * 【设计说明】
 *   项目当前未提供独立的"快捷键帮助"模态框（避免为单一功能引入新组件）。
 *   这里使用 Toast 呈现简短提示，用户如需完整列表可查阅 README。
 */
function handleOpenShortcutsHelp() {
    showMessage(
        '快捷键：Ctrl+K 搜索 · Ctrl+/ 新建 · Esc 关闭 · Delete 删除选中'
    );
}

/**
 * 更多菜单 → 设置
 *
 * 【C2 修复】将设置面板接线到 UI 入口。
 *
 * 每次打开设置面板时从 getVaultSnapshot() 重新读取最新的
 * vault.settings，确保面板内显示的开关状态与数据强一致。
 *
 * 开关切换后，若 dispatch 被拒（settings.js 中的 onToggle 返回 false），
 * 由 settings.js 内部回滚视觉状态。本函数不处理回滚逻辑。
 *
 * @returns {Promise<void>} 面板关闭时 resolve
 */
async function handleOpenSettings() {
    const vault = getVaultSnapshot();
    if (!vault || !vault.settings) {
        // 理论上不会发生（normalizeVault 保证 settings 存在），
        // 但作为防御性处理，给出明确反馈而非静默失败。
        showMessage('设置加载失败：数据状态异常', true);
        return;
    }

    await openSettingsModal({
        settings: vault.settings,
        onToggle: handleSettingsToggle
    });
}

/**
 * 更多菜单 → 关于
 *
 * 【设计说明】
 *   同 handleOpenShortcutsHelp：使用 Toast 呈现简短的版本信息。
 */
function handleOpenAbout() {
    showMessage(
        'DeepSeek 语句工坊 · 命令-查询分离架构 · AES-256-GCM 加密 · 本地存储'
    );
}

/**
 * 设置面板 → 切换某个设置项
 *
 * 【返回值语义】
 *   返回 true  = 命令实际执行（或已是目标值，视觉状态无需回滚）；
 *   返回 false = 命令被拒且真实值未变化，UI 应回滚。
 *
 * settings.js 中的开关根据此返回值决定是否回滚视觉状态。
 *
 * 【M3 修复】
 *   dispatch 返回 false 可能是"幂等"（值未变化，实际上已成功）
 *   或"命令被拒"（校验失败）。原实现直接把 false 透传给
 *   settings.js，导致在幂等情况（用户点击一个与当前值相同的开关）
 *   下错误回滚视觉状态，呈现"点击无效"的观感。
 *
 *   现通过读取最新 vault.settings 判定：若最新值已等于目标值，
 *   说明是幂等而非失败，返回 true（不回滚）。
 *
 * @param {string} key 设置项键名
 * @param