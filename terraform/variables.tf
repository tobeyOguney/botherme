variable "hcloud_token" {
  description = "Hetzner Cloud API token. Set via TF_VAR_hcloud_token or HCLOUD_TOKEN."
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "Logical name. Used for VM name, labels, env file path, and systemd unit."
  type        = string
  default     = "botherme"
}

variable "location" {
  description = "Hetzner Cloud datacentre location (fsn1, nbg1, hel1, ash, hil, sin)."
  type        = string
  default     = "fsn1"
}

variable "server_type" {
  description = <<-EOT
    Hetzner server type. Cheapest options as of 2026:
      cpx11 = 2 vCPU / 2 GB AMD  (~€4/mo, widely available)
      cax11 = 2 vCPU / 4 GB ARM  (~€4/mo, requires arm64 image)
      cx22  = 2 vCPU / 4 GB Intel (sporadically out of stock per DC)
    Run `hcloud server-type list` to see what's actually available.
  EOT
  type        = string
  default     = "cpx11"
}

variable "image" {
  description = "Base OS image. Cloud-init script targets Ubuntu/Debian."
  type        = string
  default     = "ubuntu-24.04"
}

variable "volume_size_gb" {
  description = "Persistent volume size in GB. Hetzner minimum is 10."
  type        = number
  default     = 10
  validation {
    condition     = var.volume_size_gb >= 10
    error_message = "Hetzner Cloud volumes must be at least 10 GB."
  }
}

variable "ssh_public_keys" {
  description = "List of OpenSSH public keys (the actual key strings) authorised on the VM."
  type        = list(string)
  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "Provide at least one SSH public key — there is no console password."
  }
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs permitted to reach SSH (TCP/22). Tighten to your IP for production."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "docker_image" {
  description = "Fully-qualified container image reference, e.g. ghcr.io/owner/botherme:latest"
  type        = string
}

variable "docker_registry" {
  description = "Registry hostname for `docker login`. Leave empty for public images."
  type        = string
  default     = ""
}

variable "docker_registry_username" {
  description = "Username for `docker login` (e.g. GitHub username for GHCR)."
  type        = string
  default     = ""
}

variable "docker_registry_password" {
  description = "Password or PAT for `docker login`. Sensitive."
  type        = string
  default     = ""
  sensitive   = true
}

variable "app_env" {
  description = <<-EOT
    Environment variables passed to the container. Required keys for botherMe:
    ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN. All BOTHERME_* overrides accepted.
  EOT
  type        = map(string)
  sensitive   = true
}

variable "extra_labels" {
  description = "Additional Hetzner labels merged onto the server resource."
  type        = map(string)
  default     = {}
}
