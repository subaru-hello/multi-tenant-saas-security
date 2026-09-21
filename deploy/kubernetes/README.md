# Home server deployment

The manifests target `octom-server`: a single-node kubeadm cluster with
containerd, Cilium, the `local-path` StorageClass, and host-managed
`cloudflared`.

Create a GitHub OAuth App with:

- Homepage URL: `https://saas.octomblog.com`
- Authorization callback URL: `https://saas.octomblog.com/auth/github/callback`

Create secrets directly on the server; never commit them:

```bash
kubectl apply -f deploy/kubernetes/00-namespace.yaml
kubectl -n tenant-saas create secret generic tenant-saas-secrets \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=POSTGRES_DB=tenant_saas \
  --from-literal=APP_DB_USER=tenant_saas_app \
  --from-literal=APP_DB_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=GITHUB_CLIENT_ID='<github-client-id>' \
  --from-literal=GITHUB_CLIENT_SECRET='<github-client-secret>'
kubectl apply -k deploy/kubernetes
kubectl -n tenant-saas rollout status statefulset/postgres
kubectl -n tenant-saas rollout status deployment/tenant-saas
curl --fail http://127.0.0.1:30302/health/ready
```

The host-side Cloudflare Tunnel route is:

```yaml
- hostname: saas.octomblog.com
  service: http://127.0.0.1:30302
```

PostgreSQL initializes a separate, non-superuser application role. The
application runs schema migrations through that role. Contract rows and audit
events have PostgreSQL Row-Level Security enabled with `FORCE ROW LEVEL
SECURITY`; every content query runs inside a transaction whose tenant setting
comes from server-verified membership.
