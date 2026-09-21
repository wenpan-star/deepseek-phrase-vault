// filename: src/commands/tag-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 标签增 / 改 / 删 / 排序
// 全部为纯函数
//
// 【本次改进 · N6 修复】
//   addTag / editTag 增加"标签名长度上限"校验。
//
//   背景：
//     UI 层（views/modals/tag.js）通过 <input maxlength="20">
//     限制用户输入，但命令层此前没有任何防御。
//
//   风险：
//     若未来出现其他调用路径（如导入、自动化脚本、控制台调试）
//     绕过 UI 层，可能写入超长名称，导致侧边栏渲染时撑破布局。
//
//   修复：
//     命令层使用 MAX_TAG_NAME_LENGTH 常量做兜底校验，
//     与 UI 层的 maxlength 属性保持一致。
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import {
    DEFAULT_TAG_ID,
    DEFAULT_TAG_NAME,
    PRESET_COLORS,
    MAX_TAG_NAME_LENGTH
} from '../constants.js';

/**
 * 新建标签
 * @param {Object} vault
 * @param {{ name: string, color: string|null }} payload
 * @returns {Object} 新 Vault
 */
export function addTag(vault, payload) {
    const trimmedName = String(payload.name || '').trim();
    if (!trimmedName) return vault;

    // 名称长度上限：与 UI 层 maxlength 属性保持一致
    if (trimmedName.length > MAX_TAG_NAME_LENGTH) return vault;

    // 标签名不能重复
    const isDuplicate = vault.tags.some(function (tag) {
        return tag.name.trim() === trimmedName;
    });
    if (isDuplicate) return vault;

    // 颜色白名单校验：只接受预设调色板中的颜色
    const validatedColor = PRESET_COLORS.includes(payload.color) ? payload.color : null;

    const newTag = {
        id: generateUniqueId(),
        name: trimmedName,
        color: validatedColor
    };

    return {
        tags: [...vault.tags, newTag],
        statementsMap: {
            ...vault.statementsMap,
            [newTag.id]: []
        },
        uiState: vault.uiState
    };
}

/**
 * 编辑标签（名称 + 颜色）
 * @param {Object} vault
 * @param {{ tagId: string, name: string, color: string|null }} payload
 * @returns {Object} 新 Vault
 */
export function editTag(vault, payload) {
    const tagId = payload.tagId;
    const trimmedName = String(payload.name || '').trim();
    if (!tagId || !trimmedName) return vault;
    if (tagId === DEFAULT_TAG_ID) return vault; // 默认标签不可改

    // 名称长度上限：与 addTag 一致
    if (trimmedName.length > MAX_TAG_NAME_LENGTH) return vault;

    const targetIndex = vault.tags.findIndex(function (tag) {
        return tag.id === tagId;
    });
    if (targetIndex === -1) return vault;

    // 名称不能与其他标签重复
    const isDuplicate = vault.tags.some(function (tag) {
        return tag.id !== tagId && tag.name.trim() === trimmedName;
    });
    if (isDuplicate) return vault;

    // 颜色白名单校验
    const nextColor = payload.color === undefined
        ? vault.tags[targetIndex].color
        : (PRESET_COLORS.includes(payload.color) ? payload.color : null);

    const newTags = vault.tags.slice();
    newTags[targetIndex] = {
        ...newTags[targetIndex],
        name: trimmedName,
        color: nextColor
    };

    return {
        tags: newTags,
        statementsMap: vault.statementsMap,
        uiState: vault.uiState
    };
}

/**
 * 删除标签及其所有语句
 * @param {Object} vault
 * @param {{ tagId: string }} payload
 * @returns {Object} 新 Vault
 */
export function deleteTag(vault, payload) {
    const tagId = payload.tagId;
    if (!tagId || tagId === DEFAULT_TAG_ID) return vault;
    if (vault.tags.length <= 1) return vault;

    const newTags = vault.tags.filter(function (tag) {
        return tag.id !== tagId;
    });
    const newStatementsMap = { ...vault.statementsMap };
    delete newStatementsMap[tagId];

    // 若删除的是当前标签，切换到默认标签
    const newUiState = vault.uiState.currentTagId === tagId
        ? { ...vault.uiState, currentTagId: DEFAULT_TAG_ID }
        : vault.uiState;

    return {
        tags: newTags,
        statementsMap: newStatementsMap,
        uiState: newUiState
    };
}

/**
 * 重排标签顺序（默认标签固定第一）
 * @param {Object} vault
 * @param {{ orderedIds: string[] }} payload  不含默认标签的顺序
 * @returns {Object} 新 Vault
 */
export function reorderTags(vault, payload) {
    const orderedIds = Array.isArray(payload.orderedIds) ? payload.orderedIds : [];
    const defaultTag = vault.tags.find(function (tag) {
        return tag.id === DEFAULT_TAG_ID;
    });
    if (!defaultTag) return vault;

    const tagMap = new Map(vault.tags.map(function (tag) {
        return [tag.id, tag];
    }));

    const newTags = [defaultTag];
    const usedIds = new Set([DEFAULT_TAG_ID]);

    for (const id of orderedIds) {
        if (id === DEFAULT_TAG_ID || usedIds.has(id)) continue;
        const tag = tagMap.get(id);
        if (tag) {
            newTags.push(tag);
            usedIds.add(id);
        }
    }

    // 追加未在 orderedIds 中出现的标签（保持原顺序）
    for (const tag of vault.tags) {
        if (!usedIds.has(tag.id)) {
            newTags.push(tag);
        }
    }

    return {
        tags: newTags,
        statementsMap: vault.statementsMap,
        uiState: vault.uiState
    };
}