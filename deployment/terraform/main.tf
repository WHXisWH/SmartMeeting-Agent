# SmartMeet AI Agent Google Cloud Infrastructure
terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud Region"
  type        = string
  default     = "asia-northeast1"
}

variable "domain_name" {
  description = "Custom domain for the application"
  type        = string
  default     = ""
}

# Configure the Google Cloud Provider
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudfunctions.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com",
    "calendar-json.googleapis.com",
    "gmail.googleapis.com",
    "drive.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudbuild.googleapis.com"
  ])

  service = each.value
  project = var.project_id
  
  disable_on_destroy = false
}

# Service Account for SmartMeet Agent
resource "google_service_account" "smartmeet_agent" {
  account_id   = "smartmeet-agent"
  display_name = "SmartMeet AI Agent Service Account"
  description  = "Service account for SmartMeet AI Agent with required permissions"
}

# IAM bindings for the service account
resource "google_project_iam_member" "agent_permissions" {
  for_each = toset([
    "roles/aiplatform.user",
    "roles/datastore.user",
    "roles/pubsub.publisher",
    "roles/pubsub.subscriber",
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter"
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.smartmeet_agent.email}"
}

# Firestore Database (if not already exists)
resource "google_firestore_database" "smartmeet_db" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  
  depends_on = [google_project_service.required_apis]
}

# Pub/Sub Topics
resource "google_pubsub_topic" "agent_events" {
  name = "agent-events"
  
  depends_on = [google_project_service.required_apis]
}

resource "google_pubsub_topic" "gmail_notifications" {
  name = "gmail-notifications"
  
  depends_on = [google_project_service.required_apis]
}

# Pub/Sub Subscriptions
resource "google_pubsub_subscription" "agent_events_subscription" {
  name  = "agent-events-subscription"
  topic = google_pubsub_topic.agent_events.name
  
  ack_deadline_seconds = 60
  
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.agent_events_dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic" "agent_events_dead_letter" {
  name = "agent-events-dead-letter"
}

# Secret Manager Secrets
resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "jwt-secret"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret" "webhook_token" {
  secret_id = "webhook-token"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = "google-client-secret"
  
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Storage bucket for frontend hosting
resource "google_storage_bucket" "frontend_bucket" {
  name     = "${var.project_id}-smartmeet-frontend"
  location = var.region
  
  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
  
  uniform_bucket_level_access = true
}

resource "google_storage_bucket_iam_member" "frontend_public" {
  bucket = google_storage_bucket.frontend_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Cloud Scheduler Jobs
resource "google_cloud_scheduler_job" "agent_health_check" {
  name        = "agent-health-check"
  description = "定时检查Agent健康状态"
  schedule    = "*/15 * * * *"  # 每15分钟执行一次
  time_zone   = "UTC"
  
  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-${var.project_id}.cloudfunctions.net/agentHealthCheck"
    
    headers = {
      "Content-Type" = "application/json"
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

resource "google_cloud_scheduler_job" "cleanup_expired_data" {
  name        = "cleanup-expired-data"
  description = "清理过期数据"
  schedule    = "0 2 * * *"  # 每天凌晨2点执行
  time_zone   = "UTC"
  
  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-${var.project_id}.cloudfunctions.net/cleanupExpiredData"
    
    headers = {
      "Content-Type" = "application/json"
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Run Service
resource "google_cloud_run_service" "smartmeet_agent_brain" {
  name     = "smartmeet-agent-brain"
  location = var.region
  
  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/smartmeet-agent-brain:latest"
        
        ports {
          container_port = 8080
        }
        
        env {
          name  = "GOOGLE_CLOUD_PROJECT_ID"
          value = var.project_id
        }
        
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        
        resources {
          limits = {
            cpu    = "2000m"
            memory = "4Gi"
          }
        }
      }
      
      service_account_name = google_service_account.smartmeet_agent.email
    }
    
    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "1"
        "autoscaling.knative.dev/maxScale" = "10"
        "run.googleapis.com/cpu-throttling" = "false"
      }
    }
  }
  
  traffic {
    percent         = 100
    latest_revision = true
  }
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Run IAM
resource "google_cloud_run_service_iam_binding" "invoker" {
  location = google_cloud_run_service.smartmeet_agent_brain.location
  project  = google_cloud_run_service.smartmeet_agent_brain.project
  service  = google_cloud_run_service.smartmeet_agent_brain.name
  role     = "roles/run.invoker"
  members = [
    "allUsers",
  ]
}

# Cloud Functions
resource "google_cloudfunctions_function" "calendar_webhook" {
  name        = "calendar-webhook"
  description = "Handle Google Calendar webhook notifications"
  runtime     = "nodejs18"
  region      = var.region

  available_memory_mb   = 256
  source_archive_bucket = google_storage_bucket.functions_bucket.name
  source_archive_object = google_storage_bucket_object.calendar_webhook_zip.name
  
  trigger {
    https_trigger {
      security_level = "SECURE_ALWAYS"
    }
  }
  
  entry_point = "handleCalendarWebhook"
  
  environment_variables = {
    GOOGLE_CLOUD_PROJECT_ID = var.project_id
  }
  
  service_account_email = google_service_account.smartmeet_agent.email
  
  depends_on = [google_project_service.required_apis]
}

resource "google_cloudfunctions_function" "gmail_webhook" {
  name        = "gmail-webhook"
  description = "Handle Gmail push notifications"
  runtime     = "nodejs18"
  region      = var.region

  available_memory_mb   = 256
  source_archive_bucket = google_storage_bucket.functions_bucket.name
  source_archive_object = google_storage_bucket_object.gmail_webhook_zip.name
  
  trigger {
    https_trigger {
      security_level = "SECURE_ALWAYS"
    }
  }
  
  entry_point = "handleGmailWebhook"
  
  environment_variables = {
    GOOGLE_CLOUD_PROJECT_ID = var.project_id
  }
  
  service_account_email = google_service_account.smartmeet_agent.email
  
  depends_on = [google_project_service.required_apis]
}

resource "google_cloudfunctions_function" "agent_health_check" {
  name        = "agentHealthCheck"
  description = "Agent health check function"
  runtime     = "nodejs18"
  region      = var.region

  available_memory_mb   = 128
  source_archive_bucket = google_storage_bucket.functions_bucket.name
  source_archive_object = google_storage_bucket_object.calendar_webhook_zip.name
  
  trigger {
    https_trigger {
      security_level = "SECURE_ALWAYS"
    }
  }
  
  entry_point = "agentHealthCheck"
  
  environment_variables = {
    GOOGLE_CLOUD_PROJECT_ID = var.project_id
  }
  
  service_account_email = google_service_account.smartmeet_agent.email
  
  depends_on = [google_project_service.required_apis]
}

# Storage bucket for Cloud Functions source code
resource "google_storage_bucket" "functions_bucket" {
  name     = "${var.project_id}-smartmeet-functions"
  location = var.region
}

# Zip and upload Cloud Function source
data "archive_file" "calendar_webhook_zip" {
  type        = "zip"
  output_path = "/tmp/calendar-webhook.zip"
  source_dir  = "../cloud-functions/calendar-webhook"
}

resource "google_storage_bucket_object" "calendar_webhook_zip" {
  name   = "calendar-webhook-${data.archive_file.calendar_webhook_zip.output_md5}.zip"
  bucket = google_storage_bucket.functions_bucket.name
  source = data.archive_file.calendar_webhook_zip.output_path
}

data "archive_file" "gmail_webhook_zip" {
  type        = "zip"
  output_path = "/tmp/gmail-webhook.zip"
  source_dir  = "../cloud-functions/calendar-webhook"  # 复用同一个函数
}

resource "google_storage_bucket_object" "gmail_webhook_zip" {
  name   = "gmail-webhook-${data.archive_file.gmail_webhook_zip.output_md5}.zip"
  bucket = google_storage_bucket.functions_bucket.name
  source = data.archive_file.gmail_webhook_zip.output_path
}

# Outputs
output "agent_brain_url" {
  value = google_cloud_run_service.smartmeet_agent_brain.status[0].url
}

output "calendar_webhook_url" {
  value = google_cloudfunctions_function.calendar_webhook.https_trigger_url
}

output "gmail_webhook_url" {
  value = google_cloudfunctions_function.gmail_webhook.https_trigger_url
}

output "frontend_bucket_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.frontend_bucket.name}/index.html"
}

output "service_account_email" {
  value = google_service_account.smartmeet_agent.email
}