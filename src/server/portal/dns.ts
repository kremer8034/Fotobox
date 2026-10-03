import { createSocket, type Socket } from 'node:dgram';
import dnsPacket from 'dns-packet';
import { PORTAL_ADRESSE } from './adresse.js';

/**
 * Ein DNS-Dienst, der auf jeden Namen mit der Box antwortet.
 *
 * Fragt das Handy nach dem Beitritt "captive.apple.com" oder
 * "connectivitycheck.gstatic.com", landet es so bei der Box - und die
 * antwortet mit der Galerie statt mit "alles in Ordnung". Daran erkennt das
 * Handy ein Anmeldeportal und oeffnet es von selbst.
 *
 * IPv6-Anfragen (AAAA) bleiben leer: So bleibt das Handy auf IPv4, wo die Box
 * erreichbar ist. Kurze Lebensdauer (10 s), damit nach dem Verlassen des
 * WLANs nichts haengen bleibt.
 */

const TTL = 10;

/** Antwort auf eine DNS-Anfrage; null, wenn es keine lesbare Anfrage ist. Rein - testbar ohne Netz. */
export function beantworteDns(anfrage: Buffer, adresse = PORTAL_ADRESSE): Buffer | null {
  let paket: dnsPacket.Packet;
  try {
    paket = dnsPacket.decode(anfrage);
  } catch {
    return null;
  }
  if (paket.type !== 'query' || !paket.questions?.length) return null;
  const answers: dnsPacket.Answer[] = paket.questions
    .filter((f) => f.type === 'A')
    .map((f) => ({ type: 'A', name: f.name, ttl: TTL, data: adresse }));
  return dnsPacket.encode({
    type: 'response',
    id: paket.id,
    flags: dnsPacket.AUTHORITATIVE_ANSWER | ((paket.flags ?? 0) & dnsPacket.RECURSION_DESIRED),
    questions: paket.questions,
    answers,
  });
}

export class DnsDienst {
  private socket: Socket | null = null;

  constructor(
    private readonly adresse = PORTAL_ADRESSE,
    private readonly port = 53,
    private readonly melde: (text: string) => void = () => undefined,
  ) {}

  get laeuft(): boolean {
    return this.socket !== null;
  }

  async starte(): Promise<void> {
    if (this.socket) return;
    const socket = createSocket('udp4');
    await new Promise<void>((fertig, fehler) => {
      socket.once('error', fehler);
      socket.bind(this.port, this.adresse, () => {
        socket.off('error', fehler);
        fertig();
      });
    });
    socket.on('error', (f) => this.melde(`DNS: ${f.message}`));
    socket.on('message', (anfrage, absender) => {
      const antwort = beantworteDns(anfrage, this.adresse);
      if (antwort) socket.send(antwort, absender.port, absender.address);
    });
    this.socket = socket;
  }

  async stoppe(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (socket) await new Promise<void>((fertig) => socket.close(() => fertig()));
  }
}
