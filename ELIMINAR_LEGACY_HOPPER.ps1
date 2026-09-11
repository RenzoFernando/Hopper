param(
  [switch]$DisableGitHubPages
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "hopper-admin.ps1"))) {
  throw "Ejecuta este script desde la raíz del proyecto Hopper."
}

$obsolete = @(
  ".github\workflows\legacy-github-pages-redirect.yml",
  "scripts\build-legacy-redirect.mjs",
  "scripts\phase5-check.mjs",
  ".hopper-phase5-rollback.json",
  ".phase5-github-pages",
  "admin.html",
  "recover.html",
  "room.html",
  "share-target.html",
  "service-worker.js",
  "manifest.webmanifest",
  "css",
  "js",
  "modern",
  "public\assets",
  "scripts\serve-legacy.mjs",
  ".github\workflows\preview-frontend.yml",
  "tests\e2e\phase-three-pwa.spec.ts",
  "tests\e2e\visual-regression.spec.ts",
  "tests\unit\layout-parity.test.tsx",
  "tests\unit\style-freeze.test.ts",
  "tests\unit\phase-five-production.test.ts",
  "tests\unit\phase-three-navigation.test.ts"
)

foreach ($relative in $obsolete) {
  $path = Join-Path $PSScriptRoot $relative

  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Host "Eliminado: $relative"
  }
}

$configPath = Join-Path $PSScriptRoot ".hopper-admin.json"
if (Test-Path -LiteralPath $configPath) {
  try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $legacyProperties = @(
      "legacyPublicAppUrl",
      "cutoverComplete",
      "legacyRedirectVerified",
      "cleanFrontendUrls"
    )

    foreach ($propertyName in $legacyProperties) {
      if ($config.PSObject.Properties.Name -contains $propertyName) {
        $config.PSObject.Properties.Remove($propertyName)
      }
    }

    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText(
      $configPath,
      ($config | ConvertTo-Json -Depth 8),
      $encoding
    )
    Write-Host "Configuración local saneada: .hopper-admin.json"
  } catch {
    Write-Warning "No se pudo sanear .hopper-admin.json: $($_.Exception.Message)"
  }
}

if ($DisableGitHubPages) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue

  if (-not $gh) {
    throw "GitHub CLI (gh) no está disponible. Instálalo o ejecuta el script sin -DisableGitHubPages."
  }

  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI no está autenticado. Ejecuta 'gh auth login'."
  }

  $repo = (& gh repo view --json nameWithOwner --jq ".nameWithOwner" 2>$null | Out-String).Trim()
  if (-not $repo) {
    throw "No fue posible resolver el repositorio GitHub actual."
  }

  & gh api --method DELETE "repos/$repo/pages" *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "GitHub Pages deshabilitado para $repo."
  } else {
    Write-Warning "GitHub Pages no pudo deshabilitarse automáticamente o ya estaba deshabilitado."
  }
}

$validator = Join-Path $PSScriptRoot "scripts\project-check.mjs"
if (Test-Path -LiteralPath $validator) {
  & node $validator
  if ($LASTEXITCODE -ne 0) {
    throw "La validación estructural final falló."
  }
}

Write-Host "Limpieza legacy completada."
