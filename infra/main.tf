# IaC for Ølympiske Leker (App Service B1 + Storage) inside an EXISTING
# resource group — requires only Owner/Contributor on that resource group.
#
# Usage:
#   az login
#   terraform init
#   terraform apply -var "event_pin=1234" -var "admin_code=change-me"
#
# Off-season: scale down or stop the app to save money:
#   az appservice plan update -g rg-rune-sin-sandkasse -n plan-oelympiske-leker --sku F1   (or)
#   az webapp stop -g rg-rune-sin-sandkasse -n <app>

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = "24721414-40ad-41f7-ab9d-8b4e519ed12b"
  # No subscription-level rights needed: skip resource provider registration
  resource_provider_registrations = "none"
}

variable "resource_group_name" {
  default = "rg-rune-sin-sandkasse"
}

variable "app_name" {
  description = "Globally unique web app name"
  default     = "oelympiske-leker"
}

variable "event_pin" {
  sensitive = true
}

variable "admin_code" {
  sensitive = true
}

variable "sku_name" {
  description = "App Service plan SKU (F1 free / B1 basic). always_on is disabled automatically on F1."
  default     = "B1"
}

variable "app_location" {
  description = "Region for the App Service plan + web app (subscription has no App Service quota in norwayeast)"
  default     = "westeurope"
}

data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}

# Suffix keeps globally-unique names (web app, storage) collision-free
resource "random_string" "suffix" {
  length  = 5
  special = false
  upper   = false
}

resource "azurerm_storage_account" "main" {
  name                     = substr(replace("st${var.app_name}${random_string.suffix.result}", "-", ""), 0, 24)
  resource_group_name      = data.azurerm_resource_group.main.name
  location                 = data.azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "main" {
  name                = "plan-oelympiske-leker"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.app_location
  os_type             = "Linux"
  sku_name            = var.sku_name
}

resource "azurerm_linux_web_app" "main" {
  name                = "${var.app_name}-${random_string.suffix.result}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.app_location
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true

  site_config {
    always_on = var.sku_name != "F1" # not supported on Free tier
    application_stack {
      node_version = "20-lts"
    }
  }

  app_settings = {
    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.main.primary_connection_string
    EVENT_PIN                       = var.event_pin
    ADMIN_CODE                      = var.admin_code
    SCM_DO_BUILD_DURING_DEPLOYMENT  = "true"
  }
}

output "app_url" {
  value = "https://${azurerm_linux_web_app.main.default_hostname}"
}

output "app_name" {
  value = azurerm_linux_web_app.main.name
}
