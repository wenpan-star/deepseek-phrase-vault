// filename: src/commands/tag-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 标签增 / 改 / 删 / 排序
// 全部为纯函数
//
// 【历史修复 · N6】
//   addTag / editTag 增加"标签名长度上限"校验。
//
// 【方案 A（上一轮）】
//   所有函数的返回对象补齐 recycleBin 和 settings 字段。
//   原因：vault 的顶层结构完整性必须由每个命令维护。
//   虽然这些命令本身不修改 recycleBin / settings，
//   但若返回对象缺失这两个字段，Facade 后续操作会读取到 undefined。
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
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
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
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
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 删除标签及其所有语句
 *
 * 【决策】删除标签**不进入回收站**：
 *   - 删除标签的确认框已明确提示"该标签下有 N 条语句"与"此操作不可撤销"
 *   - 一次删除几百条会立刻撑爆回收站（100 条上限），
 *     把之前的重要误删挤出去
 *   - 若用户想保留语句而删标签，正确做法是先"批量移动到其他标签"
 *
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
        recycleBin: vault.recycleBin,
        uiState: newUiState,
        settings: vault.settings
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
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}