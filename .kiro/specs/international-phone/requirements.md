# Requirements Document

## Introduction

地址页面的手机号验证当前硬编码为中国大陆格式 `/^1\d{10}$/`，仅接受以 1 开头的 11 位数字。本功能将手机号字段改造为「国际区号选择器 + 号码输入框」的组合形式，支持全球用户输入国际手机号。涉及前端表单改造、后端验证逻辑更新、存储格式变更、手机号遮蔽函数通用化，以及所有展示手机号页面的适配。

## Glossary

- **Address_Form**: 地址管理页面（`packages/frontend/src/pages/address/index.tsx`）中用于新增或编辑收货地址的表单组件
- **OrderConfirm_Form**: 订单确认页面（`packages/frontend/src/pages/order-confirm/index.tsx`）中内嵌的快捷添加地址表单
- **Country_Code_Picker**: 国际区号下拉选择器组件，展示国旗 emoji + 区号 + 国家名称，支持常用区号置顶与全局搜索
- **Phone_Validator**: 前后端共享的手机号验证逻辑，校验区号与号码的合法性
- **Phone_Storage_Format**: 后端存储手机号的标准格式，形如 `+区号-号码`（例如 `+81-09012345678`）
- **maskPhone**: 共享工具函数（`packages/shared/src/types.ts`），用于在展示页面遮蔽手机号中间部分
- **E.164_Standard**: ITU-T 国际电话号码标准，规定号码（不含区号）长度为 4-15 位纯数字
- **Locale_Detector**: 现有的语言检测模块（`packages/frontend/src/i18n/locale-detector.ts`），通过浏览器语言和 cf_country cookie 检测用户 locale
- **Backend_Address_Validator**: 后端地址验证函数（`packages/backend/src/cart/address.ts` 中的 `validateAddressInput`）

## Requirements

### Requirement 1: Country Code Picker 组件

**User Story:** 作为全球用户，我希望在地址表单中通过下拉选择器选择我的国际区号，以便输入正确的国际手机号。

#### Acceptance Criteria

1. THE Country_Code_Picker SHALL 展示一个下拉选择列表，每个选项包含国旗 emoji、国际区号（如 +86）和国家/地区名称
2. THE Country_Code_Picker SHALL 将常用区号（+86 中国、+81 日本、+886 台湾、+852 香港、+82 韩国）置于列表顶部，并在常用区号与其他区号之间显示视觉分隔线
3. THE Country_Code_Picker SHALL 在分隔线下方按国家/地区名称的英文字母顺序排列全球其他国家区号
4. WHEN 用户点击 Country_Code_Picker 时，THE Country_Code_Picker SHALL 展开下拉列表供用户选择
5. WHEN 用户选择一个区号后，THE Country_Code_Picker SHALL 关闭下拉列表并在选择器中显示所选区号

### Requirement 2: 区号自动预选

**User Story:** 作为用户，我希望系统根据我的语言或地区自动预选区号，以减少手动选择的操作。

#### Acceptance Criteria

1. WHEN 用户 locale 为 "zh" 时，THE Country_Code_Picker SHALL 自动预选 +86（中国大陆）
2. WHEN 用户 locale 为 "ja" 时，THE Country_Code_Picker SHALL 自动预选 +81（日本）
3. WHEN 用户 locale 为 "zh-TW" 时，THE Country_Code_Picker SHALL 自动预选 +886（台湾）
4. WHEN 用户 locale 为 "ko" 时，THE Country_Code_Picker SHALL 自动预选 +82（韩国）
5. WHEN 用户 locale 为 "en" 时，THE Country_Code_Picker SHALL 读取 cf_country cookie 并映射到对应区号（如 US→+1, GB→+44, AU→+61）
6. IF cf_country cookie 不存在或无法映射，THEN THE Country_Code_Picker SHALL 默认预选 +86
7. WHEN 用户编辑已有地址时，THE Country_Code_Picker SHALL 从已存储的 Phone_Storage_Format 中解析区号并预选

### Requirement 3: 手机号输入与前端验证

**User Story:** 作为用户，我希望在输入手机号时获得即时的格式验证反馈，以确保我输入的号码格式正确。

#### Acceptance Criteria

1. THE Address_Form SHALL 将手机号字段拆分为 Country_Code_Picker 和号码输入框两个独立控件，水平排列
2. THE Phone_Validator SHALL 校验号码部分为纯数字且长度在 4 到 15 位之间（符合 E.164_Standard）
3. WHEN 用户输入的号码不符合验证规则时，THE Address_Form SHALL 在号码输入框下方显示本地化的错误提示信息
4. THE OrderConfirm_Form SHALL 采用与 Address_Form 相同的 Country_Code_Picker + 号码输入框布局和验证逻辑
5. WHEN 用户提交表单时，THE Address_Form SHALL 将区号和号码组合为 Phone_Storage_Format（`+区号-号码`）后发送至后端

### Requirement 4: 后端手机号验证

**User Story:** 作为系统，我需要在后端验证手机号格式，以确保存储的数据符合国际手机号标准。

#### Acceptance Criteria

1. THE Backend_Address_Validator SHALL 校验 phone 字段符合 Phone_Storage_Format 格式：以 `+` 开头，包含 1-4 位区号数字，一个 `-` 分隔符，以及 4-15 位纯数字号码
2. THE Backend_Address_Validator SHALL 使用正则表达式 `/^\+\d{1,4}-\d{4,15}$/` 进行格式校验
3. IF phone 字段不符合 Phone_Storage_Format 格式，THEN THE Backend_Address_Validator SHALL 返回错误码 INVALID_PHONE 和对应错误消息
4. THE Backend_Address_Validator SHALL 将符合格式的 phone 字段原样存储至 DynamoDB

### Requirement 5: maskPhone 函数通用化

**User Story:** 作为用户，我希望在订单详情等页面看到的手机号被适当遮蔽以保护隐私，且遮蔽逻辑适用于各种长度的国际手机号。

#### Acceptance Criteria

1. THE maskPhone 函数 SHALL 接受 Phone_Storage_Format 格式的手机号字符串作为输入
2. THE maskPhone 函数 SHALL 保留区号部分（`+` 到 `-` 之间的内容）完整显示
3. THE maskPhone 函数 SHALL 对号码部分（`-` 之后的内容）执行遮蔽：保留前 3 位和后 2 位，中间用 `****` 替代
4. IF 号码部分长度不足 6 位，THEN THE maskPhone 函数 SHALL 仅保留首位和末位，中间用 `****` 替代
5. WHEN 输入为旧格式纯数字手机号（无区号前缀）时，THE maskPhone 函数 SHALL 保持向后兼容，保留前 3 位 + `****` + 后 4 位的遮蔽逻辑

### Requirement 6: 展示页面适配

**User Story:** 作为用户，我希望在订单确认页和订单详情页看到的手机号能正确展示国际区号格式。

#### Acceptance Criteria

1. THE 订单确认页 SHALL 在地址选择卡片中以 `+区号 号码` 格式展示手机号（区号与号码之间用空格分隔，不遮蔽）
2. THE 订单详情页 SHALL 使用更新后的 maskPhone 函数展示遮蔽后的手机号（包含区号前缀）
3. THE 地址管理页 SHALL 在地址卡片中以 `+区号 号码` 格式展示完整手机号
4. WHEN 展示旧格式纯数字手机号数据时，THE 各展示页面 SHALL 正常显示，不产生格式错误

### Requirement 7: i18n 翻译更新

**User Story:** 作为多语言用户，我希望手机号相关的提示文案以我的语言显示，且内容反映国际手机号格式。

#### Acceptance Criteria

1. THE zh 语言文件 SHALL 包含更新后的手机号相关翻译：区号标签、号码占位符、格式错误提示等
2. THE en 语言文件 SHALL 包含更新后的手机号相关翻译
3. THE ja 语言文件 SHALL 包含更新后的手机号相关翻译
4. THE ko 语言文件 SHALL 包含更新后的手机号相关翻译
5. THE zh-TW 语言文件 SHALL 包含更新后的手机号相关翻译
6. THE 各语言文件 SHALL 将手机号占位符从固定的 "11位手机号" 更新为 "请输入手机号码"（或对应语言的等效表述）
7. THE 各语言文件 SHALL 将手机号错误提示从 "请输入正确的11位手机号" 更新为 "请输入4-15位有效手机号码"（或对应语言的等效表述）

### Requirement 8: Phone_Storage_Format 解析与格式化

**User Story:** 作为开发者，我需要可靠的工具函数来解析和格式化 Phone_Storage_Format，以便在前后端各处一致地处理国际手机号。

#### Acceptance Criteria

1. THE parsePhone 函数 SHALL 接受 Phone_Storage_Format 字符串并返回 `{ countryCode: string, phoneNumber: string }` 对象
2. THE formatPhone 函数 SHALL 接受 countryCode 和 phoneNumber 参数并返回 Phone_Storage_Format 字符串
3. FOR ALL 合法的 Phone_Storage_Format 字符串，parsePhone 然后 formatPhone SHALL 产生与原始输入等价的字符串（round-trip 属性）
4. IF parsePhone 接收到不符合 Phone_Storage_Format 的字符串，THEN THE parsePhone 函数 SHALL 返回 null
5. THE parsePhone 函数 SHALL 对旧格式纯数字手机号返回 `{ countryCode: '86', phoneNumber: 原始号码 }` 以保持向后兼容
