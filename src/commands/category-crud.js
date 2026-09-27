// filename: src/commands/category-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 分类增 / 改 / 删 / 排序
// 全部为纯函数
//
// 【本次重构 · 分类层级（新建）】
//   本模块集中管理 vault.categories 的变更命令。
//
//   为什么独立成模块：
//     - 与 tag-crud.js 职责镜像（标签的增删改 vs 分类的增删改）
//     - 未来加新分类特性（如分类颜色、分类图标）时集中在本模块扩展
//     - 便于按"分类"维度审查影响面
//
//   命令清单：
//     addCategory       新建分类
//     editCategory      重命名分类
//     deleteCategory    删除分类（其下标签回落默认分类）
//     reorderCategories 重排分类顺序
//
//   设计要点：
//     1. 删除分类**不级联删除标签**（区别于删除标签会级联删除语句）。
//        理由：
//          · 标签是"语句容器"，删除标签 = 删除内容，需要二次确认
//          · 分类只是"标签的组织维度"，删除分类 = 撤销一次组织决策，
//            不应丢失数据
//          · 其下标签的 categoryId 置为 DEFAULT_CATEGORY_ID，自动回落到
//            "未分类"
//        这与现有"删除标签不进入回收站"的设计哲学一致：
//          破坏组织结构 ≠ 破坏数据
//
//     2. 默认分类不可删除、不可重命名。
//        addCategory / editCategory / deleteCategory 均对
//        DEFAULT_CATEGORY_ID 做前置拒绝。
//
//     3. 分类名长度上限复用 MAX_TAG_NAME_LENGTH。
//        理由：分类与标签同属"组织维度名称"，长度约束的合理性完全一致。
//
//     4. 所有命令均返回完整的 Vault 顶层结构（含 categories 字段），
//        保持 Facade 替换 currentVault 时结构完整。
//
//   幂等语义：
//     值未变化时返回原 vault 引用，让 Facade 识别为"无变化"。
// ========================================================================

import { generateUniqueId } from '../utils/id.js';
import {
    DEFAULT_CATEGORY_ID,
    MAX_TAG_NAME_LENGTH
} from '../constants.js';

/**
 * 新建分类
 *
 * @param {Object} vault
 * @param {{ name: string }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 *
 * 校验：
 *   · 名称去空白后非空
 *   · 名称长度 ≤ MAX_TAG_NAME_LENGTH
 *   · 名称不能与现有分类重复（按去空白后精确比较）
 */
export function addCategory(vault, payload) {
    const trimmedName = String(payload.name || '').trim();
    if (!trimmedName) return vault;

    // 名称长度上限：与 UI 层 maxlength 属性保持一致
    if (trimmedName.length > MAX_TAG_NAME_LENGTH) return vault;

    // 分类名不能重复
    const isDuplicate = vault.categories.some(function (category) {
        return category.name.trim() === trimmedName;
    });
    if (isDuplicate) return vault;

    const newCategory = {
        id: generateUniqueId(),
        name: trimmedName
    };

    return {
        categories: [...vault.categories, newCategory],
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 重命名分类
 *
 * @param {Object} vault
 * @param {{ categoryId: string, name: string }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 *
 * 校验：
 *   · categoryId 存在且不是默认分类
 *   · 名称去空白后非空
 *   · 名称长度 ≤ MAX_TAG_NAME_LENGTH
 *   · 名称不能与其他分类重复
 *   · 名称与当前值不同（幂等：无变化时返回原引用）
 */
export function editCategory(vault, payload) {
    const categoryId = payload.categoryId;
    const trimmedName = String(payload.name || '').trim();
    if (!categoryId || !trimmedName) return vault;

    // 默认分类不可重命名
    if (categoryId === DEFAULT_CATEGORY_ID) return vault;

    // 名称长度上限
    if (trimmedName.length > MAX_TAG_NAME_LENGTH) return vault;

    const targetIndex = vault.categories.findIndex(function (category) {
        return category.id === categoryId;
    });
    if (targetIndex === -1) return vault;

    // 名称不能与其他分类重复
    const isDuplicate = vault.categories.some(function (category) {
        return category.id !== categoryId && category.name.trim() === trimmedName;
    });
    if (isDuplicate) return vault;

    // 幂等：名称未变化时返回原引用
    if (vault.categories[targetIndex].name === trimmedName) return vault;

    const newCategories = vault.categories.slice();
    newCategories[targetIndex] = {
        ...newCategories[targetIndex],
        name: trimmedName
    };

    return {
        categories: newCategories,
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 删除分类
 *
 * 行为：
 *   · 分类从 vault.categories 中移除
 *   · 该分类下的所有标签的 categoryId 置为 DEFAULT_CATEGORY_ID
 *   · 标签本身、标签下的语句、回收站均不受影响
 *
 * 【为什么不做级联删除】
 *   见文件头设计说明。
 *
 * 前置拒绝：
 *   · categoryId 为空
 *   · categoryId 是默认分类
 *   · categoryId 不存在
 *
 * @param {Object} vault
 * @param {{ categoryId: string }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 */
export function deleteCategory(vault, payload) {
    const categoryId = payload.categoryId;
    if (!categoryId) return vault;

    // 默认分类不可删除
    if (categoryId === DEFAULT_CATEGORY_ID) return vault;

    const targetIndex = vault.categories.findIndex(function (category) {
        return category.id === categoryId;
    });
    if (targetIndex === -1) return vault;

    const newCategories = vault.categories.filter(function (category) {
        return category.id !== categoryId;
    });

    // 该分类下的标签迁移到默认分类
    // 先检查是否有标签归属该分类，避免不必要的新数组创建
    const categoryHasTags = vault.tags.some(function (tag) {
        return tag.categoryId === categoryId;
    });

    const newTags = categoryHasTags
        ? vault.tags.map(function (tag) {
            if (tag.categoryId === categoryId) {
                return { ...tag, categoryId: DEFAULT_CATEGORY_ID };
            }
            return tag;
        })
        : vault.tags;

    return {
        categories: newCategories,
        tags: newTags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}

/**
 * 重排分类顺序
 *
 * 【语义（本次重构确认）】
 *   orderedIds 接收**全量顺序**（含默认分类）。
 *   侧边栏收集时遍历所有 .category-group，按 DOM 顺序收集 id。
 *
 *   命令层的处理：
 *     1. 按 orderedIds 顺序组织分类
 *     2. 跳过 orderedIds 中不存在的 id（防御非法数据）
 *     3. 追加未在 orderedIds 中出现的分类（保持原顺序）
 *        —— 避免因调用方漏传导致分类丢失
 *
 *   这种"容错优先"的设计允许调用方发送"部分顺序"，
 *   命令层保证结果始终包含全部分类。
 *
 * 幂等：顺序无变化时返回原 vault 引用。
 *
 * @param {Object} vault
 * @param {{ orderedIds: string[] }} payload
 * @returns {Object} 新 Vault（若校验失败返回原 Vault）
 */
export function reorderCategories(vault, payload) {
    const orderedIds = Array.isArray(payload.orderedIds) ? payload.orderedIds : [];

    const categoryMap = new Map(vault.categories.map(function (category) {
        return [category.id, category];
    }));

    const newCategories = [];
    const usedIds = new Set();

    for (const id of orderedIds) {
        if (usedIds.has(id)) continue;
        const category = categoryMap.get(id);
        if (category) {
            newCategories.push(category);
            usedIds.add(id);
        }
    }

    // 追加未在 orderedIds 中出现的分类（保持原顺序）
    for (const category of vault.categories) {
        if (!usedIds.has(category.id)) {
            newCategories.push(category);
        }
    }

    // 幂等检测：顺序无变化时返回原引用
    let orderChanged = newCategories.length !== vault.categories.length;
    if (!orderChanged) {
        for (let index = 0; index < newCategories.length; index++) {
            if (newCategories[index].id !== vault.categories[index].id) {
                orderChanged = true;
                break;
            }
        }
    }
    if (!orderChanged) return vault;

    return {
        categories: newCategories,
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: vault.settings
    };
}