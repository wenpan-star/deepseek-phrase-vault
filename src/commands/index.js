// filename: src/commands/index.js
// ========================================================================
// DeepSeek 语句工坊 · 命令注册总表
// 集中声明每个命令的名称、run 函数与影响的切片
// persistMode 可选值：
//   'immediate'（默认）— 立即持久化
//   'debounced'       — 防抖持久化（用于高频变更如搜索输入）
//   'skip'            — 不持久化（仅瞬态）
//
// ------------------------------------------------------------------------
// 【切片语义定义】
// ------------------------------------------------------------------------
// 'tags'
//   消费方：src/views/sidebar.js 的 renderSidebar
//   依赖状态：
//     · tags 数组本身（增删改序）
//     · 每个标签下的语句计数（statementsMap[tagId].length）
//     · 当前哪个标签高亮（uiState.currentTagId）
//
// 'statements'
//   消费方：
//     · src/views/statement-list.js 的 renderStatementList
//     · src/main.js 的 computeVisibleCount → updateHeaderStats
//   依赖状态：
//     · statementsMap 的内容与顺序
//     · tags 数组（全局搜索模式下，卡片上显示标签徽章，
//       需要读取 tag.name 与 tag.color）
//     · tags 数组的顺序（全局搜索模式下，卡片按 vault.tags 顺序
//       遍历生成，因此标签顺序决定卡片顺序）
//     · uiState.currentTagId
//     · uiState.searchScope
//     · uiState.searchKeyword
//     · uiState.useRegex
//
// 'ui'
//   消费方：
//     · src/views/search-bar.js 的 updateSearchBarUI
//     · src/main.js 的 computeVisibleCount → updateHeaderStats
//   依赖状态：
//     · uiState.searchKeyword
//     · uiState.useRegex
//     · uiState.searchScope
//     · uiState.sidebarExpanded（由 sidebar.js 直接操作 classList，
//       不通过订阅机制，但声明在此便于语义完整）
//
// ------------------------------------------------------------------------
// 【通知规则】
// ------------------------------------------------------------------------
//   某命令若修改了渲染函数 F 所读取的任一字段，
//   就必须在 affects 中声明 F 所订阅的 slice。
//
//   判断方法：
//     1. 列出 run 函数返回的新 vault 中，哪些字段换成了新引用；
//     2. 对照上面的"切片语义定义"，找出读取这些字段的渲染函数；
//     3. 把这些渲染函数所订阅的 slice 全部加入 affects。
//
// ------------------------------------------------------------------------
// 【历史修复记录】
// ------------------------------------------------------------------------
//   修复 1：switchTag 新增 'tags'
//     原因：switchTag 修改 uiState.currentTagId，
//           而 renderSidebar 消费该字段决定哪个标签高亮。
//           之前只通知 'ui' 与 'statements'，导致切换标签后
//           侧边栏的蓝色高亮背景不跟随。
//
//   修复 2：editTag 新增 'statements'
//     原因：editTag 修改 tag.name / tag.color，
//           而在全局搜索模式下，renderStatementList 把这两个字段
//           渲染到卡片上的标签徽章（.card-tag-label）里。
//           之前只通知 'tags'，导致编辑标签后主列表徽章仍显示旧值。
//
//   修复 3：reorderTags 新增 'statements'
//     原因：reorderTags 改变 tags 数组顺序，
//           而在全局搜索模式下，renderStatementList 按 vault.tags
//           顺序遍历生成卡片。之前只通知 'tags'，导致全局模式下
//           卡片顺序不跟随标签重排。
//
//   修复 4：addTag 精简为只通知 'tags'
//     原因：addTag 会创建新的空数组 statementsMap[newId] = []，
//           但空数组不会在主列表中产出任何卡片，也不会影响现有
//           卡片的顺序或内容。之前的 ['tags', 'statements'] 声明
//           会导致每次新建标签时多余地重绘主列表。
//           移除 'statements' 后可显著降低新建标签的开销，
//           且不产生任何可见行为变化。
//
//   修复 5：删除 setScrollPositions
//     原因：滚动位置已从 Vault 迁移到 sessionStorage（见
//           statement-list.js 与 main.js 中的 scroll memory 相关函数）。
//           Vault 中不再承载 mainListScrollTop / sidebarScrollTop，
//           该命令已无任何消费方，属死代码，予以删除。
// ========================================================================

import { registerCommands } from '../core/facade.js';
import * as statementCrud from './statement-crud.js';
import * as statementOrganize from './statement-organize.js';
import * as tagCrud from './tag-crud.js';
import * as uiState from './ui-state.js';

/**
 * 一次性注册所有命令。
 *
 * 说明：
 *   - 每个命令都必须显式声明 affects 数组（不得省略）
 *   - affects 的每个值必须是 'tags' / 'statements' / 'ui' 三者之一
 *   - persistMode 可选，默认 'immediate'
 */
export function registerAllCommands() {
    registerCommands({
        // ================================================================
        // 语句 CRUD
        // ================================================================

        // 新增单条语句：
        //   - 'statements'：主列表需重绘，加入新卡片
        //   - 'tags'：该标签的计数徽章 +1
        'addStatement': {
            run: statementCrud.addStatement,
            affects: ['statements', 'tags']
        },

        // 批量新增语句（用于旧格式导入）：
        //   - 'statements'：主列表需重绘
        //   - 'tags'：该标签的计数徽章变化
        'addStatementsBatch': {
            run: statementCrud.addStatementsBatch,
            affects: ['statements', 'tags']
        },

        // 编辑语句文本：
        //   - 'statements'：主列表需重绘（文本变化）
        //   - 'tags' 不通知：语句数量未变，计数徽章无影响
        'editStatement': {
            run: statementCrud.editStatement,
            affects: ['statements']
        },

        // 删除语句：
        //   - 'statements'：主列表需重绘，移除卡片
        //   - 'tags'：该标签的计数徽章 -1
        'deleteStatement': {
            run: statementCrud.deleteStatement,
            affects: ['statements', 'tags']
        },

        // ================================================================
        // 语句批量组织
        // ================================================================

        // 批量删除：
        //   - 'statements'：主列表需重绘
        //   - 'tags'：涉及的所有标签计数徽章变化
        'batchDeleteStatements': {
            run: statementOrganize.batchDeleteStatements,
            affects: ['statements', 'tags']
        },

        // 批量移动：
        //   - 'statements'：源与目标标签的主列表都需重绘
        //   - 'tags'：源标签计数 -N，目标标签计数 +N
        'batchMoveStatements': {
            run: statementOrganize.batchMoveStatements,
            affects: ['statements', 'tags']
        },

        // 复制语句到指定标签：
        //   - 'statements'：若目标标签是当前标签，主列表立即体现
        //   - 'tags'：目标标签计数 +1
        'copyStatementToTag': {
            run: statementOrganize.copyStatementToTag,
            affects: ['statements', 'tags']
        },

        // 复制语句到默认语库：
        //   - 内部调用 copyStatementToTag
        //   - 'statements' 与 'tags' 都需要通知
        'copyStatementToDefault': {
            run: statementOrganize.copyStatementToDefault,
            affects: ['statements', 'tags']
        },

        // 标签内排序：
        //   - 'statements'：主列表顺序变化
        //   - 'tags' 不通知：计数未变
        'reorderStatementsInTag': {
            run: statementOrganize.reorderStatementsInTag,
            affects: ['statements']
        },

        // 复制计数 +1：
        //   - 'statements'：默认标签下按 copyCount 降序，排序可能变化
        //   - 'tags' 不通知：计数未变
        'incrementCopyCount': {
            run: statementOrganize.incrementCopyCount,
            affects: ['statements']
        },

        // ================================================================
        // 标签 CRUD
        // ================================================================

        // 新建标签：
        //   - 'tags'：侧边栏需新增条目
        //   - 'statements' 不通知：新建标签只会创建一个空数组，
        //     不会在主列表中产出任何卡片，也不会改变现有卡片顺序。
        //     （参见文件头"修复 4"）
        'addTag': {
            run: tagCrud.addTag,
            affects: ['tags']
        },

        // 编辑标签（名称 / 颜色）：
        //   - 'tags'：侧边栏名称与色点变化
        //   - 'statements'：★ 修复 2 ★
        //       全局搜索模式下，卡片上渲染 .card-tag-label，
        //       其中包含 tag.name 与 tag.color，必须重绘主列表
        'editTag': {
            run: tagCrud.editTag,
            affects: ['tags', 'statements']
        },

        // 删除标签：
        //   - 'tags'：侧边栏移除该条目
        //   - 'statements'：该标签下所有语句被删除，主列表需重绘
        //   - 'ui'：若删除的是当前标签，switchTag 切到默认标签，
        //           搜索栏等 UI 需感知
        'deleteTag': {
            run: tagCrud.deleteTag,
            affects: ['tags', 'statements', 'ui']
        },

        // 重排标签：
        //   - 'tags'：侧边栏顺序变化
        //   - 'statements'：★ 修复 3 ★
        //       全局搜索模式下，renderStatementList 按 vault.tags 顺序
        //       遍历生成卡片，标签顺序即卡片顺序
        'reorderTags': {
            run: tagCrud.reorderTags,
            affects: ['tags', 'statements']
        },

        // ================================================================
        // UI 状态
        // ================================================================

        // 切换当前标签：
        //   - 'ui'：currentTagId 属于 UI 状态
        //   - 'statements'：主列表需按新标签重新计算可见语句
        //   - 'tags'：★ 修复 1 ★
        //       侧边栏需重绘以更新 active 高亮
        'switchTag': {
            run: uiState.switchTag,
            affects: ['ui', 'statements', 'tags']
        },

        // 设置搜索关键词：
        //   - 'ui'：搜索栏需刷新
        //   - 'statements'：主列表过滤结果变化
        //   - persistMode: 'debounced'：搜索输入是高频操作
        'setSearchKeyword': {
            run: uiState.setSearchKeyword,
            affects: ['ui', 'statements'],
            persistMode: 'debounced'
        },

        // 设置正则模式：
        //   - 'ui'：正则按钮的 active 态
        //   - 'statements'：过滤结果变化
        'setUseRegex': {
            run: uiState.setUseRegex,
            affects: ['ui', 'statements']
        },

        // 设置搜索作用域（本地 / 全局）：
        //   - 'ui'：作用域按钮的图标
        //   - 'statements'：主列表可见集完全变化
        'setSearchScope': {
            run: uiState.setSearchScope,
            affects: ['ui', 'statements']
        },

        // 设置侧边栏展开状态：
        //   - 'ui'：sidebarExpanded 属于 UI 状态
        //   - 注意：实际的展开/折叠动画由 sidebar.js 直接操作 classList，
        //           不通过订阅机制；此处通知 'ui' 仅为语义完整性
        'setSidebarExpanded': {
            run: uiState.setSidebarExpanded,
            affects: ['ui']
        }

        // 注：原 'setScrollPositions' 命令已删除（参见文件头"修复 5"）。
        //     滚动位置现由 sessionStorage 独立管理，不进入 Vault。
    });
}