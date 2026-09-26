; Setup der Fotobox - baut aus paket\Fotobox die Datei Fotobox-Setup-<Version>.exe.
;
; Gebaut wird automatisch in GitHub Actions (.github/workflows/windows-setup.yml):
;   ISCC.exe /DVersion=1.0.0 /DVersionNummer=1.0.0.0 windows\installer\Fotobox.iss
;
; Dieselbe Datei ist Erstinstallation UND Update: Laeuft sie auf einem PC, auf
; dem die Fotobox schon installiert ist, beendet sie Server und Kiosk, sichert
; die Datenbank, tauscht die Programmdateien aus und startet alles wieder. Die
; Daten (Veranstaltungen, Fotos, Vorlagen, Einstellungen) liegen getrennt vom
; Programm unter C:\Users\Public\Fotobox-Daten und werden nie angefasst.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef VersionNummer
  #define VersionNummer "0.0.0.0"
#endif
#define Paket "..\..\paket\Fotobox"
; Nie aendern: Daran erkennt Windows, dass ein Update dieselbe Software ist.
#define AppIdRoh "{6B2C1E8A-4F3D-4C57-9A1E-2F7D5B8C9E10}"

[Setup]
AppId={{#AppIdRoh}
AppName=Fotobox
AppVersion={#Version}
AppVerName=Fotobox {#Version}
AppPublisher=Fotobox
VersionInfoVersion={#VersionNummer}
DefaultDirName={autopf}\Fotobox
DefaultGroupName=Fotobox
DisableProgramGroupPage=yes
; Bei einem Update keine Ordnerwahl - es geht in den bisherigen Ordner.
DisableDirPage=auto
UsePreviousAppDir=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 ab Version 1809
MinVersion=10.0.17763
OutputDir=..\..\paket\ausgabe
OutputBaseFilename=Fotobox-Setup-{#Version}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
; Laufende Teile beendet Fotobox-beenden.ps1 - gezielt und in der richtigen
; Reihenfolge, statt ueber den allgemeinen Neustart-Manager von Windows.
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Fotobox
UninstallDisplayIcon={app}\node\node.exe
ShowLanguageDialog=no

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Messages]
de.WelcomeLabel2=Dieses Programm installiert die Fotobox {#Version} auf diesem Computer.%n%nIst die Fotobox schon installiert, wird sie aktualisiert. Veranstaltungen, Fotos, Vorlagen und Einstellungen bleiben dabei erhalten.

[Tasks]
Name: "desktop"; Description: "Verknüpfungen auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"

[InstallDelete]
; Alte Programmdateien vollstaendig entfernen, bevor die neuen kommen - sonst
; blieben Dateien liegen, die es in der neuen Version nicht mehr gibt.
Type: filesandordirs; Name: "{app}\dist"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\node"

[Files]
Source: "{#Paket}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Wird schon vor dem Kopieren gebraucht, um die laufende Fotobox zu beenden.
Source: "..\Fotobox-beenden.ps1"; Flags: dontcopy

[Dirs]
; Der Datenordner gehoert allen Benutzern der Box - auch wenn der Installer
; ihn als Administrator anlegt. Bleibt bei der Deinstallation stehen.
Name: "{%PUBLIC}\Fotobox-Daten"; Permissions: users-modify; Flags: uninsneveruninstall

[Icons]
Name: "{group}\Fotobox Verwaltung"; Filename: "{app}\windows\Verwaltung oeffnen.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21
Name: "{group}\Kiosk starten"; Filename: "{app}\windows\Kiosk starten.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 137
Name: "{group}\Fotobox-Server starten"; Filename: "{app}\windows\Fotobox starten.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 24
Name: "{group}\Fotobox beenden"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Fotobox-beenden.ps1"" -Projektordner ""{app}"""; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 27
Name: "{group}\Datenordner"; Filename: "{%PUBLIC}\Fotobox-Daten"
Name: "{group}\Anleitungen"; Filename: "{app}\docs"
Name: "{group}\Fotobox deinstallieren"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Fotobox Verwaltung"; Filename: "{app}\windows\Verwaltung oeffnen.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21; Tasks: desktop
Name: "{autodesktop}\Kiosk starten"; Filename: "{app}\windows\Kiosk starten.bat"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 137; Tasks: desktop

[Run]
; Firewall-Freigabe, Energiesparen aus, keine Update-Neustarts - braucht Adminrechte.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Einrichtung.ps1"" -Teil System -Projektordner ""{app}"""; Flags: runhidden waituntilterminated; StatusMsg: "Windows für die Fotobox einstellen …"
; Autostart fuer den Benutzer, der an der Box angemeldet ist - nicht fuer das Administratorkonto.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Einrichtung.ps1"" -Teil Autostart -Projektordner ""{app}"""; Flags: runhidden waituntilterminated runasoriginaluser; StatusMsg: "Autostart einrichten …"
; Update: alles wieder starten wie vorher - auch bei einer stillen Installation aus der Verwaltung heraus.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Nach-Installation.ps1"" -Modus Update"; Flags: runhidden nowait runasoriginaluser; Check: WarUpdate
; Erstinstallation: Server starten und die Verwaltung oeffnen (der Kiosk erst, wenn eine PIN gesetzt ist).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Nach-Installation.ps1"" -Modus Erstinstallation"; Flags: runhidden nowait runasoriginaluser postinstall; Description: "Fotobox starten und die Verwaltung öffnen"; Check: IstErstinstallation
Filename: "https://digicamcontrol.com/download"; Flags: shellexec nowait postinstall unchecked runasoriginaluser; Description: "digiCamControl herunterladen (für die Kamera nötig, fehlt noch)"; Check: DigiCamControlFehlt

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Fotobox-beenden.ps1"" -Projektordner ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "Beenden"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\Einrichtung.ps1"" -Teil Entfernen -Projektordner ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "Entfernen"

[Code]
var
  Aktualisierung: Boolean;

function InitializeSetup(): Boolean;
var
  Schluessel: String;
begin
  Schluessel := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppIdRoh}_is1';
  Aktualisierung := RegKeyExists(HKLM64, Schluessel) or RegKeyExists(HKLM32, Schluessel);
  Result := True;
end;

function WarUpdate(): Boolean;
begin
  Result := Aktualisierung;
end;

function IstErstinstallation(): Boolean;
begin
  Result := not Aktualisierung;
end;

function DigiCamControlFehlt(): Boolean;
begin
  Result := not (FileExists(ExpandConstant('{commonpf64}\digiCamControl\CameraControl.exe')) or
                 FileExists(ExpandConstant('{commonpf32}\digiCamControl\CameraControl.exe')));
end;

// Vor dem Austausch der Dateien: Fotobox beenden und die Datenbank sichern.
// Laeuft der Server weiter, sind seine Dateien gesperrt und das Update
// scheitert mittendrin.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Ergebnis: Integer;
begin
  Result := '';
  ExtractTemporaryFile('Fotobox-beenden.ps1');
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\Fotobox-beenden.ps1') +
    '" -Projektordner "' + ExpandConstant('{app}') + '" -Sicherung',
    '', SW_HIDE, ewWaitUntilTerminated, Ergebnis);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    SuppressibleMsgBox('Die Fotobox ist entfernt.' + #13#10#13#10 +
      'Veranstaltungen, Fotos und Einstellungen liegen weiter unter' + #13#10 +
      ExpandConstant('{%PUBLIC}') + '\Fotobox-Daten' + #13#10#13#10 +
      'Wer sie nicht mehr braucht, löscht den Ordner von Hand.',
      mbInformation, MB_OK, IDOK);
end;
