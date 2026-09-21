// filename: src/utils/pinyin.js

// ========================================================================
// DeepSeek 语句工坊 · 中文拼音首字母查询
//
// 纯函数模块，无副作用，无 DOM 依赖，不接触存储。
// 被 src/commands/search.js 用于首字母搜索。
//
// 【数据来源】
//   数据表 PINYIN_INITIAL_DATA 由 scripts/tools/generate-pinyin-data.js
//   从《通用规范汉字表.xlsx》自动生成到 ./pinyin-data.js。
//   本文件只包含查询逻辑，不硬编码任何汉字数据。
//
// 【设计要点】
//   1. 模块加载时一次性构建"汉字 → 首字母"反查 Map，查询为 O(1)。
//   2. 只处理 CJK 统一表意文字；英文、数字、标点、空白、Emoji 全部跳过。
//   3. CJK 范围判定使用 codePointAt，覆盖扩展 A-H 与补充平面。
//   4. 数据表中未收录的汉字静默跳过，不影响其他字符的处理。
//   5. 新增 mapTextToInitials 函数，输出"首字母串 + 首字母到文本字符
//      索引的映射 + 原文按 codePoint 拆分的字符数组"，供 search.js 的
//      highlightText 精确高亮首字母命中的汉字。
//
// 【本次改进 · M5 + P2-N4 修复】
//   反查 Map 构建时增加双重守卫：
//     守卫 1：PINYIN_INITIAL_DATA 整体有效性检查。
//             若数据文件被污染为 Node.js 脚本（历史上发生过），
//             或格式错误导致值为 undefined，此前会在
//             Object.keys(undefined) 处抛 TypeError，
//             进而导致整个 ESM 模块图加载失败、应用白屏。
//             现在改为：记录错误日志后返回空 Map，
//             首字母搜索降级为"仅字面匹配"，其他功能完全不受影响。
//     守卫 2：每个分组的值类型检查。
//             原实现只判 truthy，若值为数字 / 对象，
//             for...of 会抛 TypeError（不可迭代）。
//             现改为严格 string 类型判断，非法值仅告警不崩溃。
//
// 【对外导出】
//   - getInitials(text)                        → string
//   - mapTextToInitials(text)                  → { initials, positions, characters }
//   - hasChineseCharacterInitial(character)    → boolean（调试用）
//   - getChineseCharacterInitialMapSize()      → number（调试用）
// ========================================================================

import { PINYIN_INITIAL_DATA } from './pinyin-data.js';

// ==================== 反查 Map 构建 ====================
// 模块加载时一次性构建，后续查询为 O(1)。
// 若同一汉字在多个分组中出现（理论上不应出现），以首次出现为准。

const CHARACTER_TO_INITIAL_MAP = (function buildCharacterToInitialMap() {
    const characterToInitialMap = new Map();

    // ---------- 守卫 1：数据对象整体有效性 ----------
    // 数据文件被污染 / 未生成 / 格式错误时，PINYIN_INITIAL_DATA
    // 可能为 undefined、null、字符串、数组等。
    // 此处直接返回空 Map，让首字母搜索降级为不可用，
    // 避免整个模块加载失败导致应用白屏。
    if (!PINYIN_INITIAL_DATA || typeof PINYIN_INITIAL_DATA !== 'object') {
        console.error(
            '[pinyin] PINYIN_INITIAL_DATA 未加载或格式错误，'
            + '首字母搜索将被禁用。'
            + '请运行 scripts/tools/generate-pinyin-data.js 重新生成数据。'
        );
        return characterToInitialMap;
    }

    const initialLetterList = Object.keys(PINYIN_INITIAL_DATA);

    for (
        let groupIndex = 0;
        groupIndex < initialLetterList.length;
        groupIndex++
    ) {
        const initialLetter = initialLetterList[groupIndex];
        const characterString = PINYIN_INITIAL_DATA[initialLetter];

        // ---------- 守卫 2：分组值类型检查 ----------
        // 原实现只判 truthy，若值为数字 / 对象 / 布尔，
        // for...of 会抛 TypeError。此处改为严格 string 类型判断。
        if (typeof characterString !== 'string') {
            // 空值（undefined / null）静默跳过，不告警——
            // 生成脚本对空分组会输出空字符串，不会输出 undefined。
            if (characterString !== undefined && characterString !== null) {
                console.warn(
                    '[pinyin] PINYIN_INITIAL_DATA["' + initialLetter
                    + '"] 不是字符串（实际为 ' + typeof characterString
                    + '），已跳过该分组'
                );
            }
            continue;
        }
        if (characterString.length === 0) {
            continue;
        }

        for (const character of characterString) {
            if (!characterToInitialMap.has(character)) {
                characterToInitialMap.set(character, initialLetter);
            }
        }
    }

    return characterToInitialMap;
})();

// ==================== 字符判定 ====================

/**
 * 判断单个字符是否是 CJK 统一表意文字。
 *
 * 覆盖范围：
 *   扩展 A：   U+3400  - U+4DBF
 *   基本区：   U+4E00  - U+9FFF
 *   兼容表意： U+F900  - U+FAFF
 *   扩展 B：   U+20000 - U+2A6DF
 *   扩展 C：   U+2A700 - U+2B73F
 *   扩展 D：   U+2B740 - U+2B81F
 *   扩展 E：   U+2B820 - U+2CEAF
 *   扩展 F：   U+2CEB0 - U+2EBEF
 *   扩展 G：   U+30000 - U+3134F
 *   扩展 H：   U+31350 - U+323AF
 *
 * @param {string} character 单个字符
 * @returns {boolean}
 */
function isChineseCharacter(character) {
    if (!character) return false;
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;

    return (
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
        (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
        (codePoint >= 0x20000 && codePoint <= 0x2A6DF) ||
        (codePoint >= 0x2A700 && codePoint <= 0x2B73F) ||
        (codePoint >= 0x2B740 && codePoint <= 0x2B81F) ||
        (codePoint >= 0x2B820 && codePoint <= 0x2CEAF) ||
        (codePoint >= 0x2CEB0 && codePoint <= 0x2EBEF) ||
        (codePoint >= 0x30000 && codePoint <= 0x3134F) ||
        (codePoint >= 0x31350 && codePoint <= 0x323AF)
    );
}

// ==================== 主函数 ====================

/**
 * 从文本中提取中文字符的拼音首字母。
 *
 * 处理规则：
 *   - 中文汉字：若在数据表中，追加其拼音首字母（小写）。
 *   - 中文汉字但不在数据表中：静默跳过。
 *   - 英文 / 数字 / 标点 / 空格 / Emoji：全部跳过。
 *
 * @param {*} text 任意输入（会自动转为字符串）
 * @returns {string} 小写首字母字符串；若无中文或数据表为空则返回空串
 */
export function getInitials(text) {
    if (text === null || text === undefined) return '';

    const sourceText = String(text);
    if (!sourceText) return '';
    if (CHARACTER_TO_INITIAL_MAP.size === 0) return '';

    let resultInitials = '';

    for (const character of sourceText) {
        if (!isChineseCharacter(character)) continue;

        const initialLetter = CHARACTER_TO_INITIAL_MAP.get(character);
        if (initialLetter) {
            resultInitials += initialLetter;
        }
    }

    return resultInitials;
}

/**
 * 将文本映射为「首字母串 + 每个首字母对应的文本字符索引 + 原文按 codePoint
 * 拆分的字符数组」。
 *
 * 【用途】
 *   highlightText 需要知道"关键词在首字母串中匹配到的位置"对应文本中的
 *   哪几个字符，才能精确高亮那些汉字。
 *
 * 【返回结构】
 *   {
 *     initials:   'zfb',              // 与 getInitials 输出完全一致
 *     positions:  [0, 1, 2],          // initials 中第 i 个字符对应的
 *                                     //   文本字符（按 codePoint 计）索引
 *     characters: ['支', '付', '宝']  // 文本按 codePoint 拆分的字符数组
 *   }
 *
 * 【关键约束】
 *   使用 Array.from(sourceText) 拆分字符数组，确保 surrogate pair
 *   （emoji、CJK 扩展 B 区生僻字）被当成 1 个字符处理，与
 *   String.prototype.indexOf / slice 在 codePoint 上的索引单位保持一致。
 *
 *   initials.length === positions.length 恒成立。
 *   positions 严格递增。
 *   positions 中的每个值都是 characters 数组的合法下标。
 *
 * @param {*} text 任意输入（会自动转为字符串）
 * @returns {{initials: string, positions: number[], characters: string[]}}
 */
export function mapTextToInitials(text) {
    if (text === null || text === undefined) {
        return { initials: '', positions: [], characters: [] };
    }

    const sourceText = String(text);
    if (!sourceText) {
        return { initials: '', positions: [], characters: [] };
    }

    const characters = Array.from(sourceText);

    if (CHARACTER_TO_INITIAL_MAP.size === 0) {
        return {
            initials: '',
            positions: [],
            characters: characters
        };
    }

    let initials = '';
    const positions = [];

    for (
        let characterIndex = 0;
        characterIndex < characters.length;
        characterIndex++
    ) {
        const character = characters[characterIndex];
        if (!isChineseCharacter(character)) continue;

        const initialLetter = CHARACTER_TO_INITIAL_MAP.get(character);
        if (initialLetter) {
            initials += initialLetter;
            positions.push(characterIndex);
        }
    }

    return {
        initials: initials,
        positions: positions,
        characters: characters
    };
}

/**
 * 判断字符是否已收录在拼音数据表中。
 * 仅用于测试与调试，业务代码无需调用。
 *
 * @param {string} character
 * @returns {boolean}
 */
export function hasChineseCharacterInitial(character) {
    return CHARACTER_TO_INITIAL_MAP.has(character);
}

/**
 * 返回拼音数据表已收录的汉字总数。仅用于测试与调试。
 * @returns {number}
 */
export function getChineseCharacterInitialMapSize() {
    return CHARACTER_TO_INITIAL_MAP.size;
}