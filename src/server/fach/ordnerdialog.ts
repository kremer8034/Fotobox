import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lesbarerFehler, OHNE_FORTSCHRITT } from '../treiber/powershell.js';

const fuehreAus = promisify(execFile);

/**
 * Der Ordnerdialog von Windows - derselbe moderne Explorer-Dialog wie beim
 * Oeffnen einer Datei, mit Schnellzugriff, OneDrive und USB-Sticks.
 *
 * Warum der Server ihn oeffnet und nicht der Browser: Der Browser waehlt zwar
 * Dateien aus (so kommt das Hintergrundbild hoch), verraet aber aus
 * Sicherheitsgruenden nie den Pfad eines Ordners. Fuer die Uebergabe braucht
 * es aber genau den.
 *
 * Der Dialog haengt an einem unsichtbaren, immer obenliegenden Fenster -
 * sonst ginge er hinter dem Browser auf, weil der Server im Hintergrund
 * laeuft und Windows ihm den Vordergrund nicht ueberlaesst.
 */
const DIALOG = `
${OHNE_FORTSCHRITT}
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FotoboxOrdnerdialog {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogKlasse { }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint anzahl, IntPtr filter);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr ereignisse, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint optionen);
    void GetOptions(out uint optionen);
    void SetDefaultFolder(IShellItem ordner);
    void SetFolder(IShellItem ordner);
    void GetFolder(out IShellItem ordner);
    void GetCurrentSelection(out IShellItem auswahl);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string titel);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetResult(out IShellItem ergebnis);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint art, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint maske, out uint attribute);
    void Compare(IShellItem anderes, uint hinweis, out int ergebnis);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string pfad, IntPtr pbc, ref Guid riid, out IShellItem item);

  const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  const uint SIGDN_FILESYSPATH = 0x80058000;

  public static string Waehle(IntPtr besitzer, string titel, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialogKlasse();
    dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog.SetTitle(titel);
    dialog.SetOkButtonLabel("Diesen Ordner wählen");
    if (!String.IsNullOrEmpty(start)) {
      try {
        Guid iid = typeof(IShellItem).GUID;
        IShellItem ordner;
        SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out ordner);
        dialog.SetFolder(ordner);
      } catch { }
    }
    int hr = dialog.Show(besitzer);
    if (hr != 0) return null;
    IShellItem ergebnis;
    dialog.GetResult(out ergebnis);
    string pfad;
    ergebnis.GetDisplayName(SIGDN_FILESYSPATH, out pfad);
    return pfad;
  }
}
"@
  if ($env:FOTOBOX_NUR_PRUEFEN -eq '1') { 'BEREIT'; exit 0 }
  $traeger = New-Object System.Windows.Forms.Form
  $traeger.TopMost = $true
  $traeger.ShowInTaskbar = $false
  $traeger.StartPosition = 'CenterScreen'
  $traeger.Size = New-Object System.Drawing.Size(1, 1)
  $traeger.Opacity = 0
  $traeger.Show()
  $traeger.Activate()
  $pfad = [FotoboxOrdnerdialog]::Waehle($traeger.Handle, $env:FOTOBOX_TITEL, $env:FOTOBOX_START)
  $traeger.Close()
  if ($pfad) { "PFAD:$pfad" } else { 'ABGEBROCHEN' }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}
`;

let offen = false;

/**
 * Oeffnet den Windows-Ordnerdialog auf dem Bildschirm der Box.
 * @returns den gewaehlten Pfad, oder null bei "Abbrechen"
 */
export async function waehleOrdner(titel: string, start = '', nurPruefen = false): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('Der Ordnerdialog von Windows steht nur auf der Fotobox selbst zur Verfügung.');
  }
  if (offen) throw new Error('Der Ordnerdialog ist schon offen - er liegt vielleicht hinter einem anderen Fenster.');
  offen = true;
  try {
    const { stdout } = await fuehreAus(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(DIALOG, 'utf16le').toString('base64')],
      {
        // Wer den Dialog offen laesst und geht, blockiert ihn nicht fuer immer.
        timeout: 10 * 60_000,
        windowsHide: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          FOTOBOX_TITEL: titel,
          FOTOBOX_START: start,
          FOTOBOX_NUR_PRUEFEN: nurPruefen ? '1' : '0',
        },
      },
    );
    return deuteDialogAntwort(stdout);
  } catch (fehler) {
    const f = fehler as { stderr?: string; killed?: boolean; message?: string };
    if (f?.killed) return null;
    throw new Error(lesbarerFehler(f?.stderr ?? '') || f?.message || String(fehler));
  } finally {
    offen = false;
  }
}

/** Die Ausgabe des Dialogs deuten: "PFAD:..." oder "ABGEBROCHEN" (bei der Pruefung "BEREIT"). */
export function deuteDialogAntwort(stdout: string): string | null {
  const zeile = stdout
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter(Boolean)
    .at(-1);
  if (zeile?.startsWith('PFAD:')) return zeile.slice(5);
  if (zeile === 'ABGEBROCHEN' || zeile === 'BEREIT') return null;
  throw new Error(`Unerwartete Antwort vom Ordnerdialog: "${(zeile ?? '').slice(0, 120)}"`);
}
