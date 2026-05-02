locals {
  labels = merge(
    { app = var.project_name, managed_by = "terraform" },
    var.extra_labels,
  )

  ssh_keys_indexed = { for idx, key in var.ssh_public_keys : tostring(idx) => key }

  # Sorted for stable output across applies; same format Docker --env-file expects.
  env_file_content = join("\n", [
    for k in sort(keys(var.app_env)) : "${k}=${var.app_env[k]}"
  ])
}

resource "hcloud_ssh_key" "this" {
  for_each   = local.ssh_keys_indexed
  name       = "${var.project_name}-${each.key}"
  public_key = each.value
  labels     = local.labels
}

resource "hcloud_volume" "data" {
  name     = "${var.project_name}-data"
  size     = var.volume_size_gb
  location = var.location
  format   = "ext4"
  labels   = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_firewall" "this" {
  name   = "${var.project_name}-fw"
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }
}

resource "hcloud_server" "app" {
  name         = var.project_name
  image        = var.image
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = [for k in hcloud_ssh_key.this : k.id]
  firewall_ids = [hcloud_firewall.this.id]
  labels       = local.labels

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    project_name             = var.project_name
    docker_image             = var.docker_image
    docker_registry          = var.docker_registry
    docker_registry_username = var.docker_registry_username
    docker_registry_password = var.docker_registry_password
    volume_id                = hcloud_volume.data.id
    app_env                  = var.app_env
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  lifecycle {
    # user_data is consumed only on first boot. Changing app_env, docker_image,
    # etc. would otherwise force a VM replacement. Config drift after the
    # initial apply is reconciled out of band:
    #   - app_env  -> null_resource.env_sync below (file push + service restart)
    #   - image    -> `ssh root@... systemctl restart <project>` (unit re-pulls)
    ignore_changes = [user_data]
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.app.id
  automount = false
}

# Pushes /etc/<project>/env on every app_env change and restarts the service.
# Requires SSH reachability from wherever Terraform runs. Uses ssh-agent /
# default keys; no extra variables needed.
resource "null_resource" "env_sync" {
  triggers = {
    env_hash  = sha256(local.env_file_content)
    server_id = hcloud_server.app.id
  }

  connection {
    type    = "ssh"
    user    = "root"
    host    = hcloud_server.app.ipv4_address
    timeout = "5m"
  }

  # Wait for cloud-init to finish on the very first apply so /etc/<project>/
  # exists and the systemd unit is registered.
  provisioner "remote-exec" {
    inline = [
      "cloud-init status --wait >/dev/null 2>&1 || true",
      "mkdir -p /etc/${var.project_name}",
    ]
  }

  provisioner "file" {
    content     = local.env_file_content
    destination = "/etc/${var.project_name}/env"
  }

  provisioner "remote-exec" {
    inline = [
      "chmod 600 /etc/${var.project_name}/env",
      "systemctl restart ${var.project_name}.service",
    ]
  }

  depends_on = [hcloud_volume_attachment.data]
}
