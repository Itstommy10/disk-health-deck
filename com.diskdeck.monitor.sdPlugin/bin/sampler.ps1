$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Mappa lettera di unita' -> modello del disco fisico (serve per abbinare i
# sensori di temperatura). Cambia raramente: la ricalcoliamo ogni 60 cicli.
function Get-DriveModels {
  $map = @{}
  foreach ($drive in Get-CimInstance Win32_DiskDrive) {
    $parts = Get-CimAssociatedInstance -InputObject $drive -ResultClassName Win32_DiskPartition
    foreach ($part in $parts) {
      foreach ($ld in (Get-CimAssociatedInstance -InputObject $part -ResultClassName Win32_LogicalDisk)) {
        $map[$ld.DeviceID] = $drive.Model
      }
    }
  }
  return $map
}

$models = Get-DriveModels
$cycle = 0

while ($true) {
  if ($cycle % 60 -eq 0) { $models = Get-DriveModels }
  $cycle++
  $vols = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'
  $perf = @{}
  foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk) {
    $perf[$p.Name] = $p
  }
  $out = @()
  foreach ($v in $vols) {
    $p = $perf[$v.DeviceID]
    $out += [pscustomobject]@{
      id    = $v.DeviceID
      label = $v.VolumeName
      model = [string]$models[$v.DeviceID]
      size  = [double]$v.Size
      free  = [double]$v.FreeSpace
      read  = [double]($(if ($p) { $p.DiskReadBytesPersec } else { 0 }))
      write = [double]($(if ($p) { $p.DiskWriteBytesPersec } else { 0 }))
      busy  = [double]($(if ($p) { 100 - $p.PercentIdleTime } else { 0 }))
    }
  }
  $t = $perf['_Total']
  $payload = [pscustomobject]@{
    disks = $out
    total = [pscustomobject]@{
      read  = [double]($(if ($t) { $t.DiskReadBytesPersec } else { 0 }))
      write = [double]($(if ($t) { $t.DiskWriteBytesPersec } else { 0 }))
      busy  = [double]($(if ($t) { 100 - $t.PercentIdleTime } else { 0 }))
    }
  }
  $payload | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
