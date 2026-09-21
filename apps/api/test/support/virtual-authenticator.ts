import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, KeyObject } from 'crypto';
import * as cbor from 'cbor';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types';

/**
 * A real (not mocked) FIDO2/WebAuthn authenticator for tests, since there
 * is no browser/device here to produce a genuine ceremony response. It
 * generates a real P-256 keypair and produces byte-for-byte spec-shaped
 * CBOR attestationObject / authenticatorData / ECDSA signatures, so
 * @simplewebauthn/server's verifyRegistrationResponse and
 * verifyAuthenticationResponse run their real verification logic against
 * genuinely valid input rather than the ceremony being mocked away.
 * "none" attestation format (no attestation statement, no trust chain) —
 * matches what generateRegistrationOptions asks for (attestationType: 'none').
 */
export class VirtualAuthenticator {
  readonly credentialId: Buffer = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private signCount = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  private cosePublicKey(): Buffer {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const coseKey = new Map<number, number | Buffer>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]);
    return cbor.encode(coseKey);
  }

  /** Test-only escape hatch: force the NEXT assertion's embedded/signed
   * counter to an explicit value instead of auto-incrementing — real
   * cloned or reset authenticators don't politely keep counting up, and
   * a security-relevant check (the server's clone-detection logic) needs
   * a genuinely signed assertion carrying an arbitrary counter to test
   * against, not just a tampered-after-the-fact one that would only fail
   * signature verification instead of exercising that check. */
  private forcedNextCounter: number | null = null;
  forceNextCounter(counter: number): void {
    this.forcedNextCounter = counter;
  }

  private authenticatorData(rpID: string, includeAttestedCredentialData: boolean): Buffer {
    const rpIdHash = createHash('sha256').update(rpID).digest();
    if (this.forcedNextCounter !== null) {
      this.signCount = this.forcedNextCounter;
      this.forcedNextCounter = null;
    } else {
      this.signCount += 1;
    }
    const UP = 0x01;
    const UV = 0x04;
    const AT = 0x40;
    const flags = Buffer.from([UP | UV | (includeAttestedCredentialData ? AT : 0)]);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.signCount, 0);

    let attestedCredentialData = Buffer.alloc(0);
    if (includeAttestedCredentialData) {
      const aaguid = Buffer.alloc(16); // all-zero: acceptable for a virtual/software authenticator
      const credIdLen = Buffer.alloc(2);
      credIdLen.writeUInt16BE(this.credentialId.length, 0);
      attestedCredentialData = Buffer.concat([
        aaguid,
        credIdLen,
        this.credentialId,
        this.cosePublicKey(),
      ]);
    }
    return Buffer.concat([rpIdHash, flags, counter, attestedCredentialData]);
  }

  register(rpID: string, challenge: string, origin: string): RegistrationResponseJSON {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
      'utf8',
    );
    const authData = this.authenticatorData(rpID, true);
    const attestationObject = cbor.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: isoBase64URL.fromBuffer(this.credentialId),
      rawId: isoBase64URL.fromBuffer(this.credentialId),
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
      },
      clientExtensionResults: {},
      type: 'public-key',
    };
  }

  authenticate(rpID: string, challenge: string, origin: string): AuthenticationResponseJSON {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
      'utf8',
    );
    const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
    const authData = this.authenticatorData(rpID, false);
    const signature = cryptoSign('sha256', Buffer.concat([authData, clientDataHash]), this.privateKey);

    return {
      id: isoBase64URL.fromBuffer(this.credentialId),
      rawId: isoBase64URL.fromBuffer(this.credentialId),
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
      clientExtensionResults: {},
      type: 'public-key',
    };
  }
}
