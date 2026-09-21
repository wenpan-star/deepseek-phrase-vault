// filename: src/commands/statement-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 语句增 / 改 / 删
// 全部为纯函数，输入旧 Vault，输出新 Vault，绝不修改入参
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import { isDuplicateInTag } from '../core/vault.js';
import { MAX_COPY_COUNT } from '../constants.js';

/**
 * 新增单条语句
 * @param {Object} vault
 * @param {{ tagId: string, text: string }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 */
export function addStatement(vault, payload) {
    const tagId = payload.tagId;
    const rawText = String(payload.text || '');
    const trimmedText = rawText.trim();
    if (!tagId || !trimmedText) return vault;

    if (!vault.statementsMap[tagId]) return vault;
    if (isDuplicateInTag(vault, tagId, trimmedText)) return vault;

    const newStatement = {
        id: generateUniqueId(),
        text: trimmedText,
        copyCount: 0
    };

    return {
        tags: vault.tags,
        uiState: vault.uiState,
        statementsMap: {
            ...vault.statementsMap,
            [tagId]: [...vault.statementsMap[tagId], newStatement]
        }
    };
}

/**
 * 批量新增语句（用于旧格式导入等场景，单次持久化）
 * 空文本与重复文本会被过滤，批内重复也会被去除
 * @param {Object} vault
 * @param {{ tagId: string, entries: Array<{text: string, copyCount?: number}> }} payload
 * @returns {Object} 新 Vault
 */
export function addStatementsBatch(vault, payload) {
    const tagId = payload.tagId;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!tagId || entries.length === 0) return vault;
    if (!vault.statementsMap[tagId]) return vault;

    const targetList = vault.statementsMap[tagId];
    const existingTexts = new Set(
        targetList.map(function (statement) {
            return String(statement.text).trim();
        })
    );

    const newStatements = [];
    for (const entry of entries) {
        const rawText = String((entry && entry.text) || '');
        const trimmedText = rawText.trim();
        if (!trimmedText) continue;
        if (existingTexts.has(trimmedText)) continue;
        existingTexts.add(trimmedText);

        // copyCount 强制为 [0, MAX_COPY_COUNT] 内的整数
        let copyCount = 0;
        const rawCopyCount = entry && entry.copyCount;
        if (typeof rawCopyCount === 'number' && Number.isFinite(rawCopyCount)) {
            copyCount = Math.max(
                0,
                Math.min(Math.floor(rawCopyCount), MAX_COPY_COUNT)
            );
        }

        newStatements.push({
            id: generateUniqueId(),
            text: trimmedText,
            copyCount: copyCount
        });
    }

    if (newStatements.length === 0) return vault;

    return {
        tags: vault.tags,
        uiState: vault.uiState,
        statementsMap: {
            ...vault.statementsMap,
            [tagId]: [...targetList, ...newStatements]
        }
    };
}

/**
 * 编辑语句文本
 * @param {Object} vault
 * @param {{ statementId: string, newText: string }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 */
export function editStatement(vault, payload) {
    const statementId = payload.statementId;
    const trimmedText = String(payload.newText || '').trim();
    if (!statementId || !trimmedText) return vault;

    let targetTagId = null;
    for (const tagId of Object.keys(vault.statementsMap)) {
        const found = vault.statementsMap[tagId].some(function (item) {
            return item.id === statementId;
        });
        if (found) {
            targetTagId = tagId;
            break;
        }
    }
    if (!targetTagId) return vault;

    const list = vault.statementsMap[targetTagId];
    const index = list.findIndex(function (item) {
        return item.id === statementId;
    });
    if (index === -1) return vault;

    if (list[index].text.trim() === trimmedText) return vault;

    if (isDuplicateInTag(vault, targetTagId, trimmedText, statementId)) {
        return vault;
    }

    const newList = list.slice();
    newList[index] = { ...list[index], text: trimmedText };

    return {
        tags: vault.tags,
        uiState: vault.uiState,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: newList
        }
    };
}

/**
 * 删除语句
 * @param {Object} vault
 * @param {{ statementId: string }} payload
 * @returns {Object} 新 Vault
 */
export function deleteStatement(vault, payload) {
    const statementId = payload.statementId;
    if (!statementId) return vault;

    let targetTagId = null;
    for (const tagId of Object.keys(vault.statementsMap)) {
        const found = vault.statementsMap[tagId].some(function (item) {
            return item.id === statementId;
        });
        if (found) {
            targetTagId = tagId;
            break;
        }
    }
    if (!targetTagId) return vault;

    const newList = vault.statementsMap[targetTagId].filter(function (item) {
        return item.id !== statementId;
    });

    return {
        tags: vault.tags,
        uiState: vault.uiState,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: newList
        }
    };
}