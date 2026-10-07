' TARS Voice — hidden launcher. Runs launch-tars.ps1 with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Dim here : here = fso.GetParentFolderName(WScript.ScriptFullName)
Dim ps1 : ps1 = here & "\launch-tars.ps1"
Dim cmd : cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
CreateObject("WScript.Shell").Run cmd, 0, False
