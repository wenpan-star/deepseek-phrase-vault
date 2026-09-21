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
// 【第 7 轮补充修复（本轮 N1 / N2）】
//   N1（Safari 下载兼容性强化）：
//     handleExport 中把 downloadLink 的 display: none 改为
//     屏幕外绝对定位（position: absolute; left: -9999px）。
//
//     背景：
//       部分 Safari 版本（15 之前）会检查下载元素是否"renderable"。
//       display: none 的元素被判定为不可渲染，即使挂载到 DOM 树中，
//       也会跳过下载调度。
//
//       屏幕外定位既满足"在 DOM 树中"（W2 的初衷），
//       又满足"可渲染"（N1 的目标），是跨浏览器最稳的做法。
//
//   N2（iOS Safari 剪贴板降级路径兼容性）：
//     copyTextToClipboard 中删除冗余的 setSelectionRange 调用。
//
//     背景：
//       iOS Safari 对 readonly textarea 调用 setSelectionRange 可能抛
//       InvalidStateError。一旦抛异常，execCommand('copy') 不会执行，
//       用户看到"复制失败"。而实际上 select() 已完整选中内容，
//       execCommand 本可成功。
//
//       删除冗余调用（select() 已等价于 setSelectionRange(0, length)），
//       可最大化跨浏览器成功率。
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
    MAX_IMPORT_FILE_SIZE_BYTES
} from './constants.js';
import {
    createVaultFromBuiltinPreset,
    findStatementById,
    getAllStatementsWithTags,
    normalizeVault,
    ensureDefaultTagExists
} from './core/vault.js';
import { matchSearch } from './commands/search.js';

import { initializeToast, showMessage } from './views/toast.js';
import { showConfirmDialog } from './views/modals/confirm.js';
import { openEditModal } from './views/modals/edit.js';
import { openTagModal } from './views/modals/tag.js';
import { openSelectTagModal } from './views/modals/select-tag.js';

import {
    initializeSidebar,
    renderSidebar
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
import { initializeShortcuts } from './shortcuts.js';

// ==================== 浏览器剪贴板 ====================

/**
 * 复制文本到剪贴板。
 *
 * 【策略】双路径降级：
 *   1. 优先使用现代 Clipboard API（需要 HTTPS 或 localhost 上下文）
 *   2. 若现代 API 不存在，或调用时抛异常（例如在 HTTP 上下文、
 *      或用户拒绝权限），则回退到旧的 execCommand('copy')
 *
 * 【R2 修复说明】
 *   此前实现中，若 `navigator.clipboard.writeText` 抛异常，
 *   异常会传播到调用方（handleCardCopy 的 catch），
 *   显示"复制失败"，但实际上 execCommand 是可用的。
 *   现改为：现代 API 失败时仍尝试 execCommand，最大化成功率。
 *
 * 【N2 修复说明（本轮）】
 *   删除了降级路径中的 setSelectionRange 调用。
 *
 *   原因：
 *     iOS Safari 对 readonly textarea 调用 setSelectionRange 时可能抛
 *     InvalidStateError。一旦抛异常，execCommand('copy') 不会执行，
 *     用户看到"复制失败"——而实际上 select() 已完整选中内容，
 *     execCommand 本可成功。
 *
 *     而 select() 在功能上等价于 setSelectionRange(0, value.length)，
 *     因此 setSelectionRange 调用本身是冗余的。
 *     删除冗余调用可最大化跨浏览器成功率。
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
            // 现代 API 失败（例如 HTTP 上下文、权限被拒、页面失焦等），
            // 记录日志后继续尝试路径 2。不直接抛异常，避免错过 fallback。
            console.warn(
                '[main] 现代剪贴板 API 失败，尝试 execCommand 降级:',
                modernClipboardError
            );
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
        // 【N2 修复】不再调用 setSelectionRange：
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

async function bootstrap() {
    // 1. Font Awesome 异步加载，不阻塞初始化
    initializeFontAwesomeLoader();

    // 2. Toast 容器
    initializeToast();

    // 3. 初始化 Facade（从存储加载 Vault）
    await initializeFacade({ toastHandler: showMessage });

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
}

// ==================== 标签事件 ====================

function handleTagClick(tagId) {
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
        // 只有视口内的卡片才需要滚动补偿；视口外的卡片位置变化
        // 不会影响用户的视觉焦点，强行补偿反而会造成"列表莫名跳动"
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
    // 理论上 openSelectTagModal 返回的 tagId 来自 candidateTags，
    // 而 candidateTags 来自当前 vault，一定存在。
    // 但纯防御性检查可避免极端情况（例如异步过程中 vault 被替换）下的
    // TypeError 崩溃。
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
 */
async function handleBatchDelete() {
    const selectedIds = getSelectedStatementIds();
    if (selectedIds.size === 0) return;

    const vault = getVaultSnapshot();
    const allSelected = getAllStatementsWithTags(vault).filter(function (statement) {
        return selectedIds.has(statement.id);
    });

    // 【N5 修复】按 codePoint 截断预览，避免断开 surrogate pair。
    const previewLines = allSelected.slice(0, 3).map(function (statement) {
        const allCharacters = Array.from(statement.text);
        if (allCharacters.length > 30) {
            return allCharacters.slice(0, 30).join('') + '...';
        }
        return statement.text;
    }).join('\n');
    const moreSuffix = allSelected.length > 3 ? '\n...' : '';

    const confirmed = await showConfirmDialog(
        '确定删除选中的 ' + selectedIds.size + ' 条语句吗？\n\n'
        + previewLines + moreSuffix
    );
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
    // 同 handleCardCopyToTag 的 R4 防御说明。
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
    // 【N9 修复】先清空选中（不触发渲染），再 dispatch（触发一次渲染）
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
 * 背景：
 *   clearAddBarInput 之后通过 setTimeout(ADD_STATEMENT_SCROLL_DELAY_MS)
 *   延迟调用 scrollMainListToBottom。这 50ms 内用户可能已经：
 *     - 切换到其他标签
 *     - 从本地搜索切到全局搜索
 *     - 输入了搜索关键词
 *     - 切换了正则模式
 *   此时若无条件滚动到底部，会让用户感到"切换标签后列表莫名跳到底部"。
 *
 * 修复：
 *   记录添加时的 (tagId, searchScope, searchKeyword, useRegex) 四元组，
 *   在 setTimeout 回调中校验当前状态是否与之一致，不一致则跳过滚动。
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
 * 【P3-N4 修复】延迟释放 ObjectURL。
 *
 * 部分浏览器（尤其 Safari）在 click() 后下载流程是异步启动的，
 * 立即 revoke 可能中断下载。延迟 1 秒释放足以覆盖绝大多数浏览器的
 * 下载启动时间，同时避免内存泄漏。
 *
 * 【W2 修复】将 downloadLink 挂载到 DOM 后再 click()。
 *
 * 背景：
 *   Chrome / Firefox 允许对未挂载到 DOM 的 <a> 元素调用 click()
 *   触发下载，但 Safari 的部分版本（特别是旧版）要求元素必须在
 *   文档树中，否则 click 不会启动下载。
 *
 *   修复：把 downloadLink 添加到 document.body 后再 click()，
 *         click() 完成后立即从 DOM 移除（不在 DOM 中留下垃圾节点）。
 *
 * 【N1 修复（本轮）】用屏幕外定位替代 display: none。
 *
 * 问题分析：
 *   部分 Safari 版本（15 之前）会检查下载元素是否"renderable"。
 *   display: none 的元素被判定为不可渲染，即使挂载到 DOM 树中，
 *   也会跳过下载调度。
 *
 *   这与 W2 的初衷（让元素在 DOM 树中）看似矛盾——实际上：
 *     · W2 修复的是"元素不在 DOM 树中"这一层问题
 *     · N1 修复的是"元素在 DOM 树中但不可渲染"这更深一层的问题
 *
 *   修复方案：
 *     使用屏幕外绝对定位（position: absolute; left: -9999px）。
 *     这样元素：
 *       · 在 DOM 树中 ✅（满足 W2）
 *       · 有布局且可渲染 ✅（满足 N1）
 *       · 不可见 ✅（不干扰用户视觉）
 */
async function handleExport() {
    const vault = getVaultSnapshot();
    const exportData = {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: vault.uiState,
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

    // 【W2 + N1 修复】挂载到 DOM 且保持可渲染（屏幕外定位）
    // 不再使用 display: none，避免部分 Safari 版本跳过下载调度
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

    // 延迟释放 ObjectURL，确保下载已启动（P3-N4 修复）
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

    // 【R3 修复】处理文件读取失败（例如文件被删除、磁盘错误、
    // 权限不足等），避免用户看不到任何提示。
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
 *   导入成功后显式更新批量栏，确保 UI 状态与数据强一致。
 *
 * 归一化会执行以下清理：
 *   - 丢弃 id / name 为空的非法标签
 *   - 丢弃无主标签（引用了不存在的 tagId）的语句
 *   - 丢弃 id / text 为空的非法语句
 *   - 丢弃同 id 重复语句（保留第一条）
 *   - 丢弃非法颜色（回退为 null）
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
            uiState: parsedData.uiState
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

    // 归一化可能补入默认标签，因此 droppedTagCount 取 max(0, ...)，
    // 避免"标签数不减反增"时给出负数提示
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

    // 整块替换：replaceVault 内部会通知三个 slice
    replaceVault(normalizedVault, ['tags', 'statements', 'ui']);

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    // ---------- 结果提示 ----------
    let message = '导入成功：' + normalizedVault.tags.length
        + ' 个标签，' + normalizedStatementCount + ' 条语句';

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

async function handleReset() {
    const confirmed = await showConfirmDialog(
        '重置全局会丢失所有自定义数据，恢复为内置语料库。确定吗？'
    );
    if (!confirmed) return;

    const presetVault = ensureDefaultTagExists(
        normalizeVault(createVaultFromBuiltinPreset())
    );

    clearStatementSelection(false);

    replaceVault(presetVault, ['tags', 'statements', 'ui']);

    // 显式更新批量栏，确保 UI 状态与数据强一致
    updateBatchBar({
        selectedCount: 0,
        allSelected: false
    });

    showMessage('已恢复内置语料库');
}

// ==================== 统计与滚动 ====================

function computeVisibleCount() {
    const vault = getVaultSnapshot();
    const currentTagId = vault.uiState.currentTagId;
    const isGlobalMode = vault.uiState.searchScope === SEARCH_SCOPE_GLOBAL;
    const keyword = vault.uiState.searchKeyword;
    const useRegex = vault.uiState.useRegex;

    if (isGlobalMode) {
        const all = getAllStatementsWithTags(vault);
        if (!keyword) return all.length;
        return all.filter(function (statement) {
            return matchSearch(statement.text, keyword, useRegex);
        }).length;
    }

    const localList = vault.statementsMap[currentTagId] || [];
    if (!keyword) return localList.length;
    return localList.filter(function (statement) {
        return matchSearch(statement.text, keyword, useRegex);
    }).length;
}

/**
 * 绑定侧边栏滚动保存 + beforeunload 兜底
 * 主列表滚动保存已内聚到 statement-list.js，此处不再处理
 */
function bindSidebarScrollMemory() {
    const sidebarTagsElement = document.getElementById('sidebarTagsList');
    let scrollSaveTimer = null;

    function saveSidebarScroll() {
        if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(function () {
            if (sidebarTagsElement) {
                try {
                    sessionStorage.setItem(
                        SESSION_KEY_SIDEBAR_SCROLL_POSITION,
                        String(sidebarTagsElement.scrollTop)
                    );
                } catch (storageError) {
                    console.warn('[main] sessionStorage 写入失败:', storageError);
                }
            }
        }, SCROLL_SAVE_DEBOUNCE_MS);
    }

    if (sidebarTagsElement) {
        sidebarTagsElement.addEventListener('scroll', saveSidebarScroll, { passive: true });
    }

    window.addEventListener('beforeunload', function () {
        if (sidebarTagsElement) {
            try {
                sessionStorage.setItem(
                    SESSION_KEY_SIDEBAR_SCROLL_POSITION,
                    String(sidebarTagsElement.scrollTop)
                );
            } catch (storageError) {
                // 忽略 beforeunload 期间的存储异常
            }
        }
        // 主列表滚动位置
        flushScrollPosition();
        // 防抖持久化
        flushDebouncedPersist();
    });
}

/**
 * 恢复侧边栏滚动位置
 * 主列表滚动位置由 statement-list.js 在首次渲染时自动恢复
 *
 * 【R1 修复】sessionStorage.getItem 包裹 try/catch。
 *
 * 在极端的浏览器策略环境下（例如企业策略禁用 sessionStorage），
 * getItem 会抛出 SecurityError。此前会导致 bootstrap() 失败、
 * 应用启动失败。现改为：读取失败时静默跳过恢复，
 * 使用默认滚动位置（顶部）。
 */
function restoreSidebarScrollState() {
    const sidebarTagsElement = document.getElementById('sidebarTagsList');
    if (!sidebarTagsElement) return;

    try {
        const savedSidebarScroll = sessionStorage.getItem(
            SESSION_KEY_SIDEBAR_SCROLL_POSITION
        );
        if (savedSidebarScroll === null) return;
        const parsed = parseFloat(savedSidebarScroll);
        if (!Number.isNaN(parsed)) {
            sidebarTagsElement.scrollTop = parsed;
        }
    } catch (storageError) {
        // 读取失败时静默跳过，不影响应用启动
        console.warn('[main] sessionStorage 读取失败:', storageError);
    }
}

// ==================== 启动 ====================

bootstrap().catch(function (bootstrapError) {
    console.error('[main] 启动失败:', bootstrapError);
    try {
        showMessage('应用启动失败，请刷新页面重试', true);
    } catch (toastError) {
        alert('应用启动失败，请刷新页面重试');
    }
});