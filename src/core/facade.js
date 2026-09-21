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
// 【P1-N2 修复（历史）】
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
//       false = 命令被拒（未注册命令 / 返回原 vault / 返回非法值 / 命令抛错）
//     调用方可据此决定是否提示成功或失败。
//
// 【第一批重构（历史）】
//   FA-1（affects 切片名校验缺失 —— 高）：
//     原代码注释声明"affects 的每个值必须是 'tags' / 'statements' /
//     'ui' / 'recycleBin' 四者之一"，但 registerCommand 未做校验。
//     非法切片名会被静默接受，notifySubscribers 查无对应订阅者时
//     静默跳过，形成"命令执行了但视图不更新"的隐蔽 bug。
//
//     修复：registerCommand 中遍历 affects 校验每个值。非法值：
//       · 记录 console.warn 便于定位
//       · 从注册的 affects 中过滤掉（不阻塞命令执行，仅告警）
//
//     为什么选择"过滤 + 告警"而非"抛错"：
//       抛错会导致整个 registerCommands 批量注册中断，
//       一个笔误的命令会让整个应用无法启动。
//       过滤后命令依然可执行（只是不通知非法切片），
//       开发者可从告警中定位问题。
//
//   FA-2（replaceVault 默认切片列表遗漏 'recycleBin'）：
//     原默认值 ['tags', 'statements', 'ui'] 遗漏了回收站切片。
//     调用方若省略 affects，回收站徽章不会刷新。
//     main.js 的所有现有调用都传了完整列表，但默认值应完整。
//
//     修复：新增 DEFAULT_REPLACE_SLICES 常量，包含四个切片。
//
//   FA-3（dispatch 中命令异常未捕获）：
//     command.run(currentVault, ...) 若抛异常，会冒泡到 UI 事件处理器
//     （main.js 中无 try/catch），导致调用方拿不到返回值，
//     且可能留下 UI 状态不一致。
//
//     修复：用 try/catch 包裹 command.run。异常时：
//       · 记录 console.error
//       · 返回 false（与"命令被拒"语义一致）
//       · currentVault 保持原状（不会被部分更新污染）
//
//     为什么返回 false 而非重新抛出：
//       调用方（main.js / views）的约定是"dispatch 返回 boolean"。
//       重新抛出会破坏这个约定，迫使所有调用点加 try/catch。
//       命令层是纯函数，抛异常意味着"输入有 bug"，记录日志足够，
//       不必让整个交互流程崩溃。
//
//   FA-4（initializeFacade 加载失败保护）：
//     原代码直接 await loadVaultFromStorage()，未做异常捕获。
//     虽 persist.js 内部有 try/catch 兜底，但防御性地包一层更安全。
//
//     修复：try/catch 包裹加载。异常时 currentVault 保持 null，
//     后续 dispatch 会被 FA-5 的空引用保护拒绝，UI 保持可交互
//     （用户可刷新页面重试，而非白屏）。
//
//   FA-5（currentVault 为 null 时的空引用保护）：
//     dispatch 与 replaceVault 均未校验 currentVault 是否为 null。
//     若初始化失败，所有命令会以 null 作为入参执行，
//     命令层读取 vault.statementsMap 会抛 TypeError。
//
//     修复：
//       · dispatch 开头检查 currentVault，为 null 时告警并返回 false
//       · replaceVault 允许从 null 状态恢复到正常状态（用于未来
//         "初始化失败后重新初始化"的场景），但要求 nextVault 非 null
//
//   FA-6（replaceVault 参数校验）：
//     nextVault 为 null 时会把 currentVault 置空，后续全崩。
//     修复：校验 nextVault 必须是非 null 对象，否则告警并拒绝。
//
//   FA-7（notifySubscribers 去重逻辑注释）：
//     原代码用 notifiedHandlers Set 去重，避免同一 handler 订阅了
//     多个 slice 时被多次调用。这是有意的设计，但原注释未说明。
//     本次补注释。
//
// 【本轮重构（第二批）】
//   问题 L（replaceVault 的 affects 全非法时不回退默认）：
//     原实现：
//       const effectiveAffects = (Array.isArray(affects) && affects.length > 0)
//           ? normalizeAffects('replaceVault', affects)
//           : DEFAULT_REPLACE_SLICES.slice();
//       notifySubscribers(effectiveAffects);
//
//     场景：调用方传入 ['不存在的切片']（非空数组，但全部非法）。
//     normalizeAffects 会返回 []，notifySubscribers([]) 什么都不做。
//     结果：currentVault 已替换为 nextVault，但所有视图不更新——
//     数据层与视图层永久不一致。
//
//     当前为何不触发：main.js 的所有 replaceVault 调用都传了合法切片。
//     但这是"隐式契约"，未来某个新调用点传错切片名时不会告警且不会刷新。
//
//     修复：
//       · 分两步：先 normalize，再判定是否为空
//       · 若为空，回退到 DEFAULT_REPLACE_SLICES（全切片通知）
//       · normalizeAffects 已对每个非法切片记录 warn，因此开发者
//         仍能从前面的告警日志中定位问题
//
//     为什么"回退默认"而非"拒绝 replaceVault"：
//       调用方传入 nextVault 的意图明确（替换），若因 affects 参数
//       有误而拒绝替换，会让数据层与调用方产生更严重的不一致
//       （调用方可能后续依赖新数据的存在）。
//       回退默认保证"替换生效，视图全刷"，这是最保守的行为。
//
//   registerCommand 中的 normalizeAffects 保持不变（问题 L 未涉及）：
//     显式传空数组 [] 是合法的"无 UI 影响"语义（如未来可能出现的
//     调试命令 / 内部状态同步命令）。全非法切片情况下 normalizeAffects
//     已通过 console.warn 提示，不再额外处理。
// ========================================================================

import {
    loadVaultFromStorage,
    saveVaultToStorage,
    saveVaultToStorageDebounced,
    setPersistToastHandler
} from './persist.js';

// ==================== 切片名单 ====================
// 与 commands/index.js 中的 affects 数组一一对应。
// 此处硬编码（不引入 constants.js）的原因：
//   切片是 facade 的内部协议，commands 层的 affects 值由命令注册表
//   声明。将名单放在 facade 内部可保证"消费方定义接口"的清晰边界。

const VALID_SLICE_NAMES = ['tags', 'statements', 'ui', 'recycleBin'];

// replaceVault 的默认切片列表。
// 语义：调用方未显式指定 affects，或 affects 全部非法时，通知所有切片。
// 这与"整块替换 = 全字段变化"的语义一致。
const DEFAULT_REPLACE_SLICES = ['tags', 'statements', 'ui', 'recycleBin'];

// ==================== 模块级状态 ====================

let currentVault = null;

// 命令注册表：name → { run, affects, persistMode }
const commandRegistry = new Map();

// 切片订阅表：slice → Set<handler>
const subscribersBySlice = new Map();

// ==================== 命令注册 ====================

/**
 * 校验并规范化 affects 数组。
 *
 * 规则：
 *   · 非数组 → 返回空数组（不通知任何切片）
 *   · 数组中每个值：
 *       - 是合法切片名 → 保留
 *       - 非字符串 / 非法切片名 → 过滤掉 + 记录告警
 *   · 去重（同一命令不应重复声明同一切片）
 *
 * @param {string} commandName  用于告警日志
 * @param {*} rawAffects
 * @returns {string[]}
 */
function normalizeAffects(commandName, rawAffects) {
    if (!Array.isArray(rawAffects)) {
        return [];
    }

    const seenSlices = new Set();
    const normalizedAffects = [];

    for (let index = 0; index < rawAffects.length; index++) {
        const sliceName = rawAffects[index];

        if (typeof sliceName !== 'string') {
            console.warn(
                '[facade] 命令 "' + commandName + '" 的 affects[' + index
                + '] 不是字符串（实际为 ' + typeof sliceName
                + '），已忽略'
            );
            continue;
        }

        if (VALID_SLICE_NAMES.indexOf(sliceName) === -1) {
            console.warn(
                '[facade] 命令 "' + commandName + '" 的 affects[' + index
                + '] 使用了未知切片 "' + sliceName
                + '"，已忽略。合法切片：' + VALID_SLICE_NAMES.join(' / ')
            );
            continue;
        }

        if (seenSlices.has(sliceName)) {
            // 重复声明同一 slice：静默去重（无需告警，无副作用）
            continue;
        }

        seenSlices.add(sliceName);
        normalizedAffects.push(sliceName);
    }

    return normalizedAffects;
}

/**
 * 注册单个命令。
 *
 * @param {string} name
 * @param {{
 *   run: Function,
 *   affects: string[],
 *   persistMode?: string
 * }} definition
 *
 * 【抛错条件】
 *   · definition.run 不是函数 → 抛出 Error
 *     理由：这是硬性缺失，命令无法执行，必须尽早暴露
 *
 * 【告警条件】
 *   · persistMode 非法 → 回退为 'immediate'，告警
 *   · affects 含非法切片名 → 过滤掉，告警
 *     理由：命令依然可执行，不必让整个应用崩溃
 */
export function registerCommand(name, definition) {
    if (typeof definition.run !== 'function') {
        throw new Error('[facade] 命令 "' + name + '" 缺少 run 函数');
    }

    const rawPersistMode = definition.persistMode || 'immediate';
    const validModes = ['immediate', 'debounced', 'skip'];
    let effectivePersistMode = rawPersistMode;

    if (validModes.indexOf(rawPersistMode) === -1) {
        console.warn(
            '[facade] 命令 "' + name + '" 使用了未知 persistMode "'
            + rawPersistMode + '"，回退为 immediate'
        );
        effectivePersistMode = 'immediate';
    }

    const normalizedAffects = normalizeAffects(name, definition.affects);

    commandRegistry.set(name, {
        run: definition.run,
        affects: normalizedAffects,
        persistMode: effectivePersistMode
    });
}

/**
 * 批量注册命令。
 *
 * 逐个调用 registerCommand。
 * 若某个命令的 run 缺失，registerCommand 会抛错并中断整个批量注册——
 * 这是有意的：命令注册表的配置错误应在启动时立即暴露。
 *
 * @param {Object<string, {run: Function, affects: string[], persistMode?: string}>} map
 */
export function registerCommands(map) {
    for (const name of Object.keys(map)) {
        registerCommand(name, map[name]);
    }
}

// ==================== 只读访问 ====================

/**
 * 只读查询。
 *
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
 * 获取当前 Vault 引用（慎用，仅限只读）。
 *
 * 返回的是引用，不是副本。调用方必须遵守只读约定。
 * 命令层保证每次返回新引用，不会原地修改。
 *
 * @returns {Object|null} 未初始化时返回 null
 */
export function getVaultSnapshot() {
    return currentVault;
}

// ==================== 命令派发 ====================

/**
 * 派发命令。
 *
 * 【返回值语义】
 *   true  = 命令实际执行，状态已更新，持久化已触发，订阅者已通知
 *   false = 命令被拒，原因可能是：
 *             · 未注册的命令
 *             · vault 未初始化
 *             · 命令返回原 vault 引用（前置条件不满足）
 *             · 命令返回 null / undefined / 非法值
 *             · 命令执行中抛异常
 *
 * 【错误处理】
 *   · 未注册命令 → console.warn + 返回 false
 *   · vault 未初始化 → console.warn + 返回 false
 *   · 命令抛异常 → console.error + 返回 false（不重新抛出，保持调用方
 *     的 boolean 约定）
 *
 * 【持久化分流】
 *   · persistMode = 'debounced' → saveVaultToStorageDebounced（防抖）
 *   · persistMode = 'skip'      → 不持久化（仅瞬态命令）
 *   · persistMode = 'immediate' → saveVaultToStorage（立即）
 *
 * 【订阅通知】
 *   只通知命令 affects 中声明的切片。
 *   多个 slice 订阅同一 handler 时该 handler 只被调用一次（见
 *   notifySubscribers 的去重逻辑）。
 *
 * @param {string} commandName
 * @param {Object} payload
 * @returns {boolean}
 */
export function dispatch(commandName, payload) {
    // ---------- FA-5 保护：vault 未初始化 ----------
    if (!currentVault) {
        console.warn(
            '[facade] Vault 未初始化，命令 "' + commandName + '" 被拒。'
            + '请确认 initializeFacade 已成功执行。'
        );
        return false;
    }

    const command = commandRegistry.get(commandName);
    if (!command) {
        console.warn('[facade] 未注册的命令: ' + commandName);
        return false;
    }

    const previousVault = currentVault;
    let nextVault;

    // ---------- FA-3 保护：捕获命令执行异常 ----------
    try {
        nextVault = command.run(currentVault, payload || {});
    } catch (commandError) {
        console.error(
            '[facade] 命令 "' + commandName + '" 执行异常:',
            commandError
        );
        return false;
    }

    // ---------- 命令被拒 / 无变化 ----------
    if (!nextVault || nextVault === previousVault) {
        return false;
    }

    // ---------- 状态更新 ----------
    currentVault = nextVault;

    // ---------- 持久化分流 ----------
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

    // ---------- 通知订阅者 ----------
    notifySubscribers(command.affects);

    return true;
}

// ==================== 整块替换 ====================

/**
 * 整块替换 Vault（导入、重置等场景）。
 *
 * 【与 dispatch 的区别】
 *   · dispatch 通过命令层执行，命令层保证"纯函数、返回新引用"
 *   · replaceVault 直接接受调用方构造好的完整 Vault，跳过命令层
 *   · 两者都触发持久化 + 订阅通知
 *
 * 【参数校验（FA-6）】
 *   nextVault 必须是"非 null 对象"。否则告警并拒绝，
 *   避免把 currentVault 置空导致后续全崩。
 *
 * 【切片默认值（FA-2 + 问题 L）】
 *   · affects 未提供 / 空数组 → 使用 DEFAULT_REPLACE_SLICES（4 切片）
 *   · affects 非空但全部非法 → normalizeAffects 返回空，回退到
 *     DEFAULT_REPLACE_SLICES，保证"替换生效，视图全刷"
 *
 *   理由：若 affects 全部非法时不回退，则 currentVault 已更新但
 *   所有视图不更新，数据层与视图层永久不一致。回退默认是最保守
 *   的行为——替换已生效（调用方意图已达成），视图全刷。
 *
 *   normalizeAffects 内部已对每个非法切片记录 console.warn，
 *   因此开发者仍能从前面的告警日志中定位问题。
 *
 * 【FA-5 兼容】
 *   允许从"currentVault 为 null"的状态恢复到正常状态
 *   （用于未来"初始化失败后重新初始化"的场景）。
 *   但要求 nextVault 非 null。
 *
 * @param {Object} nextVault
 * @param {string[]} [affects]
 */
export function replaceVault(nextVault, affects) {
    // ---------- FA-6 保护：nextVault 必须合法 ----------
    if (!nextVault || typeof nextVault !== 'object') {
        console.warn(
            '[facade] replaceVault 被拒：nextVault 必须是对象（实际为 '
            + typeof nextVault + '）'
        );
        return;
    }

    currentVault = nextVault;

    saveVaultToStorage(currentVault).catch(function (persistError) {
        console.error('[facade] 持久化失败:', persistError);
    });

    // ---------- FA-2 + 问题 L 保护：切片默认值与全非法回退 ----------
    // 计算流程：
    //   1. 若 affects 不是非空数组 → 直接用默认切片
    //   2. 否则调用 normalizeAffects 得到规范化切片列表
    //   3. 若规范化结果为空（全部非法）→ 回退默认切片
    //   4. 否则使用规范化结果
    let effectiveAffects;

    if (!Array.isArray(affects) || affects.length === 0) {
        effectiveAffects = DEFAULT_REPLACE_SLICES.slice();
    } else {
        const normalizedAffects = normalizeAffects('replaceVault', affects);
        effectiveAffects = normalizedAffects.length > 0
            ? normalizedAffects
            : DEFAULT_REPLACE_SLICES.slice();
    }

    notifySubscribers(effectiveAffects);
}

// ==================== 订阅 ====================

/**
 * 订阅切片变更。
 *
 * @param {string} slice  可取 'tags' | 'statements' | 'ui' | 'recycleBin'
 * @param {(vault: Object) => void} handler
 * @returns {() => void} 取消订阅函数
 *
 * 【合法切片校验】
 *   非合法切片名会被告警，但依然注册订阅。
 *   理由：告警让开发者定位笔误，注册则保证订阅不会因为拼写错误
 *         "静默失效"。若某切片永远不发通知，订阅者可以自行排查。
 *
 *   实际上，若订阅方使用了非法切片名，该 handler 永远不会被调用——
 *   这比"报错"更符合"静默降级"的项目风格，且不阻塞应用启动。
 */
export function subscribe(slice, handler) {
    if (typeof handler !== 'function') return function () {};

    if (VALID_SLICE_NAMES.indexOf(slice) === -1) {
        console.warn(
            '[facade] subscribe 使用了未知切片 "' + slice
            + '"，该订阅永远不会被触发。合法切片：'
            + VALID_SLICE_NAMES.join(' / ')
        );
    }

    if (!subscribersBySlice.has(slice)) {
        subscribersBySlice.set(slice, new Set());
    }
    subscribersBySlice.get(slice).add(handler);

    return function () {
        const sliceSubscribers = subscribersBySlice.get(slice);
        if (sliceSubscribers) sliceSubscribers.delete(handler);
    };
}

/**
 * 通知订阅者。
 *
 * 【去重逻辑（FA-7 说明）】
 *   notifiedHandlers 用于确保"同一 handler 因多个切片触发时只被调用一次"。
 *
 *   场景：若某 handler 同时订阅了 'tags' 和 'statements'，
 *        且命令的 affects 为 ['tags', 'statements']，
 *        没有去重的话该 handler 会被连续调用两次，
 *        导致重复渲染 / 重复计算。
 *
 *   去重后：该 handler 只被调用一次，收到的 currentVault 是
 *          "所有切片都已更新后"的最终状态。
 *
 *   注意：main.js 中每个切片的订阅使用不同的匿名函数，
 *        因此去重不会误伤任何现有订阅。
 *
 * 【异常隔离】
 *   单个订阅者抛异常不会影响其他订阅者。
 *
 * @param {string[]} slices
 */
function notifySubscribers(slices) {
    if (!Array.isArray(slices) || slices.length === 0) return;

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
                console.error(
                    '[facade] 订阅者异常 (slice=' + slice + '):',
                    handlerError
                );
            }
        }
    }
}

// ==================== 初始化 ====================

/**
 * 初始化门面：从存储加载 Vault。
 *
 * 【FA-4 保护：加载异常捕获】
 *   若 loadVaultFromStorage 抛异常（理论上不会，persist.js 内部已兜底，
 *   但作为防御层），currentVault 保持 null。
 *   后续所有 dispatch 会被 FA-5 保护拒绝，
 *   UI 层可显示"应用未就绪"提示，用户刷新页面重试。
 *
 *   不在此处"回退到内置预设"的原因：
 *     预设构造属于 vault.js 的职责。若 facade 引入预设依赖，
 *     会破坏"facade 只管状态协调，不管数据构造"的边界。
 *     让 currentVault 保持 null 是更干净的做法——
 *     调用方（main.js）可以根据返回值决定 UI 提示。
 *
 * 【调用顺序】
 *   1. 注入 toastHandler（必须在 load 之前，以便捕获加载期间的错误）
 *   2. 加载 Vault
 *   3. 返回加载结果（可能是 null）
 *
 * 【返回值】
 *   Promise<Object|null>
 *     · 成功 → 加载并归一化后的 vault 对象
 *     · 失败 → null（调用方需检查，参见 main.js 的 bootstrap 处理）
 *
 * @param {{
 *   toastHandler?: (message: string, isError?: boolean) => void
 * }} [options]
 * @returns {Promise<Object|null>}
 */
export async function initializeFacade(options) {
    const effectiveOptions = options || {};

    // 步骤 1：注入 toastHandler
    // 顺序重要：必须在 load 之前，因为 loadVaultFromStorage 内部
    // 在"解密失败"等场景下会调用 safeToast 通知用户
    if (typeof effectiveOptions.toastHandler === 'function') {
        setPersistToastHandler(effectiveOptions.toastHandler);
    }

    // 步骤 2：加载 Vault（包一层 try/catch 作为 FA-4 防御）
    try {
        currentVault = await loadVaultFromStorage();
    } catch (loadError) {
        console.error('[facade] Vault 加载失败:', loadError);
        currentVault = null;
    }

    // 步骤 3：返回加载结果
    return currentVault;
}