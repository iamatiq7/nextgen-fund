$ErrorActionPreference = 'Continue'
$ev = 'C:\Users\SMART\.openclaw-autoclaw\agents\atiqv2\workspace\.cluster\hosting-audit-20260914\evidence'
New-Item -ItemType Directory -Force -Path $ev | Out-Null
$stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
$lines = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$s) { $lines.Add($s) | Out-Null }

Add-Line "=== RUN A: DNS / network ownership / HTTP headers ==="
Add-Line "timestamp   : $stamp"
Add-Line "machine     : $env:COMPUTERNAME"
Add-Line "public IP   : $((Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 20))"
Add-Line "resolver    : $((Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | Select-Object -First 1).ServerAddresses -join ', ')"
Add-Line ""

$hosts = @('nextgen-fund-2040.web.app', 'iamatiq7.github.io', 'nextgen-fund-2040.firebaseapp.com')
foreach ($h in $hosts) {
  Add-Line "--- $h ---"
  foreach ($t in @('A', 'AAAA', 'CNAME', 'NS', 'TXT', 'SOA')) {
    try {
      $r = Resolve-DnsName -Name $h -Type $t -ErrorAction Stop
      $tbl = ($r | Format-Table Name, Type, IPAddress, NameHost, NameExchange, PrimaryServer, TTL -AutoSize | Out-String -Width 200).TrimEnd()
      Add-Line "[$t]"
      Add-Line $tbl
    } catch {
      Add-Line "[$t] ERROR: $($_.Exception.Message)"
    }
  }
  Add-Line ""
}

Add-Line "=== IP ownership (RDAP, public registry) ==="
$ips = @()
foreach ($h in @('nextgen-fund-2040.web.app', 'iamatiq7.github.io', 'firestore.googleapis.com', 'identitytoolkit.googleapis.com')) {
  try { $ips += (Resolve-DnsName -Name $h -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress) } catch {}
}
foreach ($ip in ($ips | Sort-Object -Unique)) {
  Add-Line "--- $ip ---"
  $done = $false
  foreach ($base in @('https://rdap.arin.net/registry/ip/', 'https://rdap.org/ip/')) {
    if ($done) { continue }
    try {
      $rd = Invoke-RestMethod -Uri ($base + $ip) -TimeoutSec 30
      Add-Line "  handle       : $($rd.handle)"
      Add-Line "  name         : $($rd.name)"
      Add-Line "  range        : $($rd.startAddress) - $($rd.endAddress)"
      Add-Line "  country      : $($rd.country)"
      if ($rd.entities) {
        foreach ($e in $rd.entities) {
          $fn = ''
          try { $fn = (($e.vcardArray[1] | Where-Object { $_[0] -eq 'fn' })[0][3]) } catch {}
          Add-Line "  entity       : $($e.handle)  roles=$($e.roles -join ',')  name=$fn"
        }
      }
      $done = $true
    } catch { Add-Line "  ($base error: $($_.Exception.Message))" }
  }
}
Add-Line ""

Add-Line "=== HTTP response headers (curl.exe, no redirect following) ==="
$urls = @(
  'https://nextgen-fund-2040.web.app/setup.html',
  'https://nextgen-fund-2040.web.app/',
  'https://nextgen-fund-2040.web.app/assets/js/firebase-config.js',
  'https://iamatiq7.github.io/nextgen-fund/setup.html',
  'https://nextgen-fund-2040.firebaseapp.com/setup.html',
  'https://nextgen-fund-2040.web.app/does-not-exist-404-check.html'
)
foreach ($u in $urls) {
  Add-Line "--- $u ---"
  Add-Line (curl.exe -sS -D - -o NUL --max-time 30 --http2 $u 2>&1 | Out-String).TrimEnd()
  Add-Line ""
}

Add-Line "=== redirect chain + code (curl -L -w) ==="
foreach ($u in $urls) {
  $res = curl.exe -sS -o NUL -L --max-time 40 --http2 -w "final=%{url_effective} code=%{http_code} redirects=%{num_redirects} ip=%{remote_ip} port=%{remote_port} time=%{time_total}s size=%{size_download}" $u 2>&1 | Out-String
  Add-Line ("{0,-70} {1}" -f $u, $res.Trim())
}
Add-Line ""

Add-Line "=== HTTP/1.1 vs HTTP/2 + HEAD request ==="
foreach ($u in @('https://nextgen-fund-2040.web.app/setup.html', 'https://iamatiq7.github.io/nextgen-fund/setup.html')) {
  Add-Line "--- $u ---"
  Add-Line (curl.exe -sS -I --http2 --max-time 30 $u 2>&1 | Out-String).TrimEnd()
  Add-Line ""
}

$f = Join-Path $ev '01-dns-http-headers.txt'
Set-Content -Path $f -Value ($lines -join "`r`n") -Encoding utf8
"saved: $f ($((Get-Item $f).Length) bytes, $($lines.Count) lines)"
$lines | Select-Object -First 40
