// filename: src/core/facade.js
// ========================================================================
// DeepSeek 语句工坊 · 门面
// 整个应用唯一的状态入口 / 出口：
//   - dispatch(commandName, payload)  → 命令执行，状态更新，持久化，通知
//   - query(fn)                       → 只读访问（保留用于未来扩展）
//   - subscribe(slice, handler)       → 按切片订阅
//   - replaceVault(vault, affects)    → 用于导入、重置等整块替换
// 本模块是唯一的副作用汇合点，其余模块均为纯逻辑
// 支持 persistMode：'immediate'（默认）| 'debounced' | 'skip'
//
// 【本次改进 · P1-N2 修复】
//   dispatch 现在返回一个布尔值，表示"是否实际改变了状态"。
//
//   背景：
//     命令层（如 addStatement / editTag / reorderStatementsInTag）
//     会在各种前置条件不满足时返回原 vault 引用。
//     facade 检测到 nextVault === previousVault 时静默 return，
//     调用方无法感知命令是否真的执行。
//     这导致 UI 层"只要调用 dispatch 就提示成功"，
//     在命令被拒时给出错误提示，用户会以为操作成功但数据未变。
//
//   修复：
//     dispatch 返回值语义明确：
//       true  = 命令实际执行，状态已更新，持久化已触发，订阅者已通知
//       false = 命令被拒（未注册命令 / 返回原 vault / 返回非法值）
//     调用方可据此决定是否提示成功或失败。
// ========================================================================

import {
    loadVaultFromStorage,
    saveVaultToStorage,
    saveVaultToStorageDebounced,
    setPersistToastHandler
} from './persist.js';

let currentVault = null;
const commandRegistry = new Map();
const subscribersBySlice = new Map();

/**
 * 注册命令
 * @param {string} name
 * @param {{run: Function, affects: string[], persistMode?: string}} definition
 */
export function registerCommand(name, definition) {
    if (typeof definition.run !== 'function') {
        throw new Error(`[facade] 命令 "${name}" 缺少 run 函数`);
    }
    const persistMode = definition.persistMode || 'immediate';
    const validModes = ['immediate', 'debounced', 'skip'];
    if (validModes.indexOf(persistMode) === -1) {
        console.warn(`[facade] 命令 "${name}" 使用了未知 persistMode "${persistMode}"，回退为 immediate`);
    }
    commandRegistry.set(name, {
        run: definition.run,
        affects: Array.isArray(definition.affects) ? definition.affects.slice() : [],
        persistMode: validModes.indexOf(persistMode) === -1 ? 'immediate' : persistMode
    });
}

/**
 * 批量注册
 * @param {Object<string, {run: Function, affects: string[], persistMode?: string}>} map
 */
export function registerCommands(map) {
    for (const name of Object.keys(map)) {
        registerCommand(name, map[name]);
    }
}

/**
 * 只读查询
 * 注：当前项目所有视图层均通过 getVaultSnapshot() 获取 vault 引用。
 *     query 作为未来的"只读访问入口"保留，视图层可逐步迁移至 query。
 *
 * @param {(vault: Object) => any} queryFunction
 * @returns {any}
 */
export function query(queryFunction) {
    if (!currentVault) {
        console.warn('[facade] Vault 尚未初始化');
        return undefined;
    }
    return queryFunction(currentVault);
}

/**
 * 获取当前 Vault 引用（慎用，仅限只读）
 * @returns {Object}
 */
export function getVaultSnapshot() {
    return currentVault;
}

/**
 * 派发命令
 *
 * @param {string} commandName
 * @param {Object} payload
 * @returns {boolean} true = 状态已更新；false = 命令被拒
 */
export function dispatch(commandName, payload) {
    const command = commandRegistry.get(commandName);
    if (!command) {
        console.warn(`[facade] 未注册的命令: ${commandName}`);
        return false;
    }
    const previousVault = currentVault;
    const nextVault = command.run(currentVault, payload || {});
    if (!nextVault || nextVault === previousVault) {
        // 命令被拒（校验失败 / 无变化），不持久化、不通知
        return false;
    }
    currentVault = nextVault;

    if (command.persistMode === 'debounced') {
        saveVaultToStorageDebounced(currentVault).catch(function (persistError) {
            console.error('[facade] 防抖持久化失败:', persistError);
        });
    } else if (command.persistMode === 'skip') {
        // 显式不持久化，仅用于调试 / 瞬态命令
    } else {
        saveVaultToStorage(currentVault).catch(function (persistError) {
            console.error('[facade] 持久化失败:', persistError);
        });
    }

    notifySubscribers(command.affects);
    return true;
}

/**
 * 整块替换 Vault（导入、重置等场景）
 * @param {Object} nextVault
 * @param {string[]} affects
 */
export function replaceVault(nextVault, affects) {
    currentVault = nextVault;
    saveVaultToStorage(currentVault).catch(function (persistError) {
        console.error('[facade] 持久化失败:', persistError);
    });
    notifySubscribers(Array.isArray(affects) && affects.length > 0
        ? affects
        : ['tags', 'statements', 'ui']);
}

/**
 * 订阅切片变更
 * @param {string} slice  可取 'tags' | 'statements' | 'ui'
 * @param {(vault: Object) => void} handler
 * @returns {() => void} 取消订阅函数
 */
export function subscribe(slice, handler) {
    if (typeof handler !== 'function') return function () {};
    if (!subscribersBySlice.has(slice)) {
        subscribersBySlice.set(slice, new Set());
    }
    subscribersBySlice.get(slice).add(handler);
    return function () {
        const sliceSubscribers = subscribersBySlice.get(slice);
        if (sliceSubscribers) sliceSubscribers.delete(handler);
    };
}

function notifySubscribers(slices) {
    const notifiedHandlers = new Set();
    for (const slice of slices) {
        const handlers = subscribersBySlice.get(slice);
        if (!handlers) continue;
        for (const handler of handlers) {
            if (notifiedHandlers.has(handler)) continue;
            notifiedHandlers.add(handler);
            try {
                handler(currentVault);
            } catch (handlerError) {
                console.error(`[facade] 订阅者异常 (slice=${slice}):`, handlerError);
            }
        }
    }
}

/**
 * 初始化门面：从存储加载 Vault
 * @param {Object} options
 * @param {(message: string, isError?: boolean) => void} [options.toastHandler]
 * @returns {Promise<Object>}
 */
export async function initializeFacade(options) {
    const effectiveOptions = options || {};
    if (typeof effectiveOptions.toastHandler === 'function') {
        setPersistToastHandler(effectiveOptions.toastHandler);
    }
    currentVault = await loadVaultFromStorage();
    return currentVault;
}