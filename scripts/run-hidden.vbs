' run-hidden.vbs - launch a .bat file with hidden window
' Usage: wscript.exe run-hidden.vbs "path\to\script.bat"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & WScript.Arguments(0) & """", 0, False
