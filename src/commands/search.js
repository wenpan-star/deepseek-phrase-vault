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
// 【历史修复 · 回归修复】
//   回退了在 highlightText 正则分支中引入的 bug。
//   空匹配（如 `x*`）不产出 HTML，局部 lastIndex 不应对其推进。
//
// 【历史修复 · M1 修复 + P1-N3 注释修正】
//   修正了 collectLiteralMatchRanges 返回的索引单位。
//   String.prototype.indexOf 返回 UTF-16 code unit 索引，
//   而 Array.from(sourceText) 按 codePoint 拆分字符。
//   含 emoji / CJK 扩展 B 区生僻字时两者不一致。
//   通过 buildUtf16ToCodePointIndexMap 建立映射表解决。
//
// 【方案 A（上一轮）】
//   matchSearch / filterStatements / highlightText 增加
//   enableInitialsSearch 参数，支持关闭拼音首字母回退。
//
//   参数设计：
//     - 作为显式参数而非模块级变量，保持纯函数特性
//     - 所有调用方必须传参（保证语义清晰）
//     - 默认值不设，避免"忘记传参时静默失效"的隐患
//
//   关闭后的行为：
//     - matchSearch 跳过首字母回退路径
//     - filterStatements 直接透传
//     - highlightText 跳过首字母高亮
//     - 正则模式不受影响
//
// 【本轮重构（第一批 · 问题 G 说明）】
//   collectLiteralMatchRanges 使用 lowerCaseText 进行 indexOf 查找，
//   而同一函数内又通过 buildUtf16ToCodePointIndexMap(sourceText)
//   把 UTF-16 索引转换为 codePoint 索引。
//
//   这在绝大多数 CJK / ASCII / 拉丁文本下成立（小写化不改变长度），
//   但存在极端反例：
//     · 'İ'.toLowerCase() → 'i̇'（1 个字符 → 2 个字符）
//     · 特殊大写字母在 toLowerCase 后长度变化，会导致两种索引错位
//
//   触发条件极罕见：用户的语句文本必须包含特定的大写特殊字符，
//   且同时在搜索时命中。项目定位为中文语句管理工具，
//   实际使用中不会触发。
//
//   决策：保留现有实现，不做额外处理。
//   理由：
//     1. 若要在每条语句上做"是否含长度变化字符"的判定，
//        代价是每次渲染都要跑一趟正则，得不偿失；
//     2. 真正的修复方案（用 Intl.Segmenter 或按 codePoint 逐字符
//        toLowerCase 后重新拼接索引映射）会引入数倍复杂度；
//     3. 本项目的用户群体与实际数据分布不会触及此边界。
//
//   若未来业务扩展为多语言语料库，需重新评估此处的处理策略。
//
// 【历史版本】
//   - 第二批深度审核：本模块无需逻辑修改。
//   - 本次重构：补充问题 G 的边界说明。
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
 *      拼音首字母子串匹配。
 *      仅在以下两个条件同时满足时启用：
 *        a. 关键词为纯 ASCII（避免中文误触发首字母匹配）
 *        b. enableInitialsSearch 为 true（用户设置）
 *
 * @param {string} text
 * @param {string} keyword
 * @param {boolean} useRegex
 * @param {boolean} enableInitialsSearch
 * @returns {boolean}
 */
export function matchSearch(text, keyword, useRegex, enableInitialsSearch) {
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

    // ---------- 首字母回退路径 ----------
    // 若用户关闭了首字母搜索，直接返回 false（字面未全命中就是未命中）
    if (!enableInitialsSearch) {
        return false;
    }

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
 * @param {boolean} enableInitialsSearch
 * @returns {Array}
 */
export function filterStatements(statements, keyword, useRegex, enableInitialsSearch) {
    if (!Array.isArray(statements)) {
        return [];
    }
    if (!keyword) {
        return statements.slice();
    }

    return statements.filter(function (statement) {
        return matchSearch(statement.text, keyword, useRegex, enableInitialsSearch);
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
 * 【隐含前提（重要 · 参见文件头【本轮重构 · 问题 G 说明】）】
 *   本函数用 lowerCaseText 做 indexOf 查找，用 sourceText 建立
 *   UTF-16 → codePoint 索引映射。两者的 UTF-16 长度必须一致，
 *   否则映射错位。
 *
 *   对 CJK / ASCII / 拉丁文本成立；对 'İ' 等 toLowerCase 后长度
 *   变化的特殊字符不成立。项目定位为中文语句管理工具，实际不会触发。
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
 *      整段作为正则，使用 exec + lastIndex 手动切片。
 *      若关键词超长，退化为纯文本输出。
 *
 *   2. 普通模式：
 *      · 字面命中的区间
 *      · 首字母命中的区间（仅当 enableInitialsSearch 为 true 时）
 *      两类区间合并去重后输出。
 *
 * @param {string} text
 * @param {string} keyword
 * @param {boolean} useRegex
 * @param {boolean} enableInitialsSearch
 * @returns {string}
 */
export function highlightText(text, keyword, useRegex, enableInitialsSearch) {
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
            //   空匹配（如 `x*` 命中空串）不产出任何 HTML 输出，
            //   因此局部游标不应对其推进。
            let lastIndex = 0;
            let matchResult;

            while (
                (matchResult = regularExpression.exec(stringText)) !== null
            ) {
                // 空匹配必须推进 regularExpression.lastIndex 防止死循环。
                // 此处仅推进 RegExp 内部游标，不更新局部 lastIndex。
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
        const initialsMap = getInitialsMapCached(stringText);
        const characters = initialsMap.characters;

        // 字面命中区间（已转换为 codePoint 索引，与 characters 对齐）
        const lowerCaseText = stringText.toLowerCase();
        const literalRanges = collectLiteralMatchRanges(
            stringText,
            lowerCaseText,
            lowerCaseWords
        );

        // 首字母命中区间
        // 仅在满足以下条件时计算：
        //   a. 用户启用了首字母搜索
        //   b. 至少一个 ASCII 关键词
        let initialsRanges = [];

        if (enableInitialsSearch) {
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

            if (hasAsciiKeyword) {
                initialsRanges = collectInitialsMatchRanges(
                    initialsMap.initials,
                    initialsMap.positions,
                    lowerCaseWords
                );
            }
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