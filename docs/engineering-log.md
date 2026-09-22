# Engineering log

ブログや面接で、完成物だけでなく判断と失敗から説明できるようにするための記録です。秘密値、個人情報、復旧コードは残しません。

## 2026-09-22 — マルチテナントSaaSを自宅Kubernetesへ載せる

### 作ったもの

Rust/Wasmの`tenant-invariant`とPostgreSQLのRow-Level Security（RLS）を重ねた、契約情報を扱う小さなマルチテナントSaaSを作った。TypeScriptアプリは、URLやフォームから渡されたテナントIDを信用せず、認証済みセッション、リソース所有者、要求されたテナントが一致することをRust側のガードで確認してからSQLを実行する。DBにも同じテナント境界をRLSとして持たせ、アプリのチェック漏れがそのまま他テナントの情報漏洩にならない構成にした。

### 設計で得た知識

- アプリケーションの検査とDBのRLSは競合する機能ではない。前者は意図を明示して監査しやすくし、後者は実装ミスに対する最後の防壁になる。
- PostgreSQLのスーパーユーザーはRLSを回避できる。アプリ接続には専用の非スーパーユーザーを作り、テーブルには`ENABLE ROW LEVEL SECURITY`だけでなく`FORCE ROW LEVEL SECURITY`も設定する必要がある。
- 所有テナントを判定するために、RLSで本文を取得する前に本文テーブルを検索すると循環する。そこで、機密本文を含まない所有者メタデータと、RLSで保護する本文を分けた。
- OAuthのClient Secret、DBパスワード、セッション署名鍵はGitに置かない。Kubernetes Secretとして実行時に注入し、ログにも値を出さない。
- GitHub OAuthのコールバックURLとアプリの公開URLは一致させる。今回は`https://saas.octomblog.com/auth/github/callback`を登録した。

### Kubernetesで得た知識

- PostgreSQLは永続データを持つためStatefulSetとPersistentVolumeClaim、アプリは置換可能なためDeploymentに分けた。
- ServiceはPodの入れ替わりから接続先を分離する。PostgreSQLはクラスタ内部だけ、Webアプリは自宅サーバーのCloudflare Tunnelから到達させるためNodePort `30302`を使う。
- readiness probeは「トラフィックを渡せるか」、liveness probeは「プロセスを再起動すべきか」を判断する。デプロイ成功はPodがRunningになったことではなく、readinessが通るところまで確認する。
- NetworkPolicyでアプリからPostgreSQLへの通信だけを許可する。ただしポリシーの実効性はCNIがNetworkPolicyを実装していることが前提で、今回はCiliumを使っている。
- `runAsNonRoot: true`は、コンテナイメージの`USER node`のような名前だけではKubernetesが非rootと検証できないことがある。今回の初回起動は`CreateContainerConfigError`になり、イベントに「non-numeric userを検証できない」と出た。公式NodeイメージのUID/GID 1000を`runAsUser`と`runAsGroup`に明示して解決した。
- 障害調査では`kubectl get pods`で状態を絞り、`kubectl describe pod`のEventsで起動前の失敗を確認し、起動後の失敗は`kubectl logs`を見る。コンテナが作られていない場合、ログよりEventsが先になる。

### 配布と検証で得た知識

- GitHub ActionsでNode、Deno、Cloudflare Workers、PostgreSQL RLSをそれぞれ検証した。対応環境をREADMEに書くだけでなく、CIで実際に動かすことが互換性の根拠になる。
- GHCRの`main`イメージを自宅クラスタから匿名pullできることを一時Podで先に確認した。これにより、本番デプロイでImagePull権限とアプリ障害を切り分けられた。
- PostgreSQL統合テストでは、テナントAの接続コンテキストからテナントBの行が取得できないこと、テナント未設定の検索が0件になること、Rustガードが`CrossTenant`を返すことを確認した。
- Cloudflare Tunnelのingressルールは上から順に評価され、最初に一致したものが使われる。`saas.octomblog.com`のルールは必須の`http_status:404` catch-allより前に追加した。
- Tunnel設定は、既存ファイルのバックアップ、`cloudflared tunnel ingress validate`による構文検証、`ingress rule`による対象URLの一致確認、サービス再起動、外部HTTPSリクエストの順で検証した。
- 公開確認では`/health/ready`の200だけでなく、トップページのHTML、GitHub OAuthの302、リダイレクト先のClient IDとcallback URL、cloudflaredの4本のQUIC接続まで確認した。
- 自宅ルーターで受信ポートを開けず、cloudflaredからCloudflareへ張る外向き接続を使った。NodePortはインターネットへ直接公開する入口ではなく、同じホスト上のcloudflaredが到達するoriginとして扱った。

### ブログで使える失敗談

最初の構成ではアプリもPostgreSQLの管理ユーザーで接続していたため、RLSを定義しても実際には迂回できた。さらにKubernetesへの初回デプロイでは、非rootユーザーを使っているつもりでもUIDを数値で明示していなかったため、セキュリティ設定がアプリ起動を止めた。どちらも「設定を書いた」ことと「その制約が実際に効いている」ことは別だと分かる例だった。負のテストと実環境のEventsを根拠に確認することが重要だった。

### 次の設計テーマ — 監査可能なTenantInvariant

DEV Communityのフィードバックを起点に、単なる許可・拒否ログを、リクエストID、操作、適用ポリシー、実行結果まで結び付けた監査証跡へ拡張するPRDを書いた。特に、混在テナントのバッチでは全IDを先に判定し、1件でも拒否なら保護された本文取得や更新を一切始めない「事前判定」を採用する。詳細は[`auditable-tenant-invariant.md`](./prd/auditable-tenant-invariant.md)を参照する。
