// filename: src/core/vault.js
// ========================================================================
// DeepSeek 语句工坊 · Vault 状态形状与纯查询函数
// 本模块严禁 import 任何 UI、DOM、存储相关模块
// 所有函数均为纯函数：输入 vault，输出新值，绝不修改入参
//
// 【安全强化（历史）】
//   normalizeVault 执行严格校验：
//     - 标签颜色仅接受 PRESET_COLORS 白名单（杜绝 CSS 注入）
//     - 丢弃 id 或 name 为空的标签，杜绝幽灵标签
//     - statementsMap 中无主标签的键被丢弃
//     - uiState 逐字段做类型断言，非法值回退默认
//
// 【滚动位置策略（历史调整）】
//   滚动位置不进入 Vault 持久化，由 sessionStorage 独立管理。
//   normalizeVault 静默忽略旧数据里残留的 mainListScrollTop /
//   sidebarScrollTop 字段。
//
// 【方案 A（上一轮）】
//   1. 新增 vault.settings 命名空间：
//        与 uiState 分离，用于存放用户偏好（跨会话持久，
//        未来可参与"配置同步"，与"重置 UI 状态"解耦）
//   2. 新增 vault.recycleBin 数组：
//        存放软删除的语句。每条记录包含来源标签快照
//        （id / name / color）与删除时间。
//   3. 新增 normalizeSettings / normalizeRecycleBin 两个归一化函数
//
// 【本轮深度审核（第一批 / 第二批）】
//   本模块无需逻辑修改。
//   ensureDefaultTagExists 在返回对象中已正确携带 recycleBin
//   与 settings，保持 Vault 顶层结构完整性。
// ========================================================================

import {
    DEFAULT_TAG_ID,
    DEFAULT_TAG_NAME,
    SEARCH_SCOPE_LOCAL,
    SEARCH_SCOPE_GLOBAL,
    PRESET_COLORS,
    MAX_COPY_COUNT,
    SETTINGS_DEFAULTS,
    MAX_RECYCLE_BIN_SIZE
} from '../constants.js';
import { getBuiltinPreset } from '../preset.js';

// -------------------- 形状构造 --------------------

/**
 * 创建一个空 Vault
 *
 * 结构：
 *   {
 *     tags: [],
 *     statementsMap: {},
 *     recycleBin: [],
 *     uiState: { ...会话级瞬态... },
 *     settings: { ...用户偏好... }
 *   }
 *
 * @returns {{tags: Array, statementsMap: Object, recycleBin: Array, uiState: Object, settings: Object}}
 */
export function createEmptyVault() {
    return {
        tags: [],
        statementsMap: {},
        recycleBin: [],
        uiState: {
            currentTagId: null,
            sidebarExpanded: false,
            searchKeyword: "",
            useRegex: false,
            searchScope: SEARCH_SCOPE_LOCAL
        },
        settings: normalizeSettings(null)
    };
}

/**
 * 将内置预设转为标准 Vault 结构
 * @returns {{tags: Array, statementsMap: Object, recycleBin: Array, uiState: Object, settings: Object}}
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
 * 归一化回收站数组。
 *
 * 每条记录的合法形状：
 *   {
 *     id:                原语句 ID（字符串，非空）
 *     text:              语句文本（字符串，非空）
 *     copyCount:         复制计数（整数）
 *     sourceTagId:       来源标签 ID（字符串，可能已失效）
 *     sourceTagName:     来源标签名快照（字符串）
 *     sourceTagColor:    来源标签颜色快照（白名单或 null）
 *     deletedAt:         删除时间戳（毫秒）
 *     deletionSource:    'single' | 'batch'（UI 展示用）
 *   }
 *
 * 清洗规则：
 *   - 缺 id 或 text → 丢弃
 *   - deletedAt 非有效数字 → 丢弃
 *   - sourceTagColor 非法 → null
 *   - deletionSource 非法 → 'single'
 *   - 总条数超过 MAX_RECYCLE_BIN_SIZE → 保留最新的 N 条
 *
 * @param {Array} rawRecycleBin
 * @returns {Array}
 */
export function normalizeRecycleBin(rawRecycleBin) {
    if (!Array.isArray(rawRecycleBin)) return [];

    const result = [];
    const seenIds = new Set();

    for (const rawItem of rawRecycleBin) {
        if (!rawItem || typeof rawItem !== 'object') continue;

        const itemId = rawItem.id == null ? '' : String(rawItem.id).trim();
        const itemText = rawItem.text == null ? '' : String(rawItem.text);
        if (!itemId || !itemText.trim()) continue;
        if (seenIds.has(itemId)) continue;
        seenIds.add(itemId);

        let copyCount = 0;
        if (typeof rawItem.copyCount === 'number'
            && Number.isFinite(rawItem.copyCount)) {
            copyCount = Math.max(
                0,
                Math.min(Math.floor(rawItem.copyCount), MAX_COPY_COUNT)
            );
        }

        const sourceTagId = rawItem.sourceTagId == null
            ? ''
            : String(rawItem.sourceTagId);
        const sourceTagName = rawItem.sourceTagName == null
            ? ''
            : String(rawItem.sourceTagName).trim();
        const sourceTagColor = PRESET_COLORS.includes(rawItem.sourceTagColor)
            ? rawItem.sourceTagColor
            : null;

        let deletedAt = 0;
        if (typeof rawItem.deletedAt === 'number'
            && Number.isFinite(rawItem.deletedAt)
            && rawItem.deletedAt > 0) {
            deletedAt = Math.floor(rawItem.deletedAt);
        } else {
            // 无有效时间戳的条目视为"很久以前删除"，时间戳回退到 0
            // （会被后续排序和淘汰规则自然处理）
            deletedAt = 0;
        }

        const deletionSource = (rawItem.deletionSource === 'batch')
            ? 'batch'
            : 'single';

        result.push({
            id: itemId,
            text: itemText,
            copyCount: copyCount,
            sourceTagId: sourceTagId,
            sourceTagName: sourceTagName,
            sourceTagColor: sourceTagColor,
            deletedAt: deletedAt,
            deletionSource: deletionSource
        });
    }

    // 保留最新的 MAX_RECYCLE_BIN_SIZE 条
    // 排序基准：deletedAt 降序（越新越靠前）
    // 时间戳相同时用 id 字典序作次级排序键（保证稳定）
    if (result.length > MAX_RECYCLE_BIN_SIZE) {
        result.sort(function (itemA, itemB) {
            if (itemB.deletedAt !== itemA.deletedAt) {
                return itemB.deletedAt - itemA.deletedAt;
            }
            return itemB.id.localeCompare(itemA.id);
        });
        return result.slice(0, MAX_RECYCLE_BIN_SIZE);
    }

    return result;
}

/**
 * 归一化 settings 对象。
 *
 * 策略：
 *   以 SETTINGS_DEFAULTS 为唯一真相源，逐字段校验：
 *     - 原始值缺失 → 用默认值
 *     - 原始值类型与默认值不一致 → 用默认值
 *     - 一致 → 保留原始值
 *
 * 未来若需枚举校验（如 theme: 'light' | 'dark'），
 * 增加 SETTINGS_VALIDATORS 表，在类型校验后应用自定义断言。
 *
 * @param {Object|null} rawSettings
 * @returns {Object}
 */
export function normalizeSettings(rawSettings) {
    const source = (rawSettings && typeof rawSettings === 'object')
        ? rawSettings
        : {};

    const result = {};
    const settingKeys = Object.keys(SETTINGS_DEFAULTS);

    for (let keyIndex = 0; keyIndex < settingKeys.length; keyIndex++) {
        const settingKey = settingKeys[keyIndex];
        const defaultValue = SETTINGS_DEFAULTS[settingKey];
        const rawValue = source[settingKey];

        if (rawValue !== undefined
            && typeof rawValue === typeof defaultValue) {
            result[settingKey] = rawValue;
        } else {
            result[settingKey] = defaultValue;
        }
    }

    return result;
}

/**
 * 归一化完整 Vault：补全所有缺失字段，剔除非法数据
 *
 * 向后兼容说明：
 *   旧版本数据可能在 uiState 中包含 mainListScrollTop / sidebarScrollTop，
 *   也可能完全缺少 recycleBin / settings 字段。
 *   本函数静默处理所有这些差异，保证从任意历史版本升级都不会失败。
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

    // ---------- recycleBin 归一化（方案 A）----------
    const normalizedRecycleBin = normalizeRecycleBin(
        rawVault && rawVault.recycleBin
    );

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

    // ---------- settings 归一化（方案 A）----------
    const normalizedSettings = normalizeSettings(
        rawVault && rawVault.settings
    );

    return {
        tags: normalizedTags,
        statementsMap: normalizedStatementsMap,
        recycleBin: normalizedRecycleBin,
        uiState: normalizedUiState,
        settings: normalizedSettings
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
    return {
        tags: tags,
        statementsMap: statementsMap,
        recycleBin: vault.recycleBin,
        uiState: uiState,
        settings: vault.settings
    };
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
 * 在回收站中查找条目
 * @param {Object} vault
 * @param {string} recycleBinItemId
 * @returns {Object|null}
 */
export function findRecycleBinItemById(vault, recycleBinItemId) {
    if (!recycleBinItemId) return null;
    if (!Array.isArray(vault.recycleBin)) return null;
    const item = vault.recycleBin.find(function (binItem) {
        return binItem.id === recycleBinItemId;
    });
    return item || null;
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