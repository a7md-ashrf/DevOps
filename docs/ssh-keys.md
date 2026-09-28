# SSH keys & secrets

Three different credentials exist in this system — don't mix them up:

| Credential                  | Where it lives                 | Used by                     | Grants                          |
| --------------------------- | ------------------------------ | --------------------------- | ------------------------------- |
| **Deploy key** (ed25519)    | GitHub secret `VPS_SSH_KEY`    | Actions → VPS               | shell on the VPS as `VPS_USER`  |
| **GHCR pull creds**         | VPS `~/.docker/config.json`    | VPS → ghcr.io               | `read:packages` only            |
| **Docker Hub mirror creds** | GitHub secrets (optional)      | Actions → docker.io         | push to your namespace          |

There is intentionally **no** long-lived GitHub *write* credential anywhere:
CI uses the ephemeral `GITHUB_TOKEN` for package pushes, and the VPS can't
call back into GitHub at all.

## 1. Generate the deploy key (on your machine)

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/devops_deploy -N ""
# -> ~/.ssh/devops_deploy      (private: becomes VPS_SSH_KEY)
# -> ~/.ssh/devops_deploy.pub  (public: goes to the VPS)
```

Ed25519 (small, fast, modern), no passphrase — it's a CI-only key; protect
it by scope, not by a secret you'd have to paste into CI anyway.

## 2. Authorize it on the VPS

```bash
# as your server user (deploy):
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys < ~/.ssh/devops_deploy.pub   # paste manually if copying
chmod 600 ~/.ssh/authorized_keys
```

Permissions matter — OpenSSH silently refuses overly-open files:
`~/.ssh` 700, `authorized_keys` 600, private keys 600.

The user must be in the `docker` group (step 1 of
[vps-setup.md](vps-setup.md)) — `deploy.sh` runs `docker compose`.

Test from the machine that generated it:

```bash
ssh -i ~/.ssh/devops_deploy -p 22 deploy@yourdomain.com 'echo ok'
```

## 3. Capture the host key (`known_hosts`)

The Actions runner must verify the server's identity — two ways:

**Recommended (pin it):**

```bash
ssh-keyscan -p 22 yourdomain.com
# verify the fingerprints against your provider's panel / first-login notice:
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub     # on the VPS
```

Store the `ssh-keyscan` output verbatim in the `VPS_KNOWN_HOSTS` secret
(newlines preserved).

**Fallback:** leave `VPS_KNOWN_HOSTS` empty — the workflow warns and runs
`ssh-keyscan` at deploy time (trust-on-first-use; acceptable for a single
low-value host, but pinning closes the MITM window during first contact).

## 4. GitHub repository configuration

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret           | Required | Value                                        |
| ---------------- | -------- | -------------------------------------------- |
| `VPS_HOST`       | ✔        | IP or FQDN (must match the keyscan name)      |
| `VPS_USER`       | ✔        | e.g. `deploy`                                 |
| `VPS_SSH_KEY`    | ✔        | full private key, `-----BEGIN …-----` included|
| `VPS_PORT`       | optional | default `22`                                  |
| `VPS_KNOWN_HOSTS`| optional | pinned host key(s) — recommended              |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | optional | enables the Release **mirror** job |

**Variables** (same page, "Variables" tab):

| Variable        | Default                 | Meaning                          |
| --------------- | ----------------------- | -------------------------------- |
| `VPS_DEPLOY_DIR`| `/srv/devops-reference` | where the repo lives on the VPS  |

How the private key is handled in the workflow (see `deploy.yml`):

- written to `$RUNNER_TEMP`-adjacent `~/.ssh/vps_key` with `chmod 600`
  **only after** the secrets check passes;
- `IdentitiesOnly=yes` so other agent keys on the runner can't interfere;
- deleted in an `if: always()` cleanup step (runners are ephemeral anyway —
  defense in depth, not the only barrier).

## 5. GHCR pull access on the VPS (private packages)

Registry images are the *only* thing the VPS fetches over the network
besides git. Either make the packages public (Settings → Packages →
Visibility) or, per user:

```bash
# on the VPS
docker login ghcr.io -u <github-user>
# password: classic PAT with read:packages (no other scopes!)
```

Stored in `~/.docker/config.json` (root or the deploying user — whoever runs
`deploy.sh`; if you deploy as `deploy`, log in **as that user**).

Rotation: revoke the PAT, log in again. Nothing else references it.

## 6. Git access on the VPS

`deploy.sh` runs `git pull --ff-only origin main`, so the checkout needs
read access:

- **Public repo:** clone URL is enough.
- **Private repo:** deploy key (GitHub → Settings → Deploy keys → *Add
  deploy key*, read-only) on the VPS:

  ```bash
  ssh-keygen -t ed25519 -C "vps-deploy-key" -f ~/.ssh/repo_deploy -N ""
  # paste repo_deploy.pub into GitHub Deploy keys (read-only, no write)
  cd /srv/devops-reference
  git config core.sshCommand "ssh -i ~/.ssh/repo_deploy"
  ```

This is a *different* key from the Actions deploy key in §1 — read-only repo
access vs. shell access to the server; compromise of one never implies the
other.

## 7. Rotation & revocation

| Event                       | Action                                                 |
| --------------------------- | ------------------------------------------------------ |
| Laptop lost                 | remove `VPS_SSH_KEY` secret; delete pubkey from `authorized_keys` |
| Person left the team        | rotate VPS user key + GitHub secrets; check `authorized_keys`    |
| Suspected leak              | revoke PATs first (registry), then keys; audit `last`/`auth.log`  |
| Routine (quarterly)         | regenerate deploy key → update secret + `authorized_keys`         |

Audit logins at any time:

```bash
sudo last -20 && sudo grep Accepted /var/log/auth.log | tail -20
```

## Local convenience (optional)

`~/.ssh/config` on your machine:

```
Host devops-vps
    HostName yourdomain.com
    User deploy
    IdentityFile ~/.ssh/devops_deploy
    Port 22
```

Then `ssh devops-vps`, `rsync`, and the runbook's ad-hoc commands all get
shorter.
