# Requirements Document

## Introduction

管理员订单管理页面的两项改进：（1）移除手机号遮蔽，在订单详情中显示完整手机号以便发货联系；（2）新增"导出待发货订单"功能，将所有待发货（pending）订单导出为 Excel 文件，包含商品信息和收货地址信息。

## Glossary

- **Admin_Orders_Page**: 管理员订单管理前端页面（`packages/frontend/src/pages/admin/orders.tsx`），用于查看和管理所有用户订单
- **Order_Detail_View**: Admin_Orders_Page 中展开某个订单后显示的详情区域，包含商品列表、收货地址、物流时间线等
- **maskPhone**: `@points-mall/shared` 中的手机号遮蔽函数，将手机号中间部分替换为 `****`
- **Export_API**: 后端新增的 API 端点（`GET /api/admin/orders/export`），用于查询所有待发货订单并生成 Excel 文件返回
- **Export_Button**: Admin_Orders_Page 中新增的导出按钮，点击后调用 Export_API 下载 Excel 文件
- **Pending_Order**: 物流状态（shippingStatus）为 `pending`（待发货）的订单
- **Excel_File**: 使用 xlsx 库生成的 `.xlsx` 格式电子表格文件
- **Order_Handler**: 后端订单 API 路由处理器（`packages/backend/src/orders/handler.ts`）

## Requirements

### Requirement 1: Display Full Phone Number in Order Detail

**User Story:** As an admin, I want to see the full phone number in the order detail view, so that I can contact the recipient for shipping and delivery purposes.

#### Acceptance Criteria

1. WHEN an admin expands an order in the Admin_Orders_Page, THE Order_Detail_View SHALL display the full phone number from the shipping address without any masking
2. THE Admin_Orders_Page SHALL NOT import or invoke the maskPhone function for displaying the shipping address phone number
3. WHEN the backend returns an order detail containing a phone number in the shipping address, THE Order_Detail_View SHALL render the phone number exactly as returned by the backend

### Requirement 2: Export Pending Orders API Endpoint

**User Story:** As an admin, I want a backend API that generates an Excel file of all pending orders, so that I can download the data for shipping processing.

#### Acceptance Criteria

1. WHEN an authenticated admin sends a GET request to `/api/admin/orders/export`, THE Export_API SHALL query all Pending_Order records from the orders table
2. THE Export_API SHALL generate an Excel_File containing one row per order item with the following columns: 订单号, 商品名称, 数量, 尺码, 收件人, 电话, 地址
3. WHEN a Pending_Order contains multiple items, THE Export_API SHALL output one row per item, with the 订单号, 收件人, 电话, and 地址 repeated on each row
4. THE Export_API SHALL populate the 电话 column with the full phone number from the shipping address without masking
5. THE Export_API SHALL populate the 尺码 column with the selected size value, or leave it empty when no size is selected for the item
6. THE Export_API SHALL return the Excel_File as a binary response with Content-Type `application/vnd.openxmlformats-officedocument.spreadsheetml.ml.sheet` and a Content-Disposition header specifying a filename that includes the current date
7. WHEN no Pending_Order records exist, THE Export_API SHALL return an Excel_File containing only the header row
8. IF an unauthenticated or non-admin user sends a request to the Export_API, THEN THE Order_Handler SHALL return a 403 Forbidden response

### Requirement 3: Export Button on Admin Orders Page

**User Story:** As an admin, I want an export button on the orders page, so that I can easily download pending orders as an Excel file for shipping processing.

#### Acceptance Criteria

1. THE Admin_Orders_Page SHALL display an Export_Button in the stats area or toolbar section of the page
2. WHEN an admin clicks the Export_Button, THE Admin_Orders_Page SHALL send a GET request to the Export_API endpoint and trigger a file download of the returned Excel_File
3. WHILE the export request is in progress, THE Export_Button SHALL display a loading state to indicate the download is being processed
4. WHEN the export request completes successfully, THE Admin_Orders_Page SHALL save the downloaded file with a filename containing the current date
5. IF the export request fails, THEN THE Admin_Orders_Page SHALL display an error toast notification to the admin
6. WHEN there are zero Pending_Order records, THE Export_Button SHALL remain enabled and download an Excel_File with only the header row
