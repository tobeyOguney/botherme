# Hetzner Cloud deployment

A self-contained Terraform module that runs `botherMe` (or any Docker image
of a similar shape — a long-running container with no inbound HTTP and a few
on-disk directories) on a single Hetzner Cloud VM.

## What it provisions

- One `hcloud_server` (default `cx22`, Ubuntu 24.04 LTS).
- One `hcloud_volume` (default 10 GB, ext4) attached at `/mnt/data`. Survives
  VM destroy/recreate. `prevent_destroy = true` is set on the volume.
- One `hcloud_firewall` allowing only inbound SSH from `ssh_allowed_cidrs`.
- `hcloud_ssh_key` resources for each entry in `ssh_public_keys`.
- A `cloud-init` script that installs Docker, formats and mounts the volume,
  writes the app env file, and runs the container under a systemd unit named
  after `var.project_name`.

The container is started with:

```
docker run --rm --name <project_name> \
  --env-file /etc/<project_name>/env \
  -v /mnt/data/data:/data \
  -v /mnt/data/users:/users \
  -v /mnt/data/traces:/traces \
  <docker_image>
```

## Prerequisites

1. A Hetzner Cloud project and an [API token](https://docs.hetzner.cloud/#getting-started)
   with **read & write** scope.
2. Terraform `>= 1.6`.
3. The application image already published to a registry. For botherMe the
   default CI workflow (`.github/workflows/docker.yml`) pushes to
   `ghcr.io/<owner>/botherme`. Note: GHCR packages start **private** even
   when the source repo is public — flip it under
   `https://github.com/users/<owner>/packages/container/botherme/settings`
   if you want unauthenticated pulls. Otherwise set the
   `docker_registry_*` variables with a `read:packages` PAT.
4. An SSH key pair on your machine — the public key goes into
   `ssh_public_keys`.

## First deploy

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars: set docker_image, ssh_public_keys, location.
# Keep secrets out of the file by exporting them instead:
export TF_VAR_hcloud_token='...'
export TF_VAR_app_env='{
  ANTHROPIC_API_KEY  = "sk-ant-..."
  TELEGRAM_BOT_TOKEN = "12345:ABC..."
}'

terraform init
terraform apply
```

Apply takes ~60 seconds. Cloud-init then needs another ~90 seconds to
install Docker and pull the image. Watch progress on the box:

```bash
ssh root@$(terraform output -raw server_ipv4) \
  'tail -f /var/log/cloud-init-output.log'
```

Once `botherme.service` is `active (running)`, send `/start` to the bot in
Telegram to confirm.

## Updating the app

The systemd unit re-pulls the image each time it starts, so the simplest
update is:

```bash
ssh root@$(terraform output -raw server_ipv4) systemctl restart botherme
```

This works whenever you push a new image to the same tag (e.g. `:latest`).
For pinned tags, bump `docker_image` in `terraform.tfvars` and
`terraform apply` (cloud-init has already run, so a tag change won't trigger
a re-deploy on its own — restart the service after applying).

## Updating infrastructure

Most variable changes (firewall CIDRs, additional SSH keys, server type)
apply in place or trigger a server replacement. The volume is preserved
across replacements thanks to `prevent_destroy`.

## Backups

Hetzner Cloud doesn't offer volume snapshots. Two options:

- **Server backups** (`hcloud_server.backups = true`) — 20% surcharge,
  weekly snapshot of the *boot* disk. Volumes are **not** included, so this
  alone is insufficient.
- **rsync to off-box storage** — recommended. A nightly cron on the VM that
  copies `/mnt/data` to S3/Backblaze/Hetzner Storage Box gives you point-in-
  time recovery for the data that actually matters. SQLite should be backed
  up via `sqlite3 botherme.sqlite ".backup ..."` rather than a raw file copy
  to avoid WAL inconsistencies.

## State file safety

Both `hcloud_token` and `app_env` end up in `terraform.tfstate` in plaintext.
Two reasonable postures:

- **Local state**, gitignored. Fine for solo deployments. Back up the state
  file separately (e.g. `pass`, 1Password).
- **Encrypted remote backend** (S3 with SSE-KMS, or `terraform cloud`). Required
  for any team or CI use.

The repo's `.gitignore` ignores `terraform/terraform.tfvars`,
`terraform/.terraform/`, and `terraform/*.tfstate*` so neither secrets nor
state get committed by accident.

## Forking for another project

Three changes get you a deployment for an unrelated Node bot/worker:

1. Replace the `Dockerfile` and `.github/workflows/docker.yml` image name.
2. Set `var.docker_image` and `var.project_name` in `terraform.tfvars`.
3. Set `var.app_env` to your project's env keys.

The cloud-init template references the project only via these variables —
no Terraform changes needed for a typical Node container.

## Costs (approximate, EUR, May 2026)

| Resource | Monthly |
|---|---|
| `cpx11` server (default) | ~€4.00 |
| 10 GB volume | ~€0.40 |
| IPv4 address | ~€0.50 |
| **Total** | **~€4.90** |

Switch `server_type` to `cax11` (arm64, 4 GB RAM) for similar pricing if your
image supports `linux/arm64`. The CI workflow above only builds `amd64`;
add `platforms: linux/amd64,linux/arm64` to `build-push-action` to enable
multi-arch.

Hetzner occasionally pulls server types from individual datacentres. If
`terraform apply` fails with `server type X not found`, try a different
`location` (`fsn1` / `nbg1` / `hel1` / `ash` / `hil` / `sin`) or pick another
type from `hcloud server-type list`.

## Tearing down

```bash
terraform destroy
```

The volume has `prevent_destroy = true`, so destroy will fail until you
either remove it from the lifecycle block or run
`terraform state rm hcloud_volume.data` (and clean it up manually in the
Hetzner console). This is intentional — it makes "I just wanted to rebuild
the VM" safe.
