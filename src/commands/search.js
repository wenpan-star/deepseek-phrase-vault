// filename: src/commands/search.js

// ========================================================================
// DeepSeek 语句工坊 · 搜索匹配与高亮
//
// 纯函数模块，无副作用。
// 被 src/views/statement-list.js 与 src/main.js 复用。
//
// 【设计目标】
//   matchSearch 与 highlightText 必须"判定一致、展示一致"：
//     凡是 matchSearch 判定命中的关键词，
//     highlightText 必须在视觉上高亮出对应的文本片段。
//
// 【本次改进 · 回归修复】
//   回退了上一轮在 highlightText 正则分支中引入的 bug。
//
//   问题代码（已删除）：
//     if (matchResult[0].length === 0) {
//         regularExpression.lastIndex += 1;
//         if (regularExpression.lastIndex > lastIndex) {
//             lastIndex = regularExpression.lastIndex;   // ← bug
//         }
//         continue;
//     }
//
//   错在何处：
//     混淆了两个"lastIndex"：
//       1. regularExpression.lastIndex —— RegExp 内部状态，
//          表示"下一次 exec 的搜索起点"
//       2. 局部变量 lastIndex —— 本函数用于切片已输出文本的游标
//     两者职责完全不同，绝不能同步。
//
//   具体反例：
//     文本 "abc"、正则 "a*"
//       1. 匹配 "a"（位置 0-1）→ 输出 <span>a</span>，局部 lastIndex = 1
//       2. 空匹配（位置 1）→ 同步后 lastIndex = 2   ← 错误推进
//       3. 空匹配（位置 2）→ 同步后 lastIndex = 3   ← 错误推进
//       4. 空匹配（位置 3）→ 同步后 lastIndex = 4   ← 错误推进
//       5. exec 返回 null，循环结束
//       6. slice(4) = ""  → 丢失 "bc"
//
//     文本 "xyz"、正则 "a*"（全部空匹配）
//       同步路径：lastIndex = 4 → slice(4) = "" → 整个文本丢失
//       不同步：  lastIndex = 0 → slice(0) = "xyz" ✓
//
//   修复后：
//     仅推进 regularExpression.lastIndex（防止 exec 死循环），
//     局部 lastIndex 保持不变。空匹配不产出 HTML，
//     因此局部游标不应对其做任何推进。
//
// 【本次改进 · M1 修复 + P1-N3 注释修正（保留）】
//   修正了 collectLiteralMatchRanges 返回的索引单位。
//
//   问题分析：
//     String.prototype.indexOf 返回 UTF-16 code unit 索引；
//     而 Array.from(sourceText) 按 codePoint 拆分字符。
//     当文本包含辅助平面字符（emoji 😀、CJK 扩展 B 区生僻字 𠮷）时，
//     1 个字符占 2 个 UTF-16 单元，两种索引单位不再一一对应。
//
//     原实现的注释中曾错误地声称"toLowerCase 对同一 codePoint 的
//     字符数不变，因此 lowerCaseText.length === characters.length"。
//     该论断只在纯 BMP 文本中成立，含 emoji 时会失效。
//     本次修正：删除错误注释，在 collectLiteralMatchRanges 内部
//     建立 UTF-16 → codePoint 索引映射表，把 indexOf 返回的
//     位置转换为 codePoint 索引，与 characters 数组的单位对齐。
//
//   示例：
//     "A😀B" → Array.from 长度 3（codePoint），length 长度 4（UTF-16）
//     搜索 "B" → indexOf 返回 3（UTF-16 索引）
//     转换后 → codePoint 索引 2（characters 数组中的 "B"）
//
// 【本次改进 · 保留】
//   正则关键词长度上限（MAX_REGEX_KEYWORD_LENGTH）。
//   超长关键词在正则模式下退化为字面匹配，避免灾难性回溯（ReDoS）。
// ========================================================================

import { escapeHtml } from '../utils/dom.js';
import { mapTextToInitials } from '../utils/pinyin.js';
import { MAX_REGEX_KEYWORD_LENGTH } from '../constants.js';

// ==================== 首字母映射缓存 ====================
// 以语句文本为 key。同一文本永远对应同一映射，
// 天然跨 vault / 跨版本稳定。
// 上限防内存膨胀；超出时清掉最早的一半条目（简化 LRU，够用）。

const INITIALS_CACHE_MAX_ENTRY_COUNT = 8000;
const INITIALS_CACHE_PRUNE_RATIO = 0.5;

const initialsCache = new Map();

/**
 * 带缓存的 mapTextToInitials。
 *
 * 缓存结构：
 *   key   → 语句原文（string）
 *   value → { initials, positions, characters }
 *
 * 淘汰策略：容量达到上限时，从最早插入的条目开始删除，
 *          删除数量 = 上限 × 淘汰比例（向下取整）。
 *
 * @param {string} text 语句原文
 * @returns {{initials: string, positions: number[], characters: string[]}}
 */
function getInitialsMapCached(text) {
    let cachedMap = initialsCache.get(text);
    if (cachedMap !== undefined) {
        return cachedMap;
    }

    cachedMap = mapTextToInitials(text);

    if (initialsCache.size >= INITIALS_CACHE_MAX_ENTRY_COUNT) {
        const pruneCount = Math.floor(
            INITIALS_CACHE_MAX_ENTRY_COUNT * INITIALS_CACHE_PRUNE_RATIO
        );
        let removedCount = 0;
        for (const cacheKey of initialsCache.keys()) {
            initialsCache.delete(cacheKey);
            removedCount++;
            if (removedCount >= pruneCount) {
                break;
            }
        }
    }

    initialsCache.set(text, cachedMap);
    return cachedMap;
}

// 纯 ASCII 判断：只在关键词是纯 ASCII 时才启用首字母回退。
const ASCII_KEYWORD_PATTERN = /^[a-z0-9]+$/;

/**
 * 判断正则关键词是否安全。
 *
 * 防御目标：灾难性回溯（ReDoS）
 *   恶意构造的正则（如 `(a+)+$`）在长文本上可能导致指数级回溯，
 *   使主线程卡死。由于正则匹配是同步操作，无法在执行中打断，
 *   唯一可靠的防御是"不执行"。
 *
 * 判定标准：
 *   - 关键词长度 ≤ MAX_REGEX_KEYWORD_LENGTH
 *
 * 超长关键词的处理：
 *   由调用方决定——matchSearch 会退化为字面匹配，highlightText
 *   会退化为纯文本输出。这保证了功能不中断（用户仍可搜索），
 *   只是失去了正则语义。
 *
 * @param {string} keyword
 * @returns {boolean}
 */
function isRegexKeywordSafe(keyword) {
    return typeof keyword === 'string'
        && keyword.length <= MAX_REGEX_KEYWORD_LENGTH;
}

// ==================== 匹配 ====================

/**
 * 判断文本是否命中搜索关键词。
 *
 * 支持三种模式：
 *   1. 正则模式（useRegex）：整体作为正则。
 *      若关键词超长（> MAX_REGEX_KEYWORD_LENGTH），退化为字面匹配。
 *   2. 字面 AND 模式：空格分隔的关键词需全部字面命中。
 *   3. 字面 OR 首字母回退：任一词字面未命中时，尝试整段文本的
 *      拼音首字母子串匹配（仅在关键词为纯 ASCII 时启用）。
 *
 * @param {string} text
 * @param {string} keyword
 * @param {boolean} useRegex
 * @returns {boolean}
 */
export function matchSearch(text, keyword, useRegex) {
    if (!keyword) {
        return true;
    }

    const stringText = String(text == null ? '' : text);

    // ---------- 正则模式：行为与原有完全一致，附加长度防御 ----------
    if (useRegex) {
        // 超长正则退化为字面匹配，防止 ReDoS
        if (!isRegexKeywordSafe(keyword)) {
            return stringText.toLowerCase().includes(String(keyword).toLowerCase());
        }
        try {
            const regularExpression = new RegExp(keyword, 'i');
            return regularExpression.test(stringText);
        } catch (invalidRegexError) {
            return false;
        }
    }

    // ---------- 字面 AND 模式 ----------
    const keywordWords = String(keyword).split(/\s+/).filter(Boolean);
    if (keywordWords.length === 0) {
        return true;
    }

    const lowerCaseText = stringText.toLowerCase();
    const lowerCaseWords = keywordWords.map(function (word) {
        return word.toLowerCase();
    });

    // 快速路径：所有词都字面命中 → 直接返回，不算首字母。
    // 覆盖大多数中文查询，零首字母开销。
    let isAllLiteralMatch = true;
    for (
        let wordIndex = 0;
        wordIndex < lowerCaseWords.length;
        wordIndex++
    ) {
        if (!lowerCaseText.includes(lowerCaseWords[wordIndex])) {
            isAllLiteralMatch = false;
            break;
        }
    }
    if (isAllLiteralMatch) {
        return true;
    }

    // ---------- 慢速路径：首字母回退 ----------
    // 仅当至少一个关键词是纯 ASCII 时才需要计算首字母。
    let hasAsciiKeyword = false;
    for (
        let wordIndex = 0;
        wordIndex < lowerCaseWords.length;
        wordIndex++
    ) {
        if (ASCII_KEYWORD_PATTERN.test(lowerCaseWords[wordIndex])) {
            hasAsciiKeyword = true;
            break;
        }
    }
    if (!hasAsciiKeyword) {
        return false;
    }

    const initialsMap = getInitialsMapCached(stringText);
    const textInitials = initialsMap.initials;

    return lowerCaseWords.every(function (lowerCaseWord) {
        if (lowerCaseText.includes(lowerCaseWord)) {
            return true;
        }
        if (ASCII_KEYWORD_PATTERN.test(lowerCaseWord)) {
            return textInitials.includes(lowerCaseWord);
        }
        return false;
    });
}

/**
 * 过滤语句列表（不修改原数组）。
 * 空关键词时返回输入数组的浅拷贝。
 *
 * @param {Array<{text: string}>} statements
 * @param {string} keyword
 * @param {boolean} useRegex
 * @returns {Array}
 */
export function filterStatements(statements, keyword, useRegex) {
    if (!Array.isArray(statements)) {
        return [];
    }
    if (!keyword) {
        return statements.slice();
    }

    return statements.filter(function (statement) {
        return matchSearch(statement.text, keyword, useRegex);
    });
}

/**
 * 按 copyCount 降序排序（不修改原数组）。
 * 缺失 copyCount 时视为 0。
 *
 * @param {Array<{copyCount?: number}>} statements
 * @returns {Array}
 */
export function sortByCopyCount(statements) {
    if (!Array.isArray(statements)) {
        return [];
    }

    return statements.slice().sort(function (statementA, statementB) {
        const countA =
            typeof statementA.copyCount === 'number' &&
            Number.isFinite(statementA.copyCount)
                ? statementA.copyCount
                : 0;
        const countB =
            typeof statementB.copyCount === 'number' &&
            Number.isFinite(statementB.copyCount)
                ? statementB.copyCount
                : 0;
        return countB - countA;
    });
}

// ==================== 高亮辅助函数 ====================

/**
 * 构建「UTF-16 code unit 索引 → codePoint 索引」的映射表。
 *
 * 【为什么需要】
 *   String.prototype.indexOf 返回 UTF-16 code unit 索引；
 *   而 Array.from(sourceText) 按 codePoint 拆分字符。
 *   当文本包含辅助平面字符（emoji、CJK 扩展 B 区生僻字）时，
 *   1 个字符占 2 个 UTF-16 单元，两种索引单位不再一一对应。
 *
 * 【映射表结构】
 *   utf16ToCodePoint[i] = 第 i 个 UTF-16 code unit 所在字符的
 *                          codePoint 索引（从 0 开始）
 *   哨兵：utf16ToCodePoint[utf16Length] = codePointCount，
 *         便于处理"匹配结束位置恰好在字符串末尾"的情况。
 *
 * 【示例】
 *   sourceText = "A😀B"
 *   Array.from(sourceText) = ['A', '😀', 'B']  → 3 个 codePoint
 *   "A😀B".length = 4  → 4 个 UTF-16 code unit
 *   utf16ToCodePoint = [0, 1, 1, 2, 3]
 *     索引 0 → codePoint 0（'A'）
 *     索引 1 → codePoint 1（'😀' 的 high surrogate）
 *     索引 2 → codePoint 1（'😀' 的 low surrogate）
 *     索引 3 → codePoint 2（'B'）
 *     索引 4 → codePoint 3（哨兵，字符串末尾）
 *
 * @param {string} sourceText
 * @returns {number[]}
 */
function buildUtf16ToCodePointIndexMap(sourceText) {
    const utf16ToCodePoint = [];
    let codePointIndex = 0;
    let utf16Index = 0;

    for (const character of sourceText) {
        const characterUtf16Length = character.length;
        for (let offset = 0; offset < characterUtf16Length; offset++) {
            utf16ToCodePoint[utf16Index + offset] = codePointIndex;
        }
        utf16Index += characterUtf16Length;
        codePointIndex++;
    }

    // 哨兵：字符串末尾的 UTF-16 索引映射到 codePoint 总数
    utf16ToCodePoint[utf16Index] = codePointIndex;

    return utf16ToCodePoint;
}

/**
 * 收集文本中所有字面命中的区间。
 *
 * 【索引单位】
 *   返回的区间用 codePoint 索引表示，与 mapTextToInitials 返回的
 *   characters 数组索引一致，也与 buildHighlightedHtml 中
 *   characters.slice(...) 的单位一致。
 *
 * 【为什么需要索引转换】
 *   String.prototype.indexOf 返回的是 UTF-16 code unit 索引，
 *   而 characters = Array.from(sourceText) 是 codePoint 索引。
 *   当文本含辅助平面字符（emoji、CJK 扩展 B 区生僻字）时，
 *   两者的索引不再一一对应。本函数通过 utf16ToCodePoint 映射表
 *   把 indexOf 返回的位置转换为 codePoint 索引。
 *
 * @param {string} sourceText        语句原文
 * @param {string} lowerCaseText     已转小写的文本
 * @param {string[]} lowerCaseWords  已转小写的关键词数组
 * @returns {Array<[number, number]>} 形如 [startIndex, endIndex) 的区间数组（codePoint 索引）
 */
function collectLiteralMatchRanges(sourceText, lowerCaseText, lowerCaseWords) {
    const utf16ToCodePoint = buildUtf16ToCodePointIndexMap(sourceText);
    const literalRanges = [];

    for (
        let wordIndex = 0;
        wordIndex < lowerCaseWords.length;
        wordIndex++
    ) {
        const lowerCaseWord = lowerCaseWords[wordIndex];
        if (lowerCaseWord.length === 0) {
            continue;
        }

        let searchStartIndex = 0;
        while (true) {
            const matchPosition = lowerCaseText.indexOf(
                lowerCaseWord,
                searchStartIndex
            );
            if (matchPosition === -1) {
                break;
            }

            const matchEndUtf16 = matchPosition + lowerCaseWord.length;
            literalRanges.push([
                utf16ToCodePoint[matchPosition],
                utf16ToCodePoint[matchEndUtf16]
            ]);

            // 允许重叠匹配（例如关键词 `aa` 在 `aaaa` 中可匹配两次）
            searchStartIndex = matchPosition + 1;
        }
    }

    return literalRanges;
}

/**
 * 收集文本中所有首字母命中的区间。
 *
 * 【原理】
 *   mapTextToInitials 返回的 positions 数组记录了：
 *     initials[i] 对应 characters[positions[i]] 这个汉字。
 *
 *   因此，当 ASCII 关键词在 initials 中匹配到 [mStart, mEnd) 时：
 *     - 对应文本中第一个汉字是 characters[positions[mStart]]
 *     - 对应文本中最后一个汉字是 characters[positions[mEnd - 1]]
 *     - 高亮区间即 [positions[mStart], positions[mEnd - 1] + 1)
 *
 * 【为什么区间可能包含首字母之外的其他字符】
 *   如果文本中的汉字之间夹杂了标点、空格、英文数字，
 *   这些字符不会贡献首字母，所以 positions 可能不连续。
 *   例如文本「支,付宝」，initials='zfb'，positions=[0,2,3]。
 *   关键词 `zfb` 命中时，区间为 [0, 4)，会把逗号也一起高亮。
 *   这是**有意的设计**：让用户看到"关键词跨越了这段文本"，
 *   视觉上比"三个孤立汉字分别高亮"更易读。
 *
 * 【索引单位】
 *   initialPositions 中的值已经是 codePoint 索引（由 pinyin.js
 *   的 mapTextToInitials 产生），无需再做转换。
 *
 * @param {string} textInitials        整段文本的拼音首字母串（小写）
 * @param {number[]} initialPositions  initials 中第 i 个字符对应的字符索引
 * @param {string[]} lowerCaseWords    已转小写的关键词数组
 * @returns {Array<[number, number]>}  形如 [startIndex, endIndex) 的区间数组
 */
function collectInitialsMatchRanges(
    textInitials,
    initialPositions,
    lowerCaseWords
) {
    const initialsRanges = [];

    if (textInitials.length === 0) {
        return initialsRanges;
    }

    for (
        let wordIndex = 0;
        wordIndex < lowerCaseWords.length;
        wordIndex++
    ) {
        const lowerCaseWord = lowerCaseWords[wordIndex];

        // 只有纯 ASCII 关键词才走首字母回退
        if (!ASCII_KEYWORD_PATTERN.test(lowerCaseWord)) {
            continue;
        }
        if (lowerCaseWord.length === 0) {
            continue;
        }

        let searchStartIndex = 0;
        while (true) {
            const matchPosition = textInitials.indexOf(
                lowerCaseWord,
                searchStartIndex
            );
            if (matchPosition === -1) {
                break;
            }

            const lastInitialIndex =
                matchPosition + lowerCaseWord.length - 1;
            const firstCharacterIndex = initialPositions[matchPosition];
            const lastCharacterIndex = initialPositions[lastInitialIndex];

            initialsRanges.push([
                firstCharacterIndex,
                lastCharacterIndex + 1
            ]);

            searchStartIndex = matchPosition + 1;
        }
    }

    return initialsRanges;
}

/**
 * 合并重叠 / 相邻的区间，返回排序后的不相交区间数组。
 *
 * 【合并规则】
 *   若 currentRange.start <= lastMerged.end，
 *   则说明两个区间重叠或相邻，合并为一个更宽的区间。
 *
 * 【为什么"相邻"也要合并】
 *   例如字面区间 [0, 2) 与首字母区间 [2, 4)，
 *   合并后 [0, 4) 生成单个 <span>，避免出现
 *   <span>AB</span><span>CD</span> 这种碎片化输出。
 *
 * @param {Array<[number, number]>} ranges
 * @returns {Array<[number, number]>}
 */
function mergeRanges(ranges) {
    if (ranges.length <= 1) {
        return ranges.slice();
    }

    const sortedRanges = ranges.slice().sort(function (rangeA, rangeB) {
        return rangeA[0] - rangeB[0];
    });

    const mergedRanges = [sortedRanges[0].slice()];

    for (
        let rangeIndex = 1;
        rangeIndex < sortedRanges.length;
        rangeIndex++
    ) {
        const currentRange = sortedRanges[rangeIndex];
        const lastMerged = mergedRanges[mergedRanges.length - 1];

        if (currentRange[0] <= lastMerged[1]) {
            // 重叠或相邻：合并
            if (currentRange[1] > lastMerged[1]) {
                lastMerged[1] = currentRange[1];
            }
        } else {
            mergedRanges.push(currentRange.slice());
        }
    }

    return mergedRanges;
}

/**
 * 根据合并后的区间数组生成高亮 HTML。
 *
 * 【安全】
 *   所有文本均经过 escapeHtml 转义，可安全写入 innerHTML。
 *
 * 【输出结构】
 *   普通片段 → escapeHtml(片段)
 *   高亮片段 → '<span class="search-highlight">' + escapeHtml(片段) + '</span>'
 *
 * @param {string[]} characters              文本按 codePoint 拆分的字符数组
 * @param {Array<[number, number]>} mergedRanges  已合并的区间数组
 * @returns {string}
 */
function buildHighlightedHtml(characters, mergedRanges) {
    if (mergedRanges.length === 0) {
        return escapeHtml(characters.join(''));
    }

    let resultHtml = '';
    let cursorIndex = 0;

    for (
        let rangeIndex = 0;
        rangeIndex < mergedRanges.length;
        rangeIndex++
    ) {
        const rangeStart = mergedRanges[rangeIndex][0];
        const rangeEnd = mergedRanges[rangeIndex][1];

        // 高亮区间之前的普通片段
        if (rangeStart > cursorIndex) {
            resultHtml += escapeHtml(
                characters.slice(cursorIndex, rangeStart).join('')
            );
        }

        // 高亮片段
        resultHtml +=
            '<span class="search-highlight">' +
            escapeHtml(characters.slice(rangeStart, rangeEnd).join('')) +
            '</span>';

        cursorIndex = rangeEnd;
    }

    // 最后一个高亮区间之后的普通片段
    if (cursorIndex < characters.length) {
        resultHtml += escapeHtml(characters.slice(cursorIndex).join(''));
    }

    return resultHtml;
}

// ==================== 高亮主函数 ====================

/**
 * 生成高亮 HTML。
 *
 * 行为与 matchSearch 完全对齐：
 *
 *   1. 正则模式：
 *      整段作为正则，使用 exec + lastIndex 手动切片，
 *      避免捕获组导致 split 错位，并防御空匹配死循环。
 *      若关键词超长，退化为纯文本输出。
 *
 *   2. 普通模式：
 *      · 字面命中的区间（中文、数字、标点、完整英文单词等）
 *      · 首字母命中的区间（仅 ASCII 关键词，逐字高亮对应汉字）
 *      两类区间合并去重后输出。
 *
 * 所有输出文本均经过 escapeHtml 转义，可安全写入 innerHTML。
 *
 * @param {string} text
 * @param {string} keyword
 * @param {boolean} useRegex
 * @returns {string}
 */
export function highlightText(text, keyword, useRegex) {
    const stringText = String(text == null ? '' : text);
    if (!keyword) {
        return escapeHtml(stringText);
    }

    try {
        // ---------- 正则模式：行为与原有完全一致 ----------
        if (useRegex) {
            // 超长正则：退化为纯文本（不做高亮），与 matchSearch
            // 的退化字面匹配行为保持一致——不做高亮比错误高亮更安全
            if (!isRegexKeywordSafe(keyword)) {
                return escapeHtml(stringText);
            }

            const regularExpression = new RegExp(keyword, 'gi');
            let resultHtml = '';

            // 局部游标：记录**已输出到结果 HTML 的文本位置**（UTF-16 索引）。
            //
            // 【关键设计决策】此处必须严格区分两个"游标"：
            //   1. regularExpression.lastIndex
            //        —— RegExp 对象的内部状态，表示"下一次 exec 的搜索起点"
            //   2. 局部变量 lastIndex
            //        —— 本函数用于 stringText.slice(lastIndex, ...) 的输出游标
            //
            //   两者职责完全不同，绝不能相互赋值。
            //
            // 【为什么空匹配分支不能同步局部 lastIndex】
            //   空匹配（如 `x*` 命中空串）不产出任何 HTML 输出，
            //   因此局部游标不应因空匹配而推进。
            //
            //   若错误地在空匹配分支中执行
            //     lastIndex = regularExpression.lastIndex
            //   会导致后续 slice(lastIndex) 跳过空匹配位置之后的所有文本，
            //   造成部分文本静默丢失。
            //
            // 【反例验证】
            //   文本 "abc"、正则 "a*"
            //     1. 匹配 "a"（位置 0-1）→ 输出 <span>a</span>，lastIndex = 1
            //     2. 空匹配（位置 1）→ 若同步 lastIndex = 2   ← 错误
            //     3. 空匹配（位置 2）→ 若同步 lastIndex = 3   ← 错误
            //     4. 空匹配（位置 3）→ 若同步 lastIndex = 4   ← 错误
            //     5. exec 返回 null，循环结束
            //     6. slice(4) = ""  → 丢失 "bc"
            //   正确行为：不更新局部 lastIndex，slice(1) = "bc" ✓
            //
            //   文本 "xyz"、正则 "a*"（全部空匹配）
            //     错误同步：lastIndex = 4 → slice(4) = "" → 整个文本丢失
            //     正确做法：lastIndex = 0 → slice(0) = "xyz" ✓
            let lastIndex = 0;
            let matchResult;

            while (
                (matchResult = regularExpression.exec(stringText)) !== null
            ) {
                // 空匹配（如 `x*` 命中空串）必须推进 regularExpression.lastIndex
                // 防止 exec 死循环。
                //
                // 此处仅推进 RegExp 内部游标，**不更新局部 lastIndex**。
                // 理由见上方注释中的【反例验证】。
                if (matchResult[0].length === 0) {
                    regularExpression.lastIndex += 1;
                    continue;
                }

                const matchStart = matchResult.index;
                const matchEnd = matchStart + matchResult[0].length;

                resultHtml += escapeHtml(
                    stringText.slice(lastIndex, matchStart)
                );
                resultHtml +=
                    '<span class="search-highlight">' +
                    escapeHtml(matchResult[0]) +
                    '</span>';

                lastIndex = matchEnd;
            }

            resultHtml += escapeHtml(stringText.slice(lastIndex));
            return resultHtml;
        }

        // ---------- 普通模式 ----------
        const keywordWords = String(keyword).split(/\s+/).filter(Boolean);
        if (keywordWords.length === 0) {
            return escapeHtml(stringText);
        }

        const lowerCaseWords = keywordWords.map(function (word) {
            return word.toLowerCase();
        });

        // 拆分字符数组，供字面区间与首字母区间共用相同的索引单位。
        // 一次缓存命中即可同时拿到 initials / positions / characters。
        const initialsMap = getInitialsMapCached(stringText);
        const characters = initialsMap.characters;

        // 字面命中区间（已转换为 codePoint 索引，与 characters 对齐）
        const lowerCaseText = stringText.toLowerCase();
        const literalRanges = collectLiteralMatchRanges(
            stringText,
            lowerCaseText,
            lowerCaseWords
        );

        // 首字母命中区间（仅当至少一个 ASCII 关键词时）
        let hasAsciiKeyword = false;
        for (
            let wordIndex = 0;
            wordIndex < lowerCaseWords.length;
            wordIndex++
        ) {
            if (ASCII_KEYWORD_PATTERN.test(lowerCaseWords[wordIndex])) {
                hasAsciiKeyword = true;
                break;
            }
        }

        let initialsRanges = [];
        if (hasAsciiKeyword) {
            initialsRanges = collectInitialsMatchRanges(
                initialsMap.initials,
                initialsMap.positions,
                lowerCaseWords
            );
        }

        // 合并去重：把字面区间与首字母区间合并为不相交的高亮区间
        const mergedRanges = mergeRanges(
            literalRanges.concat(initialsRanges)
        );

        return buildHighlightedHtml(characters, mergedRanges);
    } catch (highlightError) {
        return escapeHtml(stringText);
    }
}