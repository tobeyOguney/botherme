locals {
  labels = merge(
    { app = var.project_name, managed_by = "terraform" },
    var.extra_labels,
  )

  ssh_keys_indexed = { for idx, key in var.ssh_public_keys : tostring(idx) => key }
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
    # The volume_id is interpolated into user_data; rebuilding the VM on
    # cloud-init changes is intentional — that's how config gets applied.
    ignore_changes = []
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.app.id
  automount = false
}
