/**
 * The public half of the engine's license signing key (Ed25519, SPKI PEM),
 * baked into every build per DR-31. The private half lives in the key tool in
 * the private repository and never enters this tree. A license file is a JSON
 * `{ claims, signature }` whose signature covers the canonical JSON of the
 * claims (`canonical-json.ts`).
 *
 * Read by the API at boot and by the install stepper before it writes a byte,
 * so the two verify against one key (§3.14). Rotating it is a release: every
 * license in the field is signed by the previous key and stops verifying
 * until re-issued.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEACgvdCChfpNtpIOAmiDVtanThJuCG5/viWCjStAGIpw0=
-----END PUBLIC KEY-----
`;
