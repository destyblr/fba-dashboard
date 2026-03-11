$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\desty\Desktop\FBA Dashboard.lnk")
$Shortcut.TargetPath = "C:\Users\desty\Desktop\Travail\Amz dashboard\OA\fba-dashboard\LANCER-APPLICATION.bat"
$Shortcut.WorkingDirectory = "C:\Users\desty\Desktop\Travail\Amz dashboard\OA\fba-dashboard"
$Shortcut.Description = "Lancer le dashboard FBA Amazon"
$Shortcut.Save()
Write-Host "Raccourci cree."
