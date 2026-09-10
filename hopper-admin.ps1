param(
  [ValidateSet("menu", "setup", "init", "deploy", "status", "lock", "unlock", "change-pin", "block", "unblock", "events", "email", "b2", "cors", "cleanup", "url", "pages-preview", "phase3-preview-cors", "phase3-preview-cors-reset")]
  [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$configPath = Join-Path $PSScriptRoot ".hopper-admin.json"
$deployConfigPath = Join-Path $PSScriptRoot ".hopper-wrangler.json"
$schemaPath = Join-Path $PSScriptRoot "cloudflare\schema.sql"
$frontendConfigPath = Join-Path $PSScriptRoot "js\config.js"

$script:DatabaseName = ""
$script:DatabaseId = ""
$script:B2BucketName = ""
$script:B2Endpoint = ""
$script:WorkerName = ""
$script:WorkerUrl = ""
$script:PublicAppUrl = ""
$script:AllowedOrigin = ""
$script:MaxFileBytes = [long](512MB)
$script:RoomMaxFileBytes = [long](100MB)
$script:DefaultTtlMinutes = 5
$script:RoomDefaultTtlMinutes = 5
$script:PollIntervalMs = 3000
$script:UploadConcurrency = 2
$script:SessionSecretConfigured = $false
$script:B2SecretConfigured = $false
$script:RecoveryConfigured = $false
$script:CleanFrontendUrls = $false
$script:Phase3PreviewCorsEnabled = $false
$script:Phase3PreviewOrigin = "https://phase-3.hopper-preview.pages.dev"

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
  $script:B2BucketName = [string]$config.b2BucketName
  $script:B2Endpoint = [string]$config.b2Endpoint
  $script:WorkerName = [string]$config.workerName
  $script:WorkerUrl = [string]$config.workerUrl
  $script:PublicAppUrl = [string]$config.publicAppUrl
  $script:AllowedOrigin = [string]$config.allowedOrigin

  if ($config.maxFileBytes) {
    $script:MaxFileBytes = [long]$config.maxFileBytes
  }

  $script:SessionSecretConfigured = [bool]$config.sessionSecretConfigured
  $script:B2SecretConfigured = [bool]$config.b2SecretConfigured
  $script:RecoveryConfigured = [bool]$config.recoveryConfigured
  $script:CleanFrontendUrls = [bool]$config.cleanFrontendUrls
  $script:Phase3PreviewCorsEnabled = [bool]$config.phase3PreviewCorsEnabled
}

function Save-Config {
  $payload = [ordered]@{
    databaseName = $script:DatabaseName
    databaseId = $script:DatabaseId
    b2BucketName = $script:B2BucketName
    b2Endpoint = $script:B2Endpoint
    workerName = $script:WorkerName
    workerUrl = $script:WorkerUrl
    publicAppUrl = $script:PublicAppUrl
    allowedOrigin = $script:AllowedOrigin
    maxFileBytes = $script:MaxFileBytes
    sessionSecretConfigured = $script:SessionSecretConfigured
    b2SecretConfigured = $script:B2SecretConfigured
    recoveryConfigured = $script:RecoveryConfigured
    cleanFrontendUrls = $script:CleanFrontendUrls
    phase3PreviewCorsEnabled = $script:Phase3PreviewCorsEnabled
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

function Test-B2BucketName {
  param([string]$Name)

  if (-not $Name -or $Name.Length -lt 6 -or $Name.Length -gt 63) {
    return $false
  }

  if ($Name -notmatch "^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$") {
    return $false
  }

  if ($Name.ToLowerInvariant().StartsWith("b2-") -or $Name.Contains("..")) {
    return $false
  }

  if ($Name -match "^\d{1,3}(\.\d{1,3}){3}$") {
    return $false
  }

  return $true
}

function Configure-BaseValues {
  $previousWorkerName = $script:WorkerName
  $previousBucketName = $script:B2BucketName
  $previousEndpoint = $script:B2Endpoint
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

  $bucketLabel = if ($script:B2BucketName) {
    "Bucket privado de Backblaze B2 [$($script:B2BucketName)]"
  } else {
    "Bucket privado de Backblaze B2"
  }
  $bucketName = (Read-Host $bucketLabel).Trim()

  if (-not $bucketName) {
    $bucketName = $script:B2BucketName
  }

  if (-not (Test-B2BucketName $bucketName)) {
    throw "El nombre del bucket de Backblaze B2 no es válido."
  }

  $script:B2BucketName = $bucketName
  $endpointLabel = if ($script:B2Endpoint) {
    "Endpoint S3 de Backblaze B2 [$($script:B2Endpoint)]"
  } else {
    "Endpoint S3 de Backblaze B2, por ejemplo https://s3.us-west-004.backblazeb2.com"
  }
  $endpointInput = (Read-Host $endpointLabel).Trim()

  if (-not $endpointInput) {
    $endpointInput = $script:B2Endpoint
  }

  $endpointUri = $null

  if (
    -not [Uri]::TryCreate($endpointInput, [UriKind]::Absolute, [ref]$endpointUri) -or
    $endpointUri.Scheme -ne "https" -or
    $endpointUri.Host -notmatch "^s3\.[a-z0-9-]+\.backblazeb2\.com$" -or
    ($endpointUri.AbsolutePath -and $endpointUri.AbsolutePath -ne "/") -or
    $endpointUri.Query -or
    $endpointUri.Fragment
  ) {
    throw "El endpoint debe tener el formato https://s3.<region>.backblazeb2.com."
  }

  $script:B2Endpoint = $endpointUri.GetLeftPart([UriPartial]::Authority)

  if ($previousWorkerName -and $script:WorkerName -ne $previousWorkerName) {
    $script:WorkerUrl = ""
    $script:SessionSecretConfigured = $false
    $script:B2SecretConfigured = $false
    $script:RecoveryConfigured = $false
  } elseif (
    ($previousBucketName -and $script:B2BucketName -ne $previousBucketName) -or
    ($previousEndpoint -and $script:B2Endpoint -ne $previousEndpoint)
  ) {
    $script:B2SecretConfigured = $false
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
  publicAppUrl: "$($script:PublicAppUrl)",
  defaultTtlMinutes: $script:DefaultTtlMinutes,
  roomDefaultTtlMinutes: $script:RoomDefaultTtlMinutes,
  maxFileBytes: $script:MaxFileBytes,
  roomMaxFileBytes: $script:RoomMaxFileBytes,
  pollIntervalMs: $script:PollIntervalMs,
  uploadConcurrency: $script:UploadConcurrency
});

export { appConfig };
"@

  Set-Content $frontendConfigPath -Value $content -Encoding UTF8
}

function New-DeployConfig {
  param([string[]]$AdditionalAllowedOrigins = @())

  if (
    -not $script:DatabaseId -or
    -not $script:WorkerName -or
    -not $script:PublicAppUrl -or
    -not $script:B2BucketName -or
    -not $script:B2Endpoint
  ) {
    throw "Faltan valores de configuración. Ejecuta primero la configuración guiada."
  }

  $previewOrigins = if ($script:Phase3PreviewCorsEnabled) { @($script:Phase3PreviewOrigin) } else { @() }
  $allowedOrigins = @(
    $script:AllowedOrigin
    $previewOrigins
    $AdditionalAllowedOrigins
  ) | Where-Object { $_ } | Select-Object -Unique

  return [ordered]@{
    name = $script:WorkerName
    main = "cloudflare/src/index.js"
    compatibility_date = (Get-Date).ToString("yyyy-MM-dd")
    workers_dev = $true
    vars = [ordered]@{
      ALLOWED_ORIGINS = ($allowedOrigins -join ",")
      ALLOW_LOCALHOST = "true"
      PUBLIC_APP_URL = $script:PublicAppUrl
      CLEAN_FRONTEND_URLS = if ($script:CleanFrontendUrls) { "true" } else { "false" }
      MAX_FILE_BYTES = [string]$script:MaxFileBytes
      B2_BUCKET_NAME = $script:B2BucketName
      B2_ENDPOINT = $script:B2Endpoint
    }
    d1_databases = @(
      [ordered]@{
        binding = "DB"
        database_name = $script:DatabaseName
        database_id = $script:DatabaseId
      }
    )
    triggers = [ordered]@{
      crons = @("* * * * *")
    }
  }
}

function Deploy-Worker {
  param(
    [string[]]$AdditionalAllowedOrigins = @(),
    [switch]$SkipSchema
  )

  if (-not $SkipSchema) {
    Initialize-Schema
  }

  $config = New-DeployConfig -AdditionalAllowedOrigins $AdditionalAllowedOrigins
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

function Configure-B2Secrets {
  if (-not $script:B2BucketName -or -not $script:B2Endpoint) {
    throw "Primero configura el bucket y el endpoint de Backblaze B2."
  }

  $keyId = Read-SecretText "Backblaze B2 Key ID"
  $applicationKey = Read-SecretText "Backblaze B2 Application Key"

  if (-not $keyId -or -not $applicationKey) {
    throw "El Key ID y el Application Key de Backblaze B2 son obligatorios."
  }

  Set-WorkerSecretsBulk ([ordered]@{
    B2_KEY_ID = $keyId
    B2_APPLICATION_KEY = $applicationKey
  })
  $script:B2SecretConfigured = $true
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

function Invoke-B2NativeRequest {
  param(
    [string]$Url,
    [string]$AuthorizationToken,
    [hashtable]$Body
  )

  $headers = @{ Authorization = $AuthorizationToken }
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  return Invoke-RestMethod -Uri $Url -Method Post -Headers $headers -ContentType "application/json" -Body $json
}

function Get-B2MasterAuthorization {
  $keyId = Read-SecretText "Backblaze Master Application Key ID para configurar CORS"
  $applicationKey = Read-SecretText "Backblaze Master Application Key para configurar CORS"

  if (-not $keyId -or -not $applicationKey) {
    throw "Las credenciales maestras de Backblaze son obligatorias para configurar CORS."
  }

  $pair = "${keyId}:$applicationKey"
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
  $headers = @{ Authorization = "Basic $basic" }

  try {
    $authorization = Invoke-RestMethod `
      -Uri "https://api.backblazeb2.com/b2api/v4/b2_authorize_account" `
      -Method Get `
      -Headers $headers
  } finally {
    $applicationKey = $null
    $pair = $null
    $basic = $null
  }

  $storageApi = $authorization.apiInfo.storageApi

  if (-not $authorization.accountId -or -not $authorization.authorizationToken -or -not $storageApi.apiUrl) {
    throw "Backblaze no devolvió una autorización administrativa válida."
  }

  $capabilities = @($storageApi.allowed.capabilities)

  foreach ($required in @("listBuckets", "writeBuckets")) {
    if ($capabilities -notcontains $required) {
      throw "La credencial utilizada no tiene la capacidad '$required'. Usa la Master Application Key."
    }
  }

  return $authorization
}

function Configure-B2Cors {
  param([string[]]$AdditionalAllowedOrigins = @())

  if (-not $script:B2BucketName -or -not $script:B2Endpoint -or -not $script:AllowedOrigin) {
    throw "Primero configura el bucket, el endpoint y la URL pública de Hopper."
  }

  Write-Host ""
  Write-Host "CORS de Backblaze B2"
  Write-Host "La Master Application Key se usa solo durante esta operación y no se guarda."
  $authorization = Get-B2MasterAuthorization
  $storageApi = $authorization.apiInfo.storageApi
  $apiUrl = [string]$storageApi.apiUrl
  $reportedEndpoint = ([string]$storageApi.s3ApiUrl).TrimEnd("/")

  if ($reportedEndpoint -and $reportedEndpoint -ne $script:B2Endpoint) {
    throw "El endpoint S3 configurado no coincide con el endpoint de la cuenta Backblaze."
  }

  $listBody = @{
    accountId = [string]$authorization.accountId
    bucketName = $script:B2BucketName
  }
  $listed = Invoke-B2NativeRequest `
    "$($apiUrl.TrimEnd('/'))/b2api/v4/b2_list_buckets" `
    ([string]$authorization.authorizationToken) `
    $listBody
  $buckets = @($listed.buckets)

  if ($buckets.Count -ne 1) {
    throw "No se encontró exactamente un bucket con el nombre '$($script:B2BucketName)'."
  }

  $bucket = $buckets[0]

  if ([string]$bucket.bucketType -ne "allPrivate") {
    throw "El bucket de Hopper debe ser privado (allPrivate)."
  }

  if (@($bucket.options) -notcontains "s3") {
    throw "El bucket seleccionado no está habilitado para la API S3 compatible."
  }

  if ($bucket.fileLockConfiguration.value.isFileLockEnabled) {
    throw "Object Lock está habilitado. Hopper necesita poder eliminar archivos temporales; usa un bucket sin Object Lock."
  }

  $previewOrigins = if ($script:Phase3PreviewCorsEnabled) { @($script:Phase3PreviewOrigin) } else { @() }
  $origins = @(
    $script:AllowedOrigin
    $previewOrigins
    $AdditionalAllowedOrigins
    "http://localhost:5500"
    "http://127.0.0.1:5500"
    "http://localhost:4173"
    "http://127.0.0.1:4173"
    "http://localhost:4175"
    "http://127.0.0.1:4175"
    "http://localhost:5173"
    "http://127.0.0.1:5173"
  ) | Where-Object { $_ } | Select-Object -Unique
  $corsRules = @(
    [ordered]@{
      corsRuleName = "hopperDirectTransfer"
      allowedOrigins = @($origins)
      allowedHeaders = @("content-type")
      allowedOperations = @("s3_put", "s3_get", "s3_head")
      exposeHeaders = @("etag", "content-length", "content-type", "x-amz-version-id")
      maxAgeSeconds = 3600
    }
  )
  $updateBody = @{
    accountId = [string]$authorization.accountId
    bucketId = [string]$bucket.bucketId
    corsRules = $corsRules
    lifecycleRules = @(
      [ordered]@{
        fileNamePrefix = "drop/"
        daysFromUploadingToHiding = 1
        daysFromHidingToDeleting = 1
        daysFromStartingToCancelingUnfinishedLargeFiles = 1
      }
    )
  }

  $updatedBucket = Invoke-B2NativeRequest `
    "$($apiUrl.TrimEnd('/'))/b2api/v4/b2_update_bucket" `
    ([string]$authorization.authorizationToken) `
    $updateBody

  $appliedRule = @($updatedBucket.corsRules | Where-Object { $_.corsRuleName -eq "hopperDirectTransfer" }) | Select-Object -First 1
  $appliedOrigins = @($appliedRule.allowedOrigins)
  $missingOrigins = @($origins | Where-Object { $appliedOrigins -notcontains $_ })

  if (-not $appliedRule -or $missingOrigins.Count -gt 0) {
    throw "Backblaze no confirmó todos los orígenes CORS requeridos: $($missingOrigins -join ', ')."
  }

  Write-Host "CORS y regla de seguridad de ciclo de vida configurados para Hopper."
}

function Test-B2WorkerAccess {
  if (-not $script:B2SecretConfigured) {
    throw "Primero configura el Key ID y el Application Key de Backblaze B2."
  }

  Use-TemporaryAdminToken {
    param($adminToken)
    $result = Invoke-AdminRequest "/admin/storage-check" @{} $adminToken

    if (-not $result.ok) {
      throw "El Worker no confirmó el acceso de lectura/escritura/eliminación a Backblaze B2."
    }

    Write-Host "Backblaze B2: $($result.bucket) - acceso operativo OK"
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
  $uri = "$($script:WorkerUrl.TrimEnd('/'))$Path"
  $maxAttempts = 15

  for ($attempt = 1; $attempt -le $maxAttempts; $attempt += 1) {
    try {
      return Invoke-RestMethod `
        -Uri $uri `
        -Method Post `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $json
    } catch {
      $statusCode = $null

      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }

      $retryable = $statusCode -in @(401, 404)

      if (-not $retryable -or $attempt -ge $maxAttempts) {
        throw
      }

      Write-Host "Esperando propagación del token administrativo... ($attempt/$maxAttempts)"
      Start-Sleep -Seconds 2
    }
  }
}

function Use-TemporaryAdminToken {
  param([scriptblock]$Operation)

  $adminToken = New-RandomToken 32
  Set-WorkerSecretsBulk ([ordered]@{ ADMIN_CLI_TOKEN = $adminToken })

  # Da tiempo a Cloudflare para propagar la nueva versión con el secret temporal.
  Start-Sleep -Seconds 5

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

  if ($script:B2BucketName -and $script:B2Endpoint) {
    Write-Host "B2: $script:B2BucketName"
    Write-Host "Endpoint: $script:B2Endpoint"
  }

  if ($script:Phase3PreviewCorsEnabled) {
    Write-Host "Preview Fase 3 autorizado en CORS: $script:Phase3PreviewOrigin"
  }

  if ($script:WorkerUrl) {
    try {
      $health = Invoke-RestMethod -Uri "$($script:WorkerUrl.TrimEnd('/'))/health" -Method Get
      Write-Host "Worker: $($health.service) - OK"
      Write-Host "B2: $($health.configured.b2Bucket) | firma: $($health.configured.b2Signing) | correo: $($health.configured.recoveryEmail)"
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

    $roomScanned = [int]$result.rooms.scanned
    $roomClosed = [int]$result.rooms.closed
    $roomDeleted = [int]$result.rooms.deleted
    $itemScanned = [int]$result.items.scanned
    $itemExpired = [int]$result.items.expired
    $itemDeleted = [int]$result.items.deleted
    $failed = [int]$result.failed

    Write-Host "Salas revisadas: $roomScanned | cerradas: $roomClosed | elementos de salas eliminados: $roomDeleted"
    Write-Host "Elementos revisados: $itemScanned | expirados: $itemExpired | eliminados: $itemDeleted | fallos: $failed"
  }
}

function Update-PublicUrl {
  $uri = Read-ValidatedUrl "Nueva URL pública de Hopper" $script:PublicAppUrl
  $previousPublicAppUrl = $script:PublicAppUrl
  $previousAllowedOrigin = $script:AllowedOrigin
  $previousCleanFrontendUrls = $script:CleanFrontendUrls
  $previousPreviewCorsEnabled = $script:Phase3PreviewCorsEnabled

  $script:PublicAppUrl = $uri.AbsoluteUri.TrimEnd("/") + "/"
  $script:AllowedOrigin = $uri.GetLeftPart([UriPartial]::Authority)
  $script:CleanFrontendUrls = $true
  $script:Phase3PreviewCorsEnabled = $false
  Save-Config

  try {
    Deploy-Worker
    Configure-B2Cors
  } catch {
    $failure = $_
    $script:PublicAppUrl = $previousPublicAppUrl
    $script:AllowedOrigin = $previousAllowedOrigin
    $script:CleanFrontendUrls = $previousCleanFrontendUrls
    $script:Phase3PreviewCorsEnabled = $previousPreviewCorsEnabled
    Save-Config

    try {
      Write-Warning "El cambio de URL pública no se completó. Restaurando la configuración anterior del Worker."
      Deploy-Worker -SkipSchema
    } catch {
      Write-Warning "No fue posible restaurar automáticamente el Worker. Revisa el despliegue antes de continuar."
    }

    throw $failure
  }
}

function Set-Phase3PreviewCors {
  param([bool]$Enabled)

  $previousState = $script:Phase3PreviewCorsEnabled
  $label = if ($Enabled) { "habilitando" } else { "retirando" }
  Write-Host "Fase 3: $label acceso del preview en Worker y B2 sin cambiar la URL pública."
  $script:Phase3PreviewCorsEnabled = $Enabled

  try {
    Deploy-Worker -SkipSchema
    Configure-B2Cors
  } catch {
    $failure = $_
    $script:Phase3PreviewCorsEnabled = $previousState
    Save-Config

    try {
      Write-Warning "La actualización de CORS no se completó. Restaurando la configuración anterior del Worker."
      Deploy-Worker -SkipSchema
    } catch {
      Write-Warning "No fue posible restaurar automáticamente el Worker. Ejecuta de nuevo la acción de CORS correspondiente antes de continuar."
    }

    throw $failure
  }

  Save-Config

  if ($Enabled) {
    Write-Host "CORS de preview habilitado para $script:Phase3PreviewOrigin. La URL pública y los enlaces de recuperación permanecen en producción actual."
  } else {
    Write-Host "CORS de preview retirado. Worker y B2 vuelven a aceptar únicamente producción y los orígenes locales configurados."
  }
}

function Invoke-PagesPreview {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "No se encontró npm. Instala Node.js antes de preparar el preview."
  }

  $projectName = "hopper-preview"
  $raw = (& npx --yes wrangler pages project list --json 2>$null | Out-String)

  if ($LASTEXITCODE -ne 0 -or -not $raw.Trim()) {
    throw "No fue posible consultar los proyectos de Cloudflare Pages."
  }

  $parsed = $raw | ConvertFrom-Json
  $projects = if ($parsed -is [System.Array]) { @($parsed) } elseif ($parsed.result) { @($parsed.result) } else { @($parsed) }
  $existing = @($projects | Where-Object { $_.name -eq $projectName -or $_.project_name -eq $projectName -or $_.'Project Name' -eq $projectName })

  if ($existing.Count -eq 0) {
    Write-Host "Creando proyecto Direct Upload de Cloudflare Pages: $projectName"
    Invoke-Wrangler pages project create $projectName --production-branch main
  }

  Write-Host "Validando y compilando el preview moderno..."
  $lockPath = Join-Path $PSScriptRoot "package-lock.json"
  if (Test-Path $lockPath) {
    & npm ci
  } else {
    & npm install --no-audit --no-fund
  }

  if ($LASTEXITCODE -ne 0) {
    throw "La instalación de dependencias terminó con código $LASTEXITCODE."
  }

  & npm run lint
  if ($LASTEXITCODE -ne 0) {
    throw "ESLint terminó con código $LASTEXITCODE."
  }

  & npm run typecheck
  if ($LASTEXITCODE -ne 0) {
    throw "TypeScript terminó con código $LASTEXITCODE."
  }

  & npm run test
  if ($LASTEXITCODE -ne 0) {
    throw "Vitest terminó con código $LASTEXITCODE."
  }

  & npm run test:legacy
  if ($LASTEXITCODE -ne 0) {
    throw "Los tests existentes terminaron con código $LASTEXITCODE."
  }

  & npm run test:integration
  if ($LASTEXITCODE -ne 0) {
    throw "Los tests de integración terminaron con código $LASTEXITCODE."
  }

  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "El build terminó con código $LASTEXITCODE."
  }

  Write-Host "Desplegando únicamente la rama de preview phase-3..."
  Invoke-Wrangler pages deploy dist --project-name $projectName --branch phase-3
  Write-Host "Preview desplegado. La URL pública actual, el Worker, D1 y B2 no fueron modificados."
}

function Invoke-GuidedSetup {
  Write-Host ""
  Write-Host "Hopper - configuración inicial"
  Write-Host "Necesitas Cloudflare Workers/D1 en Free, un bucket privado de Backblaze B2 sin método de pago y una API key de Resend Free."
  Write-Host "No añadas una tarjeta ni un método de pago para configurar Hopper."
  Write-Host ""

  Select-Database
  Configure-BaseValues
  Initialize-Schema
  Deploy-Worker
  Configure-SessionSecret
  Configure-B2Secrets
  Test-B2WorkerAccess
  Configure-RecoveryEmail
  Set-NewPin
  Configure-B2Cors
  Write-FrontendConfig
  Show-Status

  Write-Host ""
  Write-Host "Configuración terminada."
  Write-Host "Worker: $script:WorkerUrl"
  Write-Host "Backblaze B2: $script:B2BucketName"
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
    "b2" { Configure-B2Secrets; Test-B2WorkerAccess }
    "cors" { Configure-B2Cors }
    "cleanup" { Invoke-Cleanup }
    "url" { Update-PublicUrl }
    "pages-preview" { Invoke-PagesPreview }
    "phase3-preview-cors" { Set-Phase3PreviewCors $true }
    "phase3-preview-cors-reset" { Set-Phase3PreviewCors $false }
  }
}

Ensure-CloudflareLogin
Load-Config

if ($Action -notin @("pages-preview", "phase3-preview-cors", "phase3-preview-cors-reset")) {
  Select-Database
}

if ($Action -ne "menu") {
  Invoke-Action $Action
  exit 0
}

do {
  Write-Host ""
  Write-Host "Hopper - administración"
  Write-Host "D1: $script:DatabaseName"
  if ($script:B2BucketName) { Write-Host "B2: $script:B2BucketName" }
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
  Write-Host "[12] Configurar credenciales de Backblaze B2"
  Write-Host "[13] Configurar CORS de Backblaze B2"
  Write-Host "[14] Ejecutar limpieza ahora"
  Write-Host "[15] Cambiar URL pública"
  Write-Host "[16] Crear o desplegar preview de Cloudflare Pages"
  Write-Host "[17] Habilitar CORS para preview de Fase 3"
  Write-Host "[18] Retirar CORS del preview de Fase 3"
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
    "12" { Invoke-Action "b2" }
    "13" { Invoke-Action "cors" }
    "14" { Invoke-Action "cleanup" }
    "15" { Invoke-Action "url" }
    "16" { Invoke-Action "pages-preview" }
    "17" { Invoke-Action "phase3-preview-cors" }
    "18" { Invoke-Action "phase3-preview-cors-reset" }
    "0" { return }
    default { Write-Host "Opción inválida." }
  }
} while ($true)
