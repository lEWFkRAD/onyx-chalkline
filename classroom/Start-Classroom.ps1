[CmdletBinding()]
param(
  [string]$DataDirectory = (Join-Path $PSScriptRoot 'data'),
  [string]$ConfigPath = '',
  [ValidateRange(1024,65535)][int]$Port = 5195,
  [switch]$NoBrowser,
  [switch]$TeacherSession
)
$ErrorActionPreference = 'Stop'
foreach ($package in @('pdfjs-dist','mammoth','yauzl')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ('node_modules/' + $package + '/package.json')))) { throw 'Install classroom dependencies first: npm ci --omit=dev --ignore-scripts --workspaces=false' }
}
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
if (-not $ConfigPath) { $ConfigPath = Join-Path $DataDirectory 'config.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$config = @{}
if (Test-Path -LiteralPath $ConfigPath) { $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json }
if (-not $PSBoundParameters.ContainsKey('Port') -and $config.server.port) { $Port = [int]$config.server.port }
$healthOrigin = "http://127.0.0.1:$Port"
if ($config.server.tls) { $healthOrigin = $config.server.publicOrigin }
$expectedEdition = if ($config.edition) { $config.edition } else { 'school' }
$ready = $false
try { $health = Invoke-RestMethod "$healthOrigin/health" -TimeoutSec 2; $ready = $health.service -eq 'chalkline-classroom' } catch {}
if ($ready -and $health.version -ne 2) { throw 'An older classroom is running on this port. Back it up and stop it before upgrading.' }
if (-not $ready) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $server = Join-Path $PSScriptRoot 'server.mjs'
  $arguments = @('"' + $server + '"', '--data', '"' + $DataDirectory + '"', '--config', '"' + $ConfigPath + '"', '--port', $Port)
  Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'service.log') -RedirectStandardError (Join-Path $DataDirectory 'service-errors.log') | Out-Null
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { $health = Invoke-RestMethod "$healthOrigin/health" -TimeoutSec 1; if ($health.service -eq 'chalkline-classroom' -and $health.version -eq 2) { $ready = $true; break } } catch {}
  }
}
if (-not $ready) { throw "Classroom did not start. See $DataDirectory/service-errors.log" }
$actualEdition = if ($health.edition) { $health.edition } else { 'school' }
if ($actualEdition -ne $expectedEdition) { throw 'This port is serving another Chalkline edition. Choose a separate port and data directory.' }
$launchPath = Join-Path $DataDirectory 'launch.json'
if (-not (Test-Path -LiteralPath $launchPath)) { throw 'This port is serving another classroom. Use its data directory or another port.' }
$launch = Get-Content -LiteralPath $launchPath -Raw | ConvertFrom-Json
if ($launch.instanceId -ne $health.instanceId) { throw 'This port is serving another classroom instance. Check the selected data directory.' }
$openUrl = $launch.origin
if ($TeacherSession -and -not $NoBrowser) {
  try {
    $bootstrap = Get-Content -LiteralPath (Join-Path $DataDirectory 'bootstrap.json') -Raw | ConvertFrom-Json
    $session = Invoke-RestMethod "$healthOrigin/api/login" -Method Post -ContentType 'application/json' -Body ($bootstrap.teacher | ConvertTo-Json -Compress)
    $openUrl = $launch.origin + '/#access=' + $session.token
  } catch { Write-Output 'Sign in with your current teacher username and password in the browser.' }
}
if (-not $NoBrowser) { Start-Process -FilePath $openUrl }
Write-Output 'Chalkline classroom is ready. Initial credentials are in the private data/bootstrap.json file.'
