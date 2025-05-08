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