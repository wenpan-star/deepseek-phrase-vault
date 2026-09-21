// filename: src/commands/settings-crud.js
// ========================================================================
// DeepSeek 语句工坊 · 设置项变更
// 全部为纯函数
//
// 【方案 A（上一轮）】
//   新建本模块，集中管理 vault.settings 的变更命令。
//
//   为什么独立成模块：
//     - ui-state.js 管理 uiState（会话级瞬态）
//     - settings-crud.js 管理 settings（用户偏好，跨会话持久）
//     - 职责分离清晰，未来加新设置项时集中在本模块扩展
//
//   affects 声明规则：
//     - 若设置项影响搜索行为（如 enableInitialsSearch）→ ['statements']
//     - 若设置项影响外观（如 theme）→ ['ui']
//     - 若设置项影响数据行为（如 autoBackup）→ []（无 UI 影响）
//     具体到每个命令在注册表中声明
//
// 【本轮深度审核（第二批）】
//   本模块无需逻辑修改。
//   幂等语义正确：值未变化时返回原 vault 引用，
//   让 Facade 识别为"无变化"。
//
//   main.js 中的 handleSettingsToggle（M3 修复）通过读取最新 vault
//   判定"幂等 vs 拒绝"，本模块的幂等返回语义与此兼容。
// ========================================================================

/**
 * 设置首字母搜索开关
 *
 * 数据位置：vault.settings.enableInitialsSearch
 * 语义：控制 matchSearch / highlightText 是否走拼音首字母回退路径
 *
 * 幂等：若值相同则返回原 vault 引用，让 Facade 识别为"无变化"
 *
 * @param {Object} vault
 * @param {{ enabled: boolean }} payload
 * @returns {Object} 新 Vault
 */
export function setInitialsSearchEnabled(vault, payload) {
    const enabled = Boolean(payload.enabled);

    // 值未变化：返回原引用，避免无意义的加密写入
    if (vault.settings.enableInitialsSearch === enabled) return vault;

    return {
        tags: vault.tags,
        statementsMap: vault.statementsMap,
        recycleBin: vault.recycleBin,
        uiState: vault.uiState,
        settings: {
            ...vault.settings,
            enableInitialsSearch: enabled
        }
    };
}