// filename: src/commands/tag-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 标签增 / 改 / 删 / 排序
// 全部为纯函数
//
// 【历史修复 · N6】
//   addTag / editTag 增加"标签名长度上限"校验。
//
// 【方案 A 调整】
//   所有函数的返回对象补齐 recycleBin 和 settings 字段。
//   原因：vault 的顶层结构完整性必须由每个命令维护。
//   虽然这些命令本身不修改 recycleBin / settings，
//   但若返回对象缺失这两个字段，Facade 后续操作会读取到 undefined。
//
// 【本次重构 · 分类层级】
//   1. addTag / editTag 增加 categoryId 参数处理。
//      addTag：
//        · payload.categoryId 提供且指向存在的分类 → 使用它
//        · 未提供 / 非法 → 回落到 DEFAULT_CATEGORY_ID
//      editTag：
//        · payload.categoryId === undefined → 保持原分类不变
//        · payload.categoryId === null      → 回落到 DEFAULT_CATEGORY_ID
//        · payload.categoryId 为合法分类 id → 使用它
//        · payload.categoryId 非法          → 回落到 DEFAULT_CATEGORY_ID
//
//   2. 所有命令的返回对象补齐 categories 字段，保持 Vault 顶层结构完整。
//
//   3. editTag 的幂等判断扩展为三元组：
//        name / color / categoryId 三者均无变化时返回原引用。
//
// 【本轮深度审核（第一批 / 第二批）】
//   本模块无需逻辑修改。
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import {
    DEFAULT_TAG_ID,
    DEFAULT_TAG_NAME,
    DEFAULT_CATEGORY_ID,
    PRESET_COLORS,
    MAX_TAG_NAME_LENGTH
} from '../constants.js';

/**
 * 新建标签
 *
 * @param {Object} vault
 * @param {{ name: string, color: string|null, categoryId?: string }} payload
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

    // 分类归属校验：非法或缺失时回落到默认分类
    let validatedCategoryId = DEFAULT_CATEGORY_ID;
    if (typeof payload.categoryId === 'string') {
        const trimmedCategoryId = payload.categoryId.trim();
        if (trimmedCategoryId
            && vault.categories.some(function (category) {
                return category.id === trimmedCategoryId;
            })) {
            validatedCategoryId = trimmedCategoryId;
        }
    }

    const newTag = {
        id: generateUniqueId(),
        name: trimmedName,
        color: validatedColor,
        categoryId: validatedCategoryId
    };

    return {
        categories: vault.categories,
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
 * 编辑标签（名称 + 颜色 + 分类归属）
 *
 * @param {Object} vault
 * @param {{ tagId: string, name: string, color?: string|null, categoryId?: string|null }} payload
 * @returns {Object} 新 Vault
 *
 * payload.categoryId 的语义：
 *   · undefined → 保持原分类
 *   · null      → 回落到默认分类
 *   · 合法分类 id → 迁移到该分类
 *   · 非法 id   → 回落到默认分类
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

    // 分类归属处理
    let nextCategoryId = vault.tags[targetIndex].categoryId;
    if (payload.categoryId !== undefined) {
        // 显式传入（含 null）→ 重新校验
        if (payload.categoryId === null) {
            nextCategoryId = DEFAULT_CATEGORY_ID;
        } else {
            const candidateCategoryId = String(payload.categoryId).trim();
            if (candidateCategoryId
                && vault.categories.some(function (category) {
                    return category.id === candidateCategoryId;
                })) {
                nextCategoryId = candidateCategoryId;
            } else {
                nextCategoryId = DEFAULT_CATEGORY_ID;
            }
        }
    }

    // 幂等：三者均无变化时返回原引用
    if (vault.tags[targetIndex].name === trimmedName
        && vault.tags[targetIndex].color === nextColor
        && vault.tags[targetIndex].categoryId === nextCategoryId) {
        return vault;
    }

    const newTags = vault.tags.slice();
    newTags[targetIndex] = {
        ...newTags[targetIndex],
        name: trimmedName,
        color: nextColor,
        categoryId: nextCategoryId
    };

    return {
        categories: vault.categories,
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
        categories: vault.categories,
        tags: newTags,
        statementsMap: newStatementsMap,
        recycleBin: vault.recycleBin,
        uiState: newUiState,
        settings: vault.settings
    };
}

/**
 * 重排标签顺序（默认标签固定第一）
 *
 * 【本次重构说明】
 *   本命令的语义**保持不变**：orderedIds 不含默认标签，
 *   命令层把默认标签固定为第一位，其余按 orderedIds 顺序。
 *
 *   侧边栏收集全局顺序时，跳过默认标签：
 *     ```
 *     containerElement.querySelectorAll('.category-group').forEach(group => {
 *         group.querySelectorAll('.tag-item').forEach(tagItem => {
 *             const tagId = tagItem.getAttribute('data-tag-id');
 *             if (tagId && tagId !== DEFAULT_TAG_ID) orderedIds.push(tagId);
 *         });
 *     });
 *     ```
 *
 *   关键洞察：
 *     vault.tags 数组的顺序决定"标签在各自分类内的相对顺序"
 *     （侧边栏渲染时对每个分类 filter 出 tags 数组中的相关标签，
 *      filter 保持数组原始顺序）。
 *     因此本命令只需保证 tags 数组的全量顺序与 DOM 一致即可。
 *
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
        categories: vault.categories,
        tags: newTags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}