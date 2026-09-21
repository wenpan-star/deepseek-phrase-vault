// filename: src/commands/statement-organize.js
// ========================================================================
// DeepSeek 语句工坊 · 语句批量组织
// 包含：批量删除 / 批量移动 / 复制到指定标签 / 复制到默认标签 /
//       标签内排序 / 累加复制计数
// 全部为纯函数
//
// 【方案 A（上一轮）】
//   batchDeleteStatements 改为**软删除**：
//     - 批量从 statementsMap 中移除
//     - 批量追加到 recycleBin（使用同一个 deletedAt 时间戳，
//       保证批量删除的条目在回收站中连续显示）
//     - 所有条目都记录来源标签快照
//     - 统一截断到 MAX_RECYCLE_BIN_SIZE
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import {
    DEFAULT_TAG_ID,
    MAX_COPY_COUNT,
    MAX_RECYCLE_BIN_SIZE,
    PRESET_COLORS
} from '../constants.js';
import { isDuplicateInTag } from '../core/vault.js';

/**
 * 批量删除语句（软删除，跨标签扫描）
 *
 * 时间戳策略：
 *   所有条目使用同一个 `deletedAt`（同一批次），
 *   保证它们在回收站中时间一致、按 id 字典序稳定排序。
 *
 * @param {Object} vault
 * @param {{ statementIds: string[] }} payload
 * @returns {Object} 新 Vault
 */
export function batchDeleteStatements(vault, payload) {
    const idsToDelete = new Set(payload.statementIds || []);
    if (idsToDelete.size === 0) return vault;

    const newStatementsMap = {};
    const deletedItems = [];
    let anyChanged = false;
    const deletionTimestamp = Date.now();

    for (const tagId of Object.keys(vault.statementsMap)) {
        const originalList = vault.statementsMap[tagId];
        const filteredList = [];
        const sourceTag = vault.tags.find(function (tag) {
            return tag.id === tagId;
        });
        const sourceTagColor = (sourceTag && PRESET_COLORS.includes(sourceTag.color))
            ? sourceTag.color
            : null;

        for (const statement of originalList) {
            if (idsToDelete.has(statement.id)) {
                deletedItems.push({
                    id: statement.id,
                    text: statement.text,
                    copyCount: typeof statement.copyCount === 'number'
                        ? statement.copyCount
                        : 0,
                    sourceTagId: tagId,
                    sourceTagName: sourceTag ? sourceTag.name : '',
                    sourceTagColor: sourceTagColor,
                    deletedAt: deletionTimestamp,
                    deletionSource: 'batch'
                });
            } else {
                filteredList.push(statement);
            }
        }

        if (filteredList.length !== originalList.length) {
            anyChanged = true;
        }
        newStatementsMap[tagId] = filteredList;
    }

    if (!anyChanged) return vault;

    const newRecycleBin = [...deletedItems, ...vault.recycleBin]
        .slice(0, MAX_RECYCLE_BIN_SIZE);

    return {
        tags: vault.tags,
        statementsMap: newStatementsMap,
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 批量移动语句到目标标签
 * 移动成功后从源标签删除；目标已存在相同文本时跳过（含本次批内已加入的）
 * @param {Object} vault
 * @param {{ statementIds: string[], targetTagId: string }} payload
 * @returns {Object} 新 Vault
 */
export function batchMoveStatements(vault, payload) {
    const idsToMove = new Set(payload.statementIds || []);
    const targetTagId = payload.targetTagId;
    if (idsToMove.size === 0 || !targetTagId) return vault;
    if (!vault.statementsMap[targetTagId]) return vault;

    const itemsToMove = [];
    for (const sourceTagId of Object.keys(vault.statementsMap)) {
        for (const statement of vault.statementsMap[sourceTagId]) {
            if (idsToMove.has(statement.id)) {
                itemsToMove.push({ statement: statement, sourceTagId: sourceTagId });
            }
        }
    }
    if (itemsToMove.length === 0) return vault;

    const newStatementsMap = {};
    for (const tagId of Object.keys(vault.statementsMap)) {
        newStatementsMap[tagId] = vault.statementsMap[tagId].slice();
    }

    const targetList = newStatementsMap[targetTagId];

    // 关键：用 Set 追踪"目标标签下现有 + 本次即将加入"的所有文本
    // 保证批内重复也能被正确去重
    const targetExistingTexts = new Set(
        targetList.map(function (statement) {
            return String(statement.text).trim();
        })
    );

    const sourceIdsToRemove = new Map();

    for (const item of itemsToMove) {
        const sourceTagId = item.sourceTagId;
        if (sourceTagId === targetTagId) continue;

        const normalizedText = String(item.statement.text).trim();
        if (targetExistingTexts.has(normalizedText)) continue;

        // copyCount 钳制到合法范围
        let copyCount = 0;
        if (typeof item.statement.copyCount === 'number'
            && Number.isFinite(item.statement.copyCount)) {
            copyCount = Math.max(
                0,
                Math.min(Math.floor(item.statement.copyCount), MAX_COPY_COUNT)
            );
        }

        targetList.push({
            id: generateUniqueId(),
            text: item.statement.text,
            copyCount: copyCount
        });
        targetExistingTexts.add(normalizedText);

        if (!sourceIdsToRemove.has(sourceTagId)) {
            sourceIdsToRemove.set(sourceTagId, new Set());
        }
        sourceIdsToRemove.get(sourceTagId).add(item.statement.id);
    }

    for (const [sourceTagId, idSet] of sourceIdsToRemove) {
        newStatementsMap[sourceTagId] = newStatementsMap[sourceTagId].filter(function (statement) {
            return !idSet.has(statement.id);
        });
    }

    return {
        tags: vault.tags,
        statementsMap: newStatementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 复制一条语句文本到目标标签
 * @param {Object} vault
 * @param {{ text: string, targetTagId: string }} payload
 * @returns {Object} 新 Vault（重复则返回原 Vault）
 */
export function copyStatementToTag(vault, payload) {
    const trimmedText = String(payload.text || '').trim();
    const targetTagId = payload.targetTagId;
    if (!trimmedText || !targetTagId) return vault;
    if (!vault.statementsMap[targetTagId]) return vault;
    if (isDuplicateInTag(vault, targetTagId, trimmedText)) return vault;

    const newStatement = {
        id: generateUniqueId(),
        text: trimmedText,
        copyCount: 0
    };

    return {
        tags: vault.tags,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: [...vault.statementsMap[targetTagId], newStatement]
        },
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 复制一条语句到默认语库
 * @param {Object} vault
 * @param {{ text: string }} payload
 * @returns {Object} 新 Vault（重复则返回原 Vault）
 */
export function copyStatementToDefault(vault, payload) {
    return copyStatementToTag(vault, {
        text: payload.text,
        targetTagId: DEFAULT_TAG_ID
    });
}

/**
 * 在标签内重排语句
 * @param {Object} vault
 * @param {{ tagId: string, fromIndex: number, toIndex: number }} payload
 * @returns {Object} 新 Vault
 */
export function reorderStatementsInTag(vault, payload) {
    const tagId = payload.tagId;
    const fromIndex = payload.fromIndex;
    const toIndex = payload.toIndex;
    if (!tagId || !vault.statementsMap[tagId]) return vault;
    if (fromIndex === toIndex) return vault;

    const list = vault.statementsMap[tagId].slice();
    if (fromIndex < 0 || fromIndex >= list.length) return vault;
    if (toIndex < 0 || toIndex >= list.length) return vault;

    const movedItem = list.splice(fromIndex, 1)[0];
    list.splice(toIndex, 0, movedItem);

    return {
        tags: vault.tags,
        statementsMap: {
            ...vault.statementsMap,
            [tagId]: list
        },
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 累加指定语句的复制计数（上限 MAX_COPY_COUNT）
 * @param {Object} vault
 * @param {{ statementId: string }} payload
 * @returns {Object} 新 Vault
 */
export function incrementCopyCount(vault, payload) {
    const statementId = payload.statementId;
    if (!statementId) return vault;

    for (const tagId of Object.keys(vault.statementsMap)) {
        const list = vault.statementsMap[tagId];
        const index = list.findIndex(function (item) {
            return item.id === statementId;
        });
        if (index !== -1) {
            const currentCopyCount = typeof list[index].copyCount === 'number'
                ? list[index].copyCount
                : 0;
            const nextCopyCount = Math.min(currentCopyCount + 1, MAX_COPY_COUNT);
            if (nextCopyCount === currentCopyCount) return vault;

            const newList = list.slice();
            newList[index] = {
                ...list[index],
                copyCount: nextCopyCount
            };
            return {
                tags: vault.tags,
                statementsMap: {
                    ...vault.statementsMap,
                    [tagId]: newList
                },
                recycleBin: vault.recycleBin,
                uiState: vault.uiState,
                settings: vault.settings
            };
        }
    }
    return vault;
}