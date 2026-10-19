# 4. Bộ test case và bằng chứng

## Kết quả chạy

Các lệnh được chọn từ scripts thật trong `package.json`:

| Lệnh | Kết quả |
|---|---|
| `npm test` | **Pass** — backend 7/7, frontend 4/4; 11 test, 0 fail. |
| `npm run lint` | **Pass** — Oxlint frontend. |
| `npm run lint --workspace=backend` | **Pass** — `node --check` các module server đã khai báo. |
| `npm run build` | **Pass** — `tsc -b` và Vite build; 1.893 module. |

Log database/VNPay lỗi trong một số test là fault injection có chủ đích; suite xác nhận rollback/trả lỗi và vẫn Pass.

`Pass` dưới đây chỉ khẳng định assertion của test tự động đã thành công; không có nghĩa là VNPay thật đã được gọi.

## Test case tự động

| Mã | Mục tiêu / bước chính | Kỳ vọng | Kết quả thực tế / bằng chứng |
|---|---|---|---|
| AUTH-01 | Đăng ký hợp lệ; email sai/trùng, mật khẩu rỗng/ngắn | Tạo role `customer`; sai lệch bị từ chối; mật khẩu băm | **Pass** — suite registration/private orders; 201, 400, 409; xác minh bcrypt hash |
| AUTH-02 | Login email malformed hoặc password sai | 400 hoặc 401, không cấp phiên | **Pass** — `login rejects malformed email input` và suite registration |
| AUTH-03 | Khôi phục phiên, logout | `/api/auth/me` đúng; logout xóa cookie | **Pass** — backend suite và frontend auth-state tests |
| SEC-01 | Anonymous gọi admin/tạo đơn; customer gọi admin/đọc đơn người khác | 401, 403 hoặc 404 đúng quyền | **Pass** — suite registration/private orders |
| SEC-02 | Kiểm tra CSP và các security headers trên storefront, API success/error; tải trang dưới CSP | CSP chặn script ngoài, cho phép assets đã dùng; các headers có cả ở lỗi | **Pass** — `nginx -t`, reload riêng `dongo-course-demo` proxy; storefront 200, API 401/404; browser có 8 product cards, ảnh tải đủ, 0 CSP violation |
| SEC-03 | Gửi request với Origin được phép/không được phép, email không hợp lệ; gọi admin anonymous | Chỉ origin allowlist được phản chiếu; input lỗi 400; admin trả 401 | **Pass** — CORS allowlist trả `http://localhost:18080`, origin không tin cậy không có `Access-Control-Allow-Origin`; register email sai 400; admin 401 |
| CAT-01 | Đọc catalog, chi tiết tồn tại/không tồn tại | 8 sản phẩm seed; ID sai trả 404 | **Pass** — suite registration/private orders; assertion 8 đường dẫn ảnh |
| ORDER-01 | Giỏ rỗng, quantity 0/21, sản phẩm thiếu, shipping sai | Dữ liệu bị từ chối | **Pass** — các request trả 400 trong suite registration/private orders |
| ORDER-02 | Gửi giá/tổng tiền giả từ frontend | Backend tính lại giá từ database; backend test dùng SQLite | **Pass** — giá 900.000 × 2 cho tổng 1.800.000 trong test |
| ORDER-03 | Retry cùng idempotency key; dùng lại key với payload khác | Trả đơn cũ hoặc 409; không tạo đơn trùng | **Pass** — suite registration/private orders |
| ORDER-04 | Cập nhật fulfillment đơn chưa paid hoặc bỏ bước | Bị từ chối; tiến độ hợp lệ theo từng bước | **Pass** — suite registration/private orders |
| PAY-01 | Return URL hợp lệ trước IPN | Điều hướng browser, order vẫn pending | **Pass** — suite registration/private orders |
| PAY-02 | IPN sai chữ ký hoặc sai amount | Không cập nhật paid; trả mã lỗi tương ứng | **Pass** — chữ ký sai `97`, amount sai `04` |
| PAY-03 | Hai IPN thành công đồng thời rồi gửi lặp | Chỉ một lần cập nhật paid; callback lặp idempotent | **Pass** — hai callback trả `00`/`02`; callback sau trả `02` |
| PAY-04 | IPN thất bại; attempt mới; success từ attempt cũ hoặc sau expiry | Giữ trạng thái của order hiện tại, đưa attempt cũ vào đối soát duy nhất | **Pass** — `superseded_attempt`, callback lặp không thêm dòng; test expiry mô phỏng bằng timestamp |
| PAY-05 | Database abort giữa transaction IPN | Rollback; không giả thành thanh toán thành công | **Pass** — suite rollback trả `99`; order/attempt giữ pending |
| PAY-06 | Thiếu thông tin merchant khi tạo thanh toán | Trả 503; order vẫn pending | **Pass** — `checkout stays pending when VNPay merchant credentials are missing` |
| DB-01 | Database không khả dụng | Trả lỗi server thay vì giả phiên anonymous | **Pass** — `database outages are returned as server errors...` |
| DB-02 | Mở database legacy có ảnh seed cũ và URL tùy chỉnh | Migration an toàn, giữ dữ liệu và URL tùy chỉnh | **Pass** — `legacy database data and custom images are preserved...` |

## Test frontend tự động

| Mã | Mục tiêu | Kết quả |
|---|---|---|
| FE-AUTH-01 | Anonymous thấy đăng nhập/đăng ký | **Pass** |
| FE-AUTH-02 | Tài khoản hiện user của phiên | **Pass** |
| FE-AUTH-03 | Logout vô hiệu hóa phản hồi session restore cũ | **Pass** |
| FE-AUTH-04 | Giữ loading khi session restore chưa xong | **Pass** |

Nguồn `frontend/src/auth-state.test.js`; bốn test đều Pass. Chưa có unit test cho search, filter, cart, keyboard/accessibility hoặc responsive.

## Kiểm tra giao diện quan sát trong phiên demo

| Mã | Thao tác | Kết quả |
|---|---|---|
| UI-01 | Mở trang storefront; kiểm tra `naturalWidth` ảnh DOM | **Pass trong phiên chụp** — hero và 8 ảnh sản phẩm tải được |
| UI-02 | Thêm Đèn bàn Mellow vào giỏ | **Pass trong phiên chụp** — số đếm thành 1, toast xuất hiện |
| UI-03 | Mở giỏ và form giao hàng | **Pass trong phiên chụp** — modal có sản phẩm/giá/số lượng; checkout có trường giao hàng |
| UI-04 | Đăng nhập admin giả lập, mở `/admin`, xem orders/products | **Pass trong phiên chụp** — dashboard tải 1 đơn pending; tab sản phẩm hiển thị đủ 8 sản phẩm |
| UI-05 | Viewport 390px | **Pass có giới hạn** — phép đo trước capture: innerWidth 390, document scroll width 375; bảng admin 720px trong vùng cuộn |
| UI-06 | Gửi order hoặc thanh toán từ UI | **Chưa kiểm tra** — không gửi request thanh toán VNPay và không tạo dữ liệu persistent |

Ảnh được chụp trên app chạy với SQLite `:memory:`. Tài khoản/đơn hàng minh họa không phải dữ liệu dự án hay người dùng thật. Chi tiết tại [kiểm thử giao diện](./05-kiem-thu-giao-dien.md).

## Kiểm tra observability trong workspace hiện tại — 2026-10-16

Đây là kết quả của lượt kiểm tra hiện tại, tách biệt với các smoke test lịch sử bên dưới.

| Mã | Mục tiêu / bước chính | Kết quả hiện tại |
|---|---|---|
| OBS-CUR-01 | Đếm panel dashboard trong workspace | **Pass tĩnh** — JSON hiện có 15 panel, ID duy nhất; không dùng số panel trong bản ZIP hoặc báo cáo cũ |
| OBS-CUR-02 | Đối chiếu biểu đồ CPU/RAM | **Pass tĩnh** — query container yêu cầu `name!=""` và loại `id="/"`; query host/VM chỉ chọn `id="/"`. Không gắn nhãn host thành container; không tạo fallback metric 0 |
| OBS-CUR-03 | Đối chiếu scrape config và dashboard | **Pass tĩnh** — Prometheus cấu hình jobs `backend`, `nginx`, `mysql`, `containers`, `loki`, `log_agent`, `prometheus`; dashboard có backend request/5xx/latency, MySQL exporter/threads, Nginx exporter/request/active connections |
| OBS-CUR-04 | Kiểm tra Docker/cAdvisor runtime | **Chưa thể kiểm tra runtime** — Docker Desktop Linux engine sẵn sàng, nhưng không có container Dongo/cAdvisor; không có log cAdvisor để kết luận lỗi kết nối Docker hoặc đọc cgroup |
| OBS-CUR-05 | Xác minh Docker API socket | **Cấu hình cho thấy không mount** — Compose không mount `/var/run/docker.sock`/`/var/run`, cAdvisor v0.49.2 mặc định endpoint `unix:///var/run/docker.sock`; không thể kiểm tra bên trong container vì container không chạy |
| OBS-CUR-06 | Kiểm tra target/metric live, PromQL và mở Grafana | **Chưa chạy** — Prometheus 9090/29090 và Grafana 3000 đóng; không có phiên Grafana đăng nhập; `promtool`/image Prometheus không sẵn có. Không xác nhận target `UP`, parse PromQL, `mysql_up`, `dongo_database_up`, metric backend hoặc dữ liệu panel hiện hành |
| OBS-CUR-07 | Kiểm tra Compose / chạy stack | **Kiểm tra tĩnh bị chặn** — `docker compose -f docker-compose.yml config -q` dừng vì thiếu giá trị `MYSQL_MONITOR_PASSWORD`; không chạy `up/recreate`, không xem/sửa/tạo `.env`, không đụng volume/database |
| OBS-CUR-08 | Đối chiếu đề cương PDF | **Không tìm thấy PDF trong workspace `DuAnGit`** — đối chiếu theo yêu cầu chính thức được nêu trong yêu cầu triển khai |

Metric/query được cấu hình không đồng nghĩa có dữ liệu runtime. Các metric backend được khai báo trong `backend/server/app.js`; Nginx exporter 1.4.2 cung cấp `nginx_up`, `nginx_http_requests_total` và `nginx_connections_active` theo tài liệu upstream; MySQL exporter có panel `mysql_up` và `mysql_global_status_threads_connected`. Không query nào trong lượt này được gửi tới một Prometheus đang chạy.

## Smoke test Docker Compose và observability — kết quả lịch sử

Các kết quả trong mục này được giữ để tham khảo lịch sử, không đại diện cho trạng thái runtime của lượt kiểm tra hiện tại.

Các kiểm tra dưới đây chạy trên Compose project thử nghiệm cô lập, không phải database SQLite local:

| Mã | Thao tác | Kết quả |
|---|---|---|
| NGINX-01 | Kiểm tra storefront, API health/catalog/product detail và security headers trên ba Nginx proxy đang chạy | **Pass** — `nginx -t` và response headers trên course-demo, acceptance, observability-check; storefront/API/product hợp lệ 200, sản phẩm không tồn tại 404, admin anonymous 401; CSP và 4 headers có trên storefront |
| NGINX-02 | So sánh proxy container lỗi với cấu hình Compose; kiểm tra log mount/ownership | **Pass sau khi sửa runtime** — proxy cũ không dùng image Dockerfile dự án và không mount `nginx_logs`; tái tạo riêng reverse-proxy bằng `--no-deps --build`; file access JSON được ghi trong named volume bởi UID 101; error log đi stderr |
| NGINX-03 | Mô phỏng upstream bị từ chối và upstream không trả response trong test container/network biệt lập | **Pass có giới hạn** — harness trước đó nhận 502/504 (~2s theo timeout rút ngắn); chưa đo lại timeout 30s ở stack ứng dụng; không có trang lỗi tùy chỉnh để tránh đổi lỗi JSON API |
| NGINX-04 | Xác minh HTTPS storefront hiện tại | **Chưa đạt** — port chỉ phục vụ HTTP; thử TLS handshake trên port 18080 thất bại như dự kiến; chưa có certificate/443 listener |
| NGINX-05 | Kiểm tra runtime proxy dùng chung CSP và timeout sau reload có chọn lọc | **Pass** — ba proxy đều `nginx -t` hợp lệ; graceful reload riêng reverse-proxy; `nginx -T` xác nhận connect 5s/send 30s/API read 30s; cả 3 port trả CSP và routes có status kỳ vọng |
| CMP-01 | Re-run Compose mới với Alloy; health backend MySQL và đọc catalog qua Nginx | **Pass** — health `ok`, `products` gồm 8 sản phẩm seed; acceptance project dùng cổng host riêng |
| CMP-02 | Đăng ký tài khoản, tạo/đọc đơn qua API | **Pass** — dữ liệu hoạt động trên MySQL volume thử nghiệm |
| CMP-03 | Truy cập phpMyAdmin | **Pass** — HTTP 200 |
| OBS-01 | Kiểm tra Prometheus `/api/v1/targets` trên hai project monitoring đang chạy | **Pass sau khi sửa scrape target** — 7 active targets backend, containers, log_agent, Loki, MySQL, Nginx, Prometheus đều `up`; Promtail là agent hiện chạy trong hai project |
| OBS-02 | Đọc backend, MySQL và Nginx exporter metrics | **Pass** — `dongo_database_up=1`, `mysql_up=1`, `nginx_up=1`; MySQL threads connected `2`; Nginx active connections `1` tại snapshot |
| OBS-03 | Truy vấn Loki qua Grafana cho backend và Nginx | **Pass** — 15 backend entries và 11 Nginx HTTP 200 entries trong acceptance project mới |
| OBS-05 | Query CPU/memory cAdvisor trong dashboard | **Pass có giới hạn** — có metrics host-level từ VM Linux; Docker Desktop không cung cấp breakdown theo từng container trong lần kiểm tra |
| CMP-04 | Chạy Compose mặc định với Alloy trên project `dongo-alloy-acceptance-260603` (cổng 38280/38281/39290/33200); kiểm tra health | **Pass** — 12 service chạy; các healthcheck ứng dụng, MySQL, Prometheus/Grafana và cAdvisor xanh; `docker compose config -q` đạt với env tạm ACL-restricted; dừng bằng `down` (không `-v`), giữ 8 named volumes |
| OBS-04 | Kiểm tra Grafana health, datasources và dashboard provision | **Pass** — health healthy, datasource Prometheus/Loki và dashboard UID `dongo-operations` tồn tại |
| OBS-06 | Alloy định dạng/runtime; Prometheus scrape; tìm log 404 bằng LogQL | **Pass** — `alloy fmt --test`; target Alloy `up=1`; backend và Nginx mỗi stream có 1 entry cho HTTP 404 |
| OBS-07 | `promtool check config`, Prometheus health/reload, Grafana datasource và panel PromQL | **Pass** — promtool hợp lệ; hai Prometheus healthy, 7/7 targets UP; panels 1–8 đều trả series; 5xx zero hiện giá trị `0` |
| OBS-08 | Đối chiếu cAdvisor theo từng container và kiểm tra alert rules | **Pass có giới hạn** — chỉ có series host `id="/"`, không có `name!=""`; chưa có rule groups, Grafana alert rules hoặc Alertmanager |
| OBS-09 | Gửi request probe qua acceptance Nginx/backend; đối chiếu file JSON nguồn, LogQL JSON parse và Grafana datasource proxy | **Pass có giới hạn** — Promtail 3.5.0 hoạt động; Nginx/backend probe tìm thấy trong Loki, parser-error query rỗng, Grafana datasource `OK`; panel backend đổi để hiển thị log level 30 thực tế |
| OBS-10 | Kiểm tra Promtail đọc log Nginx và backend course-demo, kiểm parser và gửi tới Loki | **Pass** — cả hai target `1/1 ready`; JSON source có probe; Grafana LogQL trả đúng 1 row/job và parser-error queries trả 0 row |
| OBS-11 | Restart riêng Promtail, xác nhận positions được tiếp tục và log mới không mất/trùng | **Pass có giới hạn** — giữ nguyên `dongo-course-demo_promtail_positions`; sau restart Grafana query trả đúng một row cho probe backend và Nginx; counter dropped hiện tại bằng 0 |
| OBS-12 | Kết nối Grafana acceptance tới Loki course-demo và truy vấn từ Grafana | **Pass** — network internal riêng chỉ gồm Grafana/Loki; datasource UID `loki-course-demo` health `OK`; hostname riêng tránh alias `loki` trùng; các probe trả đúng một row; dashboard/datasource cũ không đổi |
| OBS-13 | Điều tra Loki `negative structured metadata` và HTTP 500 ring | **Đạt một phần** — `size=0` warning vẫn tái hiện ở Loki 3.5.0; probes ingest thành công, ring hiện có 1 ingester active và Promtail dropped `0`; lịch sử có retry HTTP 500 do ring không có replica khỏe, nguyên nhân intermittent chưa xác định |

## Chưa có bằng chứng

- Bàn phím toàn luồng Tab/Shift+Tab/Enter/Space/Escape, screen reader và thiết bị vật lý.
- Viewport 320, 360, 430, 768, 1024, 1440px trong phiên lập tài liệu này. Báo cáo UX trước đó ghi có đo các cỡ này nhưng chưa chạy lại lần này.
- Tìm kiếm/lọc/sắp xếp, lưu yêu thích sau reload, giỏ rỗng và lỗi tải catalog trong phiên trình duyệt này.
- VNPay sandbox đầu cuối. Test thanh toán tạo chữ ký nội bộ, không kết nối VNPay.
- Alert delivery/notification end-to-end; hiện chưa cấu hình Alertmanager/contact point.
- Thời gian vận hành dài hạn của Loki/agent và mức độ chi tiết cAdvisor trên Linux host không phải Docker Desktop.
