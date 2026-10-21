# 2. Sơ đồ cơ sở dữ liệu (ERD)

ERD dựa trên schema, index và migration trong `backend/server/db.js`. Không có bảng tồn kho. `order_items.product_id` không khai báo khóa ngoại; tên và giá được lưu snapshot tại lúc tạo đơn.

```mermaid
erDiagram
    USERS {
        INTEGER id PK
        TEXT name
        TEXT email UK
        TEXT password_hash
        TEXT role
        TEXT created_at
    }
    PRODUCTS {
        INTEGER id PK
        TEXT name
        TEXT category
        TEXT category_key
        INTEGER price
        INTEGER old_price
        TEXT badge
        TEXT rating
        INTEGER reviews
        TEXT image
        TEXT color
        INTEGER active
    }
    ORDERS {
        TEXT id PK
        INTEGER user_id FK
        TEXT status
        TEXT payment_status
        INTEGER total_amount
        TEXT shipping_name
        TEXT shipping_phone
        TEXT shipping_address
        TEXT client_request_id
        TEXT request_fingerprint
        TEXT created_at
        TEXT fulfillment_status
        TEXT updated_at
    }
    ORDER_ITEMS {
        INTEGER id PK
        TEXT order_id FK
        INTEGER product_id
        TEXT product_name
        INTEGER unit_price
        INTEGER quantity
    }
    PAYMENT_ATTEMPTS {
        INTEGER id PK
        TEXT order_id FK
        TEXT txn_ref UK
        INTEGER amount
        TEXT status
        TEXT transaction_no
        TEXT created_at
    }
    PAYMENT_RECONCILIATIONS {
        INTEGER id PK
        INTEGER payment_attempt_id FK
        TEXT order_id FK
        TEXT transaction_no
        INTEGER amount
        TEXT reason
        TEXT status
        TEXT created_at
    }
    NEWSLETTER_SUBSCRIBERS {
        INTEGER id PK
        TEXT email UK
        TEXT created_at
    }

    USERS ||--o{ ORDERS : "đặt"
    ORDERS ||--o{ ORDER_ITEMS : "gồm"
    ORDERS ||--o{ PAYMENT_ATTEMPTS : "có lần thanh toán"
    PAYMENT_ATTEMPTS ||--o| PAYMENT_RECONCILIATIONS : "có thể cần đối soát"
    ORDERS ||--o{ PAYMENT_RECONCILIATIONS : "được tham chiếu"
```

## Ràng buộc và ý nghĩa

- `users.email` và `newsletter_subscribers.email` duy nhất, không phân biệt hoa thường.
- `users.role`: `customer` hoặc `admin`.
- `orders.status`: COD order mới là `PENDING`; các giá trị cũ được giữ để tương thích dữ liệu lịch sử. `payment_method` của đơn mới là `COD`, `payment_status` được đặt `PAID` khi tạo đơn thành công.
- `orders.fulfillment_status`: `new`, `processing`, `shipped`, `delivered`. Admin có thể cập nhật đơn COD theo từng bước.
- `client_request_id` và `request_fingerprint` hỗ trợ idempotency; unique index áp dụng lên `(user_id, client_request_id)`.
- `order_items.order_id` tham chiếu `orders.id` với `ON DELETE CASCADE`; `product_id` không có FK. `product_name` và `unit_price` lưu snapshot lịch sử.
- `payment_attempts` và `payment_reconciliations` là cấu trúc lịch sử được giữ lại; luồng COD hiện tại không ghi giao dịch hoặc callback vào các bảng này.
- `products.price > 0`; `old_price` nếu có phải lớn hơn `price`; `reviews >= 0`; `active` là `0/1`.
- Bật foreign keys bằng `PRAGMA foreign_keys = ON`; có index cho đơn theo user/thời gian, attempt theo đơn và hàng đợi đối soát.

Migration theo hướng cộng thêm: bảng/index dùng `IF NOT EXISTS`; cột legacy được thêm có điều kiện. Migration ảnh chỉ đổi các giá trị seed legacy đã nhận diện và không thay URL ảnh tùy chỉnh.
