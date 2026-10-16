[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Backup', 'Verify', 'Restore')]
    [string]$Action,

    [string]$BackupPath,

    [ValidateSet('RESTORE')]
    [string]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backendRoot = Join-Path $projectRoot 'backend'
$maintenanceScript = Join-Path $PSScriptRoot 'sqlite-maintenance.mjs'

function Get-BackendSetting([string]$Name, [string]$DefaultValue) {
    $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ($processValue) { return $processValue }

    $environmentFile = Join-Path $backendRoot '.env'
    if (Test-Path -LiteralPath $environmentFile -PathType Leaf) {
        $line = Get-Content -LiteralPath $environmentFile | Where-Object {
            $_ -match "^\s*$([regex]::Escape($Name))\s*="
        } | Select-Object -First 1
        if ($line) {
            $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", '').Trim()
            if ($value -match '^(["''])(.*)\1\s*(?:#.*)?$') {
                $value = $Matches[2]
            } else {
                $value = ($value -replace '\s+#.*$', '').Trim()
            }
            if ($value) { return $value }
        }
    }
    return $DefaultValue
}

function Invoke-SqliteMaintenance([string]$Operation, [string]$Source, [string]$Target) {
    if ($Target) {
        & node $maintenanceScript $Operation $Source $Target
    } else {
        & node $maintenanceScript $Operation $Source
    }
    if ($LASTEXITCODE -ne 0) {
        throw "SQLite maintenance operation '$Operation' failed (exit code $LASTEXITCODE)."
    }
}

function Resolve-FromBackend([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $backendRoot $Path))
}

$databaseSetting = Get-BackendSetting 'DATABASE_PATH' 'data/storefront.sqlite'
$databasePath = Resolve-FromBackend $databaseSetting
$backupDirectory = Join-Path (Split-Path -Parent $databasePath) 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'

try {
    if (-not (Test-Path -LiteralPath $maintenanceScript -PathType Leaf)) {
        throw "Required Node.js helper is missing: $maintenanceScript"
    }

    switch ($Action) {
        'Backup' {
            if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
                throw "Configured SQLite database was not found: $databasePath"
            }
            if (-not $BackupPath) {
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($databasePath)
                $BackupPath = Join-Path $backupDirectory "$baseName-$timestamp.sqlite"
            } else {
                $BackupPath = [System.IO.Path]::GetFullPath($BackupPath)
            }
            $destinationDirectory = Split-Path -Parent $BackupPath
            if (-not (Test-Path -LiteralPath $destinationDirectory)) {
                New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
            }
            Invoke-SqliteMaintenance 'backup' $databasePath $BackupPath
            Write-Output "Verified backup created: $BackupPath"
        }

        'Verify' {
            if (-not $BackupPath) { throw 'Specify -BackupPath for verification.' }
            $BackupPath = [System.IO.Path]::GetFullPath($BackupPath)
            Invoke-SqliteMaintenance 'verify' $BackupPath $null
            Write-Output "Database file is readable and passed PRAGMA quick_check: $BackupPath"
        }

        'Restore' {
            if (-not $BackupPath) { throw 'Specify -BackupPath for restore.' }
            if ($ConfirmRestore -ne 'RESTORE') {
                throw "Restore requires explicit confirmation: pass -ConfirmRestore RESTORE."
            }
            $BackupPath = [System.IO.Path]::GetFullPath($BackupPath)
            if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
                throw "Backup file was not found: $BackupPath"
            }
            if ($BackupPath -eq $databasePath) {
                throw 'The backup and configured database paths are identical; refusing to restore.'
            }

            $backendPort = [int](Get-BackendSetting 'PORT' '3001')
            if ($backendPort -gt 0) {
                $listener = Get-NetTCPConnection -State Listen -LocalPort $backendPort -ErrorAction SilentlyContinue |
                    Select-Object -First 1
                if ($listener) {
                    throw "Backend port $backendPort is listening. Stop the backend before restore, then retry."
                }
            }

            Invoke-SqliteMaintenance 'verify' $BackupPath $null
            $safetyBackup = $null
            if (Test-Path -LiteralPath $databasePath -PathType Leaf) {
                New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($databasePath)
                $safetyBackup = Join-Path $backupDirectory "$baseName-before-restore-$timestamp.sqlite"
                Invoke-SqliteMaintenance 'backup' $databasePath $safetyBackup
            }

            $databaseDirectory = Split-Path -Parent $databasePath
            if (-not (Test-Path -LiteralPath $databaseDirectory)) {
                New-Item -ItemType Directory -Path $databaseDirectory -Force | Out-Null
            }
            $stagingPath = Join-Path $databaseDirectory ("restore-$timestamp-" + [guid]::NewGuid().ToString('N') + '.sqlite')
            $rollbackTag = ".pre-restore-$timestamp"
            $originalFiles = @($databasePath, "$databasePath-wal", "$databasePath-shm", "$databasePath-journal")
            $movedOriginals = @()
            $installedRestoredFile = $false

            try {
                Invoke-SqliteMaintenance 'restore-stage' $BackupPath $stagingPath
                foreach ($originalFile in $originalFiles) {
                    if (Test-Path -LiteralPath $originalFile -PathType Leaf) {
                        $rollbackPath = "$originalFile$rollbackTag"
                        if (Test-Path -LiteralPath $rollbackPath) {
                            throw "Rollback file already exists; refusing to overwrite: $rollbackPath"
                        }
                        Move-Item -LiteralPath $originalFile -Destination $rollbackPath
                        $movedOriginals += [pscustomobject]@{ Original = $originalFile; Rollback = $rollbackPath }
                    }
                }
                Move-Item -LiteralPath $stagingPath -Destination $databasePath
                $installedRestoredFile = $true
                Invoke-SqliteMaintenance 'verify' $databasePath $null
            } catch {
                if ($installedRestoredFile -and (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
                    Remove-Item -LiteralPath $databasePath -Force
                }
                for ($index = $movedOriginals.Count - 1; $index -ge 0; $index--) {
                    $movedFile = $movedOriginals[$index]
                    if (Test-Path -LiteralPath $movedFile.Rollback -PathType Leaf) {
                        Move-Item -LiteralPath $movedFile.Rollback -Destination $movedFile.Original
                    }
                }
                if (Test-Path -LiteralPath $stagingPath -PathType Leaf) {
                    Remove-Item -LiteralPath $stagingPath -Force
                }
                throw
            }

            Write-Output "Restore verified: $databasePath"
            if ($safetyBackup) { Write-Output "Pre-restore safety backup retained: $safetyBackup" }
            if ($movedOriginals.Count -gt 0) {
                Write-Output 'Original database and any SQLite sidecars were retained with a .pre-restore timestamp suffix.'
            }
            Write-Output 'Start the backend and verify /api/health and expected application records.'
        }
    }
} catch {
    Write-Error "Database $Action failed: $($_.Exception.Message)"
    exit 1
}
