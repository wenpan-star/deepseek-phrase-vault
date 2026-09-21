# filename: scripts/tools/README.md

# 工具说明

`scripts/tools/` 目录存放**可含依赖**的辅助工具脚本，用于维护项目的数据文件。

> 项目约定：
>
> - `scripts/*.js` —— 零依赖的正式脚本
> - `scripts/tools/*.js` —— 可含 npm 依赖的辅助工具

---

## 脚本清单

### 1. `generate-pinyin-data.js`

**用途**：从《通用规范汉字表.xlsx》生成 `src/utils/pinyin-data.js`（ES Module）。

**输入**：

- `scripts/data/通用规范汉字表.xlsx`
- 或项目根目录下的同名文件
- 或 `scripts/tools/` 目录下的同名文件

（以上三处任选其一即可，脚本会按此顺序查找）

**输出**：

- `src/utils/pinyin-data.js`
- `src/utils/pinyin-data.js.bak`（首次运行时生成，作为回滚点）

**用法**：

```bash
cd scripts/tools
npm install --no-save xlsx
node generate-pinyin-data.js
```

**依赖**：`xlsx`

**注意**：

- 输出文件会被覆盖，请勿手工编辑 `pinyin-data.js`。
- 若需回滚，执行：
  ```bash
  copy /y src\utils\pinyin-data.js.bak src\utils\pinyin-data.js
  ```

---

### 2. `check-dict-gaps.js`

**用途**：校验 `src/utils/pinyin-data.js` 是否完整覆盖《通用规范汉字表.xlsx》中的全部汉字。

**输入**：

- 同上 xlsx（查找顺序一致）
- `src/utils/pinyin-data.js`（被校验对象）

**输出**：

- 覆盖率报告（控制台）
- 退出码：
  - `0` = 校验通过
  - `1` = 存在缺失或多余字符 / 输入文件缺失

**用法**：

```bash
cd scripts/tools
npm install --no-save xlsx
node check-dict-gaps.js
```

**依赖**：`xlsx`

**注意**：

- 该脚本与 `generate-pinyin-data.js` **同源**（都读取同一份 xlsx），
  因此正常情况下应为 100% 覆盖。
- 若校验不通过，说明 `pinyin-data.js` 被手工篡改或损坏，
  请重新运行生成脚本。

---

## 一键维护

项目根目录提供 `build.bat`，可一键完成
「生成 → 校验 → 清理」全流程。

**用法**：双击项目根目录下的 `build.bat`。

**特性**：

- 纯 ASCII 编码，任意代码页下都不会乱码
- 依赖自动检测：缺失 `xlsx` 时自动 `npm install`
- 多镜像兜底：official → taobao → tencent → huawei → ustc
- 路径安全：不使用 `if (...)` 括号块，规避路径中 `(` `)` 引发的 cmd 解析错误

---

## 数据源

**唯一权威数据源**：`scripts/data/通用规范汉字表.xlsx`

**Sheet 结构**（三张工作表，名称必须完全一致）：

| Sheet 名   | 级别     | 字数   |
| ---------- | -------- | ------ |
| `Level_1`  | 一级字表 | 3500   |
| `Level 2`  | 二级字表 | 3000   |
| `Level_3`  | 三级字表 | 约 1605 |

> ⚠️ 注意 `Level 2` 中间是**空格**，不是下划线，也不是连字符。
> 若实际 sheet 名不同，请修改 `generate-pinyin-data.js` 与
> `check-dict-gaps.js` 顶部的 `SHEET_NAMES` 常量。

**列结构**（每张 sheet 从第 2 行起）：

| 列   | 索引 | 说明                                          |
| ---- | ---- | --------------------------------------------- |
| A    | 0    | （忽略）                                      |
| B    | 1    | **汉字**（必填）                              |
| C    | 2    | 带声调拼音（如 `shí`），作为 I 列为空时的回退 |
| D-H  | 3-7  | （忽略）                                      |
| I    | 8    | **拼音首字母**（如 `sh`），优先使用           |

---

## 设计原则

1. **源码零硬编码**：任何 `.js` 文件里不出现汉字拼音数据。
2. **数据可独立重生成**：改 xlsx → 重跑 `build.bat` → 数据立即更新。
3. **数据文件可回滚**：首次生成时自动备份为 `pinyin-data.js.bak`。
4. **数据 / 逻辑分离**：
   - `src/utils/pinyin-data.js` —— 只含数据（自动生成）
   - `src/utils/pinyin.js` —— 只含逻辑（手写）