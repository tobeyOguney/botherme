output "server_id" {
  description = "Hetzner Cloud server ID."
  value       = hcloud_server.app.id
}

output "server_ipv4" {
  description = "Public IPv4 address of the VM."
  value       = hcloud_server.app.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address of the VM."
  value       = hcloud_server.app.ipv6_address
}

output "ssh_command" {
  description = "Convenience SSH command."
  value       = "ssh root@${hcloud_server.app.ipv4_address}"
}

output "volume_id" {
  description = "Hetzner Volume ID holding /data, /users, /traces."
  value       = hcloud_volume.data.id
}
