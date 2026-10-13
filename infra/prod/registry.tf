# One repository per image; `sha-<7>` tags for every deployed commit, `main`
# moved on each deploy, `buildcache` for buildx's registry cache. Mutable
# because `main` and `buildcache` move; the deploy script only ever pulls a
# `sha-` tag.

resource "aws_ecr_repository" "images" {
  for_each = toset(["backend", "frontend"])

  name                 = "spacerental/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "keep_last_10" {
  for_each = aws_ecr_repository.images

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the last 10 images (rollback targets), expire the rest"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
