# 实现计划：国际手机号支持

## 概述

将地址表单的手机号字段从中国大陆硬编码格式改造为「国际区号选择器 + 号码输入框」组合。涉及共享层新增 `phone.ts` 工具模块（区号数据、parsePhone、formatPhone、displayPhone、validatePhoneNumber）、更新 `maskPhone` 函数、新增前端 `CountryCodePicker` 组件、改造地址表单和订单确认表单、更新后端验证正则、适配展示页面、更新 5 种语言的 i18n 翻译。

## 任务

- [x] 1. 共享层手机号工具模块
  - [x] 1.1 创建 `packages/shared/src/phone.ts` 模块
    - 定义 `CountryCode` 接口（code、dialCode、flag、name）
    - 定义 `ParsedPhone` 接口（countryCode、phoneNumber）
    - 定义 `COMMON_DIAL_CODES` 常量数组：`['86', '81', '886', '852', '82']`
    - 定义 `COUNTRY_CODES` 数据数组，包含约 30+ 常见国家/地区的区号数据
    - 实现 `getSortedCountryCodes()` 函数：返回 `{ common: CountryCode[]; others: CountryCode[] }`，常用区号在前，其余按 `name` 英文字母序排列
    - 实现 `getDefaultDialCode(locale, cfCountry?)` 函数：根据 locale 映射默认区号（zh→86, ja→81, zh-TW→886, ko→82, en→由 cfCountry 决定），无法映射时默认 86
    - 实现 `parsePhone(phone)` 函数：解析 `+CC-NNNN` 格式返回 `ParsedPhone`，旧格式 11 位纯数字返回 `{ countryCode: '86', phoneNumber: 原始号码 }`，无效输入返回 `null`
    - 实现 `formatPhone(countryCode, phoneNumber)` 函数：组合为 `+CC-NNNN` 格式
    - 实现 `displayPhone(phone)` 函数：格式化为 `+CC NNNN` 展示格式，旧格式原样返回
    - 实现 `validatePhoneNumber(phoneNumber)` 函数：校验纯数字且 4-15 位
    - 在 `packages/shared/src/index.ts` 中导出所有新增函数和类型
    - _需求: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 1.2 编写 parsePhone/formatPhone round-trip 属性测试
    - **Property 2: parsePhone/formatPhone round-trip**
    - 使用 fast-check 生成合法 Phone_Storage_Format 字符串（`+{1-4位数字}-{4-15位数字}`），验证 `parsePhone` 返回非 null，再 `formatPhone` 后等于原始字符串
    - 在 `packages/shared/src/phone.property.test.ts` 中创建测试
    - **验证: 需求 8.1, 8.2, 8.3**

  - [ ]* 1.3 编写 parsePhone 拒绝无效输入属性测试
    - **Property 3: parsePhone rejects invalid input**
    - 使用 fast-check 生成不符合 Phone_Storage_Format 且不是旧格式 11 位纯数字的字符串，验证 `parsePhone` 返回 `null`
    - 在 `packages/shared/src/phone.property.test.ts` 中添加测试
    - **验证: 需求 8.4**

  - [ ]* 1.4 编写 parsePhone 向后兼容属性测试
    - **Property 4: parsePhone backward compatibility**
    - 使用 fast-check 生成 11 位纯数字字符串（以 1 开头 + 10 位随机数字），验证 `parsePhone` 返回 `{ countryCode: '86', phoneNumber: 原始字符串 }`
    - 在 `packages/shared/src/phone.property.test.ts` 中添加测试
    - **验证: 需求 8.5**

  - [ ]* 1.5 编写手机号格式验证属性测试
    - **Property 1: Phone number format validation**
    - 使用 fast-check 生成随机字符串，验证 `validatePhoneNumber` 仅当输入为 4-15 位纯数字时返回 true；同时验证后端正则 `/^\+\d{1,4}-\d{4,15}$/` 与 parsePhone 的一致性
    - 在 `packages/shared/src/phone.property.test.ts` 中添加测试
    - **验证: 需求 3.2, 4.1, 4.2**

  - [ ]* 1.6 编写区号列表排序属性测试
    - **Property 7: Country code list sorting**
    - 验证 `getSortedCountryCodes()` 返回的 `others` 数组中，任意相邻两项的 `name` 按英文字母序排列
    - 在 `packages/shared/src/phone.property.test.ts` 中添加测试
    - **验证: 需求 1.3**

- [x] 2. 更新 maskPhone 函数
  - [x] 2.1 更新 `packages/shared/src/types.ts` 中的 `maskPhone` 函数
    - 导入 `parsePhone` 函数
    - 国际格式（`+CC-NNNN`）：保留区号，号码部分 ≥6 位时保留前 3 后 2 中间 `****`，<6 位时保留首末中间 `****`
    - 旧格式纯数字：保持原有逻辑（前 3 + `****` + 后 4）
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 2.2 编写 maskPhone 国际格式属性测试
    - **Property 5: maskPhone for international format**
    - 使用 fast-check 生成合法 Phone_Storage_Format 字符串，验证 maskPhone 输出保留完整区号、号码部分按规则遮蔽
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 5.2, 5.3, 5.4**

  - [ ]* 2.3 编写 maskPhone 向后兼容属性测试
    - **Property 6: maskPhone backward compatibility**
    - 使用 fast-check 生成 11 位纯数字字符串，验证 maskPhone 输出等于 `前3位 + **** + 后4位`
    - 在 `packages/shared/src/types.test.ts` 中添加测试
    - **验证: 需求 5.5**

- [x] 3. 检查点 - 共享层验证
  - 确保所有共享层代码编译通过，运行 `packages/shared` 相关测试。如有问题请向用户确认。

- [x] 4. 后端验证逻辑更新
  - [x] 4.1 更新 `packages/backend/src/cart/address.ts` 中的 `validateAddressInput` 函数
    - 将手机号正则从 `/^1\d{10}$/` 更新为 `/^\+\d{1,4}-\d{4,15}$/`
    - 保持错误码 `INVALID_PHONE` 和错误消息不变
    - _需求: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.2 编写后端地址验证单元测试
    - 更新 `packages/backend/src/cart/address.test.ts` 中的手机号验证测试用例
    - 新增国际格式接受测试：`+86-13800138000`、`+81-09012345678`、`+1-2025551234`
    - 新增旧格式拒绝测试：纯数字 `13800138000` 应被拒绝
    - 新增无效格式拒绝测试：`+86`、`+86-`、`+86-123`（号码不足 4 位）
    - _需求: 4.1, 4.2, 4.3_

- [x] 5. 前端 CountryCodePicker 组件
  - [x] 5.1 创建 `packages/frontend/src/components/CountryCodePicker/index.tsx` 和 `index.scss`
    - 组件接收 `value`（当前区号）和 `onChange` 回调
    - 紧凑按钮展示：国旗 emoji + `+区号`
    - 点击展开下拉列表：常用区号置顶 → 分隔线 → 其余按英文名字母序
    - 每个选项展示：国旗 + `+区号` + 国家名称
    - 选择后关闭下拉并回调 `onChange`
    - 使用 CSS 变量遵循项目设计规范
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 6. 改造地址管理页面表单
  - [x] 6.1 更新 `packages/frontend/src/pages/address/index.tsx`
    - 在表单 state 中新增 `countryCode` 字段，默认值通过 `getDefaultDialCode` 根据当前 locale 和 cf_country cookie 获取
    - 将手机号输入字段拆分为 `CountryCodePicker` + 号码输入框，水平排列
    - 移除旧的 `PHONE_REGEX` 硬编码正则，改用 `validatePhoneNumber` 校验号码部分
    - 提交时使用 `formatPhone(countryCode, phone)` 组合为 `+CC-NNNN` 格式发送至后端
    - 编辑已有地址时，使用 `parsePhone` 解析已存储的手机号，预填区号和号码
    - 移除 `maxLength={11}` 限制，改为 `maxLength={15}`
    - 地址卡片中使用 `displayPhone` 展示完整手机号（`+CC NNNN` 格式）
    - 旧格式纯数字手机号通过 `parsePhone` 向后兼容处理
    - _需求: 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 6.3, 6.4_

- [x] 7. 改造订单确认页面表单
  - [x] 7.1 更新 `packages/frontend/src/pages/order-confirm/index.tsx`
    - 在快捷添加地址表单中新增 `countryCode` state，默认值同上
    - 将手机号输入字段拆分为 `CountryCodePicker` + 号码输入框
    - 更新 `validateAddressForm` 使用 `validatePhoneNumber` 校验
    - 提交时使用 `formatPhone` 组合格式
    - 地址选择卡片中使用 `displayPhone` 展示手机号
    - 移除旧的 `/^1\d{10}$/` 正则
    - _需求: 3.4, 6.1_

- [x] 8. 适配展示页面
  - [x] 8.1 更新 `packages/frontend/src/pages/order-detail/index.tsx`
    - 确认已导入更新后的 `maskPhone`，无需额外改动（maskPhone 已自动支持国际格式）
    - 验证旧格式订单数据展示正常
    - _需求: 6.2, 6.4_

  - [x] 8.2 更新管理端订单页面 `packages/frontend/src/pages/admin/orders.tsx`
    - 如果页面展示手机号，使用 `displayPhone` 或 `maskPhone` 处理国际格式
    - 确保旧格式数据正常展示
    - _需求: 6.4_

- [x] 9. 检查点 - 前端组件与页面验证
  - 确保所有前端代码编译通过，CountryCodePicker 组件和表单改造逻辑正确。如有问题请向用户确认。

- [x] 10. i18n 翻译更新
  - [x] 10.1 更新中文翻译 `packages/frontend/src/i18n/zh.ts`
    - 更新 `address.phoneLabel` → `'手机号码'`（保持不变）
    - 更新 `address.phonePlaceholder` → `'请输入手机号码'`
    - 更新 `address.phoneError` → `'请输入 4-15 位有效手机号码'`
    - 新增 `address.countryCodeLabel` → `'区号'`
    - 同步更新 `orderConfirm` 中对应的手机号翻译
    - _需求: 7.1, 7.6, 7.7_

  - [x] 10.2 更新英文翻译 `packages/frontend/src/i18n/en.ts`
    - 更新 `address.phonePlaceholder` → `'Enter phone number'`
    - 更新 `address.phoneError` → `'Please enter a valid 4-15 digit phone number'`
    - 新增 `address.countryCodeLabel` → `'Country Code'`
    - 同步更新 `orderConfirm` 中对应翻译
    - _需求: 7.2, 7.6, 7.7_

  - [x] 10.3 更新日文翻译 `packages/frontend/src/i18n/ja.ts`
    - 更新 `address.phonePlaceholder` → `'電話番号を入力してください'`
    - 更新 `address.phoneError` → `'4〜15桁の有効な電話番号を入力してください'`
    - 新增 `address.countryCodeLabel` → `'国番号'`
    - 同步更新 `orderConfirm` 中对应翻译
    - _需求: 7.3, 7.6, 7.7_

  - [x] 10.4 更新韩文翻译 `packages/frontend/src/i18n/ko.ts`
    - 更新 `address.phonePlaceholder` → `'전화번호를 입력하세요'`
    - 更新 `address.phoneError` → `'4-15자리 유효한 전화번호를 입력하세요'`
    - 新增 `address.countryCodeLabel` → `'국가번호'`
    - 同步更新 `orderConfirm` 中对应翻译
    - _需求: 7.4, 7.6, 7.7_

  - [x] 10.5 更新繁体中文翻译 `packages/frontend/src/i18n/zh-TW.ts`
    - 更新 `address.phonePlaceholder` → `'請輸入手機號碼'`
    - 更新 `address.phoneError` → `'請輸入 4-15 位有效手機號碼'`
    - 新增 `address.countryCodeLabel` → `'區號'`
    - 同步更新 `orderConfirm` 中对应翻译
    - _需求: 7.5, 7.6, 7.7_

- [x] 11. 集成联调与最终验证
  - [x] 11.1 确保共享层导出完整
    - 验证 `packages/shared/src/index.ts` 正确导出 `phone.ts` 中所有函数、类型和常量
    - 验证前后端均可正确导入使用
    - _需求: 8.1, 8.2_

  - [x] 11.2 验证旧数据向后兼容
    - 确认 `parsePhone` 对旧格式纯数字手机号返回 `{ countryCode: '86', phoneNumber: 原始号码 }`
    - 确认 `maskPhone` 对旧格式保持 `前3 + **** + 后4` 行为
    - 确认 `displayPhone` 对旧格式原样返回
    - 确认各展示页面对旧数据不产生格式错误
    - _需求: 5.5, 6.4, 8.5_

- [x] 12. 最终检查点 - 全面验证
  - 运行所有测试确保通过，验证前后端编译正确。如有问题请向用户确认。

## 备注

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 开发
- 每个任务引用具体需求编号以确保可追溯性
- 属性测试验证设计文档中定义的 7 个正确性属性
- 所有函数均保持对旧格式纯数字手机号的向后兼容
- 前端组件遵循项目设计规范，使用 CSS 变量和全局组件类
- 检查点任务用于阶段性验证，确保增量开发的正确性
