// filename: src/commands/ui-state.js
// ========================================================================
// DeepSeek 语句工坊 · UI 状态变更
// 包含：切换当前标签 / 搜索关键词 / 正则模式 / 搜索作用域 / 侧边栏展开
// 全部为纯函数
//
// 【本次调整】
//   删除 setScrollPositions 函数。
//   原因：滚动位置已从 Vault 迁移到 sessionStorage（见 statement-list.js
//         与 main.js 中的 scroll memory 相关函数），Vault 中不再承载
//         mainListScrollTop / sidebarScrollTop 字段。
//   该函数的原注册项（commands/index.js）也会同步移除。
// ========================================================================

import { SEARCH_SCOPE_LOCAL } from '../constants.js';

/**
 * 切换当前标签
 * 切标签时自动切回本地搜索作用域，保留搜索关键词以延续搜索上下文
 * （与旧版行为一致，非缺陷；若需清空关键词可修改下方 searchKeyword 字段）
 * @param {Object} vault
 * @param {{ tagId: string }} payload
 * @returns {Object} 新 Vault
 */
export function switchTag(vault, payload) {
    const tagId = payload.tagId;
    if (!tagId) return vault;
    if (!vault.tags.some(function (tag) { return tag.id === tagId; })) return vault;
    if (vault.uiState.currentTagId === tagId) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: {
            ...vault.uiState,
            currentTagId: tagId,
            searchScope: SEARCH_SCOPE_LOCAL
        }
    };
}

/**
 * 设置搜索关键词
 * @param {Object} vault
 * @param {{ keyword: string }} payload
 * @returns {Object} 新 Vault
 */
export function setSearchKeyword(vault, payload) {
    const keyword = String(payload.keyword || '');
    if (vault.uiState.searchKeyword === keyword) return vault;
    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: { ...vault.uiState, searchKeyword: keyword }
    };
}

/**
 * 设置是否启用正则
 * @param {Object} vault
 * @param {{ useRegex: boolean }} payload
 * @returns {Object} 新 Vault
 */
export function setUseRegex(vault, payload) {
    const useRegex = Boolean(payload.useRegex);
    if (vault.uiState.useRegex === useRegex) return vault;
    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: { ...vault.uiState, useRegex: useRegex }
    };
}

/**
 * 设置搜索作用域
 * @param {Object} vault
 * @param {{ scope: string }} payload  'local' | 'global'
 * @returns {Object} 新 Vault
 */
export function setSearchScope(vault, payload) {
    const scope = payload.scope;
    if (vault.uiState.searchScope === scope) return vault;
    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: { ...vault.uiState, searchScope: scope }
    };
}

/**
 * 设置侧边栏展开状态
 * @param {Object} vault
 * @param {{ expanded: boolean }} payload
 * @returns {Object} 新 Vault
 */
export function setSidebarExpanded(vault, payload) {
    const expanded = Boolean(payload.expanded);
    if (vault.uiState.sidebarExpanded === expanded) return vault;
    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        uiState: { ...vault.uiState, sidebarExpanded: expanded }
    };
}