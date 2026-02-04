# Excel和SQLite互转工具使用教程

这个工具提供Excel文件和SQLite数据库之间的双向转换功能，支持批量转换和合并。

## 功能特点

- **Excel转SQLite功能**：
  - 支持将单个Excel文件转换为SQLite数据库
  - 支持将多个Excel文件合并到一个SQLite数据库
  - 自动处理工作表(Sheet)映射为数据库表

- **SQLite转Excel功能**：
  - 支持将SQLite数据库转换为Excel文件
  - 可选择指定表进行转换
  - 支持列出数据库中的所有表
  - 支持将各表保存为独立的Excel文件或合并到一个文件

- **通用功能**：
  - 自动处理列名规范化，解决特殊字符和关键字冲突
  - 智能处理空工作表/表和无效数据
  - 支持多种数据类型自动识别(文本、整数、浮点数)

## 环境要求

- Python 3.6+
- 依赖库：pandas, openpyxl, sqlite3

安装依赖：
```bash
pip install pandas openpyxl
```

如果需要启用 YAML 功能，请额外安装 PyYAML：
```bash
pip install pyyaml
```

## 使用方法

### 默认行为

当不提供任何参数时，工具会：
1. 默认执行Excel转SQLite模式
2. 使用当前目录中的所有.xlsx文件作为输入
3. 创建一个以当前目录名命名的SQLite数据库文件

```bash
python xlsx_to_sqlite.py
```

等同于：

```bash
python xlsx_to_sqlite.py --xlsx2db --dir .
```

### Excel转SQLite

#### 1. 转换单个Excel文件

将一个Excel文件转换为同名的SQLite数据库：

```bash
python xlsx_to_sqlite.py --xlsx2db --file 文件路径.xlsx
```

指定输出数据库名称：

```bash
python xlsx_to_sqlite.py --xlsx2db --file 文件路径.xlsx --output 输出数据库.db
```

#### 2. 转换目录中所有Excel文件到一个数据库

```bash
python xlsx_to_sqlite.py --xlsx2db --dir 目录路径 --output 输出数据库.db
```

如果不指定`--output`参数，则使用目录名作为数据库名称。

#### 3. 转换当前目录中的所有Excel文件

```bash
python xlsx_to_sqlite.py --xlsx2db
```

这将在当前目录创建一个以目录名命名的数据库文件，并把当前目录中所有的xlsx文件合并到这个数据库中。

### SQLite转Excel

#### 1. 将整个SQLite数据库转换为单个Excel文件

```bash
python xlsx_to_sqlite.py --db2xlsx --file 数据库文件.db --output 输出文件.xlsx
```

如果不指定`--output`参数，则使用数据库文件名作为Excel文件名。

#### 2. 将各表保存为独立的Excel文件

```bash
python xlsx_to_sqlite.py --db2xlsx --file 数据库文件.db --separate
```

这将为每个表创建一个独立的Excel文件，文件名为表名。
如果指定了`--output`参数，则将其视为输出目录：

```bash
python xlsx_to_sqlite.py --db2xlsx --file 数据库文件.db --output 输出目录 --separate
```

#### 3. 仅转换数据库中的指定表

```bash
python xlsx_to_sqlite.py --db2xlsx --file 数据库文件.db --tables 表1 表2 表3 --output 输出文件.xlsx
```

也可以与`--separate`参数组合使用：

```bash
python xlsx_to_sqlite.py --db2xlsx --file 数据库文件.db --tables 表1 表2 --separate
```

#### 4. 列出数据库中的所有表

```bash
python xlsx_to_sqlite.py --list-tables 数据库文件.db
```

## 表命名规则

### Excel转SQLite

转换后的SQLite表名规则如下：

- 单个文件转换：表名为工作表(Sheet)名
- 多文件合并：表名为`文件名_工作表名`

### SQLite转Excel

- 单文件模式：Excel工作表名与SQLite表名保持一致
- 分离文件模式：每个表生成一个以表名命名的Excel文件

## 注意事项

1. **空表处理**：空的工作表/表会被自动跳过，不会在转换后的文件中创建
2. **特殊字符**：列名如果包含特殊字符，会被自动替换为下划线
3. **SQLite关键字**：如果列名是SQLite的关键字，会自动添加下划线后缀
4. **错误处理**：遇到问题会尝试使用替代方法处理，如果仍然失败会跳过问题表
5. **Excel工作表名限制**：Excel工作表名不能超过31个字符，如果SQLite表名过长，可能会被截断
6. **分离文件模式**：在分离文件模式下，每个表都会保存为一个独立的Excel文件，避免了工作表名31字符的限制

## 示例

### 默认使用示例（无参数）
```bash
python xlsx_to_sqlite.py
# 将当前目录中的所有Excel文件合并到一个以目录名命名的数据库中
```

### Excel转SQLite示例

#### 示例1：转换单个文件
```bash
python xlsx_to_sqlite.py --xlsx2db --file data/vulnerabilities.xlsx
```

#### 示例2：合并多个文件
```bash
python xlsx_to_sqlite.py --xlsx2db --dir data --output combined.db
```

### SQLite转Excel示例

#### 示例3：将数据库转为单个Excel文件
```bash
python xlsx_to_sqlite.py --db2xlsx --file data/combined.db
```

#### 示例4：将各表分别保存为独立Excel文件
```bash
python xlsx_to_sqlite.py --db2xlsx --file data/combined.db --separate
```

#### 示例5：转换指定表到单个Excel文件
```bash
python xlsx_to_sqlite.py --db2xlsx --file data/combined.db --tables vulnerabilities_Sheet1 icp_info_Sheet1
```

#### 示例6：将指定表保存为独立Excel文件
```bash
python xlsx_to_sqlite.py --db2xlsx --file data/combined.db --tables vulnerabilities_Sheet1 --separate --output exports/
```

#### 示例7：查看数据库表
```bash
python xlsx_to_sqlite.py --list-tables data/combined.db
```

## YAML 与 SQLite 互转

脚本现在支持 YAML（.yml/.yaml）与 SQLite 之间的相互转换。YAML 支持两种根结构：

- 映射（mapping/object）：{ table1: [rows], table2: [rows], ... }
- 序列（sequence/array）：[rows] —— 当根为数组时，将视为单表数据

使用示例：

- 将整个数据库导出为 YAML（若只指定一个表则输出为 YML 的数组，否则为映射）：
```bash
python xlsx_to_sqlite.py --db2yml --file data/combined.db --output out.yml
```

- 将指定表导出为 YAML：
```bash
python xlsx_to_sqlite.py --db2yml --file data/combined.db --tables my_table --output my_table.yml
```

- 将 YAML 导入为 SQLite（YML 根为对象时按键作为表导入；根为数组时会导入到单表）：
```bash
python xlsx_to_sqlite.py --yml2db --file data/out.yml --output out.db
```

- 当导入根为数组的 YML 时，可使用 `--yml-table` 指定目标表名（否则使用文件名作为表名）：
```bash
python xlsx_to_sqlite.py --yml2db --file rows.yml --yml-table my_table --output out.db
```

注意：若未安装 `PyYAML`，脚本会提示并给出安装建议。

## JSON 与 SQLite 互转

脚本同时也支持 JSON（.json）与 SQLite 之间的相互转换。JSON 支持两种常见输出结构：

- 当只导出一个表时，输出为 JSON 数组（list of records）：
  - 示例: [{"col1": v1, "col2": v2}, {...}]
- 当导出多个表时，输出为 JSON 对象（mapping），键为表名，值为该表的记录数组：
  - 示例: {"table1": [{...}], "table2": [{...}]}

使用示例：

- 将整个数据库导出为 JSON（单表输出为数组，多表输出为对象）：
```bash
python xlsx_to_sqlite.py --db2json --file data/combined.db --output out.json
```

- 导出指定表并以可读格式（缩进）输出：
```bash
python xlsx_to_sqlite.py --db2json --file data/combined.db -t my_table -o my_table.json --pretty
```

- 将 JSON 导入为 SQLite（当 JSON 根为对象时，按键作为表导入；根为数组时视为单表）：
```bash
python xlsx_to_sqlite.py --json2db --file data/out.json --output out.db
```

- 当导入根为数组的 JSON 时，可使用 `--json-table` 或 `-j` 指定目标表名（否则使用文件名作为表名）：
```bash
python xlsx_to_sqlite.py --json2db --file rows.json -j my_table --output out.db
```

行为与注意事项：

- JSON 输出使用 Python 内置的 json 模块；不需要额外依赖。
- 默认情况下，脚本在序列化遇到 pandas/特殊类型（例如 datetime、numpy 类型）时会使用 str() 进行降级处理，
  即这些值会被写为字符串。若需要更严格的类型保持，应在调用前对列进行转换或扩展序列化器。
- 空值会被映射为 JSON 的 null（导入回数据库时将成为 NULL）。
- `--pretty` 会启用带缩进的可读输出（默认 indent=4），否则输出为紧凑格式以节省空间。


## 常见问题

- **Q: 直接运行`python xlsx_to_sqlite.py`会发生什么？**
  - A: 工具会转换当前目录中所有Excel文件到一个以当前目录名命名的SQLite数据库

- **Q: 转换时提示"工作表/表XXX为空，跳过该表"**
  - A: 这是正常现象，表示该工作表/表没有数据，程序会自动跳过

- **Q: 如何查看生成的SQLite数据库？**
  - A: 可以使用DB Browser for SQLite等工具打开查看

- **Q: 支持哪些Excel格式？**
  - A: 支持.xlsx格式，不支持旧版.xls格式
  
- **Q: SQLite表名很长时转为Excel会发生什么？**
  - A: 在单文件模式下，Excel工作表名限制为31个字符，过长的表名会被截断。建议使用`--separate`参数分别保存为独立文件
  
- **Q: 如何处理大量表的数据库？**
  - A: 对于包含大量表的数据库，建议使用`--separate`参数将各表保存为独立文件，这样可以避免Excel工作表数量和命名的限制 