!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
  !ifdef COMPRESS
    !undef COMPRESS
  !endif
!macroend

; -----------------------------------------------------------------
; Self-delete installer after successful installation
; -----------------------------------------------------------------
!include "FileFunc.nsh"

; -----------------------------------------------------------------
; Self-delete installer after successful installation (robust version)
; -----------------------------------------------------------------
Function .onInstSuccess
  ; Ensure the file is not read‑only
  SetFileAttributes "$EXEDIR\$EXEFILE" FILE_ATTRIBUTE_NORMAL
  ; Try to delete immediately; if fails, schedule deletion on next reboot
  Delete "$EXEDIR\$EXEFILE"
  IfFileExists "$EXEDIR\$EXEFILE" 0 +2
    Delete /REBOOTOK "$EXEDIR\$EXEFILE"
FunctionEnd

!define MUI_INSTFILESPAGE_FINISHFUNCTION .onInstSuccess
