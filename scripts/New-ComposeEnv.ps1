param(
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env')
)

$ErrorActionPreference = 'Stop'

function New-HexSecret {
    param([int]$ByteLength = 32)

    $bytes = New-Object byte[] $ByteLength
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $generator.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

$destination = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $destination) {
    throw "Refusing to overwrite existing environment file: $destination"
}

$templatePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.example'
$secretValues = @{
    MYSQL_ROOT_PASSWORD = (New-HexSecret)
    MYSQL_PASSWORD = (New-HexSecret)
    MYSQL_MONITOR_PASSWORD = (New-HexSecret)
    SESSION_SECRET = (New-HexSecret 48)
    GRAFANA_ADMIN_PASSWORD = (New-HexSecret)
}
$requiredSecretKeys = @($secretValues.Keys)
if (!(Test-Path -LiteralPath $templatePath)) {
    throw "Compose environment template is missing: $templatePath"
}

$seenSecretKeys = @{}
$generatedLines = foreach ($line in [IO.File]::ReadAllLines($templatePath)) {
    $separator = $line.IndexOf('=')
    if ($separator -lt 0) {
        $line
        continue
    }

    $key = $line.Substring(0, $separator)
    if ($secretValues.ContainsKey($key)) {
        if ($seenSecretKeys.ContainsKey($key) -or $line.Substring($separator + 1).Length -gt 0) {
            throw "The template must contain one empty placeholder for $key."
        }
        $seenSecretKeys[$key] = $true
        "$key=$($secretValues[$key])"
    } else {
        $line
    }
}

$missingSecretKeys = @($requiredSecretKeys | Where-Object { !$seenSecretKeys.ContainsKey($_) })
if ($missingSecretKeys.Count -gt 0) {
    throw "The environment template is missing required secret placeholders: $($missingSecretKeys -join ', ')"
}

$directory = Split-Path -Parent $destination
if (!(Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$file = $null
$created = $false
try {
    $file = [IO.File]::Open(
        $destination,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    $created = $true
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = Get-Acl -LiteralPath $destination
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $identity.User,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow
    )
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $destination -AclObject $acl

    $content = ($generatedLines -join [Environment]::NewLine) + [Environment]::NewLine
    $bytes = [Text.Encoding]::ASCII.GetBytes($content)
    $file.Write($bytes, 0, $bytes.Length)
    $file.Flush()
    [Array]::Clear($bytes, 0, $bytes.Length)
}
catch {
    if ($null -ne $file) {
        $file.Dispose()
        $file = $null
    }
    if ($created -and (Test-Path -LiteralPath $destination)) {
        Remove-Item -LiteralPath $destination -Force
    }
    throw "Could not create a protected environment file; any partial file was removed. $($_.Exception.Message)"
}
finally {
    if ($null -ne $file) {
        $file.Dispose()
    }
}

Write-Output "Generated a new Compose environment file at $destination. Keep it private; no existing file was overwritten."
