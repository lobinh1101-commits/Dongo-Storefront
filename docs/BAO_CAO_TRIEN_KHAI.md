# Báo cáo triển khai hạ tầng và vận hành

## Dongo Storefront

**Đồ án:** Website thương mại điện tử và hạ tầng triển khai Docker  
**Phạm vi báo cáo:** ứng dụng, MySQL, reverse proxy, metrics, dashboard và log tập trung  
**Phiên bản dữ liệu:** cấu hình và kết quả kiểm tra được ghi nhận trong workspace hiện tại  
**Trạng thái:** báo cáo kỹ thuật; chưa có PDF đề cương gốc để đối chiếu

> Tài liệu được chia thành 10 trang nội dung bằng dấu ngắt trang để tiện xuất/định dạng A4. Kết quả kiểm tra chỉ ghi những gì đã thực hiện; các hạng mục chưa có bằng chứng được nêu rõ, không thay bằng số liệu giả.

<div style="page-break-after: always;"></div>

## Trang 1 — Tóm tắt và mục tiêu

Dongo Storefront là ứng dụng bán hàng trực tuyến gồm giao diện React/TypeScript/Vite, API Node.js/Express, quản trị sản phẩm và đơn hàng, cùng thanh toán khi nhận hàng (COD). Backend là điểm thực thi nghiệp vụ tin cậy: kiểm tra đầu vào, xác thực người dùng, phân quyền, đọc giá từ database và tính lại tổng đơn. Trình duyệt không thể quyết định giá hoặc tự đặt trạng thái đơn.

Phần hạ tầng bổ sung cung cấp Docker Compose cho môi trường demo tách biệt. Trong stack này, backend dùng MySQL 8.4; Nginx phục vụ frontend và chuyển tiếp `/api`; phpMyAdmin hỗ trợ quản trị database; Prometheus thu metrics; Grafana provision dashboard; Loki lưu log tập trung và Grafana Alloy chuyển log từ backend/Nginx. Các cổng host được giới hạn trên loopback.

Mục tiêu kỹ thuật:

1. Duy trì chế độ local/test dùng SQLite, tránh yêu cầu database server cho phát triển thông thường.
2. Bổ sung adapter MySQL và cấu hình Compose mà không thay thế hay tự động nhập database SQLite hiện hữu.
3. Triển khai reverse proxy, health checks và network phân tách để các service nội bộ không phải publish trực tiếp ra host.
4. Cung cấp metrics và log có thể truy vấn, cùng dashboard vận hành.
5. Bảo toàn dữ liệu qua named volumes và ghi rõ thao tác có nguy cơ xóa dữ liệu.

Đây là cấu hình đồ án/dev, không phải khuyến nghị triển khai production. Stack hiện dùng HTTP trên máy local, không có chứng thư TLS, CI/CD hoặc dịch vụ backup tự động.

<div style="page-break-after: always;"></div>

## Trang 2 — Phạm vi ứng dụng và nghiệp vụ

Frontend cung cấp danh mục, tìm kiếm/lọc/sắp xếp, giỏ hàng, checkout, tài khoản và trang quản trị. Backend Express thực hiện đăng ký/đăng nhập, cookie phiên HttpOnly, kiểm tra quyền customer/admin, quản lý catalog và orders. Mật khẩu được băm bằng bcryptjs; schema request được xác thực bằng Zod.

Khi tạo đơn, backend lấy giá từ database thay vì tin tổng tiền trình duyệt gửi. Giao dịch dùng transaction và khóa `Idempotency-Key` để retry cùng yêu cầu không tạo order trùng. Dòng order item giữ bản chụp tên/giá tại thời điểm mua. Đơn mới có `payment_method = 'COD'`, `status = 'PENDING'` và trạng thái thanh toán pending; admin có thể cập nhật fulfillment theo các bước nghiệp vụ.

Checkout gọi trực tiếp API tạo đơn; không chuyển hướng tới cổng thanh toán và không phụ thuộc cấu hình merchant/callback.

Giới hạn nghiệp vụ còn lại: chưa có quản lý/trừ tồn kho, email xác minh, email giao dịch, newsletter delivery, tích hợp hãng vận chuyển hoặc quy trình xác nhận thu tiền COD.

Chi tiết giao diện, API và bộ test hiện có được ghi trong [hồ sơ bảo vệ](./bao-ve-do-an/README.md).

<div style="page-break-after: always;"></div>

## Trang 3 — Kiến trúc và lựa chọn database

Có hai chế độ hoạt động độc lập:

| Chế độ | Database | Cách khởi chạy | Vị trí dữ liệu |
|---|---|---|---|
| Local/test | SQLite qua `node:sqlite` | npm workspaces | `backend/data/storefront.sqlite` hoặc DB test in-memory |
| Docker Compose | MySQL qua `mysql2` | `docker compose up -d --build` | Named volume `mysql_data` |

Backend chọn driver qua `DB_DRIVER`. Adapter MySQL dùng connection pool, migration schema lặp an toàn, seed catalog không ghi đè sản phẩm đã có và transaction gắn với connection hiện hành. Adapter SQLite cũ tiếp tục phục vụ local và test. Những thay đổi này không sao chép, xóa hay ghi đè SQLite gốc.

Quy tắc cần nhớ khi demo/vận hành: dữ liệu đăng ký ở website local không tự xuất hiện trong Compose và ngược lại. Việc chuyển đổi dữ liệu giữa SQLite và MySQL không nằm trong phạm vi tự động của dự án; không đổi `DB_DRIVER` để trỏ một hệ thống đang có dữ liệu mà chưa có kế hoạch migration/backup phù hợp.

Backend cung cấp health endpoint `/api/health` để kiểm tra khả năng truy vấn database và endpoint `/metrics` cho Prometheus. Nginx proxy website và API; health checks của Docker kiểm tra service tại chỗ. Sơ đồ luồng chi tiết và module được mô tả trong [tổng quan kiến trúc](./bao-ve-do-an/01-tong-quan-kien-truc.md).

<div style="page-break-after: always;"></div>

## Trang 4 — Docker Compose và mạng dịch vụ

Compose định nghĩa các dịch vụ `mysql`, `backend`, `frontend`, `reverse-proxy`, `phpmyadmin`, `mysql-exporter`, `nginx-exporter`, `cadvisor`, `prometheus`, `grafana`, `loki` và `alloy`. Dữ liệu MySQL, Prometheus, Grafana, Loki, log ứng dụng và trạng thái Alloy dùng named volumes riêng. `promtail_positions` vẫn được giữ và chỉ mount read-only để Alloy có thể nhập checkpoint cũ khi file tồn tại.

Nginx là điểm vào của storefront trên host. phpMyAdmin, Prometheus và Grafana cũng được publish nhưng bind `127.0.0.1`; backend, exporters, MySQL và Loki không publish cổng host. MySQL và một số service monitoring nằm trong network internal; frontend/backend được tách network theo vai trò. Container backend, frontend và Nginx dùng cấu hình hạn chế quyền như non-root, read-only filesystem, `cap_drop: ALL` hoặc tmpfs ở những service phù hợp.

Tệp root `.env.example` liệt kê cổng và secrets cần thiết. Trước khi chạy phải tạo `.env` riêng với giá trị ngẫu nhiên, đặc biệt `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `MYSQL_MONITOR_PASSWORD`, `SESSION_SECRET` và `GRAFANA_ADMIN_PASSWORD`. Exporter yêu cầu password hexadecimal tối thiểu 32 ký tự. Không chia sẻ hoặc đưa `.env` vào gói bàn giao.

Lệnh dừng an toàn là `docker compose down`, giữ nguyên volumes. `docker compose down -v` xóa volumes và có thể làm mất MySQL cùng dữ liệu monitoring; không dùng nếu chưa có yêu cầu xóa và backup được xác nhận. Chi tiết lệnh khởi chạy và khôi phục lỗi ở [hướng dẫn triển khai/quản trị](./HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md).

<div style="page-break-after: always;"></div>

## Trang 5 — MySQL, quyền truy cập và bảo toàn dữ liệu

Backend khởi tạo schema và seed catalog khi kết nối MySQL. Seed bổ sung sản phẩm mẫu còn thiếu, không ghi đè catalog đã tồn tại. API smoke test trên Compose xác nhận health thành công, trả 8 sản phẩm seed, đăng ký tài khoản, tạo/đọc đơn và phpMyAdmin phản hồi HTTP 200.

MySQL được tách khỏi SQLite local bằng adapter và volume. Không có quy trình tự động import dữ liệu cá nhân vào MySQL; vậy nên không dùng catalog/tài khoản/đơn ở một chế độ để suy ra dữ liệu ở chế độ còn lại. SQLite backup script chỉ xử lý file SQLite, không phải phương tiện backup MySQL.

Tài khoản `MYSQL_USER` dùng ứng dụng; monitor user được tạo quyền đọc cần thiết cho exporter qua init script. Init script trong `/docker-entrypoint-initdb.d` chỉ được chạy tự động khi MySQL khởi tạo volume rỗng lần đầu. Nếu dùng volume cũ, phải xử lý grant có kiểm soát; không xóa volume để buộc chạy lại init. Password exporter được ghi vào file cấu hình tạm trong container với quyền hạn chế thay vì đưa trực tiếp vào đối số command line.

phpMyAdmin được giới hạn host loopback trong cấu hình hiện tại. Tài khoản quản trị không được nhúng trong tài liệu; dùng secrets cục bộ trong `.env`. Dù vậy, đây vẫn là cấu hình demo HTTP; không mở port ra Internet và không dùng các credentials mẫu trong môi trường chia sẻ.

<div style="page-break-after: always;"></div>

## Trang 6 — Reverse proxy, metrics và dashboard

Nginx nhận yêu cầu từ trình duyệt, proxy `/api` tới backend và phần website tới frontend container. Access log ở định dạng JSON, tách thành volume để Alloy đọc. Cấu hình áp dụng security headers và giới hạn một số request; TLS/HSTS không bật trong demo HTTP để tránh khai báo transport security sai.

Backend xuất HTTP counters/histogram và trạng thái database tại `/metrics`. Prometheus có scrape jobs `backend`, `nginx`, `mysql`, `containers`, `loki`, `log_agent` và `prometheus`. MySQL exporter đọc MySQL; Nginx exporter đọc `stub_status` nội bộ; cAdvisor scrape cgroup metrics. Cấu hình job không tự chứng minh target đang hoạt động.

Grafana provision datasource Prometheus/Loki và dashboard `Dongo Operations` (UID `dongo-operations`). Dashboard hiện có **15 panel**: target status; backend request rate, HTTP 5xx và latency p95; application DB health; MySQL exporter health và connected threads; Nginx exporter health, request rate và active connections; CPU/RAM theo container; CPU/RAM riêng từ root cgroup (host/VM); backend logs. Query container loại trừ `id="/"` và yêu cầu `name` không rỗng. Panel root chỉ chọn `id="/"`; không đổi nhãn root thành container. HTTP 5xx không sinh vector 0 khi series không có, do đó “No data” không bị trình bày sai thành zero.

**Kiểm tra workspace hiện tại (2026-10-16):** Docker context là `desktop-linux` (Docker Desktop, Linux engine 26.1.4). `docker ps --filter name=dongo` và `docker ps --filter name=cadvisor` không tìm thấy container; các cổng Prometheus 9090/29090 và Grafana 3000 không lắng nghe. Vì vậy trong lượt này không thể đọc log cAdvisor đang chạy, kiểm tra socket bên trong container, truy vấn Prometheus thực tế hoặc mở dashboard đã đăng nhập. Đã chạy `docker compose -f docker-compose.yml config -q` (chỉ kiểm tra, không khởi chạy service); Compose dừng ở lỗi biến bắt buộc `MYSQL_MONITOR_PASSWORD` chưa có giá trị. Không chạy `up/recreate`, không xem/sửa/tạo `.env`.

**Bằng chứng và chẩn đoán cAdvisor:** Compose đang mount `/`, `/sys`, `/var/lib/docker`, `/dev/disk` chỉ đọc và chạy `--docker_only=true`, nhưng không mount `/var/run/docker.sock`, không mount `/var/run` và không cấu hình `--docker`. Source đúng tag [cAdvisor v0.49.2 factory.go](https://github.com/google/cadvisor/blob/v0.49.2/container/docker/factory.go) đặt mặc định `--docker=unix:///var/run/docker.sock`; [client.go](https://github.com/google/cadvisor/blob/v0.49.2/container/docker/client.go) bật API version negotiation. `--docker_only` chỉ lọc cgroup nào được xem là container, không cấp Docker API access. Do container hiện không tồn tại nên không có bằng chứng log runtime để khẳng định lỗi connect hoặc đọc cgroup. Bản ghi nghiệm thu lịch sử trong workspace từng thấy duy nhất series `id="/"`, không có `name!=""`; điều này xác nhận snapshot đó chỉ có root cgroup series, không xác định nguyên nhân duy nhất và không thay cho phép đo hiện tại. Cgroup layout/quyền truy cập trên Docker Desktop cũng chưa kiểm chứng được.

**Đánh giá proxy Docker API:** Các call cần cho cAdvisor metrics ở phiên bản này là `HEAD /_ping` (API negotiation; fallback `GET /_ping` nếu `HEAD` không được hỗ trợ), `GET /version`, `GET /info` và `GET /containers/{id}/json` (inspect container). Mã nguồn cAdvisor gọi `Info`, `ServerVersion` và `ContainerInspect`; Docker SDK v20.10.27 ánh xạ tới các đường dẫn này ([inspect](https://github.com/moby/moby/blob/v20.10.27/client/container_inspect.go), [info](https://github.com/moby/moby/blob/v20.10.27/client/info.go), [version](https://github.com/moby/moby/blob/v20.10.27/client/version.go), [ping](https://github.com/moby/moby/blob/v20.10.27/client/ping.go), [API negotiation](https://github.com/moby/moby/blob/v20.10.27/client/client.go)). Cờ cAdvisor `--docker` chuyển endpoint cho Docker SDK; SDK này hỗ trợ scheme TCP cho proxy nội bộ ([options.go](https://github.com/moby/moby/blob/v20.10.27/client/options.go)), nhưng chưa cấu hình hoặc kiểm thử kết nối đó. `GET /images/json` chỉ phục vụ trang Docker UI của cAdvisor, không phải luồng scrape metrics. Không thấy yêu cầu `GET /containers/json` trong đường lấy metrics đã truy dấu. Không cấu hình proxy trong lượt này: chưa có runtime để kiểm tra endpoint/phiên bản thực, và `GET /containers/{id}/json` có thể trả `Config.Env`, mounts, labels, network metadata cùng cấu hình container — dữ liệu đọc vẫn có thể chứa secrets. Nếu thử nghiệm sau này, proxy phải giới hạn chính xác các method `HEAD`/`GET` và paths nêu trên, tắt `POST`, không publish host port, nối vào network `internal` riêng chỉ có cAdvisor/proxy, đồng thời đánh giá redaction/allowlist response; chỉ mount socket read-only không giới hạn quyền API. Docker Desktop/cgroup visibility vẫn cần thử nghiệm cô lập trước khi chọn proxy.

**Kết quả kiểm tra tĩnh/runtime của lượt này:** YAML Prometheus và Compose parse được; JSON dashboard hợp lệ với 15 panel/ID duy nhất, các query container và root cgroup tách riêng. `promtool` và image Prometheus cục bộ không có, nên không kiểm tra PromQL bằng parser. Chưa xác minh được target nào `UP`, dữ liệu MySQL/backend hiện hành, query PromQL trên Prometheus đang chạy hoặc dashboard đã xác thực. Các số liệu nêu trong phần smoke test lịch sử không được coi là trạng thái runtime hiện tại. PDF đề cương không có trong workspace được kiểm tra; kết luận tiêu chí dưới đây chỉ đối chiếu yêu cầu chính thức đã nêu trong yêu cầu triển khai. Chưa có alert rules hoặc Alertmanager/notification route.

<div style="page-break-after: always;"></div>

## Trang 7 — Log tập trung và chuyển đổi sang Grafana Alloy

Backend dùng Pino để ghi log request dạng JSON vào `/var/log/dongo/backend.jsonl` trong Compose. Serializer giới hạn thông tin request/response (method, path, status, thời gian) và không ghi body, cookie hay authorization header. Nginx ghi JSON access log. Cấu hình Compose mặc định mount hai log volumes read-only cho Alloy; runtime hiện tại của hai monitoring project vẫn là Promtail 3.5.0 và đọc các volume tương ứng của từng project.

Alloy v1.20.1 là agent mặc định trong Compose, parse JSON và trích các nhãn cardinality thấp như `job`, `method`, `status`. Cấu hình đã được convert từ Promtail và kiểm tra bằng formatter/runtime Alloy; canary riêng đã đọc thử positions Promtail ở chế độ read-only. Để đáp ứng tiêu chí Promtail mà không coi hai agent là tương đương, overlay riêng cho `dongo-course-demo` chạy Promtail 3.5.0 và Loki 3.5.0. Alloy vẫn là cấu hình mặc định; không chạy đồng thời hai agent trên cùng file.

**Kiểm thử backend runtime 2026-10-16:** image ban đầu không chứa `backend/server/logger.js`, nên dù `LOG_FILE` và mount đã cấu hình, file log không được tạo. Đã build lại từ Dockerfile/source hiện tại, xác minh module có trong image rồi recreate riêng backend. Promtail/Loki không bị restart trong bước đó; MySQL container ID/start time và volume không đổi. stdout cũ (25 dòng; checksum đối chiếu) được giữ trong `backend-prior-stdout.log` của named log volume. Sau cập nhật, backend healthy; `/api/health` trả HTTP 200 và `/api/products` trả 8 sản phẩm. GET an toàn tới API route không tồn tại trả 404 và ghi đúng một JSON request record vào `/var/log/dongo/backend.jsonl`.

Promtail course-demo được recreate riêng để nhận mount backend mới; volume `dongo-course-demo_promtail_positions` được giữ nguyên. Hai jobs `course_demo_backend` và `course_demo_nginx` cùng `1/1 ready`. Nginx probe trả HTTP 200 và có entry JSON trong volume nguồn. Sau restart, Grafana query trả đúng một row cho probe backend và Nginx; counter tại snapshot là `promtail_sent_entries_total=82`, còn mọi `promtail_dropped_entries_total=0`.

Ví dụ JSON đã đọc trực tiếp từ volume nguồn (token probe được thay bằng `<token>`):

```json
{"level":30,"time":"2026-10-16T07:16:22.403Z","service":"dongo-backend","req":{"method":"GET","url":"/api/health/loki-backend-probe-<token>"},"res":{"statusCode":404},"responseTime":2,"msg":"request completed"}
{"time":"2026-10-16T07:19:09+00:00","service":"nginx","method":"GET","uri":"/loki-nginx-probe-<token>","status":200,"request_time":"0.000","upstream_status":"200"}
```

**Kết nối Grafana:** tạo network internal riêng `dongo-course-demo_grafana_loki` chỉ gồm Grafana acceptance và Loki course-demo. Ban đầu Grafana được nối thử vào monitoring network rộng hơn; khi thấy network đó còn chứa backend/reverse-proxy, đã chuyển Grafana ra khỏi network ấy và giữ Loki trên đó để Promtail tiếp tục gửi log. Không restart container hoặc publish port. Datasource mới UID `loki-course-demo` báo health `OK`, URL `http://dongo-course-demo-loki-1:3100`; tên `loki` tránh dùng vì alias resolve về Loki acceptance. Datasource `loki` và dashboard provisioned `dongo-operations` (9 panels) không đổi; panel backend hiện hữu tiếp tục trả dữ liệu từ datasource cũ. Log course-demo truy vấn được trong Explore.

**Điều tra Loki:** ba Loki đang chạy là phiên bản 3.5.0. Thông báo `negative structured metadata bytes received` với `size=0` tiếp tục xuất hiện trong log hiện tại của cả ba project. Promtail configs không có structured-metadata stage. Source Loki v3.5.0 tại [`pkg/loghttp/push/push.go`](https://github.com/grafana/loki/blob/v3.5.0/pkg/loghttp/push/push.go#L193-L211) phát thông báo ở nhánh `size <= 0`; giá trị `size=0` phù hợp với trường hợp không có structured metadata để tính nhưng không tự chứng minh batch được chấp nhận hoặc không mất log. Các probe course-demo tìm thấy qua Grafana, Loki `/ready` trả `ready`, ring metric hiện có một ingester `ACTIVE`, và counter Promtail hiện tại không ghi dropped entries. Các kết quả chứng minh probes đã ingest nhưng không giải quyết nguồn gốc warning hoặc loại trừ mọi mất log.

Promtail acceptance và observability có các đợt retry HTTP 500 từ 2026-10-15 đến 2026-10-16; lỗi nêu “at least 1 live replicas required” và `127.0.0.1:9096` unhealthy. Course-demo Loki cũng ghi `empty ring` lúc startup. Không quy tất cả 500 cho startup: acceptance còn có retry lúc 06:27 UTC dù Loki container hiện tại start lúc 05:16 UTC. Ring hiện active, nhưng nguyên nhân khiến ingester tạm thời unhealthy chưa xác định. Không sửa Loki hoặc che cảnh báo.

Các truy vấn LogQL end-to-end đã chạy:

```logql
{job="backend", project="dongo-course-demo"} |= "loki-backend-probe-<token>"
{job="nginx", project="dongo-course-demo"} |= "loki-nginx-probe-<token>"
{job="backend", project="dongo-course-demo"} | json | __error__!=""
{job="nginx", project="dongo-course-demo"} | json | __error__!=""
```

Qua Grafana datasource `loki-course-demo`, các truy vấn probe trả đúng một log row mỗi truy vấn; hai parser-error queries trả 0 row. LogQL filters dùng labels `project`, `job`, `service`, `method` và `status`; path/request ID không được biến thành labels. Không tìm thấy rubric gốc trong workspace; kết quả đối chiếu với checklist kỹ thuật được yêu cầu, không phải rubric chính thức của giảng viên.

**Lưu ý vòng đời và rollback:** Promtail đã EOL từ 2/3/2026. Alloy là log agent mặc định; file cấu hình Promtail và volume positions vẫn được giữ. Không xóa `alloy_data`/`promtail_positions`; rollback thủ công được ghi trong [hướng dẫn triển khai/quản trị](./HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md). Loki dùng filesystem volume riêng và retention 168 giờ (7 ngày), không phải kho lưu trữ kiểm toán lâu dài. Nguồn: [tài liệu Promtail của Grafana](https://grafana.com/docs/loki/latest/send-data/promtail/).

<div style="page-break-after: always;"></div>

## Trang 8 — An toàn, vận hành và backup

Các nguyên tắc áp dụng trong phạm vi dự án:

- Secrets được cung cấp qua `.env` cục bộ; `.env` thật và database/log/backup không thuộc archive allow-list.
- Backend kiểm tra vai trò admin tại API; việc ẩn nút giao diện không phải biện pháp phân quyền.
- Request order được validate và giá tính lại ở server; đơn COD được ghi trong database với trạng thái `PENDING`.
- Các container được giới hạn network/port và filesystem tùy service; Nginx phát security headers.
- Log request không ghi body/cookie/auth header; Alloy đọc các volume log ở chế độ read-only.
- Compose bind giao diện quản trị vào loopback nhưng dùng HTTP và cookie non-Secure cho demo local; không tuyên bố đây là cấu hình production.

SQLite có script snapshot/verify/restore riêng dùng API `node:sqlite`, `PRAGMA quick_check`, safety backup và xác nhận trước khi restore. Script đó không backup MySQL. Compose hiện chưa có job tự động dump MySQL hoặc lập lịch retention backup; MySQL volume giúp dữ liệu tồn tại qua container restart nhưng không thay thế backup/offsite copy.

Khi cần backup MySQL, người vận hành phải tạo dump bằng `mysqldump` với credentials cục bộ, kiểm tra file backup và lưu ở nơi có quyền hạn phù hợp. Không đính kèm dữ liệu tài khoản/đơn hàng vào báo cáo hoặc gửi trong ảnh chụp. Khi xử lý lỗi startup, xem `docker compose ps` và logs theo từng service; không xóa volume để “sửa” lỗi một cách mù quáng.

<div style="page-break-after: always;"></div>

## Trang 9 — Kiểm thử và bảng nghiệm thu

| Tiêu chí / điểm | Trạng thái | File liên quan | Lệnh kiểm tra | Kết quả thực tế | Minh chứng còn thiếu |
|---|---|---|---|---|---|
| 1. GitHub — 1,5 | **Chưa đạt** | [.gitignore](../.gitignore), [GITHUB_PUBLISHING.md](./GITHUB_PUBLISHING.md) | `git --version`, `git status`, `git check-ignore` chưa chạy được | Git không khả dụng trên PATH/vị trí cài phổ biến; workspace chưa có `.git`; `.gitignore` được rà thủ công, chưa được Git xác nhận | Cài Git for Windows; owner chọn remote/visibility, tạo repo và cho phép push |
| 2. Compose + app + database — 1,5 | **Đạt** trong môi trường demo | [docker-compose.yml](../docker-compose.yml), [.env.example](../.env.example), [New-ComposeEnv.ps1](../scripts/New-ComposeEnv.ps1), Dockerfiles | `docker compose -p dongo-alloy-acceptance-260603 --env-file <env> config -q`; `up -d --build`; kiểm tra `docker compose ps`, `/api/health`, `/api/products` | Stack mới dùng Alloy chạy; MySQL/backend/frontend/Nginx/phpMyAdmin/Prometheus/Grafana health xanh; API `ok`, catalog 8 sản phẩm; file env sinh có ACL protected, secret dài 64/96 ký tự; SQLite gốc không được mount/đụng tới | Chưa có diễn tập backup/restore MySQL, tải cao, production DB hoặc kiểm tra di trú dữ liệu người dùng |
| 3. Nginx reverse proxy — 1,5 | **Đạt một phần** | [nginx.conf](../docker/nginx/nginx.conf), [Dockerfile](../docker/nginx/Dockerfile), [docker-compose.yml](../docker-compose.yml), [course-demo logging overlay](../docker-compose.course-demo-logs.yml) | `nginx -t` trên 3 proxy; graceful reload; `curl.exe` storefront/API; isolated Nginx proxy test; kiểm tra JSON access/error log | Ba proxy cùng mount cấu hình đã được đồng bộ sau khi phát hiện 2 runtime chưa áp CSP; API health/products/detail 200, missing product 404, anonymous admin 401; 5 headers; access JSON được ghi named volume; upstream failure 502/504 đã có bằng chứng harness cô lập trước đó; connect 5s/send 30s được cấu hình tường minh | HTTPS/TLS chưa cấu hình; chưa chạy lại mô phỏng lỗi upstream và timeout 30s trong lượt này; chưa có custom 502/504 page (không cần thiết cho demo, có thể làm thay đổi response API) |
| 4. Prometheus + Grafana — 1,5 | **Đạt một phần (cấu hình/dashboard; runtime chưa nghiệm thu)** | [prometheus.yml](../docker/prometheus/prometheus.yml), [dongo-overview.json](../docker/grafana/dashboards/dongo-overview.json), [docker-compose.yml](../docker-compose.yml), provisioning Grafana | Kiểm tra cấu hình tĩnh; để nghiệm thu runtime cần `/api/v1/targets`, query metrics và mở dashboard đã xác thực | Workspace có 7 scrape jobs và dashboard 15 panel; CPU/RAM theo container tách khỏi root cgroup; có panel metric Nginx/MySQL/backend. Lượt hiện tại không có Dongo containers, Prometheus/Grafana ports đóng, nên không xác nhận target UP hay metric có dữ liệu. | Cần khởi chạy stack trong môi trường cấp env secrets an toàn; xác minh Docker API/cgroup và dữ liệu container thực; mở Grafana đăng nhập. PDF rubric không có trong workspace; chưa có alert rules/Alertmanager |
| 5. Loki + Promtail + LogQL — 1,5 | **Đạt một phần** | [course-demo overlay](../docker-compose.course-demo-logs.yml), [Promtail config](../docker/promtail/course-demo-nginx.yml), [main Compose](../docker-compose.yml), [LOGQL_QUERIES.md](./LOGQL_QUERIES.md) | `docker compose ... config -q`; Promtail `-check-syntax`; Loki `/ready`; Promtail `/targets`; source grep; Grafana datasource health/query; parser-error LogQL | Backend/Nginx source probes truy vấn qua Grafana course-demo, mỗi query đúng 1 row; parser errors 0; targets `1/1 ready`; datasource `OK`; dropped counter 0. Backend riêng được rebuild/recreate; MySQL/Loki/Grafana không recreate, no host ports. Hai monitoring stack vẫn Promtail; default Compose vẫn Alloy. | Loki `size=0` warning vẫn tái hiện; lịch sử HTTP 500 do ring không có healthy replica, nguyên nhân intermittent chưa rõ; Promtail EOL; rubric gốc không tìm thấy |
| 6. Hardening — 1,5 | **Đạt một phần** | [.gitignore](../.gitignore), [docker-compose.yml](../docker-compose.yml), [nginx.conf](../docker/nginx/nginx.conf), [HARDENING_CHECKLIST.md](./HARDENING_CHECKLIST.md) | `nginx -t`; reload riêng reverse-proxy; `curl.exe` storefront/API/CORS/TLS; Playwright; `npm test`; lint | CSP mới có hiệu lực trên storefront; 4 security headers được giữ trên 200/401/404; 8 product cards và ảnh tải, không có CSP violation; CORS, input validation và anonymous admin được kiểm tra | Chưa TLS/secure cookie; `.env` không có nên Compose mặc định không validate được; cAdvisor dùng host mounts và không drop capabilities; phpMyAdmin có Apache master root; chưa xác minh Git tracking, secret rotation hoặc production controls |
| 7. Compose + trình bày — 1,0 | **Đạt một phần** | [README.md](../README.md), [BAO_CAO_TRIEN_KHAI.md](./BAO_CAO_TRIEN_KHAI.md), [hồ sơ bảo vệ](./bao-ve-do-an/README.md), [HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md](./HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md) | `docker compose ... config -q`, `up -d --build`; rà nội dung hướng dẫn | Có quy trình setup từ `.env.example`, demo, bảo toàn volume và báo cáo Markdown; cấu hình stack được kiểm tra thực tế | Chưa có PDF đề cương gốc để đối chiếu; Pandoc/LibreOffice không khả dụng nên chưa xuất PDF |

Các lệnh Compose ở bảng chạy trên project nghiệm thu riêng `dongo-alloy-acceptance-260603` với cổng 38280/38281/39290/33200; không dừng hoặc xóa hai Compose project thử nghiệm có trước. Stack nghiệm thu này được dừng bằng `docker compose down` (không `-v`) sau khi lưu kết quả; volumes giữ nguyên. Tổng điểm không được quy đổi thành 10/10 khi GitHub chưa thiết lập, hardening còn thiếu và minh chứng môn học chưa đối chiếu.

**Bằng chứng Nginx riêng (2026-10-16):** container `dongo-course-demo-reverse-proxy-1` trước khi xử lý dùng image upstream `nginxinc/nginx-unprivileged:alpine`, chỉ mount `nginx.conf`, và không có mount `/var/log/dongo`; log lặp lại `open() "/var/log/dongo/nginx-access.jsonl" failed (2: No such file or directory)`. Cấu hình Compose hiện tại yêu cầu Dockerfile `docker/nginx/Dockerfile` (tạo `/var/log/dongo` và chown UID/GID 101) cùng named volume `nginx_logs`, nhưng container cũ không được tạo từ cấu hình đó. Chỉ service reverse-proxy được build/recreate bằng `docker compose ... up -d --no-deps --build reverse-proxy`; cổng `18080` giữ nguyên, MySQL container ID/start time/health không đổi. Named volume `dongo-course-demo_nginx_logs` mới có access log JSON (file 7 KB, owner 101); `/var/log/nginx/error.log` trỏ `/dev/stderr`. Compose Alloy có mount volume `nginx_logs` read-only, nhưng Alloy/Loki không chạy trong project này. Kiểm thử 502/504 dùng proxy/container/network/config tạm biệt lập, không đổi cấu hình hoặc upstream của các stack ứng dụng; `proxy_read_timeout` trong cấu hình thực tế là 30 giây.

Các bước Compose được chạy trên project kiểm tra riêng với cổng host riêng; không xóa volume bằng `down -v`. Kết quả này chứng minh các luồng được thử trong phiên, không khẳng định hiệu năng tải cao, HA, backup/restore MySQL hoặc triển khai Internet. Ảnh giao diện trong [hồ sơ bảo vệ](./bao-ve-do-an/README.md) là từ môi trường demo cô lập; không phải screenshot của dashboard hạ tầng.

<div style="page-break-after: always;"></div>

## Trang 10 — Hạn chế, kiến nghị và kết luận

Stack hiện đáp ứng luồng triển khai demo nhiều container, MySQL độc lập, reverse proxy, metrics và log tập trung. Kiểm tra đã xác nhận service health, MySQL API, exporter, Prometheus targets, dashboard Grafana, Loki ingestion và truy vấn log. Local SQLite vẫn được giữ; không có thao tác tự động di chuyển hay ghi vào file SQLite hiện hữu.

Các hạng mục cần làm trước khi cân nhắc môi trường production:

1. Cài Git, xác nhận remote/visibility, khởi tạo repository và tự xác thực/push theo hướng dẫn; chưa có quyền thực hiện thay owner.
2. Bổ sung TLS, secrets manager, cookie Secure, network/policy phù hợp và rà soát quyền truy cập quản trị.
3. Thiết kế lịch backup/restore kiểm chứng cho MySQL, retention và bản sao ngoài máy; thực hiện diễn tập restore.
4. Thêm kiểm thử tích hợp MySQL lặp lại được trong CI, migration từ dữ liệu legacy và kiểm thử tải phù hợp.
5. Xác định monitoring alerting, retention, bảo vệ dữ liệu cá nhân và quy trình xác nhận thu tiền COD.
6. Đối chiếu báo cáo với PDF đề cương gốc và xuất PDF khi có công cụ phù hợp.
7. Bổ sung quy trình tồn kho, email và vận chuyển nếu yêu cầu nghiệp vụ cần.

Kết luận: mục tiêu kỹ thuật trong phạm vi đã kiểm thử đạt ở môi trường đồ án/dev. Chưa có PDF đề cương gốc để đối chiếu và chưa có bằng chứng MySQL restore test, production hardening hay CI/CD; các mục này được giữ rõ là chưa xác minh.

### Tài liệu tham chiếu trong workspace

- [README hướng dẫn nhanh](../README.md)
- [Hướng dẫn triển khai và quản trị](./HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md)
- [Truy vấn LogQL](./LOGQL_QUERIES.md)
- [Checklist hardening](./HARDENING_CHECKLIST.md)
- [Tổng quan kiến trúc](./bao-ve-do-an/01-tong-quan-kien-truc.md)
- [Bộ test case](./bao-ve-do-an/04-bo-test-case.md)
- [Promtail agent — Grafana Loki documentation](https://grafana.com/docs/loki/latest/send-data/promtail/)

## Bổ sung nghiệm thu Security Hardening — 2026-10-16

**Phạm vi kiểm tra runtime:** stack `dongo-course-demo` qua `127.0.0.1:18080`; trạng thái container của acceptance/observability cũng được đọc. Không restart hay chỉnh cấu hình Compose/monitoring. Phát hiện trước khi sửa là storefront HTML không có CSP (API đã có Helmet CSP); chính sách CSP được thêm vào Nginx và tại thời điểm kiểm tra này chỉ `dongo-course-demo-reverse-proxy-1` được reload sau `nginx -t` thành công. Hai proxy monitoring được kiểm tra và graceful reload riêng trong phần nghiệm thu Nginx bên dưới.

| ID / mức độ | File, vị trí | Bằng chứng và rủi ro | Sửa tối thiểu / kiểm thử |
|---|---|---|---|
| SEC-H01 — **Medium, đã khắc phục** | [nginx.conf](../docker/nginx/nginx.conf), dòng 35 | Trước sửa, `GET /` trả 200 nhưng thiếu CSP; API responses đã có Helmet CSP. Thiếu CSP làm giảm một lớp bảo vệ khi có lỗi XSS trong frontend. | Thêm `default-src 'self'`, chỉ cho script same-origin; cho phép ảnh HTTPS (tính năng sản phẩm hiện nhận URL HTTPS), Google Fonts và inline style đang dùng. `nginx -t` đạt; reload riêng proxy; browser xác nhận 8 product cards, ảnh đều tải và 0 CSP violation. |
| SEC-H02 — **Medium, còn tồn tại** | [docker-compose.yml](../docker-compose.yml), dòng 35, 39, 123; [nginx.conf](../docker/nginx/nginx.conf), dòng 28; [app.js](../backend/server/app.js), dòng 148 | Compose đặt `NODE_ENV=development`, `COOKIE_SECURE=false`; Nginx chỉ nghe HTTP/8080. Runtime chỉ bind storefront/phpMyAdmin trên loopback; TLS probe tới `127.0.0.1:18080` thất bại như dự kiến. Nếu publish stack ra mạng, phiên và dữ liệu không được mã hóa. | Chưa đổi vì chưa có chứng chỉ/tên miền và Secure cookie sẽ không hoạt động trên HTTP. Trước triển khai Internet phải cấu hình TLS termination, secure cookie, production env và kiểm tra handshake/cookie flags. |
| SEC-H03 — **Medium, còn tồn tại** | [docker-compose.yml](../docker-compose.yml), dòng 206, 209–211 | cAdvisor chạy với user Docker mặc định (root), không có `cap_drop`; mount `/`, `/sys`, `/var/lib/docker` đều read-only, container không privileged và không publish host port. Khi bị xâm nhập, quyền đọc host vẫn mở rộng tác động. | Không sửa để tránh làm hỏng metrics/stack đang chạy. Trên host triển khai thực tế, đánh giá bỏ cAdvisor hoặc giới hạn quyền/mount/capabilities; kiểm tra lại scrape và dữ liệu sau thay đổi. |
| SEC-H04 — **Low, còn tồn tại** | [docker-compose.yml](../docker-compose.yml), dòng 144, 153–154 | phpMyAdmin có port loopback-only; `docker top` xác nhận Apache master chạy root, workers chạy `www-data`. Là giao diện quản trị nhạy cảm; hạn chế loopback hiện giảm bề mặt nhưng không thay thế kiểm soát production. | Không đổi vì công cụ đang phục vụ demo local. Trước production, bỏ/disable hoặc đặt sau xác thực và allowlist; xác minh từ mạng ngoài không truy cập được. |
| SEC-H05 — **Chưa xác minh** | [.gitignore](../.gitignore), dòng 17–45; [.env.example](../.env.example) | Ignore rules loại `.env`, database/backup, secrets, keys và build output; các file example dùng placeholder. `.env` không tồn tại trong workspace. Không chạy Git theo yêu cầu, nên không xác minh file nào đã được track. | Không tạo `.env`/Git. Owner tự tạo `.env` từ example bằng secret ngẫu nhiên và kiểm tra Git tracking trước khi xuất bản repository. |

**Các kiểm tra đạt trong phạm vi:** API health và products trả 200; anonymous `/api/admin/overview` trả 401; product không tồn tại trả 404. Bốn headers hiện có (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) và CSP xuất hiện trên storefront 200, API 401 và product 404. CORS phản chiếu origin `http://localhost:18080` được phép, không phản chiếu `https://attacker.invalid`; register với email sai trả 400. Mã nguồn đặt JSON body limit 32 KB, rate-limit login/register và newsletter, kiểm tra role tại API; logger redacts cookie/Authorization và log Nginx không ghi query string. Đây là kiểm tra có giới hạn, không phải penetration test.

**Kiểm tra và giới hạn:** `docker exec dongo-course-demo-reverse-proxy-1 nginx -t` thành công; lệnh `nginx -s reload` chỉ reload proxy đó, không recreate container. `npm test` đạt backend 7/7 và frontend 4/4; backend/frontend lint đều đạt. `docker compose -f .\\docker-compose.yml config -q` không đạt vì workspace không có `.env` và các biến bắt buộc chưa được cấp; không tạo hoặc đọc secrets. TLS probe thất bại vì stack HTTP-only. MySQL không publish cổng host; các port storefront/phpMyAdmin/Prometheus/Grafana quan sát được bind `127.0.0.1`. Course-demo services vẫn chạy, MySQL volume không bị thay đổi; tại thời điểm kiểm tra hardening hai monitoring proxy chưa reload. Phần nghiệm thu Nginx phía dưới ghi nhận lần reload có chọn lọc tiếp theo của cả ba proxy.

**Kết luận:** tiêu chí Security Hardening **Đạt một phần**. CSP, header, CORS, validation, anonymous authorization và một số giới hạn runtime được kiểm tra; chưa có TLS, secret management/rotation, Git tracking evidence, backup MySQL/restore rehearsal hoặc hardening cAdvisor/phpMyAdmin phù hợp production. Không đủ căn cứ quy đổi thành 1,5/1,5 hay tuyên bố đạt chuẩn production.

## Bổ sung nghiệm thu Nginx Reverse Proxy — 2026-10-16

**Phạm vi:** đọc [nginx.conf](../docker/nginx/nginx.conf), Nginx [Dockerfile](../docker/nginx/Dockerfile), phần reverse-proxy trong [Compose mặc định](../docker-compose.yml) và [overlay logging course-demo](../docker-compose.course-demo-logs.yml). Overlay logging không định nghĩa Nginx service; nó thêm Loki/Promtail. Runtime được kiểm tra trên:

| Proxy | Host port | Config mount | Runtime trước reload |
|---|---:|---|---|
| `dongo-course-demo-reverse-proxy-1` | 18080 | `nginx.conf` read-only; volume `dongo-course-demo_nginx_logs` | CSP đã hoạt động |
| `dongo-acceptance-222040-reverse-proxy-1` | 8080 | cùng source `nginx.conf` read-only; volume log riêng | CSP chưa có trong response |
| `dongo-observability-check-reverse-proxy-1` | 28080 | cùng source `nginx.conf` read-only; volume log riêng | CSP chưa có trong response |

Các container được `nginx -t` trước reload. Chỉ ba reverse-proxy nêu trên được graceful reload bằng `docker exec <container> nginx -s reload`; không recreate container, không restart exporter/Prometheus/Grafana/Loki/agent, không đụng volume hay database. Sau reload, cả ba response storefront đều có CSP và bốn security headers hiện có.

| Vấn đề | Bằng chứng | Ưu tiên | File liên quan | Xử lý / đề xuất | Kiểm thử |
|---|---|---|---|---|---|
| Runtime của hai monitoring proxy cũ hơn file bind-mount | Trước reload, acceptance và observability-check trả đủ bốn headers nhưng không có CSP; course-demo đã có CSP. `nginx -t` cả ba đều hợp lệ. | Medium — đã xử lý | [nginx.conf](../docker/nginx/nginx.conf) | Graceful reload có chọn lọc ba reverse-proxy dùng chung config để runtime thống nhất. | Sau reload, `curl.exe` xác nhận CSP cùng `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` trên storefront ở cả 3 port. |
| Connect/send timeout dựa vào mặc định Nginx | Trước bổ sung, chỉ API có `proxy_read_timeout 30s`; connect/send không đặt tường minh. | Low — đã xử lý | [nginx.conf](../docker/nginx/nginx.conf) | Thêm `proxy_connect_timeout 5s` và `proxy_send_timeout 30s` ở server scope cho frontend/API; giữ `proxy_read_timeout 30s` trên hai API location. Frontend read timeout vẫn theo mặc định Nginx. | `nginx -t` cả ba đạt; `nginx -T` sau reload xác nhận các timeout đã nạp. Không gây upstream outage để đo timeout thật. |
| Không có trang lỗi tùy chỉnh | Cấu hình không khai báo `error_page`; API backend trả JSON 401/404 và Nginx proxy lỗi upstream theo status 502/504 mặc định. | Low — chấp nhận cho demo | [nginx.conf](../docker/nginx/nginx.conf) | Không thêm custom page: có thể làm mất định dạng JSON/status của API và không cần thiết nếu demo không yêu cầu. Production có thể bổ sung trang cho storefront riêng, giữ nguyên API error body. | Kiểm thử cũ trong harness biệt lập ghi nhận upstream refused → 502 và upstream chậm → 504; không tái diễn outage trên stack đang chạy. |
| HTTPS/TLS chưa triển khai | Cấu hình chỉ `listen 8080`; host ports quan sát được đều loopback; TLS handshake trên course-demo HTTP port trước đó trả lỗi. | Medium — còn thiếu cho môi trường Internet | [nginx.conf](../docker/nginx/nginx.conf), [docker-compose.yml](../docker-compose.yml) | Không tạo TLS giả. Cần domain/chứng chỉ và thiết kế nơi terminate TLS trước khi chuyển production cookie/config. | Chưa có listener 443/certificate; không thử nghiệm HTTPS trong lượt này. |

**Kiểm tra sau reload:** cả ba `nginx -t` thành công; `/`, `/api/health`, `/api/products`, `/api/products/1` trả 200; `/api/products/999999` trả 404; `/api/admin/overview` không cookie trả 401. `nginx -T` hiển thị connect 5s/send 30s và API read 30s trên từng proxy. JSON access log tiếp tục ghi vào `/var/log/dongo/nginx-access.jsonl`; mẫu có method, URI không query string, status, request time và upstream status. `readlink -f /var/log/nginx/error.log` trả pipe tới stderr; không có emerg/alert/crit/error trong container logs của ba proxy trong 5 phút kiểm tra.

API error responses có thể mang hai CSP header: policy của Helmet backend và policy của Nginx; chúng được áp dụng đồng thời, không thay status/body JSON. Storefront HTML chỉ dùng policy của Nginx; browser reload xác nhận 8 sản phẩm/ảnh tải, không CSP violation hay console error. Prometheus `up{job="nginx"}` trả `1` ở acceptance và observability-check sau reload. Một probe trực tiếp từ Windows host tới IP nội bộ Promtail:9080 timeout vì cổng đó không publish; không restart agent và không xem kết quả này là lỗi thu thập log.

Upstream failure 502/504 có kết quả trước đó từ cấu hình test biệt lập, nhưng không tái chạy bằng cách dừng backend hoặc chờ 30 giây trong stack thật. Do đó trạng thái hiện tại **Đạt một phần**: reverse proxy, routes, CSP/headers, timeouts cấu hình, health và logging đã có bằng chứng; TLS còn thiếu và timeout/upstream failure chưa được đo lại với đúng giá trị runtime. Không đủ căn cứ khẳng định đạt trọn 1,5 điểm.
