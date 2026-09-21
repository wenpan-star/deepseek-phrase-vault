// filename: src/commands/recycle-bin.js
// ========================================================================
// DeepSeek 语句工坊 · 回收站操作
// 包含：从回收站恢复 / 从回收站彻底删除 / 清空回收站 / 清理过期条目
// 全部为纯函数
//
// 【方案 A（上一轮）】
//   新建本模块，配套软删除语义。
//
//   恢复策略：
//     - 单条恢复：优先源标签；源标签不存在时由调用方指定 targetTagId
//     - 批量恢复：统一使用调用方指定的 targetTagId
//     - 冲突处理：目标标签下已有相同文本 → 跳过该条（保持其在回收站）
//
//   彻底删除：
//     - 从 recycleBin 中移除（不可恢复）
//     - 用户会看到确认框
//
//   清空回收站：
//     - 移除所有条目
//
//   清理过期条目：
//     - 打开面板时由 main.js 调用
//     - 移除 deletedAt 超过 RECYCLE_BIN_RETENTION_DAYS 的条目
//     - deletedAt === 0 的条目视为"无时间戳"，永久保留
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
// ========================================================================

import { isDuplicateInTag } from '../core/vault.js';
import {
    MAX_COPY_COUNT,
    RECYCLE_BIN_RETENTION_DAYS
} from '../constants.js';

// 一天的毫秒数（用于过期计算）
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 从回收站恢复单条语句
 *
 * @param {Object} vault
 * @param {{ binId: string, targetTagId?: string }} payload
 *   - binId：回收站条目 ID（必填）
 *   - targetTagId：目标标签 ID（可选）
 *       · 若提供且合法 → 使用它
 *       · 若未提供或非法 → 回退到回收站条目中的 sourceTagId
 *       · 两者都无效 → 返回原 vault（命令被拒）
 *
 * @returns {Object} 新 Vault
 */
export function restoreStatementFromRecycleBin(vault, payload) {
    const binId = payload.binId;
    const targetTagIdOverride = payload.targetTagId;
    if (!binId) return vault;

    // 定位回收站条目
    const binItem = vault.recycleBin.find(function (item) {
        return item.id === binId;
    });
    if (!binItem) return vault;

    // 确定目标标签
    let targetTagId = null;
    if (targetTagIdOverride && vault.statementsMap[targetTagIdOverride]) {
        targetTagId = targetTagIdOverride;
    } else if (binItem.sourceTagId && vault.statementsMap[binItem.sourceTagId]) {
        targetTagId = binItem.sourceTagId;
    } else {
        // 无有效目标：命令被拒，调用方应引导用户选择目标标签
        return vault;
    }

    // 冲突检查：目标标签下已有相同文本
    if (isDuplicateInTag(vault, targetTagId, binItem.text)) {
        return vault;
    }

    // 恢复语句到目标标签
    const restoredStatement = {
        id: binItem.id,
        text: binItem.text,
        copyCount: typeof binItem.copyCount === 'number'
            ? Math.max(0, Math.min(Math.floor(binItem.copyCount), MAX_COPY_COUNT))
            : 0
    };

    // 从回收站中移除该条
    const newRecycleBin = vault.recycleBin.filter(function (item) {
        return item.id !== binId;
    });

    return {
        tags: vault.tags,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: [
                ...vault.statementsMap[targetTagId],
                restoredStatement
            ]
        },
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 从回收站批量恢复语句
 *
 * 行为：
 *   - 统一使用 payload.targetTagId 作为目标标签
 *   - 逐条检查冲突，冲突的条目**保留在回收站**（不静默丢弃）
 *   - 全部冲突（无一成功）时返回原 vault 引用
 *
 * 调用方（main.js）通常在调用前做预计算，得出"将恢复 N 条、跳过 M 条"
 * 的提示信息。本函数内部也做一次相同判断，保证与预计算一致。
 *
 * @param {Object} vault
 * @param {{ binIds: string[], targetTagId: string }} payload
 * @returns {Object} 新 Vault
 */
export function restoreStatementsFromRecycleBin(vault, payload) {
    const binIds = new Set(payload.binIds || []);
    const targetTagId = payload.targetTagId;
    if (binIds.size === 0) return vault;
    if (!targetTagId || !vault.statementsMap[targetTagId]) return vault;

    // 追踪目标标签下的"现有 + 本次恢复"的文本集合，
    // 保证批内重复也能被正确去重
    const existingTexts = new Set(
        vault.statementsMap[targetTagId].map(function (item) {
            return String(item.text).trim();
        })
    );

    const newRecycleBin = [];
    const restoredStatements = [];

    for (const binItem of vault.recycleBin) {
        if (!binIds.has(binItem.id)) {
            // 未被选中：保留在回收站
            newRecycleBin.push(binItem);
            continue;
        }

        const normalizedText = String(binItem.text).trim();
        if (existingTexts.has(normalizedText)) {
            // 冲突：跳过该条，保留在回收站
            newRecycleBin.push(binItem);
            continue;
        }

        existingTexts.add(normalizedText);

        let copyCount = 0;
        if (typeof binItem.copyCount === 'number' && Number.isFinite(binItem.copyCount)) {
            copyCount = Math.max(0, Math.min(Math.floor(binItem.copyCount), MAX_COPY_COUNT));
        }

        restoredStatements.push({
            id: binItem.id,
            text: binItem.text,
            copyCount: copyCount
        });
    }

    // 全部冲突：无实际改变
    if (restoredStatements.length === 0) return vault;

    return {
        tags: vault.tags,
        statementsMap: {
            ...vault.statementsMap,
            [targetTagId]: [
                ...vault.statementsMap[targetTagId],
                ...restoredStatements
            ]
        },
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 从回收站彻底删除单条（不可恢复）
 *
 * @param {Object} vault
 * @param {{ binId: string }} payload
 * @returns {Object} 新 Vault
 */
export function purgeStatementFromRecycleBin(vault, payload) {
    const binId = payload.binId;
    if (!binId) return vault;

    const newRecycleBin = vault.recycleBin.filter(function (item) {
        return item.id !== binId;
    });

    if (newRecycleBin.length === vault.recycleBin.length) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 从回收站批量彻底删除（不可恢复）
 *
 * @param {Object} vault
 * @param {{ binIds: string[] }} payload
 * @returns {Object} 新 Vault
 */
export function purgeStatementsFromRecycleBin(vault, payload) {
    const binIds = new Set(payload.binIds || []);
    if (binIds.size === 0) return vault;

    const newRecycleBin = vault.recycleBin.filter(function (item) {
        return !binIds.has(item.id);
    });

    if (newRecycleBin.length === vault.recycleBin.length) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: newRecycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 清空回收站
 * 幂等：若已是空数组则返回原引用
 *
 * @param {Object} vault
 * @param {Object} payload  未使用（保持命令签名一致）
 * @returns {Object} 新 Vault
 */
export function clearRecycleBin(vault, payload) {
    if (vault.recycleBin.length === 0) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: [],
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 清理回收站中超过保留期的条目
 *
 * 由 main.js 在打开回收站面板时调用。
 * 幂等：若无过期条目则返回原引用。
 *
 * 特殊规则：
 *   - deletedAt === 0（无有效时间戳的条目）视为"永久保留"
 *   - deletedAt 有效且 >= cutoff 时间戳的条目保留
 *   - 其余（deletedAt 有效但 < cutoff）被清理
 *
 * @param {Object} vault
 * @param {{ now?: number }} payload
 *   - now：可选的"当前时间"（毫秒），用于测试；
 *          未提供时使用 Date.now()
 * @returns {Object} 新 Vault
 */
export function cleanupExpiredRecycleBinItems(vault, payload) {
    const now = (payload && typeof payload.now === 'number' && Number.isFinite(payload.now))
        ? payload.now
        : Date.now();
    const cutoffTimestamp = now - RECYCLE_BIN_RETENTION_DAYS * MILLISECONDS_PER_DAY;

    const filtered = vault.recycleBin.filter(function (item) {
        // 无有效时间戳：永久保留
        if (item.deletedAt === 0) return true;
        // 有效时间戳：检查是否过期
        return item.deletedAt >= cutoffTimestamp;
    });

    if (filtered.length === vault.recycleBin.length) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: filtered,
        uiState: vault.uiState,
        settings: vault.settings
    };
}