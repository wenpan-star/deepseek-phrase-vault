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
//
// 'statements'
//   消费方：
//     · src/views/statement-list.js 的 renderStatementList
//     · src/main.js 的 computeVisibleCount → updateHeaderStats
//
// 'ui'
//   消费方：
//     · src/views/search-bar.js 的 updateSearchBarUI
//     · src/main.js 的 computeVisibleCount → updateHeaderStats
//
// 'recycleBin'
//   消费方：
//     · src/views/more-menu.js 的 updateMoreMenuBadge（计数徽章）
//     · src/views/modals/recycle-bin-modal.js 的 renderAll（面板内容）
//
// ------------------------------------------------------------------------
// 【历史修复记录】
// ------------------------------------------------------------------------
//   修复 1：switchTag 新增 'tags'
//   修复 2：editTag 新增 'statements'
//   修复 3：reorderTags 新增 'statements'
//   修复 4：addTag 精简为只通知 'tags'
//   修复 5：删除 setScrollPositions
//
// 【方案 A（上一轮）】
//   1. 新增 'recycleBin' 切片用于回收站变更通知
//   2. 新增命令：
//       'setInitialsSearchEnabled'        切换首字母搜索
//       'restoreStatementFromRecycleBin'  恢复单条
//       'restoreStatementsFromRecycleBin' 批量恢复
//       'purgeStatementFromRecycleBin'    彻底删除单条
//       'purgeStatementsFromRecycleBin'   批量彻底删除
//       'clearRecycleBin'                 清空回收站
//       'cleanupExpiredRecycleBinItems'   清理过期条目
//   3. 修改命令的 affects：
//       'deleteStatement'          增加 'recycleBin'
//       'batchDeleteStatements'    增加 'recycleBin'
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
//   'setInitialsSearchEnabled' 的 affects: ['statements'] 判定正确：
//     · 该设置项只影响主列表渲染结果（首字母回退匹配是否启用）
//     · 通过 subscribe('statements') 触发 renderStatementList
//       与 updateHeaderStats(computeVisibleCount())，统计数字同步刷新
//     · 搜索栏本身不展示该开关状态，无需通知 'ui'
// ========================================================================

import { registerCommands } from '../core/facade.js';
import * as statementCrud from './statement-crud.js';
import * as statementOrganize from './statement-organize.js';
import * as tagCrud from './tag-crud.js';
import * as uiState from './ui-state.js';
import * as settingsCrud from './settings-crud.js';
import * as recycleBin from './recycle-bin.js';

/**
 * 一次性注册所有命令。
 *
 * 说明：
 *   - 每个命令都必须显式声明 affects 数组（不得省略）
 *   - affects 的每个值必须是 'tags' / 'statements' / 'ui' / 'recycleBin'
 *     四者之一
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
        'editStatement': {
            run: statementCrud.editStatement,
            affects: ['statements']
        },

        // 删除语句（软删除）：
        //   - 'statements'：主列表需重绘，移除卡片
        //   - 'tags'：该标签的计数徽章 -1
        //   - 'recycleBin'：回收站新增一条，徽章 +1
        'deleteStatement': {
            run: statementCrud.deleteStatement,
            affects: ['statements', 'tags', 'recycleBin']
        },

        // ================================================================
        // 语句批量组织
        // ================================================================

        // 批量删除（软删除）：
        //   - 'statements'：主列表需重绘
        //   - 'tags'：涉及的所有标签计数徽章变化
        //   - 'recycleBin'：回收站批量新增
        'batchDeleteStatements': {
            run: statementOrganize.batchDeleteStatements,
            affects: ['statements', 'tags', 'recycleBin']
        },

        // 批量移动：
        //   - 'statements'：源与目标标签的主列表都需重绘
        //   - 'tags'：源标签计数 -N，目标标签计数 +N
        'batchMoveStatements': {
            run: statementOrganize.batchMoveStatements,
            affects: ['statements', 'tags']
        },

        // 复制语句到指定标签：
        'copyStatementToTag': {
            run: statementOrganize.copyStatementToTag,
            affects: ['statements', 'tags']
        },

        // 复制语句到默认语库：
        'copyStatementToDefault': {
            run: statementOrganize.copyStatementToDefault,
            affects: ['statements', 'tags']
        },

        // 标签内排序：
        'reorderStatementsInTag': {
            run: statementOrganize.reorderStatementsInTag,
            affects: ['statements']
        },

        // 复制计数 +1：
        'incrementCopyCount': {
            run: statementOrganize.incrementCopyCount,
            affects: ['statements']
        },

        // ================================================================
        // 标签 CRUD
        // ================================================================

        // 新建标签：
        //   - 'tags'：侧边栏需新增条目
        'addTag': {
            run: tagCrud.addTag,
            affects: ['tags']
        },

        // 编辑标签（名称 / 颜色）：
        //   - 'tags'：侧边栏名称与色点变化
        //   - 'statements'：全局搜索模式下，卡片上渲染 .card-tag-label
        'editTag': {
            run: tagCrud.editTag,
            affects: ['tags', 'statements']
        },

        // 删除标签：
        //   - 'tags'：侧边栏移除该条目
        //   - 'statements'：该标签下所有语句被删除，主列表需重绘
        //   - 'ui'：若删除的是当前标签，切换到默认标签
        'deleteTag': {
            run: tagCrud.deleteTag,
            affects: ['tags', 'statements', 'ui']
        },

        // 重排标签：
        //   - 'tags'：侧边栏顺序变化
        //   - 'statements'：全局搜索模式下，卡片顺序跟随标签顺序
        'reorderTags': {
            run: tagCrud.reorderTags,
            affects: ['tags', 'statements']
        },

        // ================================================================
        // UI 状态
        // ================================================================

        // 切换当前标签：
        'switchTag': {
            run: uiState.switchTag,
            affects: ['ui', 'statements', 'tags']
        },

        // 设置搜索关键词：
        'setSearchKeyword': {
            run: uiState.setSearchKeyword,
            affects: ['ui', 'statements'],
            persistMode: 'debounced'
        },

        // 设置正则模式：
        'setUseRegex': {
            run: uiState.setUseRegex,
            affects: ['ui', 'statements']
        },

        // 设置搜索作用域：
        'setSearchScope': {
            run: uiState.setSearchScope,
            affects: ['ui', 'statements']
        },

        // 设置侧边栏展开状态：
        'setSidebarExpanded': {
            run: uiState.setSidebarExpanded,
            affects: ['ui']
        },

        // ================================================================
        // 设置项（方案 A）
        // ================================================================

        // 设置首字母搜索开关：
        //   - 'statements'：关闭/开启会改变主列表搜索结果
        //   - 不通知 'ui'：搜索栏本身不展示该开关状态
        'setInitialsSearchEnabled': {
            run: settingsCrud.setInitialsSearchEnabled,
            affects: ['statements']
        },

        // ================================================================
        // 回收站操作（方案 A）
        // ================================================================

        // 从回收站恢复单条：
        //   - 'statements'：目标标签下新增卡片
        //   - 'tags'：目标标签计数 +1
        //   - 'recycleBin'：回收站移除一条
        'restoreStatementFromRecycleBin': {
            run: recycleBin.restoreStatementFromRecycleBin,
            affects: ['statements', 'tags', 'recycleBin']
        },

        // 从回收站批量恢复：
        //   - 'statements'：目标标签下新增多张卡片
        //   - 'tags'：目标标签计数 +N
        //   - 'recycleBin'：回收站移除多条（保留冲突的）
        'restoreStatementsFromRecycleBin': {
            run: recycleBin.restoreStatementsFromRecycleBin,
            affects: ['statements', 'tags', 'recycleBin']
        },

        // 从回收站彻底删除单条：
        //   - 'recycleBin'：回收站移除一条
        'purgeStatementFromRecycleBin': {
            run: recycleBin.purgeStatementFromRecycleBin,
            affects: ['recycleBin']
        },

        // 从回收站批量彻底删除：
        //   - 'recycleBin'：回收站移除多条
        'purgeStatementsFromRecycleBin': {
            run: recycleBin.purgeStatementsFromRecycleBin,
            affects: ['recycleBin']
        },

        // 清空回收站：
        //   - 'recycleBin'：回收站清空
        'clearRecycleBin': {
            run: recycleBin.clearRecycleBin,
            affects: ['recycleBin']
        },

        // 清理过期条目（打开面板时调用）：
        //   - 'recycleBin'：回收站条目可能减少
        'cleanupExpiredRecycleBinItems': {
            run: recycleBin.cleanupExpiredRecycleBinItems,
            affects: ['recycleBin']
        }
    });
}