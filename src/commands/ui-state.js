// filename: src/commands/ui-state.js
// ========================================================================
// DeepSeek 语句工坊 · UI 状态变更
// 包含：切换当前标签 / 搜索关键词 / 正则模式 / 搜索作用域 / 侧边栏展开
// 全部为纯函数
//
// 【历史调整】
//   删除 setScrollPositions 函数。
//
// 【方案 A（上一轮）】
//   1. 所有函数的返回对象补齐 recycleBin 和 settings 字段，
//      保证 vault 顶层结构完整性。
//   2. 移除 setInitialsSearchEnabled 函数。
//      原因：该函数已在 commands/settings-crud.js 中实现，
//            语义上属于"设置项变更"而非"UI 状态变更"。
//            集中到 settings-crud.js 保持职责清晰。
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
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
        recycleBin: vault.recycleBin,
        settings: vault.settings,
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
        recycleBin: vault.recycleBin,
        settings: vault.settings,
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
        recycleBin: vault.recycleBin,
        settings: vault.settings,
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
        recycleBin: vault.recycleBin,
        settings: vault.settings,
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
        recycleBin: vault.recycleBin,
        settings: vault.settings,
        uiState: { ...vault.uiState, sidebarExpanded: expanded }
    };
}