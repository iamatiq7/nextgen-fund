$ErrorActionPreference = 'Continue'
$ws = 'C:\Users\SMART\.openclaw-autoclaw\agents\atiqv2\workspace'
$ev = "$ws\.cluster\hosting-audit-20260914\evidence"
$tmph = "$ws\.openclaw\tmp\hosting"
New-Item -ItemType Directory -Force -Path "$tmph\netlog", "$tmph\profile" | Out-Null

$candidates = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
"browser: $browser"
if (-not $browser) { "NO CHROMIUM BROWSER FOUND"; exit 1 }
$version = (Get-Item $browser).VersionInfo.ProductVersion
"version: $version"

$url = 'https://nextgen-fund-2040.web.app/setup.html'
$netlog = "$tmph\netlog\setup.json"
$dom = "$ev\07-rendered-dom.txt"
Remove-Item $netlog -Force -ErrorAction SilentlyContinue

# headless run: same flags Chromium uses for automated capture; Default capture mode
# (NOT IncludeSensitive) so no cookies or credentials can enter the log.
& $browser --headless=new --disable-gpu --no-first-run --no-default-browser-check `
  --user-data-dir="$tmph\profile" --log-net-log="$netlog" --net-log-capture-mode=Default `
  --virtual-time-budget=20000 --dump-dom $url > "$tmph\dom-raw.txt" 2> "$tmph\dom-err.txt"

$header = @(
  "=== rendered DOM after JavaScript execution (headless Chromium) ===",
  "timestamp : $(Get-Date -Format o)",
  "browser   : $browser ($version)",
  "url       : $url",
  "headless  : --headless=new --virtual-time-budget=20000 --dump-dom",
  "",
  "--- stderr ---",
  (Get-Content "$tmph\dom-err.txt" -Raw),
  "--- DOM ---"
)
Set-Content -Path $dom -Value ($header + (Get-Content "$tmph\dom-raw.txt" -Raw)) -Encoding utf8
"dom saved: $dom ($((Get-Item $dom).Length) bytes)"
"netlog    : $netlog ($((Get-Item $netlog -ErrorAction SilentlyContinue).Length) bytes)"
