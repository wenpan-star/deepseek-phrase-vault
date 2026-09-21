// filename: src/utils/dom.js
// ========================================================================
// DeepSeek 语句工坊 · DOM 工具
// 提供最基础的 DOM 查询与文本转义
// 本模块无任何业务语义，可被任意层引用
//
// 【本次改进 · M6 修复（历史）】
//   删除了未被任何调用方使用的导出函数 delegate。
//
//   背景：
//     delegate 是一个通用的事件委托工具函数，
//     但项目实际采用的路径是：
//       - 各视图（sidebar.js / statement-list.js / batch-bar.js 等）
//         在 initializeXxx 中手写 addEventListener
//       - 从未有任何模块 import 或调用 delegate
//
//   决策：
//     删除。理由：
//       1. 减少代码体积
//       2. 避免"看起来有统一的事件委托工具，实际各视图各写各的"
//          造成的认知负担
//       3. 若未来需要，重新加入只需几行
//
// 【本轮深度审核修复（第一批）】
//   L2（死代码）：删除未使用的 $$ 导出。
//
//     背景：
//       与 M6 修复同类问题。$$ 是 querySelectorAll 的简写，
//       返回真数组。经全项目扫描，所有视图模块都直接使用
//       document.querySelectorAll(...) 或 element.querySelectorAll(...)，
//       从未 import 或调用 $$。
//
//     决策：
//       删除。理由同上：
//         1. 减少代码体积
//         2. 保持 dom.js 只暴露真正被使用的 API
//         3. 若未来需要，重新加入只需几行
// ========================================================================

/**
 * querySelector 简写
 * @param {string} selector
 * @param {ParentNode} [root=document]
 * @returns {Element|null}
 */
export function $(selector, root = document) {
    return root.querySelector(selector);
}

/**
 * HTML 文本转义
 * 覆盖 & < > " '，确保放入属性或文本节点都安全
 * @param {string} inputString
 * @returns {string}
 */
export function escapeHtml(inputString) {
    return String(inputString).replace(/[&<>"']/g, function (matchCharacter) {
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeMap[matchCharacter];
    });
}