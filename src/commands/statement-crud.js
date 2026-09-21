// filename: src/commands/statement-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 语句增 / 改 / 删
// 全部为纯函数，输入旧 Vault，输出新 Vault，绝不修改入参
//
// 【方案 A（上一轮）】
//   deleteStatement 改为**软删除**：
//     - 从 statementsMap 中移除（用户视角：语句消失）
//     - 追加到 recycleBin（保留可恢复能力）
//     - 记录来源标签快照（id / name / color）
//     - 记录删除时间戳与删除来源（single / batch）
//
//   为什么软删除：
//     - 用户误删是高频场景，回收站提供兜底
//     - 与主流应用（Notion / Gmail / macOS Finder）一致
//     - 命令名保持 deleteStatement 不变，用户感知的"删除"语义一致
//
//   硬删除（彻底删除）能力由 commands/recycle-bin.js 提供
//
//   关于返回对象：
//     所有命令的返回对象现在都包含 recycleBin 和 settings 两个字段，
//     即使命令本身不修改它们，也保持引用传递。
//     原因：vault 的顶层结构完整性必须由每个命令维护，
//           否则 Facade 检测到 nextVault === previousVault 时会误判
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import { isDuplicateInTag } from '../core/vault.js';
import {
    MAX_COPY_COUNT,
    MAX_RECYCLE_BIN_SIZE,
    PRESET_COLORS
} from '../constants.js';

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
        statementsMap: {
            ...vault.statementsMap,
            [tagId]: [...vault.statementsMap[tagId], newStatement]
        },
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
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
        statementsMap: {
            ...vault.statementsMap,
            [tagId]: [...targetList, ...newStatements]
        },
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
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
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: newList
        },
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 删除语句（软删除）
 *
 * 流程：
 *   1. 定位语句与其所属标签
 *   2. 从 statementsMap 中移除
 *   3. 构造回收站条目（含来源标签快照）
 *   4. 前置到 recycleBin（越新越靠前）
 *   5. 若超过 MAX_RECYCLE_BIN_SIZE，截断末尾（最旧的）
 *
 * @param {Object} vault
 * @param {{ statementId: string }} payload
 * @returns {Object} 新 Vault
 */
export function deleteStatement(vault, payload) {
    const statementId = payload.statementId;
    if (!statementId) return vault;

    // 定位语句
    let targetTagId = null;
    let targetStatement = null;
    for (const tagId of Object.keys(vault.statementsMap)) {
        const list = vault.statementsMap[tagId];
        const statement = list.find(function (item) {
            return item.id === statementId;
        });
        if (statement) {
            targetTagId = tagId;
            targetStatement = statement;
            break;
        }
    }
    if (!targetTagId || !targetStatement) return vault;

    // 从 statementsMap 中移除
    const newList = vault.statementsMap[targetTagId].filter(function (item) {
        return item.id !== statementId;
    });

    // 构造回收站条目
    const sourceTag = vault.tags.find(function (tag) {
        return tag.id === targetTagId;
    });

    const recycleBinItem = {
        id: targetStatement.id,
        text: targetStatement.text,
        copyCount: typeof targetStatement.copyCount === 'number'
            ? targetStatement.copyCount
            : 0,
        sourceTagId: targetTagId,
        sourceTagName: sourceTag ? sourceTag.name : '',
        sourceTagColor: (sourceTag && PRESET_COLORS.includes(sourceTag.color))
            ? sourceTag.color
            : null,
        deletedAt: Date.now(),
        deletionSource: 'single'
    };

    // 前置新条目并截断
    const newRecycleBin = [recycleBinItem, ...vault.recycleBin]
        .slice(0, MAX_RECYCLE_BIN_SIZE);

    return {
        tags: vault.tags,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: newList
        },
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}