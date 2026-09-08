param(
  [ValidateSet("menu", "setup", "init", "deploy", "status", "lock", "unlock", "change-pin", "block", "unblock", "events", "email", "r2", "cors", "cleanup", "url")]
  [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$configPath = Join-Path $PSScriptRoot ".hopper-admin.json"
$deployConfigPath = Join-Path $PSScriptRoot ".hopper-wrangler.json"
$r2CorsPath = Join-Path $PSScriptRoot ".hopper-r2-cors.json"
$schemaPath = Join-Path $PSScriptRoot "cloudflare\schema.sql"
$frontendConfigPath = Join-Path $PSScriptRoot "js\config.js"

$script:DatabaseName = ""
$script:DatabaseId = ""
$script:R2BucketName = ""
$script:R2AccountId = ""
$script:WorkerName = ""
$script:WorkerUrl = ""
$script:PublicAppUrl = ""
$script:AllowedOrigin = ""
$script:MaxFileBytes = [long](512MB)
$script:SessionSecretConfigured = $false
$script:R2SecretConfigured = $false
$script:RecoveryConfigured = $false

function Invoke-Wrangler {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & npx --yes wrangler @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler terminó con código $LASTEXITCODE."
  }
}

function Ensure-CloudflareLogin {
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "No se encontró npx. Instala Node.js antes de ejecutar este administrador."
  }

  & npx --yes wrangler whoami *> $null

  if ($LASTEXITCODE -ne 0) {
    Invoke-Wrangler login
  }
}

function Read-Config {
  if (-not (Test-Path $configPath)) {
    return $null
  }

  try {
    return Get-Content $configPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Load-Config {
  $config = Read-Config

  if (-not $config) {
    return
  }

  $script:DatabaseName = [string]$config.databaseName
  $script:DatabaseId = [string]$config.databaseId
  $script:R2BucketName = [string]$config.r2BucketName
  $script:R2AccountId = [string]$config.r2AccountId
  $script:WorkerName = [string]$config.workerName
  $script:WorkerUrl = [string]$config.workerUrl
  $script:PublicAppUrl = [string]$config.publicAppUrl
  $script:AllowedOrigin = [string]$config.allowedOrigin

  if ($config.maxFileBytes) {
    $script:MaxFileBytes = [long]$config.maxFileBytes
  }

  $script:SessionSecretConfigured = [bool]$config.sessionSecretConfigured
  $script:R2SecretConfigured = [bool]$config.r2SecretConfigured
  $script:RecoveryConfigured = [bool]$config.recoveryConfigured
}

function Save-Config {
  $payload = [ordered]@{
    databaseName = $script:DatabaseName
    databaseId = $script:DatabaseId
    r2BucketName = $script:R2BucketName
    r2AccountId = $script:R2AccountId
    workerName = $script:WorkerName
    workerUrl = $script:WorkerUrl
    publicAppUrl = $script:PublicAppUrl
    allowedOrigin = $script:AllowedOrigin
    maxFileBytes = $script:MaxFileBytes
    sessionSecretConfigured = $script:SessionSecretConfigured
    r2SecretConfigured = $script:R2SecretConfigured
    recoveryConfigured = $script:RecoveryConfigured
  }

  $payload | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
}

function Get-Databases {
  $raw = (& npx --yes wrangler d1 list --json 2>$null | Out-String)

  if ($LASTEXITCODE -ne 0 -or -not $raw.Trim()) {
    throw "No fue posible listar las bases D1."
  }

  $parsed = $raw | ConvertFrom-Json

  if ($parsed -is [System.Array]) {
    return @($parsed)
  }

  if ($parsed.result) {
    return @($parsed.result)
  }

  return @($parsed)
}

function Select-Database {
  $databases = @(Get-Databases)

  if ($script:DatabaseName) {
    $saved = @($databases | Where-Object { $_.name -eq $script:DatabaseName })

    if ($saved.Count -eq 1) {
      $script:DatabaseName = [string]$saved[0].name
      $script:DatabaseId = [string]$saved[0].uuid
      Save-Config
      return
    }
  }

  foreach ($preferredName in @("hopper-db", "hopper-security-db")) {
    $exact = @($databases | Where-Object { $_.name -eq $preferredName })

    if ($exact.Count -eq 1) {
      $script:DatabaseName = [string]$exact[0].name
      $script:DatabaseId = [string]$exact[0].uuid
      Save-Config
      return
    }
  }

  $hopperDatabases = @($databases | Where-Object { $_.name -match "hopper" })

  if ($hopperDatabases.Count -eq 1) {
    $script:DatabaseName = [string]$hopperDatabases[0].name
    $script:DatabaseId = [string]$hopperDatabases[0].uuid
    Save-Config
    return
  }

  if ($hopperDatabases.Count -eq 0) {
    $answer = (Read-Host "No existe una D1 de Hopper. ¿Crear hopper-db? [S/n]").Trim().ToLowerInvariant()

    if (-not $answer -or $answer -eq "s" -or $answer -eq "si" -or $answer -eq "sí" -or $answer -eq "y" -or $answer -eq "yes") {
      Invoke-Wrangler d1 create hopper-db
      $databases = @(Get-Databases)
      $created = @($databases | Where-Object { $_.name -eq "hopper-db" })

      if ($created.Count -ne 1) {
        throw "La base D1 se creó, pero no fue posible resolver su identificador."
      }

      $script:DatabaseName = [string]$created[0].name
      $script:DatabaseId = [string]$created[0].uuid
      Save-Config
      return
    }
  }

  $candidates = if ($hopperDatabases.Count -gt 0) { $hopperDatabases } else { $databases }

  if ($candidates.Count -eq 0) {
    throw "La cuenta no tiene bases D1 disponibles."
  }

  Write-Host "Bases D1 disponibles:"

  for ($index = 0; $index -lt $candidates.Count; $index += 1) {
    Write-Host "[$($index + 1)] $($candidates[$index].name)"
  }

  $selection = [int](Read-Host "Selecciona la base de Hopper")

  if ($selection -lt 1 -or $selection -gt $candidates.Count) {
    throw "Selección inválida."
  }

  $script:DatabaseName = [string]$candidates[$selection - 1].name
  $script:DatabaseId = [string]$candidates[$selection - 1].uuid
  Save-Config
}

function Test-R2Bucket {
  param([string]$Name)

  if (-not $Name) {
    return $false
  }

  & npx --yes wrangler r2 bucket info $Name --json *> $null
  return $LASTEXITCODE -eq 0
}

function Select-R2Bucket {
  if ($script:R2BucketName -and (Test-R2Bucket $script:R2BucketName)) {
    return
  }

  $defaultName = if ($script:R2BucketName) { $script:R2BucketName } else { "hopper-files" }
  $bucketName = (Read-Host "Bucket privado de R2 [$defaultName]").Trim().ToLowerInvariant()

  if (-not $bucketName) {
    $bucketName = $defaultName
  }

  if ($bucketName -notmatch "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$") {
    throw "El bucket debe tener entre 3 y 63 caracteres y usar solo minúsculas, números y guiones."
  }

  if (-not (Test-R2Bucket $bucketName)) {
    $answer = (Read-Host "El bucket '$bucketName' no existe. ¿Crearlo en R2? [S/n]").Trim().ToLowerInvariant()

    if ($answer -and $answer -notin @("s", "si", "sí", "y", "yes")) {
      throw "Debes crear o seleccionar un bucket de R2 antes de continuar."
    }

    Invoke-Wrangler r2 bucket create $bucketName
  }

  if (-not (Test-R2Bucket $bucketName)) {
    throw "El bucket de R2 no quedó disponible después de la operación."
  }

  $script:R2BucketName = $bucketName
  Save-Config
}

function Read-ValidatedUrl {
  param([string]$Prompt, [string]$Default = "")

  $label = if ($Default) { "$Prompt [$Default]" } else { $Prompt }
  $value = (Read-Host $label).Trim()

  if (-not $value) {
    $value = $Default
  }

  $parsed = $null

  if (-not [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$parsed)) {
    throw "La URL indicada no es válida."
  }

  if ($parsed.Scheme -ne "https" -and -not ($parsed.Scheme -eq "http" -and ($parsed.Host -eq "localhost" -or $parsed.Host -eq "127.0.0.1"))) {
    throw "La URL pública debe usar HTTPS."
  }

  return $parsed
}

function Configure-BaseValues {
  $previousWorkerName = $script:WorkerName
  $previousAccountId = $script:R2AccountId
  $workerDefault = if ($script:WorkerName) { $script:WorkerName } else { "hopper-api" }
  $workerName = (Read-Host "Nombre del Worker [$workerDefault]").Trim()

  if (-not $workerName) {
    $workerName = $workerDefault
  }

  if ($workerName -notmatch "^[a-z0-9][a-z0-9-]{0,62}$") {
    throw "El nombre del Worker solo puede contener minúsculas, números y guiones."
  }

  $script:WorkerName = $workerName
  $publicUri = Read-ValidatedUrl "URL pública de Hopper" $script:PublicAppUrl
  $script:PublicAppUrl = $publicUri.AbsoluteUri.TrimEnd("/") + "/"
  $script:AllowedOrigin = $publicUri.GetLeftPart([UriPartial]::Authority)

  $accountLabel = if ($script:R2AccountId) { "Cloudflare Account ID [$($script:R2AccountId)]" } else { "Cloudflare Account ID" }
  $accountId = (Read-Host $accountLabel).Trim().ToLowerInvariant()

  if (-not $accountId) {
    $accountId = $script:R2AccountId
  }

  if ($accountId -notmatch "^[0-9a-f]{32}$") {
    throw "El Account ID de Cloudflare debe contener 32 caracteres hexadecimales."
  }

  $script:R2AccountId = $accountId

  if ($previousWorkerName -and $script:WorkerName -ne $previousWorkerName) {
    $script:WorkerUrl = ""
    $script:SessionSecretConfigured = $false
    $script:R2SecretConfigured = $false
    $script:RecoveryConfigured = $false
  } elseif ($previousAccountId -and $script:R2AccountId -ne $previousAccountId) {
    $script:R2SecretConfigured = $false
  }

  $currentMb = [math]::Round($script:MaxFileBytes / 1MB)
  $maxInput = (Read-Host "Tamaño máximo por archivo en MB [$currentMb]").Trim()

  if ($maxInput) {
    $maxMb = [long]$maxInput

    if ($maxMb -lt 1 -or $maxMb -gt 5120) {
      throw "El tamaño máximo debe estar entre 1 MB y 5120 MB."
    }

    $script:MaxFileBytes = [long]($maxMb * 1MB)
  }

  Save-Config
}

function Invoke-D1Command {
  param([string]$Sql)
  Invoke-Wrangler d1 execute $script:DatabaseName --remote --command $Sql --yes
}

function Invoke-D1File {
  param([string]$Path)
  Invoke-Wrangler d1 execute $script:DatabaseName --remote --file $Path --yes
}

function Initialize-Schema {
  if (-not $script:DatabaseName) {
    Select-Database
  }

  Invoke-D1File $schemaPath
}

function Read-SecretText {
  param([string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Convert-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-RandomToken {
  param([int]$Bytes = 32)

  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }

  return Convert-Base64Url $buffer
}

function Set-WorkerSecretsBulk {
  param([System.Collections.IDictionary]$Values)

  if (-not $script:WorkerName) {
    throw "El Worker todavía no está configurado."
  }

  $json = $Values | ConvertTo-Json -Compress
  $json | & npx --yes wrangler secret bulk --name $script:WorkerName

  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible actualizar los secrets del Worker."
  }
}

function Write-FrontendConfig {
  if (-not $script:WorkerUrl) {
    return
  }

  $content = @"
const appConfig = Object.freeze({
  workerBaseUrl: "$($script:WorkerUrl.TrimEnd('/'))",
  defaultTtlMinutes: 15,
  maxFileBytes: $script:MaxFileBytes,
  pollIntervalMs: 3000
});

export { appConfig };
"@

  Set-Content $frontendConfigPath -Value $content -Encoding UTF8
}

function New-DeployConfig {
  if (-not $script:DatabaseId -or -not $script:WorkerName -or -not $script:PublicAppUrl -or -not $script:R2BucketName -or -not $script:R2AccountId) {
    throw "Faltan valores de configuración. Ejecuta primero la configuración guiada."
  }

  return [ordered]@{
    name = $script:WorkerName
    main = "cloudflare/src/index.js"
    compatibility_date = (Get-Date).ToString("yyyy-MM-dd")
    workers_dev = $true
    vars = [ordered]@{
      ALLOWED_ORIGINS = $script:AllowedOrigin
      ALLOW_LOCALHOST = "true"
      PUBLIC_APP_URL = $script:PublicAppUrl
      MAX_FILE_BYTES = [string]$script:MaxFileBytes
      R2_ACCOUNT_ID = $script:R2AccountId
      R2_BUCKET_NAME = $script:R2BucketName
    }
    d1_databases = @(
      [ordered]@{
        binding = "DB"
        database_name = $script:DatabaseName
        database_id = $script:DatabaseId
      }
    )
    r2_buckets = @(
      [ordered]@{
        binding = "FILES"
        bucket_name = $script:R2BucketName
      }
    )
    triggers = [ordered]@{
      crons = @("* * * * *")
    }
  }
}

function Deploy-Worker {
  if (-not $script:R2BucketName) {
    Select-R2Bucket
  }

  Initialize-Schema
  $config = New-DeployConfig
  $config | ConvertTo-Json -Depth 8 | Set-Content $deployConfigPath -Encoding UTF8

  try {
    $output = & npx --yes wrangler deploy --config $deployConfigPath 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -ne 0) {
      throw "Wrangler no pudo desplegar el Worker."
    }

    $text = $output | Out-String
    $match = [regex]::Match($text, "https://[^\s]+\.workers\.dev")

    if ($match.Success) {
      $script:WorkerUrl = $match.Value.TrimEnd("/")
    } elseif (-not $script:WorkerUrl) {
      $uri = Read-ValidatedUrl "URL HTTPS del Worker recién desplegado"
      $script:WorkerUrl = $uri.AbsoluteUri.TrimEnd("/")
    }

    Save-Config
    Write-FrontendConfig
  } finally {
    Remove-Item $deployConfigPath -Force -ErrorAction SilentlyContinue
  }
}

function Configure-SessionSecret {
  if ($script:SessionSecretConfigured) {
    return
  }

  $secret = New-RandomToken 48
  Set-WorkerSecretsBulk ([ordered]@{ SESSION_SECRET = $secret })
  $script:SessionSecretConfigured = $true
  Save-Config
}

function Configure-R2Secrets {
  if (-not $script:R2BucketName) {
    Select-R2Bucket
  }

  $accessKeyId = Read-SecretText "R2 Access Key ID"
  $secretAccessKey = Read-SecretText "R2 Secret Access Key"

  if (-not $accessKeyId -or -not $secretAccessKey) {
    throw "Las dos credenciales S3 de R2 son obligatorias."
  }

  Set-WorkerSecretsBulk ([ordered]@{
    R2_ACCESS_KEY_ID = $accessKeyId
    R2_SECRET_ACCESS_KEY = $secretAccessKey
  })
  $script:R2SecretConfigured = $true
  Save-Config
}

function Configure-RecoveryEmail {
  $apiKey = Read-SecretText "API key de Resend"
  $email = Read-SecretText "Correo personal de recuperación"
  $sender = (Read-Host "Remitente de Resend, por ejemplo Hopper <hopper@tudominio.com> [opcional]").Trim()

  if (-not $apiKey) {
    throw "La API key de Resend es obligatoria."
  }

  try {
    $parsedEmail = [Net.Mail.MailAddress]::new($email)
  } catch {
    throw "El correo de recuperación no es válido."
  }

  if ($parsedEmail.Address -ne $email) {
    throw "El correo de recuperación no es válido."
  }

  $secrets = [ordered]@{
    RESEND_API_KEY = $apiKey
    RECOVERY_EMAIL = $email
  }

  if ($sender) {
    $secrets.RESEND_FROM_EMAIL = $sender
  }

  Set-WorkerSecretsBulk $secrets
  $script:RecoveryConfigured = $true
  Save-Config
}

function Configure-R2Cors {
  if (-not $script:R2BucketName) {
    Select-R2Bucket
  }

  if (-not $script:AllowedOrigin) {
    throw "La URL pública de Hopper todavía no está configurada."
  }

  $origins = @(
    $script:AllowedOrigin,
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ) | Where-Object { $_ } | Select-Object -Unique

  $payload = [ordered]@{
    rules = @(
      [ordered]@{
        allowed = [ordered]@{
          origins = @($origins)
          methods = @("GET", "HEAD", "PUT")
          headers = @("Content-Type")
        }
        exposeHeaders = @("ETag", "Content-Length", "Content-Type", "Content-Disposition")
        maxAgeSeconds = 3600
      }
    )
  }

  try {
    $payload | ConvertTo-Json -Depth 8 | Set-Content $r2CorsPath -Encoding UTF8
    Invoke-Wrangler r2 bucket cors set $script:R2BucketName --file $r2CorsPath
    Invoke-Wrangler r2 bucket cors list $script:R2BucketName
  } finally {
    Remove-Item $r2CorsPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-AdminRequest {
  param(
    [string]$Path,
    [hashtable]$Body,
    [string]$AdminToken
  )

  if (-not $script:WorkerUrl) {
    throw "La URL del Worker no está configurada."
  }

  $headers = @{ Authorization = "Bearer $AdminToken" }
  $json = $Body | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Uri "$($script:WorkerUrl.TrimEnd('/'))$Path" -Method Post -Headers $headers -ContentType "application/json" -Body $json
}

function Use-TemporaryAdminToken {
  param([scriptblock]$Operation)

  $adminToken = New-RandomToken 32
  Set-WorkerSecretsBulk ([ordered]@{ ADMIN_CLI_TOKEN = $adminToken })

  try {
    & $Operation $adminToken
  } finally {
    try {
      Set-WorkerSecretsBulk ([ordered]@{ ADMIN_CLI_TOKEN = $null })
    } catch {
      Write-Warning "No fue posible retirar ADMIN_CLI_TOKEN. Elimínalo manualmente en Cloudflare antes de continuar."
    }
  }
}

function Set-NewPin {
  if (-not $script:SessionSecretConfigured) {
    throw "SESSION_SECRET no está configurado. Ejecuta la configuración inicial primero."
  }

  $pin = Read-SecretText "Nuevo PIN de 4 dígitos"
  $confirmation = Read-SecretText "Confirma el PIN"

  if ($pin -notmatch "^\d{4}$") {
    throw "El PIN debe tener exactamente 4 dígitos."
  }

  if ($pin -ne $confirmation) {
    throw "Los PIN no coinciden."
  }

  Use-TemporaryAdminToken {
    param($adminToken)
    $result = Invoke-AdminRequest "/admin/change-pin" @{ pin = $pin; confirmation = $confirmation } $adminToken

    if (-not $result.ok -or $result.status -ne "updated") {
      throw "El Worker no confirmó el cambio de PIN."
    }
  }
}

function Show-Status {
  Initialize-Schema
  Invoke-D1Command "SELECT failed_attempts, locked, locked_at, last_failed_at, last_success_at, updated_at FROM security_state WHERE id = 1; SELECT version, updated_at FROM session_state WHERE id = 1; SELECT COUNT(*) AS active_items FROM drop_items WHERE status = 'ready' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'); SELECT target, kind, created_at, note FROM blocked_clients ORDER BY id DESC;"

  if ($script:R2BucketName) {
    if (Test-R2Bucket $script:R2BucketName) {
      Write-Host "R2: $script:R2BucketName — OK"
    } else {
      Write-Warning "El bucket R2 configurado no está disponible."
    }
  }

  if ($script:WorkerUrl) {
    try {
      $health = Invoke-RestMethod -Uri "$($script:WorkerUrl.TrimEnd('/'))/health" -Method Get
      Write-Host "Worker: $($health.service) — OK"
      Write-Host "R2 binding: $($health.configured.r2Bucket) | firma: $($health.configured.r2Signing) | correo: $($health.configured.recoveryEmail)"
    } catch {
      Write-Warning "El Worker no respondió al health check."
    }
  }
}

function Set-ManualLock {
  $sql = "UPDATE security_state SET failed_attempts = 5, locked = 1, lock_event_recorded = 1, locked_at = datetime('now'), updated_at = datetime('now') WHERE id = 1; UPDATE session_state SET version = version + 1, updated_at = datetime('now') WHERE id = 1; INSERT INTO security_events (type, created_at, details) VALUES ('manual-lock', datetime('now'), 'powershell-admin');"
  Invoke-D1Command $sql
}

function Set-ManualUnlock {
  $sql = "UPDATE security_state SET failed_attempts = 0, locked = 0, lock_event_recorded = 0, locked_at = NULL, updated_at = datetime('now') WHERE id = 1; UPDATE session_state SET version = version + 1, updated_at = datetime('now') WHERE id = 1; UPDATE recovery_tokens SET used_at = COALESCE(used_at, datetime('now')) WHERE used_at IS NULL; INSERT INTO security_events (type, created_at, details) VALUES ('manual-unlock', datetime('now'), 'powershell-admin');"
  Invoke-D1Command $sql
}

function Escape-SqlValue {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function Add-BlockedClient {
  $target = (Read-Host "IP exacta o red IPv4 CIDR, por ejemplo 203.0.113.0/24").Trim()

  if (-not $target) {
    throw "Debes indicar una IP o red."
  }

  $kind = if ($target.Contains("/")) { "cidr" } else { "ip" }
  $address = $null

  if ($kind -eq "cidr") {
    $parts = $target.Split("/")
    $prefix = if ($parts.Count -eq 2 -and $parts[1] -match "^\d{1,2}$") { [int]$parts[1] } else { -1 }

    if ($parts.Count -ne 2 -or $prefix -lt 0 -or $prefix -gt 32 -or -not [Net.IPAddress]::TryParse($parts[0], [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
      throw "La red CIDR no es válida."
    }
  } elseif (-not [Net.IPAddress]::TryParse($target, [ref]$address)) {
    throw "La IP no es válida."
  }

  $escapedTarget = Escape-SqlValue $target
  Invoke-D1Command "INSERT OR IGNORE INTO blocked_clients (target, kind, created_at, note) VALUES ('$escapedTarget', '$kind', datetime('now'), 'powershell-admin'); INSERT INTO security_events (type, created_at, details) VALUES ('client-blocked-manually', datetime('now'), '$escapedTarget');"
}

function Remove-BlockedClient {
  $target = (Read-Host "IP o red CIDR que quieres desbloquear").Trim()

  if (-not $target) {
    throw "Debes indicar una IP o red."
  }

  $escapedTarget = Escape-SqlValue $target
  Invoke-D1Command "DELETE FROM blocked_clients WHERE target = '$escapedTarget'; INSERT INTO security_events (type, created_at, details) VALUES ('client-unblocked-manually', datetime('now'), '$escapedTarget');"
}

function Show-Events {
  Invoke-D1Command "SELECT id, type, created_at, details FROM security_events ORDER BY id DESC LIMIT 50;"
}

function Invoke-Cleanup {
  Use-TemporaryAdminToken {
    param($adminToken)
    $result = Invoke-AdminRequest "/admin/cleanup" @{} $adminToken
    Write-Host "Revisados: $($result.scanned) | expirados: $($result.expired) | eliminados: $($result.deleted) | fallos: $($result.failed)"
  }
}

function Update-PublicUrl {
  $uri = Read-ValidatedUrl "Nueva URL pública de Hopper" $script:PublicAppUrl
  $script:PublicAppUrl = $uri.AbsoluteUri.TrimEnd("/") + "/"
  $script:AllowedOrigin = $uri.GetLeftPart([UriPartial]::Authority)
  Save-Config
  Deploy-Worker
  Configure-R2Cors
}

function Invoke-GuidedSetup {
  Write-Host ""
  Write-Host "Hopper - configuración inicial"
  Write-Host "Necesitas Cloudflare con D1 y R2 disponibles, credenciales S3 de R2 y una API key de Resend."
  Write-Host "El administrador no activa planes de pago ni configura facturación."
  Write-Host ""

  Select-Database
  Select-R2Bucket
  Configure-BaseValues
  Initialize-Schema
  Deploy-Worker
  Configure-SessionSecret
  Configure-R2Secrets
  Configure-RecoveryEmail
  Set-NewPin
  Configure-R2Cors
  Write-FrontendConfig
  Show-Status

  Write-Host ""
  Write-Host "Configuración terminada."
  Write-Host "Worker: $script:WorkerUrl"
  Write-Host "R2: $script:R2BucketName"
  Write-Host "Frontend enlazado en: js/config.js"
}

function Invoke-Action {
  param([string]$SelectedAction)

  switch ($SelectedAction) {
    "setup" { Invoke-GuidedSetup }
    "init" { Initialize-Schema }
    "deploy" { Deploy-Worker }
    "status" { Show-Status }
    "lock" { Initialize-Schema; Set-ManualLock }
    "unlock" { Initialize-Schema; Set-ManualUnlock }
    "change-pin" { Set-NewPin }
    "block" { Initialize-Schema; Add-BlockedClient }
    "unblock" { Initialize-Schema; Remove-BlockedClient }
    "events" { Initialize-Schema; Show-Events }
    "email" { Configure-RecoveryEmail }
    "r2" { Select-R2Bucket; Configure-R2Secrets }
    "cors" { Configure-R2Cors }
    "cleanup" { Invoke-Cleanup }
    "url" { Update-PublicUrl }
  }
}

Ensure-CloudflareLogin
Load-Config
Select-Database

if ($Action -ne "menu") {
  Invoke-Action $Action
  exit 0
}

do {
  Write-Host ""
  Write-Host "Hopper - administración"
  Write-Host "D1: $script:DatabaseName"
  if ($script:R2BucketName) { Write-Host "R2: $script:R2BucketName" }
  if ($script:WorkerUrl) { Write-Host "Worker: $script:WorkerUrl" }
  Write-Host "[1] Configuración inicial guiada"
  Write-Host "[2] Inicializar o actualizar esquema D1"
  Write-Host "[3] Desplegar Worker"
  Write-Host "[4] Ver estado"
  Write-Host "[5] Cambiar PIN"
  Write-Host "[6] Bloquear Hopper"
  Write-Host "[7] Desbloquear Hopper"
  Write-Host "[8] Bloquear IP o red"
  Write-Host "[9] Desbloquear IP o red"
  Write-Host "[10] Ver eventos de seguridad"
  Write-Host "[11] Configurar correo de recuperación"
  Write-Host "[12] Configurar credenciales de R2"
  Write-Host "[13] Configurar CORS de R2"
  Write-Host "[14] Ejecutar limpieza ahora"
  Write-Host "[15] Cambiar URL pública"
  Write-Host "[0] Salir"

  $choice = Read-Host "Opción"

  switch ($choice) {
    "1" { Invoke-Action "setup" }
    "2" { Invoke-Action "init" }
    "3" { Invoke-Action "deploy" }
    "4" { Invoke-Action "status" }
    "5" { Invoke-Action "change-pin" }
    "6" { Invoke-Action "lock" }
    "7" { Invoke-Action "unlock" }
    "8" { Invoke-Action "block" }
    "9" { Invoke-Action "unblock" }
    "10" { Invoke-Action "events" }
    "11" { Invoke-Action "email" }
    "12" { Invoke-Action "r2" }
    "13" { Invoke-Action "cors" }
    "14" { Invoke-Action "cleanup" }
    "15" { Invoke-Action "url" }
    "0" { return }
    default { Write-Host "Opción inválida." }
  }
} while ($true)
