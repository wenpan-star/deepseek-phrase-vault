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
// 【方案 A 调整】
//   1. 新增 vault.settings 命名空间：
//        与 uiState 分离，用于存放用户偏好（跨会话持久，
//        未来可参与"配置同步"，与"重置 UI 状态"解耦）
//   2. 新增 vault.recycleBin 数组：
//        存放软删除的语句。每条记录包含来源标签快照
//        （id / name / color）与删除时间。
//   3. 新增 normalizeSettings / normalizeRecycleBin 两个归一化函数
//
// 【本次重构 · 分类层级（新增）】
//   1. 新增 vault.categories 数组：
//        标签的一级分组。每条记录包含 id 与 name。
//        默认分类（DEFAULT_CATEGORY_ID = "未分类"）永远存在，
//        作为所有未分类标签的兜底容器。
//
//   2. 标签新增 categoryId 字段：
//        指向 vault.categories 中的某个分类。
//        归一化时若 categoryId 缺失或指向不存在的分类，
//        自动回落到 DEFAULT_CATEGORY_ID。
//
//   3. 新增 normalizeCategories 归一化函数。
//
//   4. 归一化策略：
//        · 旧数据无 categories 字段 → 创建只含默认分类的数组，
//          所有旧标签自动归入默认分类。用户升级后首次打开即看到
//          "未分类"下包含全部旧标签，体验连续，无数据丢失。
//        · 数据里 tags[].categoryId 指向已被删除的分类（例如
//          用户手动编辑或数据被截断）→ 回落到默认分类。
//        · 保证默认分类一定存在（不存在则在首位插入）。
//
//   5. 折叠状态不进 Vault（详见 constants.js 注释）。
//      uiState 结构保持与方案 A 完全一致。
//
// 【本轮深度审核（第一批 / 第二批 / 第三批）】
//   本模块无需逻辑修改。
//   ensureDefaultTagExists 在返回对象中已正确携带 categories
//   字段，保持 Vault 顶层结构完整性。
// ========================================================================

import {
    DEFAULT_TAG_ID,
    DEFAULT_TAG_NAME,
    DEFAULT_CATEGORY_ID,
    DEFAULT_CATEGORY_NAME,
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
 *     categories: [{ id, name }],       ← 本次重构新增
 *     tags: [],
 *     statementsMap: {},
 *     recycleBin: [],
 *     uiState: { ...会话级瞬态... },
 *     settings: { ...用户偏好... }
 *   }
 *
 * 新建时 categories 已含默认分类，保证 Vault 始终满足
 * "至少有一个分类"的不变式。
 *
 * @returns {{categories: Array, tags: Array, statementsMap: Object, recycleBin: Array, uiState: Object, settings: Object}}
 */
export function createEmptyVault() {
    return {
        categories: [
            { id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME }
        ],
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
 *
 * 说明：preset.tags 的每一项都会被赋予 DEFAULT_CATEGORY_ID，
 *       即所有内置标签默认归入"未分类"。
 *       这与"旧数据自动归入默认分类"的行为保持一致。
 *
 * @returns {{categories: Array, tags: Array, statementsMap: Object, recycleBin: Array, uiState: Object, settings: Object}}
 */
export function createVaultFromBuiltinPreset() {
    const preset = getBuiltinPreset();
    const vault = createEmptyVault();
    vault.tags = preset.tags.map(function (tag) {
        return {
            id: tag.id,
            name: tag.name,
            // 预设中的颜色同样走白名单，防御 preset.js 被误编辑
            color: PRESET_COLORS.includes(tag.color) ? tag.color : null,
            // 本次重构：所有预设标签默认归入"未分类"
            categoryId: DEFAULT_CATEGORY_ID
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
 * 归一化分类数组（本次重构新增）。
 *
 * 规则：
 *   · 非数组（undefined / null / 其他类型）→ 返回只含默认分类的数组
 *   · 每项校验 id 与 name：任一为空则丢弃
 *   · 同 id 去重（保留首次出现的）
 *   · 保证默认分类一定存在：
 *       若归一化后的数组不含默认分类 → 在首位插入默认分类
 *       （unshift 而非 push：默认分类保持在最上方，用户初次打开
 *        即能看到"未分类"作为落点）
 *
 * 与标签归一化的差异：
 *   · 分类没有颜色字段（分类不参与色点标识）
 *   · 分类没有其他嵌套字段（保持最简结构）
 *   · 默认分类的插入位置固定为首位（标签的默认标签固定为首位，
 *     两者设计一致）
 *
 * 防御要点：
 *   · 非对象项静默丢弃
 *   · name 去空白后为空则丢弃（避免幽灵"空名分类"）
 *   · 严格去重，避免同 id 多份副本造成的引用混乱
 *
 * @param {Array|null|undefined} rawCategories
 * @returns {Array<{id: string, name: string}>}
 */
export function normalizeCategories(rawCategories) {
    if (!Array.isArray(rawCategories)) {
        return [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME }];
    }

    const result = [];
    const seenIds = new Set();

    for (const rawCategory of rawCategories) {
        if (!rawCategory || typeof rawCategory !== 'object') continue;

        const categoryId = rawCategory.id == null
            ? ''
            : String(rawCategory.id).trim();
        const categoryName = rawCategory.name == null
            ? ''
            : String(rawCategory.name).trim();

        if (!categoryId || !categoryName) continue;
        if (seenIds.has(categoryId)) continue;

        seenIds.add(categoryId);
        result.push({ id: categoryId, name: categoryName });
    }

    // 保证默认分类存在
    if (!seenIds.has(DEFAULT_CATEGORY_ID)) {
        result.unshift({
            id: DEFAULT_CATEGORY_ID,
            name: DEFAULT_CATEGORY_NAME
        });
    }

    return result;
}

/**
 * 归一化完整 Vault：补全所有缺失字段，剔除非法数据
 *
 * 向后兼容说明：
 *   旧版本数据可能在 uiState 中包含 mainListScrollTop / sidebarScrollTop，
 *   也可能完全缺少 recycleBin / settings 字段。
 *   本次重构又新增了 categories 字段。
 *   本函数静默处理所有这些差异，保证从任意历史版本升级都不会失败。
 *
 * @param {Object} rawVault
 * @returns {Object}
 */
export function normalizeVault(rawVault) {
    // ---------- 分类归一化（本次重构新增）----------
    // 顺序很重要：先归一化分类，再归一化标签，
    // 因为标签的 categoryId 需要参照分类名单校验。
    const normalizedCategories = normalizeCategories(
        rawVault && rawVault.categories
    );
    const knownCategoryIds = new Set(
        normalizedCategories.map(function (category) {
            return category.id;
        })
    );

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

        // 分类归属校验：非法或缺失时回落到默认分类
        // （旧数据无 categoryId 字段 → 自动归入"未分类"）
        const rawCategoryId = rawTag.categoryId == null
            ? ''
            : String(rawTag.categoryId).trim();
        const tagCategoryId = knownCategoryIds.has(rawCategoryId)
            ? rawCategoryId
            : DEFAULT_CATEGORY_ID;

        normalizedTags.push({
            id: tagId,
            name: tagName,
            color: tagColor,
            categoryId: tagCategoryId
        });
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
    //       本次重构同样不读取任何"折叠状态"字段——
    //       折叠状态由 localStorage 独立键管理，与 Vault 完全解耦。
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
        categories: normalizedCategories,
        tags: normalizedTags,
        statementsMap: normalizedStatementsMap,
        recycleBin: normalizedRecycleBin,
        uiState: normalizedUiState,
        settings: normalizedSettings
    };
}

/**
 * 确保默认分类与默认标签存在；确保 currentTagId 合法；
 * 确保每个标签的 categoryId 合法。
 *
 * 【本次重构】
 *   1. 函数名保持（不破坏现有调用方），但职责扩展为同时保证
 *      默认分类和默认标签。
 *   2. 返回对象补齐 categories 字段，保持 Vault 顶层结构完整。
 *
 * 【幂等性】
 *   若一切正常（默认分类存在、默认标签存在、categoryId 都合法、
 *   currentTagId 合法），返回原 vault 引用。
 *   否则返回新对象。
 *
 * @param {Object} vault
 * @returns {Object} 新的 vault（或原 vault 引用）
 */
export function ensureDefaultTagExists(vault) {
    // ---------- 分类保障 ----------
    let categories = Array.isArray(vault.categories)
        ? vault.categories.slice()
        : [];
    let modified = false;

    // 保证默认分类存在（首位）
    if (categories.length === 0) {
        categories = [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME }];
        modified = true;
    } else {
        const defaultCategoryIndex = categories.findIndex(function (category) {
            return category.id === DEFAULT_CATEGORY_ID;
        });
        if (defaultCategoryIndex === -1) {
            categories.unshift({
                id: DEFAULT_CATEGORY_ID,
                name: DEFAULT_CATEGORY_NAME
            });
            modified = true;
        } else if (categories[defaultCategoryIndex].name !== DEFAULT_CATEGORY_NAME) {
            // 默认分类名被意外修改 → 恢复为规定名称
            const updatedCategories = categories.slice();
            updatedCategories[defaultCategoryIndex] = {
                ...updatedCategories[defaultCategoryIndex],
                name: DEFAULT_CATEGORY_NAME
            };
            categories = updatedCategories;
            modified = true;
        }
    }

    const knownCategoryIds = new Set(
        categories.map(function (category) {
            return category.id;
        })
    );

    // ---------- 标签保障 ----------
    const tags = vault.tags.slice();
    const statementsMap = { ...vault.statementsMap };

    const defaultTagIndex = tags.findIndex(function (tag) {
        return tag.id === DEFAULT_TAG_ID;
    });
    if (defaultTagIndex === -1) {
        tags.unshift({
            id: DEFAULT_TAG_ID,
            name: DEFAULT_TAG_NAME,
            color: null,
            categoryId: DEFAULT_CATEGORY_ID
        });
        if (!statementsMap[DEFAULT_TAG_ID]) {
            statementsMap[DEFAULT_TAG_ID] = [];
        }
        modified = true;
    } else if (tags[defaultTagIndex].name !== DEFAULT_TAG_NAME) {
        tags[defaultTagIndex] = {
            ...tags[defaultTagIndex],
            name: DEFAULT_TAG_NAME
        };
        modified = true;
    }

    // 保证所有标签的 categoryId 合法（指向存在的分类）
    for (let tagIndex = 0; tagIndex < tags.length; tagIndex++) {
        const tagCategoryId = tags[tagIndex].categoryId;
        if (!tagCategoryId || !knownCategoryIds.has(tagCategoryId)) {
            tags[tagIndex] = {
                ...tags[tagIndex],
                categoryId: DEFAULT_CATEGORY_ID
            };
            modified = true;
        }
    }

    // 每个标签都必须有语句数组
    for (const tag of tags) {
        if (!Array.isArray(statementsMap[tag.id])) {
            statementsMap[tag.id] = [];
            modified = true;
        }
    }

    // ---------- uiState 保障 ----------
    const uiState = { ...vault.uiState };
    if (!uiState.currentTagId || !tags.some(function (tag) {
        return tag.id === uiState.currentTagId;
    })) {
        uiState.currentTagId = DEFAULT_TAG_ID;
        modified = true;
    }

    if (!modified) return vault;

    return {
        categories: categories,
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

/**
 * 统计某分类下的标签数（本次重构新增）
 *
 * 供侧边栏渲染分类徽章使用：
 *   · 分类徽章显示"该分类下的标签数量"，而非"语句总数"
 *   · 理由：分类的直接子项是标签，用标签数描述分类的"容量"最直观
 *
 * @param {Object} vault
 * @param {string} categoryId
 * @returns {number}
 */
export function countTagsInCategory(vault, categoryId) {
    if (!categoryId) return 0;
    if (!Array.isArray(vault.tags)) return 0;
    return vault.tags.filter(function (tag) {
        return tag.categoryId === categoryId;
    }).length;
}

/**
 * 获取指定分类下的标签列表（本次重构新增）
 *
 * 保持 vault.tags 数组的原有顺序，不重新排序。
 * 侧边栏渲染时直接使用，保证"标签在分类内的相对顺序"
 * 与"vault.tags 数组顺序"严格一致。
 *
 * @param {Object} vault
 * @param {string} categoryId
 * @returns {Array}
 */
export function getTagsInCategory(vault, categoryId) {
    if (!categoryId) return [];
    if (!Array.isArray(vault.tags)) return [];
    return vault.tags.filter(function (tag) {
        return tag.categoryId === categoryId;
    });
}