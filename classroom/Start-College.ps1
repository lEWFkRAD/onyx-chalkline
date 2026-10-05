[CmdletBinding()]
param(
  [string]$DataDirectory = (Join-Path $PSScriptRoot 'data-college'),
  [string]$ConfigPath = '',
  [ValidateRange(1024,65535)][int]$Port = 5196,
  [switch]$NoBrowser,
  [switch]$InstructorSession
)
$ErrorActionPreference = 'Stop'
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
if (-not $ConfigPath) { $ConfigPath = Join-Path $DataDirectory 'config.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  @{ edition='college'; server=@{ host='127.0.0.1'; port=$Port } } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
}
$collegeConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($collegeConfig.edition -ne 'college') { throw 'Use a college config and a separate college data directory.' }
if (-not $PSBoundParameters.ContainsKey('Port') -and $collegeConfig.server.port) { $Port = [int]$collegeConfig.server.port }
& (Join-Path $PSScriptRoot 'Start-Classroom.ps1') -DataDirectory $DataDirectory -ConfigPath $ConfigPath -Port $Port -NoBrowser:$NoBrowser -TeacherSession:$InstructorSession
