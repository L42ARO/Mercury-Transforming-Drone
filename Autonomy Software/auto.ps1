# auto.ps1 — open three interactive sessions (two SSH + one local npm dev)

$remoteHost = "100.66.197.16"
$user       = "ratbird"
$port       = 22

# Remote commands: single quotes so PowerShell doesn't mangle them; remote bash interprets them.
$rc1 = "cd MercuryDelivery && ./start_mavproxy.sh; exec bash -l"
$rc2 = "cd MercuryDelivery && ./run.sh;          exec bash -l"

# Full ssh commands
$ssh1 = "ssh -t -p $port $user@$remoteHost '$rc1'"
$ssh2 = "ssh -t -p $port $user@$remoteHost '$rc2'"

# Local frontend command
$localCmd = "cd .\TeleopFrontendDev\; npm run dev"

# Prefer Windows Terminal if available
$wt = Get-Command wt -ErrorAction SilentlyContinue

if ($wt) {
  # Use Windows Terminal with 3 panes
  $args = @(
    "new-tab", "--title", "mavproxy", "powershell", "-NoExit", "-Command", $ssh1,
    ";",
    "split-pane", "-V", "--title", "app", "powershell", "-NoExit", "-Command", $ssh2,
    ";",
    "split-pane", "-H", "--title", "frontend", "powershell", "-NoExit", "-Command", $localCmd,
    ";",
    "focus-tab", "-t", "0"
  )
  Start-Process wt -ArgumentList $args
}
else {
  # Fallback: three separate PowerShell windows
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit","-Command",$ssh1)
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit","-Command",$ssh2)
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit","-Command",$localCmd)
}
