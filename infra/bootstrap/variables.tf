variable "region" {
  description = "Where the state bucket lives; the same region infra/prod uses."
  type        = string
  default     = "eu-west-1"
}

variable "github_repo" {
  description = "owner/name of the repository whose workflows may assume the roles."
  type        = string
  default     = "fairglen/spacerental"
}
