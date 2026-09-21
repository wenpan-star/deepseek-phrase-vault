// filename: src/core/vault.js
// ========================================================================
// DeepSeek 语句工坊 · Vault 状态形状与纯查询函数
// 本模块严禁 import 任何 UI、DOM、存储相关模块
// 所有函数均为纯函数：输入 vault，输出新值，绝不修改入参
//
// 【安全强化】
//   normalizeVault 现执行严格校验：
//     - 标签颜色仅接受 PRESET_COLORS 白名单（杜绝 CSS 注入）
//     - 丢弃 id 或 name 为空的标签，杜绝幽灵标签
//     - statementsMap 中无主标签的键被丢弃
//     - uiState 逐字段做类型断言，非法值回退默认
//
// 【滚动位置策略（本次调整）】
//   滚动位置不再进入 Vault 持久化。理由：
//     1. 滚动是纯会话级瞬态——无需跨设备同步、无需加密存储
//     2. sessionStorage 的写入频率高、数据量小，比加密存储更合适
//     3. 之前的实现中 uiState.mainListScrollTop / sidebarScrollTop
//        从未被任何渲染函数读取，属于死字段
//   normalizeVault 仍会静默忽略旧数据里残留的这两个字段，
//   以保证从 v4 早期版本升级时不会因数据形状变化而失败。
// ========================================================================

import {
    DEFAULT_TAG_ID,
    DEFAULT_TAG_NAME,
    SEARCH_SCOPE_LOCAL,
    SEARCH_SCOPE_GLOBAL,
    PRESET_COLORS,
    MAX_COPY_COUNT
} from '../constants.js';
import { getBuiltinPreset } from '../preset.js';

// -------------------- 形状构造 --------------------

/**
 * 创建一个空 Vault（含默认 uiState）
 *
 * 注意：uiState 中不再包含 mainListScrollTop / sidebarScrollTop。
 *       滚动位置由 sessionStorage 独立管理，见 statement-list.js /
 *       main.js 中的 scroll memory 相关函数。
 *
 * @returns {{tags: Array, statementsMap: Object, uiState: Object}}
 */
export function createEmptyVault() {
    return {
        tags: [],
        statementsMap: {},
        uiState: {
            currentTagId: null,
            sidebarExpanded: false,
            searchKeyword: "",
            useRegex: false,
            searchScope: SEARCH_SCOPE_LOCAL
        }
    };
}

/**
 * 将内置预设转为标准 Vault 结构
 * @returns {{tags: Array, statementsMap: Object, uiState: Object}}
 */
export function createVaultFromBuiltinPreset() {
    const preset = getBuiltinPreset();
    const vault = createEmptyVault();
    vault.tags = preset.tags.map(function (tag) {
        return {
            id: tag.id,
            name: tag.name,
            // 预设中的颜色同样走白名单，防御 preset.js 被误编辑
            color: PRESET_COLORS.includes(tag.color) ? tag.color : null
        };
    });
    vault.statementsMap = {};
    for (const tagId of Object.keys(preset.statementsMap)) {
        vault.statementsMap[tagId] = normalizeStatements(preset.statementsMap[tagId]);
    }
    vault.uiState.currentTagId = DEFAULT_TAG_ID;
    return vault;
}

// -------------------- 归一化 --------------------

/**
 * 归一化单条语句：
 *   - 必须含 id 与 text（去空白后非空）
 *   - 同 id 只保留第一条
 *   - copyCount 强制为 [0, MAX_COPY_COUNT] 内的整数
 * @param {Array} statementList
 * @returns {Array}
 */
export function normalizeStatements(statementList) {
    if (!Array.isArray(statementList)) return [];
    const result = [];
    const seenStatementIds = new Set();
    for (const rawStatement of statementList) {
        if (!rawStatement || typeof rawStatement !== 'object') continue;
        const statementId = rawStatement.id == null ? '' : String(rawStatement.id);
        const statementText = rawStatement.text == null ? '' : String(rawStatement.text);
        if (!statementId || !statementText.trim()) continue;
        if (seenStatementIds.has(statementId)) continue;
        seenStatementIds.add(statementId);

        let copyCount = 0;
        if (typeof rawStatement.copyCount === 'number'
            && Number.isFinite(rawStatement.copyCount)) {
            copyCount = Math.max(
                0,
                Math.min(Math.floor(rawStatement.copyCount), MAX_COPY_COUNT)
            );
        }

        result.push({
            id: statementId,
            text: statementText,
            copyCount: copyCount
        });
    }
    return result;
}

/**
 * 归一化完整 Vault：补全所有缺失字段，剔除非法数据
 *
 * 向后兼容说明：
 *   旧版本数据可能在 uiState 中包含 mainListScrollTop / sidebarScrollTop。
 *   本函数会静默忽略这些字段——不会报错，也不会把它们复制到新 uiState。
 *   这是有意为之：滚动位置已迁移至 sessionStorage，Vault 中不再承载它。
 *
 * @param {Object} rawVault
 * @returns {Object}
 */
export function normalizeVault(rawVault) {
    // ---------- 标签归一化 ----------
    const rawTags = Array.isArray(rawVault && rawVault.tags) ? rawVault.tags : [];
    const normalizedTags = [];
    const knownTagIds = new Set();

    for (const rawTag of rawTags) {
        if (!rawTag || typeof rawTag !== 'object') continue;
        const tagId = rawTag.id == null ? '' : String(rawTag.id).trim();
        const tagName = rawTag.name == null ? '' : String(rawTag.name).trim();
        if (!tagId || !tagName) continue;
        if (knownTagIds.has(tagId)) continue;
        knownTagIds.add(tagId);
        // 颜色白名单：仅接受预设调色板中的颜色
        const tagColor = PRESET_COLORS.includes(rawTag.color) ? rawTag.color : null;
        normalizedTags.push({ id: tagId, name: tagName, color: tagColor });
    }

    // ---------- statementsMap 归一化 ----------
    const rawStatementsMap = (rawVault
        && typeof rawVault.statementsMap === 'object'
        && rawVault.statementsMap)
        ? rawVault.statementsMap
        : {};
    const normalizedStatementsMap = {};
    for (const tagId of Object.keys(rawStatementsMap)) {
        // 丢弃无主标签的语句（防止非法 tagId 注入）
        if (!knownTagIds.has(tagId)) continue;
        normalizedStatementsMap[tagId] = normalizeStatements(rawStatementsMap[tagId]);
    }
    // 每个合法标签都必须有语句数组
    for (const tagId of knownTagIds) {
        if (!Array.isArray(normalizedStatementsMap[tagId])) {
            normalizedStatementsMap[tagId] = [];
        }
    }

    // ---------- uiState 归一化 ----------
    const rawUiState = (rawVault
        && rawVault.uiState
        && typeof rawVault.uiState === 'object')
        ? rawVault.uiState
        : {};

    let normalizedCurrentTagId = rawUiState.currentTagId == null
        ? null
        : String(rawUiState.currentTagId);
    if (normalizedCurrentTagId && !knownTagIds.has(normalizedCurrentTagId)) {
        normalizedCurrentTagId = null;
    }

    const normalizedSearchScope = (rawUiState.searchScope === SEARCH_SCOPE_GLOBAL)
        ? SEARCH_SCOPE_GLOBAL
        : SEARCH_SCOPE_LOCAL;

    // 注意：这里不再读取 rawUiState.mainListScrollTop / sidebarScrollTop。
    //       即使旧数据包含它们，也会被静默忽略（不报错、不迁移）。
    const normalizedUiState = {
        currentTagId: normalizedCurrentTagId,
        sidebarExpanded: Boolean(rawUiState.sidebarExpanded),
        searchKeyword: rawUiState.searchKeyword == null
            ? ''
            : String(rawUiState.searchKeyword),
        useRegex: Boolean(rawUiState.useRegex),
        searchScope: normalizedSearchScope
    };

    return {
        tags: normalizedTags,
        statementsMap: normalizedStatementsMap,
        uiState: normalizedUiState
    };
}

/**
 * 确保默认标签存在且名称正确；确保 currentTagId 合法
 * @param {Object} vault
 * @returns {Object} 新的 vault
 */
export function ensureDefaultTagExists(vault) {
    const tags = vault.tags.slice();
    const statementsMap = { ...vault.statementsMap };
    let modified = false;

    const defaultIndex = tags.findIndex(function (tag) {
        return tag.id === DEFAULT_TAG_ID;
    });
    if (defaultIndex === -1) {
        tags.unshift({ id: DEFAULT_TAG_ID, name: DEFAULT_TAG_NAME, color: null });
        if (!statementsMap[DEFAULT_TAG_ID]) {
            statementsMap[DEFAULT_TAG_ID] = [];
        }
        modified = true;
    } else if (tags[defaultIndex].name !== DEFAULT_TAG_NAME) {
        tags[defaultIndex] = { ...tags[defaultIndex], name: DEFAULT_TAG_NAME };
        modified = true;
    }

    // 每个标签都必须有语句数组
    for (const tag of tags) {
        if (!Array.isArray(statementsMap[tag.id])) {
            statementsMap[tag.id] = [];
            modified = true;
        }
    }

    // currentTagId 合法性
    const uiState = { ...vault.uiState };
    if (!uiState.currentTagId || !tags.some(function (tag) {
        return tag.id === uiState.currentTagId;
    })) {
        uiState.currentTagId = DEFAULT_TAG_ID;
        modified = true;
    }

    if (!modified) return vault;
    return { tags: tags, statementsMap: statementsMap, uiState: uiState };
}

// -------------------- 查询 --------------------

/**
 * 获取指定标签下的语句数组（原引用）
 * @param {Object} vault
 * @param {string} tagId
 * @returns {Array}
 */
export function getStatementsByTagId(vault, tagId) {
    if (!tagId || !vault.statementsMap[tagId]) return [];
    return vault.statementsMap[tagId];
}

/**
 * 获取当前标签下的语句数组
 * @param {Object} vault
 * @returns {Array}
 */
export function getCurrentStatements(vault) {
    return getStatementsByTagId(vault, vault.uiState.currentTagId);
}

/**
 * 在所有标签中查找语句
 * @param {Object} vault
 * @param {string} statementId
 * @returns {{statement: Object, tagId: string} | null}
 */
export function findStatementById(vault, statementId) {
    for (const tagId of Object.keys(vault.statementsMap)) {
        const list = vault.statementsMap[tagId];
        const statement = list.find(function (item) {
            return item.id === statementId;
        });
        if (statement) {
            return { statement: statement, tagId: tagId };
        }
    }
    return null;
}

/**
 * 扁平化所有语句并附加标签元信息
 * @param {Object} vault
 * @returns {Array}
 */
export function getAllStatementsWithTags(vault) {
    const result = [];
    for (const tag of vault.tags) {
        const list = vault.statementsMap[tag.id] || [];
        for (const statement of list) {
            result.push({
                id: statement.id,
                text: statement.text,
                copyCount: typeof statement.copyCount === 'number' ? statement.copyCount : 0,
                tagId: tag.id,
                tagName: tag.name,
                tagColor: tag.color
            });
        }
    }
    return result;
}

/**
 * 判断标签下是否已存在相同文本
 * @param {Object} vault
 * @param {string} tagId
 * @param {string} text
 * @param {string|null} excludeStatementId
 * @returns {boolean}
 */
export function isDuplicateInTag(vault, tagId, text, excludeStatementId = null) {
    const list = vault.statementsMap[tagId] || [];
    const normalizedText = String(text).trim();
    return list.some(function (item) {
        if (excludeStatementId !== null && item.id === excludeStatementId) return false;
        return String(item.text).trim() === normalizedText;
    });
}

/**
 * 统计某标签下语句数
 * @param {Object} vault
 * @param {string} tagId
 * @returns {number}
 */
export function countStatementsInTag(vault, tagId) {
    return (vault.statementsMap[tagId] || []).length;
}