import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Faengt einen Fehler in der Oberflaeche ab, bevor er sie ausloescht.
 *
 * Ohne diesen Schutz hinterlaesst eine einzige Ausnahme beim Zeichnen in React
 * eine leere weisse Seite - und am Kiosk steht niemand, der neu laedt. Hier
 * bekommt der Gast stattdessen "Kleine Pause", die Seite laedt sich nach
 * wenigen Sekunden selbst neu, und der Fehler landet im Protokoll der Box, wo
 * ihn der Besitzer spaeter findet.
 */
export class Absturzschutz extends Component<
  { kiosk: boolean; children: ReactNode },
  { fehler: Error | null }
> {
  override state: { fehler: Error | null } = { fehler: null };

  static getDerivedStateFromError(fehler: Error) {
    return { fehler };
  }

  override componentDidCatch(fehler: Error, info: ErrorInfo) {
    void fetch('/api/kiosk/meldung', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `${fehler.message}\n${fehler.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 4000),
      }),
    }).catch(() => undefined);
    if (this.props.kiosk) {
      window.setTimeout(() => window.location.replace('/'), 4000);
    }
  }

  override render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="absturz" role="alert">
        {this.props.kiosk ? (
          <>
            <p className="verbindung__titel">Kleine Pause.</p>
            <p className="verbindung__text">Gleich geht es weiter.</p>
          </>
        ) : (
          <>
            <p className="verbindung__titel">Hier ist etwas schiefgegangen.</p>
            <p className="verbindung__text">{this.state.fehler.message}</p>
            <button className="knopf" onClick={() => window.location.reload()}>
              Seite neu laden
            </button>
          </>
        )}
      </div>
    );
  }
}
